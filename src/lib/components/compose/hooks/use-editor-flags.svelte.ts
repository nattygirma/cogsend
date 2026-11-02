import type { YouTubeOptions, TikTokOptions } from '#lib/domain/platform-options.js';
import type { VideoJob } from '../types';
import type { PlatformId } from '#lib/domain/platform-sync.js';
import { onMount } from 'svelte';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Per-platform options, media jobs, save and popover flags. */
export interface EditorFlagsApi {
	altOpen: Record<string, boolean>;
	busyAction: 'publish' | 'schedule' | null;
	coverBusy: boolean;
	coverFor: string | null;
	didInitSelection: boolean;
	dirty: boolean;
	fileRefs: (HTMLInputElement | null)[];
	focusedSegment: number;
	isAccountsPopoverOpen: boolean;
	isAddOverrideOpen: boolean;
	isPostConfirmOpen: boolean;
	loadFailedId: string | null;
	loadingDraftId: string | null;
	mediaSync: Promise<void>;
	mounted: boolean;
	pendingSelected: string[] | null;
	publishBusyTimer: NodeJS.Timeout | null;
	publishBusyVisible: boolean;
	reconnecting: string | null;
	savedSnapshot: string | null;
	saveFailed: boolean;
	selectionTouched: boolean;
	readonly setLocalFlag: (key: string, on: boolean) => void;
	skipAsk: boolean;
	storedVariants: Set<PlatformId>;
	textareaRefs: (HTMLTextAreaElement | null)[];
	tiktokOptions: TikTokOptions;
	uploadingSegment: number | null;
	videoJobs: VideoJob[];
	youtubeOptions: YouTubeOptions;
}

export function useEditorFlags(ed: Composer): void {
	// Snapshot on purpose: defaults apply to a fresh editor only.
	let youtubeOptions = $state<YouTubeOptions>(ed.seededVideoOptions.youtube);
	let tiktokOptions = $state<TikTokOptions>(ed.seededVideoOptions.tiktok);
	let focusedSegment = $state(0);
	let uploadingSegment = $state<number | null>(null);
	let videoJobs = $state<VideoJob[]>([]);
	let coverFor = $state<string | null>(null);
	let coverBusy = $state(false);
	let dirty = $state(false);
	// URL id of a draft whose load is in flight. Autosave waits for it so a
	// keystroke typed during a slow load cannot create a second draft.
	let loadingDraftId = $state<string | null>(null);
	// Set when a draft fetch fails: while it is non-null every save path stays
	// off, so an editor that never received the stored copy cannot PATCH an
	// empty (or partial) body over it. Cleared by a successful load.
	let loadFailedId = $state<string | null>(null);
	// Serial queue of media-layout writes (see queueMediaSync). Publish awaits
	// it because the stored segmentIndex — not the optimistic UI order — is
	// what the provider attaches images by.
	let mediaSync: Promise<void> = Promise.resolve();
	// Cleared only by a save that succeeds: the autosave keeps retrying a failed
	// save, and the status must not flicker back to "Saving…" on every attempt.
	let saveFailed = $state(false);
	// What the split Publish button is busy with (drives its label + spinner).
	let busyAction = $state<'publish' | 'schedule' | null>(null);
	// Quick publishes should not flash "Publishing…": the button only turns
	// busy after a short delay, once the work is actually slow.
	let publishBusyVisible = $state(false);
	let publishBusyTimer: ReturnType<typeof setTimeout> | null = null;
	// Platforms with a persisted variant row. A save only DELETEs rows that
	// exist instead of firing a DELETE for every platform on every save.
	let storedVariants = new Set<PlatformId>(
		(ed.seededDraft?.variants || []).map((v) => v.platform as PlatformId)
	);
	let reconnecting = $state<string | null>(null);
	let didInitSelection = false;
	let savedSnapshot = $state<string | null>(null);
	let pendingSelected: string[] | null = ed.seededSelection;
	// True only when the user changed the account selection (never when the
	// editor initializes or restores one). Used to decide whether an in-flight
	// draft load may overwrite the current selection.
	let selectionTouched = false;
	let skipAsk = $state(false);
	// Dropdowns
	let isAccountsPopoverOpen = $state(false);
	let isPostConfirmOpen = $state(false);
	let isAddOverrideOpen = $state(false);
	let fileRefs = $state<(HTMLInputElement | null)[]>([]);
	let textareaRefs = $state<(HTMLTextAreaElement | null)[]>([]);
	let altOpen = $state<Record<string, boolean>>({});

	// The status banner states times in the viewer's zone, which the server
	// cannot know, so it waits for the browser instead of correcting itself.
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		try {
			skipAsk = localStorage.getItem(ed.SKIP_ASK_KEY) === '1';
		} catch {
			// storage unavailable: defaults hold
		}
	});

	function setLocalFlag(key: string, on: boolean) {
		try {
			if (on) localStorage.setItem(key, '1');
			else localStorage.removeItem(key);
		} catch {
			// prefs are cosmetic
		}
	}

	field(
		ed,
		'altOpen',
		() => altOpen,
		(v) => (altOpen = v)
	);
	field(
		ed,
		'busyAction',
		() => busyAction,
		(v) => (busyAction = v)
	);
	field(
		ed,
		'coverBusy',
		() => coverBusy,
		(v) => (coverBusy = v)
	);
	field(
		ed,
		'coverFor',
		() => coverFor,
		(v) => (coverFor = v)
	);
	field(
		ed,
		'didInitSelection',
		() => didInitSelection,
		(v) => (didInitSelection = v)
	);
	field(
		ed,
		'dirty',
		() => dirty,
		(v) => (dirty = v)
	);
	field(
		ed,
		'fileRefs',
		() => fileRefs,
		(v) => (fileRefs = v)
	);
	field(
		ed,
		'focusedSegment',
		() => focusedSegment,
		(v) => (focusedSegment = v)
	);
	field(
		ed,
		'isAccountsPopoverOpen',
		() => isAccountsPopoverOpen,
		(v) => (isAccountsPopoverOpen = v)
	);
	field(
		ed,
		'isAddOverrideOpen',
		() => isAddOverrideOpen,
		(v) => (isAddOverrideOpen = v)
	);
	field(
		ed,
		'isPostConfirmOpen',
		() => isPostConfirmOpen,
		(v) => (isPostConfirmOpen = v)
	);
	field(
		ed,
		'loadFailedId',
		() => loadFailedId,
		(v) => (loadFailedId = v)
	);
	field(
		ed,
		'loadingDraftId',
		() => loadingDraftId,
		(v) => (loadingDraftId = v)
	);
	field(
		ed,
		'mediaSync',
		() => mediaSync,
		(v) => (mediaSync = v)
	);
	field(
		ed,
		'mounted',
		() => mounted,
		(v) => (mounted = v)
	);
	field(
		ed,
		'pendingSelected',
		() => pendingSelected,
		(v) => (pendingSelected = v)
	);
	field(
		ed,
		'publishBusyTimer',
		() => publishBusyTimer,
		(v) => (publishBusyTimer = v)
	);
	field(
		ed,
		'publishBusyVisible',
		() => publishBusyVisible,
		(v) => (publishBusyVisible = v)
	);
	field(
		ed,
		'reconnecting',
		() => reconnecting,
		(v) => (reconnecting = v)
	);
	field(
		ed,
		'savedSnapshot',
		() => savedSnapshot,
		(v) => (savedSnapshot = v)
	);
	field(
		ed,
		'saveFailed',
		() => saveFailed,
		(v) => (saveFailed = v)
	);
	field(
		ed,
		'selectionTouched',
		() => selectionTouched,
		(v) => (selectionTouched = v)
	);
	field(
		ed,
		'skipAsk',
		() => skipAsk,
		(v) => (skipAsk = v)
	);
	field(
		ed,
		'storedVariants',
		() => storedVariants,
		(v) => (storedVariants = v)
	);
	field(
		ed,
		'textareaRefs',
		() => textareaRefs,
		(v) => (textareaRefs = v)
	);
	field(
		ed,
		'tiktokOptions',
		() => tiktokOptions,
		(v) => (tiktokOptions = v)
	);
	field(
		ed,
		'uploadingSegment',
		() => uploadingSegment,
		(v) => (uploadingSegment = v)
	);
	field(
		ed,
		'videoJobs',
		() => videoJobs,
		(v) => (videoJobs = v)
	);
	field(
		ed,
		'youtubeOptions',
		() => youtubeOptions,
		(v) => (youtubeOptions = v)
	);
	provide(ed, { setLocalFlag });
}
