/**
 * What the composer's preview draws for each selected account: the text and
 * media that account will publish, and which of its platform's screens it
 * lands on (an Instagram Reel or feed post, a YouTube Short or watch page).
 */
import { effectivePlatformBody, type PlatformOverrideMap } from './platform-sync';
import { flattenThreadBody, splitThreadSegments } from './thread-segments';
import {
	displayHandle,
	isPlatformId,
	platformName,
	supportsThreads,
	type PlatformId
} from './platforms';
import { groupMediaBySegment } from './media-limits';
import { aspectOf, isVideoMedia } from './media-layout';

type PreviewMedia = {
	mime?: string | null;
	width?: number | null;
	height?: number | null;
	segmentIndex?: number | null;
	meta?: { durationMs?: number | null } | null;
};

export type PreviewAccount = {
	id: string;
	platform: PlatformId;
	name: string;
	/** Without the leading @; each platform adds its own. */
	handle: string;
	avatarUrl: string | null;
};

export type PreviewPost<M> = { text: string; media: M[] };

export type AccountPreview<M> = {
	account: PreviewAccount;
	/** One post on single-post platforms; the thread on X and Threads. */
	posts: PreviewPost<M>[];
};

export function previewAccount(c: {
	id: string;
	platform: string;
	handle: string | null;
	displayName: string | null;
	avatarUrl?: string | null;
}): PreviewAccount | null {
	if (!isPlatformId(c.platform)) return null;
	const handle = displayHandle(c.handle).replace(/^@/, '');
	return {
		id: c.id,
		platform: c.platform,
		name: c.displayName || handle || platformName(c.platform),
		handle: handle || (c.displayName || 'you').toLowerCase().replace(/\s+/g, ''),
		avatarUrl: c.avatarUrl || null
	};
}

/** Each account's post as it will publish: its platform's text, split into a
 *  thread where the platform threads, else flattened with every attachment. */
export function accountPreviews<M extends PreviewMedia>(opts: {
	accounts: Array<Parameters<typeof previewAccount>[0]>;
	baseBody: string;
	overrides: PlatformOverrideMap;
	media: M[];
}): AccountPreview<M>[] {
	const bySegment = groupMediaBySegment(opts.media);
	const out: AccountPreview<M>[] = [];
	for (const c of opts.accounts) {
		const account = previewAccount(c);
		if (!account) continue;
		const body = effectivePlatformBody(opts.baseBody, opts.overrides, account.platform);
		const posts = supportsThreads(account.platform)
			? splitThreadSegments(body).map((text, i) => ({ text, media: bySegment.get(i) ?? [] }))
			: [{ text: flattenThreadBody(body), media: opts.media }];
		out.push({ account, posts });
	}
	return out;
}

/** Instagram publishes a video as a Reel, several photos as a carousel. */
export function instagramFormat(media: PreviewMedia[]): 'reel' | 'carousel' | 'post' {
	if (media.some(isVideoMedia)) return 'reel';
	return media.length > 1 ? 'carousel' : 'post';
}

// YouTube files a square or vertical video of up to three minutes as a Short.
const SHORT_MAX_MS = 3 * 60 * 1000;

export function youtubeFormat(media: PreviewMedia[]): 'short' | 'video' {
	const video = media.find(isVideoMedia);
	if (!video) return 'video';
	const aspect = aspectOf(video);
	const duration = video.meta?.durationMs;
	if (aspect === null || aspect > 1) return 'video';
	return duration != null && duration > SHORT_MAX_MS ? 'video' : 'short';
}

/** The caption cut where the platform folds it behind "more"; whole when it fits. */
export function foldText(text: string, max: number): { shown: string; folded: boolean } {
	const chars = [...text];
	const lines = text.split('\n');
	if (chars.length <= max && lines.length <= 4) return { shown: text, folded: false };
	let shown = chars.slice(0, max).join('');
	const cutLines = shown.split('\n');
	if (cutLines.length > 4) shown = cutLines.slice(0, 4).join('\n');
	return { shown: shown.trimEnd(), folded: true };
}
