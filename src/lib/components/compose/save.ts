import { hasOptions } from '#lib/domain/platform-options.js';
import type { TikTokOptions, YouTubeOptions } from '#lib/domain/platform-options.js';
import type { PlatformOverrideMap } from '#lib/domain/platform-sync.js';

/** The editor's state as one save takes it, so later typing cannot leak in. */
export type SaveSnapshot = {
	baseBody: string;
	overrides: PlatformOverrideMap;
	youtubeOptions: YouTubeOptions;
	tiktokOptions: TikTokOptions;
	selectedConnectionIds: string[];
};

/** The options a platform's draft variant stores. */
export function variantOptionsFor(platform: string, snap: SaveSnapshot): Record<string, unknown> {
	if (platform === 'youtube') return { ...snap.youtubeOptions };
	if (platform === 'tiktok') return { ...snap.tiktokOptions };
	return {};
}

/**
 * Whether the platform's settings alone need a variant row: YouTube's and
 * TikTok's as soon as one choice is made. A customized body needs one either
 * way.
 */
export function optionsNeedVariant(platform: string, snap: SaveSnapshot): boolean {
	if (platform === 'youtube' || platform === 'tiktok')
		return hasOptions(variantOptionsFor(platform, snap));
	return false;
}
