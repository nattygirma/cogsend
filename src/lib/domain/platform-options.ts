/**
 * Settings a post carries for one platform beyond its text, stored in that
 * platform's draft variant (`options_json`). YouTube and TikTok need choices
 * only the person can make — a title, who can watch — so they live with the
 * post, are chosen in the composer, and are read back here with every field
 * checked: an API client or an older draft can hand in anything.
 */

export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

export interface YouTubeOptions {
	/** Up to 100 characters; the first line of the post when left empty. */
	title?: string;
	privacy?: YouTubePrivacy;
	/** YouTube requires the uploader to say; unset blocks publishing. */
	madeForKids?: boolean;
	notifySubscribers?: boolean;
}

export interface TikTokOptions {
	/** One of the levels creator_info offered; unset blocks publishing, as
	 *  TikTok's guidelines forbid a default. */
	privacyLevel?: string;
	allowComment?: boolean;
	allowDuet?: boolean;
	allowStitch?: boolean;
	/** The disclosure switch itself: on, it needs one of the two kinds below
	 *  before the post can go out. */
	discloseCommercial?: boolean;
	/** Commercial content disclosure: promoting the creator's own brand. */
	brandOrganic?: boolean;
	/** Commercial content disclosure: a paid partnership. */
	brandedContent?: boolean;
	aiGenerated?: boolean;
	/** Upload to the creator's TikTok inbox as a draft, finished and posted in
	 *  the TikTok app: the person picks the audience and caption there. Works
	 *  before TikTok has audited the app, which can only post to private accounts. */
	sendToDrafts?: boolean;
}

export const YOUTUBE_PRIVACY: YouTubePrivacy[] = ['private', 'unlisted', 'public'];
export const YOUTUBE_MAX_TITLE = 100;

/** TikTok's privacy levels, in the words its guidelines use. */
export const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
	PUBLIC_TO_EVERYONE: 'Everyone',
	MUTUAL_FOLLOW_FRIENDS: 'Friends',
	FOLLOWER_OF_CREATOR: 'Followers',
	SELF_ONLY: 'Only me'
};

function bool(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function compact<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined)
	) as unknown as T;
}

export function parseYouTubeOptions(raw: unknown): YouTubeOptions {
	if (!raw || typeof raw !== 'object') return {};
	const o = raw as Record<string, unknown>;
	const title = typeof o.title === 'string' ? o.title.slice(0, 500) : undefined;
	const privacy = YOUTUBE_PRIVACY.includes(o.privacy as YouTubePrivacy)
		? (o.privacy as YouTubePrivacy)
		: undefined;
	return compact({
		title,
		privacy,
		madeForKids: bool(o.madeForKids),
		notifySubscribers: bool(o.notifySubscribers)
	});
}

export function parseTikTokOptions(raw: unknown): TikTokOptions {
	if (!raw || typeof raw !== 'object') return {};
	const o = raw as Record<string, unknown>;
	const privacyLevel =
		typeof o.privacyLevel === 'string' && /^[A-Z_]{1,64}$/.test(o.privacyLevel)
			? o.privacyLevel
			: undefined;
	return compact({
		privacyLevel,
		allowComment: bool(o.allowComment),
		allowDuet: bool(o.allowDuet),
		allowStitch: bool(o.allowStitch),
		discloseCommercial: bool(o.discloseCommercial),
		brandOrganic: bool(o.brandOrganic),
		brandedContent: bool(o.brandedContent),
		aiGenerated: bool(o.aiGenerated),
		sendToDrafts: bool(o.sendToDrafts)
	});
}

/** The title YouTube gets: the chosen one, else the post's first line. */
export function youtubeTitle(options: YouTubeOptions, text: string): string {
	const chosen = options.title?.trim();
	if (chosen) return chosen;
	const firstLine = text.split('\n').find((line) => line.trim()) ?? '';
	return firstLine.trim();
}

/** What is missing or wrong in the YouTube settings, worst first. */
export function youtubeOptionProblems(options: YouTubeOptions, text: string): string[] {
	const problems: string[] = [];
	const title = youtubeTitle(options, text);
	if (!title) problems.push('YouTube needs a title');
	else if ([...title].length > YOUTUBE_MAX_TITLE)
		problems.push(`YouTube titles are up to ${YOUTUBE_MAX_TITLE} characters`);
	if (/[<>]/.test(title)) problems.push('YouTube titles cannot contain < or >');
	if (options.madeForKids === undefined)
		problems.push('Say whether the video is made for kids in the YouTube settings');
	return problems;
}

/** What is missing or contradictory in the TikTok settings, worst first. */
export function tiktokOptionProblems(options: TikTokOptions): string[] {
	const problems: string[] = [];
	// A draft's audience and disclosures are chosen in the TikTok app.
	if (options.sendToDrafts) return problems;
	if (!options.privacyLevel) problems.push('Choose who can watch the video in the TikTok settings');
	if (options.discloseCommercial && !options.brandOrganic && !options.brandedContent)
		problems.push('Say what the commercial content is in the TikTok settings');
	if (options.brandedContent && options.privacyLevel === 'SELF_ONLY')
		problems.push('Branded content on TikTok cannot be private');
	return problems;
}

/** The label TikTok requires once commercial content is disclosed. */
export function tiktokDisclosureLabel(options: TikTokOptions): string | null {
	if (options.brandedContent) return 'Paid partnership';
	if (options.brandOrganic) return 'Promotional content';
	return null;
}

export interface VideoPlatformOptions {
	youtube: YouTubeOptions;
	tiktok: TikTokOptions;
}

/** The settings stored on a draft's YouTube and TikTok variants. */
export function videoOptionsFromVariants(
	variants: Array<{ platform: string; optionsJson?: unknown }> | null | undefined
): VideoPlatformOptions {
	const out: VideoPlatformOptions = { youtube: {}, tiktok: {} };
	for (const variant of variants ?? []) {
		if (variant.platform === 'youtube') out.youtube = parseYouTubeOptions(variant.optionsJson);
		if (variant.platform === 'tiktok') out.tiktok = parseTikTokOptions(variant.optionsJson);
	}
	return out;
}

/** True when a settings object holds any choice worth storing. */
export function hasOptions(options: object): boolean {
	return Object.values(options).some((value) => value !== undefined);
}
