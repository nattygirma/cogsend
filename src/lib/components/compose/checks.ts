import { PLATFORM_ORDER, platformName } from '#lib/domain/platforms.js';
import {
	tiktokOptionProblems,
	youtubeOptionProblems,
	type TikTokOptions,
	type YouTubeOptions
} from '#lib/domain/platform-options.js';

export type ComposeCheck = {
	key: string;
	/** The platform it concerns, which can be unchecked; null for the post. */
	platform: string | null;
	message: string;
	level: 'error' | 'warn';
	href?: string;
	hrefLabel?: string;
};

export interface ChecksInput {
	connectionCount: number;
	selectedCount: number;
	selectedPlatforms: Set<string>;
	/** Media or settings a single-post platform refuses, one per platform. */
	singlePostProblems: Map<string, { message: string }>;
	/** Attachments a platform would refuse or alter, as the cards show them. */
	fitProblems: Array<{ platform: string; message: string; level: 'error' | 'warn' }>;
	/** Each selected platform's text limit, for those the text is over. */
	overLimit: Array<{ platform: string; max: number }>;
	threadsLinks: number;
	blueskyBytesOver: number;
}

/**
 * Everything that would stop or change the post, in one list beside the
 * editor: the same rules the publish guards enforce, said before the click.
 * A rule two sources report (a card and the thread) is listed once.
 */
export function composeChecks(input: ChecksInput): ComposeCheck[] {
	const out: ComposeCheck[] = [];
	const add = (check: Omit<ComposeCheck, 'key'>) => {
		const key = `${check.platform ?? ''}:${check.message}`;
		if (!out.some((c) => c.key === key)) out.push({ ...check, key });
	};
	if (input.connectionCount === 0) {
		add({
			platform: null,
			message: 'Connect an account to start posting',
			level: 'warn',
			href: '/accounts',
			hrefLabel: 'Connect accounts'
		});
	} else if (input.selectedCount === 0) {
		add({ platform: null, message: 'Choose at least one account to post to', level: 'warn' });
	}
	for (const [platform, problem] of input.singlePostProblems) {
		add({ platform, message: problem.message, level: 'error' });
	}
	for (const row of input.fitProblems) {
		add({ platform: row.platform, message: row.message, level: row.level });
	}
	const over = [...input.overLimit].sort(
		(a, b) =>
			PLATFORM_ORDER.indexOf(a.platform as never) - PLATFORM_ORDER.indexOf(b.platform as never)
	);
	for (const { platform, max } of over) {
		add({
			platform,
			message: `${platformName(platform)}: the text is over its ${max.toLocaleString()}-character limit`,
			level: 'error'
		});
	}
	if (input.threadsLinks > 5 && input.selectedPlatforms.has('threads')) {
		add({
			platform: 'threads',
			message: `Threads allows up to 5 links per post (${input.threadsLinks} found)`,
			level: 'error'
		});
	}
	if (input.blueskyBytesOver > 0 && input.selectedPlatforms.has('bluesky')) {
		add({ platform: 'bluesky', message: 'A Bluesky post is over 3,000 bytes', level: 'error' });
	}
	return out;
}

type SettingsInput = {
	selectedPlatforms: Set<string>;
	youtube: YouTubeOptions;
	youtubeText: string;
	tiktok: TikTokOptions;
};

/** Per platform, the settings still to choose before the post can go there. */
export function requiredSettingsByPlatform(
	input: SettingsInput
): Partial<Record<'youtube' | 'tiktok', number>> {
	const out: Partial<Record<'youtube' | 'tiktok', number>> = {};
	if (input.selectedPlatforms.has('youtube'))
		out.youtube = youtubeOptionProblems(input.youtube, input.youtubeText).length;
	if (input.selectedPlatforms.has('tiktok')) out.tiktok = tiktokOptionProblems(input.tiktok).length;
	return out;
}

/** Settings still to choose before the post can go to YouTube or TikTok. */
export function requiredSettingsCount(input: SettingsInput): number {
	const byPlatform = requiredSettingsByPlatform(input);
	return (byPlatform.youtube ?? 0) + (byPlatform.tiktok ?? 0);
}
