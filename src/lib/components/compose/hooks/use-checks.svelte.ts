import {
	effectivePlatformBody,
	type PlatformId,
	isPlatformCustomized
} from '#lib/domain/platform-sync.js';
import {
	flattenThreadBody,
	maxThreadSegmentLength,
	splitThreadSegments
} from '#lib/domain/thread-segments.js';
import { countGraphemes, xWeightedLength } from '#lib/domain/validation/text.js';
import {
	PLATFORM_LIMITS,
	SINGLE_POST_PLATFORMS,
	type LimitedPlatform,
	isOverSelectedPlatformLimit
} from '#lib/domain/editor-limits.js';
import { utf8ByteLength } from '#lib/domain/bytes.js';
import {
	LINKEDIN_MAX_IMAGES,
	instagramMediaProblems,
	postMediaProblems,
	groupMediaBySegment
} from '#lib/domain/media-limits.js';
import { youtubeOptionProblems, tiktokOptionProblems } from '#lib/domain/platform-options.js';
import { supportsThreads } from '#lib/domain/platforms.js';
import type { MediaItem } from '../types';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** What each selected platform would refuse, worked out as the post changes. */
export interface ChecksApi {
	readonly blueskyBytesOver: number;
	readonly cardMedia: (index: number) => MediaItem[];
	readonly counters: Record<
		'youtube' | 'x' | 'tiktok' | 'threads' | 'linkedin' | 'instagram' | 'facebook' | 'bluesky',
		{ len: number; max: number }
	>;
	readonly getPlatformStatus: (platform: PlatformId) => {
		isCustomized: boolean;
		hasError: boolean;
	};
	readonly instagramMediaProblem: string | null;
	readonly linkedinMediaOver: boolean;
	readonly linkedinMediaProblem: string | null;
	readonly mediaBySegment: Map<number, MediaItem[]>;
	readonly overSelectedLimit: boolean;
	readonly singlePostProblems: Map<PlatformId, { message: string; media: boolean }>;
	readonly threadsLinkCount: number;
	readonly threadsLinksOver: boolean;
}

export function useChecks(ed: Composer): void {
	// Publish-time validation across the SELECTED platforms (unchanged rules).
	const counters = $derived.by(() => {
		const bskyText = effectivePlatformBody(ed.baseBody, ed.overrides, 'bluesky');
		const linkedinText = effectivePlatformBody(ed.baseBody, ed.overrides, 'linkedin');
		const threadsText = effectivePlatformBody(ed.baseBody, ed.overrides, 'threads');
		const instagramText = effectivePlatformBody(ed.baseBody, ed.overrides, 'instagram');
		const xText = effectivePlatformBody(ed.baseBody, ed.overrides, 'x');
		const linkedinFlat = flattenThreadBody(linkedinText);
		return {
			bluesky: {
				len: maxThreadSegmentLength(bskyText, countGraphemes),
				max: PLATFORM_LIMITS.bluesky
			},
			linkedin: { len: countGraphemes(linkedinFlat), max: PLATFORM_LIMITS.linkedin },
			threads: {
				len: maxThreadSegmentLength(threadsText, countGraphemes),
				max: PLATFORM_LIMITS.threads
			},
			instagram: {
				len: countGraphemes(flattenThreadBody(instagramText)),
				max: PLATFORM_LIMITS.instagram
			},
			x: {
				len: maxThreadSegmentLength(xText, xWeightedLength),
				max: ed.platformMax('x', ed.accountsFor('x'))
			},
			...Object.fromEntries(
				SINGLE_POST_PLATFORMS.map((platform) => [
					platform,
					{
						len: countGraphemes(
							flattenThreadBody(effectivePlatformBody(ed.baseBody, ed.overrides, platform))
						),
						max: PLATFORM_LIMITS[platform]
					}
				])
			)
		} as Record<LimitedPlatform, { len: number; max: number }>;
	});
	const blueskyBytesOver = $derived.by(() => {
		const bskyText = effectivePlatformBody(ed.baseBody, ed.overrides, 'bluesky');
		let over = 0;
		for (const seg of splitThreadSegments(bskyText)) {
			over = Math.max(over, utf8ByteLength(seg) - 3000);
		}
		return over;
	});
	const threadsLinkCount = $derived.by(() => {
		const text = effectivePlatformBody(ed.baseBody, ed.overrides, 'threads');
		const found = text.match(/https?:\/\/[^\s]+/gi) ?? [];
		const urls = new Set(
			found.map((u) => u.replace(/[.,);:!?]+$/, '').toLowerCase()).filter(Boolean)
		);
		return urls.size;
	});
	const threadsLinksOver = $derived(threadsLinkCount > 5 && ed.selectedPlatforms.has('threads'));
	// LinkedIn flattens the whole thread into one post, so its media rules
	// apply to the combined attachments rather than per segment.
	const linkedinMediaProblem = $derived.by(() => {
		if (!ed.selectedPlatforms.has('linkedin')) return null;
		if (ed.media.length > LINKEDIN_MAX_IMAGES) {
			return `LinkedIn combines the thread into one post — max ${LINKEDIN_MAX_IMAGES} images (${ed.media.length} attached)`;
		}
		const videos = ed.media.filter((m) => (m.mime || '').toLowerCase().startsWith('video/'));
		const images = ed.media.filter((m) => !(m.mime || '').toLowerCase().startsWith('video/'));
		if (videos.length > 1) return 'LinkedIn allows one video per post';
		if (videos.length > 0 && images.length > 0) return 'LinkedIn video posts cannot include images';
		return null;
	});
	const linkedinMediaOver = $derived(linkedinMediaProblem !== null);
	// Instagram also flattens the thread, and is the one platform that refuses
	// a post without a photo or video.
	const instagramMediaProblem = $derived.by(() => {
		if (!ed.selectedPlatforms.has('instagram')) return null;
		const problems = instagramMediaProblems(
			ed.media.map((m) => ({
				mime: m.mime,
				width: m.width,
				height: m.height,
				hasJpegCopy: ed.canMakeJpegCopies || Boolean(m.meta?.jpeg)
			}))
		);
		return problems[0] ?? null;
	});
	// Facebook, YouTube and TikTok post one flattened post, and the last two a
	// video with settings only the person can choose. Each is checked as the
	// whole post: a missing video or choice is certain to fail.
	const singlePostProblems = $derived.by(() => {
		const out = new Map<PlatformId, { message: string; media: boolean }>();
		for (const platform of SINGLE_POST_PLATFORMS) {
			if (!ed.selectedPlatforms.has(platform)) continue;
			const mediaProblem = postMediaProblems(platform, ed.media)[0];
			if (mediaProblem) {
				out.set(platform, { message: mediaProblem, media: true });
				continue;
			}
			const text = flattenThreadBody(effectivePlatformBody(ed.baseBody, ed.overrides, platform));
			const optionProblem =
				platform === 'youtube'
					? youtubeOptionProblems(ed.youtubeOptions, text)[0]
					: platform === 'tiktok'
						? tiktokOptionProblems(ed.tiktokOptions)[0]
						: undefined;
			if (optionProblem) out.set(platform, { message: optionProblem, media: false });
		}
		return out;
	});
	const overSelectedLimit = $derived(
		isOverSelectedPlatformLimit({
			selectedPlatforms: ed.selectedPlatforms,
			blueskyLen: counters.bluesky.len,
			blueskyMax: counters.bluesky.max,
			linkedinLen: counters.linkedin.len,
			linkedinMax: counters.linkedin.max,
			threadsLen: counters.threads.len,
			threadsMax: counters.threads.max,
			instagramLen: counters.instagram.len,
			instagramMax: counters.instagram.max,
			xLen: counters.x.len,
			xMax: counters.x.max
		}) ||
			threadsLinksOver ||
			linkedinMediaOver ||
			SINGLE_POST_PLATFORMS.some(
				(platform) =>
					ed.selectedPlatforms.has(platform) && counters[platform].len > counters[platform].max
			) ||
			(blueskyBytesOver > 0 &&
				(ed.selectedPlatforms.has('bluesky') || isPlatformCustomized(ed.overrides, 'bluesky')))
	);

	function getPlatformStatus(platform: PlatformId) {
		const isCustomized = isPlatformCustomized(ed.overrides, platform);
		const text = effectivePlatformBody(ed.baseBody, ed.overrides, platform);
		const max = ed.platformMax(platform, ed.accountsFor(platform));
		const countFn = (s: string) => ed.countForPlatform(s, platform);
		return {
			isCustomized,
			hasError: supportsThreads(platform)
				? maxThreadSegmentLength(text, countFn) > max
				: countFn(flattenThreadBody(text)) > max
		};
	}

	const mediaBySegment = $derived(groupMediaBySegment(ed.media));
	// Single-post platforms (LinkedIn) render one flattened card, which must
	// show every attachment publish will combine — not just segment 0's.
	function cardMedia(index: number): MediaItem[] {
		if (ed.activeTab !== 'global' && !supportsThreads(ed.activeTab)) return ed.media;
		return mediaBySegment.get(index) ?? [];
	}

	field(ed, 'blueskyBytesOver', () => blueskyBytesOver);
	field(ed, 'counters', () => counters);
	field(ed, 'instagramMediaProblem', () => instagramMediaProblem);
	field(ed, 'linkedinMediaOver', () => linkedinMediaOver);
	field(ed, 'linkedinMediaProblem', () => linkedinMediaProblem);
	field(ed, 'mediaBySegment', () => mediaBySegment);
	field(ed, 'overSelectedLimit', () => overSelectedLimit);
	field(ed, 'singlePostProblems', () => singlePostProblems);
	field(ed, 'threadsLinkCount', () => threadsLinkCount);
	field(ed, 'threadsLinksOver', () => threadsLinksOver);
	provide(ed, { cardMedia, getPlatformStatus });
}
