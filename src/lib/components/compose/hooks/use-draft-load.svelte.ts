import {
	type PlatformOverrideMap,
	type PlatformId,
	customizePlatformBody,
	resolveRestoredSelection,
	overridesFromVariants,
	restorableTargetIds,
	resolveSavedSelection
} from '#lib/domain/platform-sync.js';
import type { Connection, MediaItem } from '../types';
import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { showToast } from '#lib/components/toast.svelte.js';
import { isFullyPublished } from '#lib/domain/published-lock.js';
import { videoOptionsFromVariants } from '#lib/domain/platform-options.js';
import { earliestFutureScheduleValue } from '#lib/domain/schedule-helpers.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Snapshots, selection and loading a stored draft into the editor. */
export interface DraftLoadApi {
	readonly clearComposer: () => void;
	composeUrlPending: number;
	editorGeneration: number;
	readonly initSelection: (list: Connection[]) => void;
	readonly loadConnections: () => Promise<void>;
	readonly loadDraft: (id: string) => Promise<void>;
	readonly markDirty: () => void;
	readonly resetEditorForNewDraft: () => void;
	readonly setActiveBody: (nextBody: string) => void;
	readonly setComposeUrl: (url: string) => void;
	readonly takeSnapshot: () => string;
}

export function useDraftLoad(ed: Composer): void {
	function takeSnapshot(): string {
		const sorted: PlatformOverrideMap = {};
		for (const k of Object.keys(ed.overrides).sort())
			sorted[k as PlatformId] = ed.overrides[k as PlatformId]!;
		return JSON.stringify({
			b: ed.baseBody,
			o: sorted,
			y: ed.youtubeOptions,
			t: ed.tiktokOptions,
			s: [...ed.selected].sort(),
			m: ed.media.map((m) => ({ i: m.id, a: m.altText || '', s: m.segmentIndex ?? 0 }))
		});
	}

	function markDirty() {
		ed.dirty = true;
	}

	function setActiveBody(nextBody: string) {
		if (ed.editLocked) return;
		if (ed.activeTab === 'global') {
			ed.baseBody = nextBody;
		} else {
			// Editing a flattened single-post view implicitly customizes the platform.
			ed.overrides = customizePlatformBody(ed.overrides, ed.activeTab, nextBody);
		}
		markDirty();
	}

	function initSelection(list: Connection[]) {
		if (ed.pendingSelected) {
			ed.selected = new Set(resolveRestoredSelection(ed.pendingSelected, list) ?? []);
			ed.pendingSelected = null;
			ed.didInitSelection = true;
		} else if (!ed.didInitSelection) {
			ed.didInitSelection = true;
			const active = list.filter((c) => c.status === 'active');
			const preferred = (ed.initialSettings?.defaultAccountIds ?? []).filter((id) =>
				active.some((c) => c.id === id)
			);
			ed.selected = new Set(preferred.length ? preferred : active.map((c) => c.id));
		}
	}

	async function loadConnections() {
		const res = await fetch('/api/connections');
		if (!res.ok) return;
		const data = await res.json();
		const list: Connection[] = data.connections || [];
		ed.connections = list;
		initSelection(list);
	}

	/**
	 * Point the address bar at `url` without a navigation. SvelteKit applies a
	 * shallow `replaceState` a few microtasks later, and until then the browser
	 * still shows the old URL, which the draft-id effect below must not mistake
	 * for a navigation to an empty /compose. The URL is cosmetic: the draft is
	 * already saved, or the editor already cleared, so a refusal is ignored.
	 */
	let composeUrlPending = 0;
	function setComposeUrl(url: string) {
		composeUrlPending += 1;
		replaceState(url, page.state)
			.catch(() => undefined)
			.finally(() => {
				composeUrlPending -= 1;
			});
	}

	// Bumped whenever the editor moves to another post (cleared, or switched).
	// A save still in flight for the previous one finishes for that post only:
	// it must not hand its id, saved state or variant bookkeeping to this one.
	let editorGeneration = 0;

	function abortVideoJobs() {
		for (const job of ed.videoJobs) job.controller.abort();
		ed.videoJobs = [];
	}

	function resetEditorForNewDraft() {
		editorGeneration++;
		ed.checksRevealed = false;
		abortVideoJobs();
		ed.draftId = null;
		ed.baseBody = '';
		ed.overrides = {};
		ed.media = [];
		ed.youtubeOptions = {};
		ed.tiktokOptions = {};
		ed.activeTab = 'global';
		ed.focusedSegment = 0;
		ed.scheduleOpen = false;
		ed.loadedSchedule = null;
		ed.scheduleTouched = false;
		ed.isPostConfirmOpen = false;
		ed.pendingPublish = null;
		ed.busyAction = null;
		ed.dirty = false;
		ed.saveFailed = false;
		ed.savedSnapshot = null;
		ed.loadFailedId = null;
		ed.storedVariants = new Set();
		ed.publishedLock = false;
		ed.targets = [];
		ed.sendBlocked = false;
		ed.returnToPosts = false;
	}

	/** Back to an empty composer at /compose; the post itself is left as it is. */
	function clearComposer() {
		for (const key of Object.keys(ed.altTimers)) clearTimeout(ed.altTimers[key]);
		for (const key of Object.keys(ed.altPending)) delete ed.altPending[key];
		ed.pendingMediaRemove = null;
		resetEditorForNewDraft();
		ed.loadedDraftContentFor = null;
		setComposeUrl('/compose');
	}

	async function loadDraft(id: string) {
		// A first load races whatever the user types into the still-empty
		// editor: applying the stored copy wholesale discarded that text (and
		// the queued autosave then wrote the stale body back). Snapshot the
		// editable pieces and merge field by field instead. Switching between
		// drafts still applies the stored copy wholesale — that draft is the
		// one the user deliberately asked for.
		// `draftId` is seeded from the URL at mount, so it cannot tell a first
		// load from a draft switch — an unset snapshot can: nothing has been
		// loaded or saved in this editor instance yet.
		const fresh = ed.savedSnapshot === null;
		const before = fresh
			? {
					body: ed.baseBody,
					overrides: ed.overrides,
					media: ed.media,
					youtube: ed.youtubeOptions,
					tiktok: ed.tiktokOptions
				}
			: null;
		// A failure belongs to the draft the editor is on. Clear a stale one when
		// a different draft starts loading, or the banner would sit over content
		// that is about to arrive and block saving on it.
		if (ed.loadFailedId && ed.loadFailedId !== id) ed.loadFailedId = null;
		ed.loadingDraftId = id;
		try {
			const res = await fetch(`/api/drafts/${id}`);
			if (res.status === 401) {
				// Navigating to /login here would throw away whatever is typed in
				// the composer (it exists only in memory, and the save on the way
				// out would 401 too). Pause saving, say why, and offer the link.
				ed.loadFailedId = id;
				showToast('Your session expired — sign in again to keep editing', 'error', {
					label: 'Sign in',
					href: '/login'
				});
				return;
			}
			if (!res.ok) {
				// The stored copy never arrived. Keep saving off until it does:
				// otherwise the first keystroke autosaves an empty body over it.
				// Only arm the block for the draft the editor is actually on, and
				// only while this attempt is still the live one: a late failure
				// for a superseded attempt (the user moved on, a retry already
				// succeeded) must not freeze saving over content that loaded.
				if (ed.loadingDraftId === id && ed.composeUrl.searchParams.get('id') === id) {
					ed.loadFailedId = id;
					showToast('Could not load this draft', 'error');
				}
				return;
			}
			const data = await res.json();
			ed.loadFailedId = null;
			if (ed.composeUrl.searchParams.get('id') !== id) return;
			const d = data.draft;
			if (before && ed.draftId !== null && ed.draftId !== id) {
				// An autosave or media upload claimed a brand-new draft while this
				// fetch was in flight; it owns the editor now (the URL was
				// rewritten to it), so this response must not hijack the session.
				return;
			}
			if (ed.draftId !== d.id) {
				editorGeneration++;
				abortVideoJobs();
			}
			ed.draftId = d.id;
			const locked = isFullyPublished(d.targets || []);
			ed.publishedLock = locked;
			ed.targets = d.targets || [];
			ed.clock = Date.now();
			ed.sendBlocked = false;
			// Text typed while a published post loaded cannot be saved, so the
			// stored copy wins outright instead of being merged with it.
			const merge = before !== null && !locked;
			const main = d.baseBody || '';
			const loadedOverrides = overridesFromVariants(d.variants || [], main);
			const loadedMedia = (d.media || []).map((m: MediaItem) => ({
				...m,
				segmentIndex: m.segmentIndex ?? 0
			}));
			const loadedVideoOptions = videoOptionsFromVariants(d.variants);
			ed.storedVariants = new Set(
				((d.variants || []) as Array<{ platform: PlatformId }>).map((v) => v.platform)
			);

			let mergedCleanly = true;
			if (before && merge) {
				const keepBody = ed.baseBody !== before.body;
				const keepOverrides = ed.overrides !== before.overrides;
				const keepMedia = ed.media !== before.media;
				const keepYouTube = ed.youtubeOptions !== before.youtube;
				const keepTikTok = ed.tiktokOptions !== before.tiktok;
				const keepSelection = ed.selectionTouched;
				mergedCleanly =
					!keepBody &&
					!keepOverrides &&
					!keepMedia &&
					!keepYouTube &&
					!keepTikTok &&
					!keepSelection;
				if (!keepBody) ed.baseBody = main;
				// Platform bodies the user did not touch still come from the
				// draft; the ones they did keep their local text.
				ed.overrides = keepOverrides ? { ...loadedOverrides, ...ed.overrides } : loadedOverrides;
				if (!keepMedia) ed.media = loadedMedia;
				if (!keepYouTube) ed.youtubeOptions = loadedVideoOptions.youtube;
				if (!keepTikTok) ed.tiktokOptions = loadedVideoOptions.tiktok;
			} else {
				ed.baseBody = main;
				ed.overrides = loadedOverrides;
				ed.media = loadedMedia;
				ed.youtubeOptions = loadedVideoOptions.youtube;
				ed.tiktokOptions = loadedVideoOptions.tiktok;
			}

			// Selection precedence: the draft's own saved selection wins; older
			// rows (and drafts scheduled/published before this existed) fall
			// back to their publish targets. null means "nothing stored".
			const targetIds = restorableTargetIds(d.targets);
			const savedRaw = Array.isArray(d.selectedConnectionIds)
				? (d.selectedConnectionIds as string[])
				: null;
			// A user toggle during the load wins over the stored selection.
			const keepSelection = merge && ed.selectionTouched;
			if (!keepSelection) {
				const restored = savedRaw
					? resolveSavedSelection(savedRaw, ed.connections)
					: resolveRestoredSelection(targetIds, ed.connections);
				if (restored !== null) {
					if (ed.didInitSelection && ed.connections.length) {
						ed.selected = new Set(restored);
					} else {
						// Keep the raw ids so initSelection filters them against
						// the live connection list once it arrives.
						ed.pendingSelected = savedRaw ?? targetIds;
					}
				}
			}
			ed.selectionTouched = false;

			// Schedule: a first load keeps a schedule the user edited while the
			// fetch was in flight; a draft switch applies the stored one wholesale.
			if (!merge || !ed.scheduleTouched) {
				ed.loadedSchedule = earliestFutureScheduleValue(d.targets, new Date());
				ed.scheduleTouched = false;
				// The popover may already be open on the default; show the stored
				// time in place. With nothing future stored the default stays.
				if (ed.scheduleOpen && ed.loadedSchedule) ed.applyLoadedSchedule(ed.loadedSchedule);
			}
			if (mergedCleanly) {
				ed.dirty = false;
				ed.saveFailed = false;
				ed.savedSnapshot = takeSnapshot();
			}
			// Otherwise the local edits stay dirty on purpose: the autosave
			// effect below persists the merged content once the load settles.
		} catch (err) {
			// Network failure or an unparseable body: same protection as a 4xx.
			if (ed.loadingDraftId === id && ed.composeUrl.searchParams.get('id') === id) {
				ed.loadFailedId = id;
				showToast('Could not load this draft', 'error');
			}
			throw err;
		} finally {
			if (ed.loadingDraftId === id) ed.loadingDraftId = null;
		}
	}

	field(
		ed,
		'composeUrlPending',
		() => composeUrlPending,
		(v) => (composeUrlPending = v)
	);
	field(
		ed,
		'editorGeneration',
		() => editorGeneration,
		(v) => (editorGeneration = v)
	);
	provide(ed, {
		clearComposer,
		initSelection,
		loadConnections,
		loadDraft,
		markDirty,
		resetEditorForNewDraft,
		setActiveBody,
		setComposeUrl,
		takeSnapshot
	});
}
