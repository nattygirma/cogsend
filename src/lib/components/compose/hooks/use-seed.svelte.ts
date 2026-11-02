import { page } from '$app/state';
import { overridesFromVariants, restorableTargetIds } from '#lib/domain/platform-sync.js';
import { videoOptionsFromVariants } from '#lib/domain/platform-options.js';
import type { EditorDraft } from '../types';
import type { PlatformId } from '#lib/domain/platforms.js';
import type { PlatformOverride } from '#lib/domain/platform-sync.js';
import type { VideoPlatformOptions } from '#lib/domain/platform-options.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** What the composer opened with: the URL, the server-rendered draft and its saved settings. */
export interface SeedApi {
	readonly composeUrl: typeof page.url;
	readonly isMediaFile: (type: string) => boolean;
	readonly seededBody: string;
	readonly seededDraft: EditorDraft | null;
	readonly seededMedia: {
		segmentIndex: number;
		id: string;
		storageKey: string;
		mime: string;
		size?: number | undefined;
		width?: number | null | undefined;
		height?: number | null | undefined;
		altText: string | null;
		previewUrl?: string | undefined;
		meta?:
			| {
					durationMs?: number | null | undefined;
					videoCodec?: string | null | undefined;
					fps?: number | null | undefined;
					faststart?: boolean | null | undefined;
					cover?: { v: number; atMs?: number | undefined } | null | undefined;
					jpeg?: { v: number } | null | undefined;
			  }
			| null
			| undefined;
	}[];
	readonly seededOverrides: Partial<Record<PlatformId, PlatformOverride>>;
	readonly seededSelection: string[] | null;
	readonly seededVideoOptions: VideoPlatformOptions;
	readonly SKIP_ASK_KEY: 'posteasy-skip-publish-confirm';
}

export function useSeed(ed: Composer): void {
	// Opened over another page, the composer's URL is the link that opened it
	// (page.url stays that page's); either way it is the last real navigation's.
	const composeUrl = $derived(
		page.state.composerHref ? new URL(page.state.composerHref, page.url.origin) : page.url
	);

	// The open draft is rendered with the page. A later id change still fetches.
	function openedDraft(): EditorDraft | null {
		const id = composeUrl.searchParams.get('id');
		if (!ed.initialDraft || !id || ed.initialDraft.id !== id) return null;
		return ed.initialDraft;
	}
	const seededDraft = openedDraft();
	const seededBody = seededDraft?.baseBody || '';
	const seededOverrides = seededDraft
		? overridesFromVariants(
				(seededDraft.variants || []).map((variant) => ({
					platform: variant.platform,
					body: variant.body ?? null
				})),
				seededBody
			)
		: {};
	const seededMedia = (seededDraft?.media || []).map((m) => ({
		...m,
		segmentIndex: m.segmentIndex ?? 0
	}));
	const seededVideoOptions = videoOptionsFromVariants(seededDraft?.variants);
	const seededSelection = (() => {
		const saved = seededDraft?.selectedConnectionIds;
		if (Array.isArray(saved)) return saved;
		const targetIds = restorableTargetIds(seededDraft?.targets);
		return targetIds.length ? targetIds : null;
	})();

	const isMediaFile = (type: string) => type.startsWith('image/') || type.startsWith('video/');

	const SKIP_ASK_KEY = 'posteasy-skip-publish-confirm';

	field(ed, 'composeUrl', () => composeUrl);
	provide(ed, {
		isMediaFile,
		seededBody,
		seededDraft,
		seededMedia,
		seededOverrides,
		seededSelection,
		seededVideoOptions,
		SKIP_ASK_KEY
	});
}
