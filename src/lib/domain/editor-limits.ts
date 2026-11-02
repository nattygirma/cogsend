import { storedXLimit } from './x-limits';

/**
 * Character limits per platform, in one place. X's real limit is the
 * account's own (280, or 25,000 on a paid plan), so this is its fallback.
 */
export const PLATFORM_LIMITS = {
	bluesky: 300,
	linkedin: 3000,
	threads: 500,
	instagram: 2200,
	// A Page post; YouTube's is the description (5,000 bytes, checked again
	// by the provider), TikTok's the caption.
	facebook: 63206,
	youtube: 5000,
	tiktok: 2200,
	x: 280
} as const;

export type LimitedPlatform = keyof typeof PLATFORM_LIMITS;

/** For a platform with no entry above. */
const DEFAULT_LIMIT = 500;

/** Platforms added after the per-platform parameters below: each posts the
 *  thread flattened into one post, counted in graphemes. */
export const SINGLE_POST_PLATFORMS = ['facebook', 'youtube', 'tiktok'] as const;

/** The accounts a limit is computed from: what the composer can actually reach. */
export interface LimitedAccount {
	platform: string;
	metaJson?: { maxCharacters?: number } | null;
}

/**
 * The strictest limit among the given accounts for one platform.
 *
 * Callers pass the *selected* accounts. Passing every connected one is the bug
 * this signature exists to prevent: an unselected 280-character X account
 * used to cap a post bound for a 25,000-character one, blocking text the
 * target would have accepted.
 */
export function platformLimit(platform: string, accounts: LimitedAccount[]): number {
	const fallback = PLATFORM_LIMITS[platform as LimitedPlatform] ?? DEFAULT_LIMIT;
	if (platform === 'x') {
		// An account with no stored limit (via Zernio, or connected before long
		// posts) is a 280 one, and one such account holds the whole post to it.
		const maxes = accounts
			.filter((account) => account.platform === 'x')
			.map((account) => storedXLimit(account.metaJson?.maxCharacters));
		return maxes.length ? Math.min(...maxes) : fallback;
	}
	return fallback;
}

export function isOverSelectedPlatformLimit(params: {
	selectedPlatforms: Iterable<string>;
	blueskyLen: number;
	blueskyMax?: number;
	linkedinLen?: number;
	linkedinMax?: number;
	threadsLen?: number;
	threadsMax?: number;
	instagramLen?: number;
	instagramMax?: number;
	xLen?: number;
	xMax?: number;
}): boolean {
	const selected = new Set(params.selectedPlatforms);
	const blueskyMax = params.blueskyMax ?? PLATFORM_LIMITS.bluesky;
	const linkedinMax = params.linkedinMax ?? PLATFORM_LIMITS.linkedin;
	const threadsMax = params.threadsMax ?? PLATFORM_LIMITS.threads;
	const instagramMax = params.instagramMax ?? PLATFORM_LIMITS.instagram;
	const xMax = params.xMax ?? PLATFORM_LIMITS.x;
	if (selected.has('bluesky') && params.blueskyLen > blueskyMax) return true;
	if (selected.has('linkedin') && (params.linkedinLen ?? 0) > linkedinMax) return true;
	if (selected.has('threads') && (params.threadsLen ?? 0) > threadsMax) return true;
	if (selected.has('instagram') && (params.instagramLen ?? 0) > instagramMax) return true;
	if (selected.has('x') && (params.xLen ?? 0) > xMax) return true;
	return false;
}
