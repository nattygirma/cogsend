import { page } from '$app/state';
import { afterNavigate, beforeNavigate } from '$app/navigation';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Loading on navigation, autosave triggers and flushing before leaving. */
export interface ComposerLifecycleApi {
	readonly flushPending: () => Promise<void>;
	readonly handleWindowClick: (e: MouseEvent) => void;
	loadedDraftContentFor: string | null;
}

export function useComposerLifecycle(ed: Composer): void {
	// Close dropdowns on click outside.
	function handleWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.accounts-popover-container')) {
			ed.isAccountsPopoverOpen = false;
		}
		// The status banner's schedule buttons open the popover from outside it.
		if (!target.closest('.post-actions-container, [data-schedule-opener]')) {
			ed.scheduleOpen = false;
			if (ed.isPostConfirmOpen) ed.dismissPostConfirm();
		}
		if (!target.closest('.override-dropdown-container')) {
			ed.isAddOverrideOpen = false;
		}
		if (!target.closest('.quote-picker-container')) {
			ed.quotePickerFor = null;
		}
	}

	let loadedDraftContentFor: string | null = ed.seededDraft?.id ?? null;
	let initLoadedFor: string | null | undefined = undefined;
	$effect(() => {
		const id = ed.composeUrl.searchParams.get('id');
		ed.initSelection(ed.connections);
		if (initLoadedFor === undefined) {
			initLoadedFor = id ?? null;
			void ed.loadConnections();
		}
		// `composeUrl` keeps the id of the last real navigation after the editor
		// clears itself (discard, a finished post), and this effect re-runs on a
		// connections refresh: load only a draft the browser is actually on, or
		// the cleared post comes straight back.
		if (
			id &&
			id !== loadedDraftContentFor &&
			ed.composeUrlPending === 0 &&
			new URL(location.href).searchParams.get('id') === id
		) {
			loadedDraftContentFor = id;
			void ed.loadDraft(id).catch(() => {
				loadedDraftContentFor = null;
			});
		} else if (id !== initLoadedFor) {
			initLoadedFor = id ?? null;
		}
		if (!id && (loadedDraftContentFor || ed.loadFailedId)) {
			// `composeUrl` does not track shallow `replaceState` (the autosave
			// assigns the draft id that way), so it can still read id-less
			// while the browser is on a loaded draft. Only a real navigation
			// to /compose — browser URL has no id, and no setComposeUrl() is
			// still applying one — resets the editor;
			// re-running this effect for unrelated reasons (connections
			// refresh) must not wipe the composer.
			const browserId = new URL(location.href).searchParams.get('id');
			if (!browserId && ed.composeUrlPending === 0) {
				loadedDraftContentFor = null;
				ed.resetEditorForNewDraft();
			}
		}
		if (!id) initLoadedFor = null;
	});

	// A tab can disappear when its platform override is removed.
	$effect(() => {
		if (ed.activeTab !== 'global' && !ed.tabs.includes(ed.activeTab)) ed.activeTab = 'global';
	});

	$effect(() => {
		void ed.segments.length;
		if (ed.focusedSegment > ed.segments.length - 1)
			ed.focusedSegment = Math.max(0, ed.segments.length - 1);
		if (ed.uploadingSegment !== null && ed.uploadingSegment > ed.segments.length - 1)
			ed.uploadingSegment = null;
	});

	$effect(() => {
		// A draft that failed to load must not be baselined as "saved": that is
		// what turned the empty editor into an autosave target.
		if (ed.loadFailedId) return;
		if (ed.savedSnapshot === null) {
			ed.savedSnapshot = ed.takeSnapshot();
			return;
		}
		void ed.baseBody;
		void ed.overrides;
		void ed.youtubeOptions;
		void ed.tiktokOptions;
		void ed.media;
		if (ed.takeSnapshot() !== ed.savedSnapshot) {
			ed.dirty = true;
		} else if (!ed.saving) {
			ed.dirty = false;
		}
		if (!ed.dirty || ed.publishing || ed.saving || ed.editLocked) return;
		// A load in flight owns the editor identity (and may merge local edits
		// into the stored copy): saving now could strand the keystrokes in a
		// second draft, so wait for it to settle.
		if (ed.loadingDraftId) return;
		// Don't autosave while the user is deciding to discard: the save
		// could create/patch a draft between open and confirm.
		if (ed.isDiscardOpen || ed.discarding) return;
		const emptyNew = !ed.draftId && !ed.baseBody.trim();
		if (emptyNew) return;
		const timer = setTimeout(() => {
			void ed.persistAll();
		}, 1400);
		return () => clearTimeout(timer);
	});

	// Opened over Posts (a shallow route, which fires no navigation of its
	// own), a post from there goes back there too.
	const openedOverPosts = $derived(
		Boolean(page.state.composerHref) &&
			page.url.pathname === '/posts' &&
			ed.composeUrl.searchParams.has('id')
	);
	afterNavigate(({ from, to }) => {
		ed.returnToPosts = from?.url.pathname === '/posts' && Boolean(to?.url.searchParams.get('id'));
	});
	$effect(() => {
		if (openedOverPosts) ed.returnToPosts = true;
	});

	async function flushPending() {
		if (ed.editLocked) return;
		if (!ed.dirty && Object.keys(ed.altPending).length === 0) return;
		await Promise.all([ed.persistAll(false, { navigate: false }), ed.flushAltPending()]);
	}

	beforeNavigate(() => {
		void flushPending();
	});

	$effect(() => {
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			// A video still converting or uploading is lost with the page.
			if (!ed.dirty && !ed.videoJobs.length) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	// Phones rarely fire beforeunload, and a tab sent to the background can be
	// discarded before the autosave timer runs, so save the moment it is hidden.
	// The guards are the autosave's own: a save during a load, a discard or a
	// publish would race the flow that owns the draft.
	$effect(() => {
		const onHidden = () => {
			if (document.visibilityState !== 'hidden') return;
			void ed.flushAltPending();
			if (
				!ed.dirty ||
				ed.publishing ||
				ed.editLocked ||
				ed.loadingDraftId ||
				ed.isDiscardOpen ||
				ed.discarding
			)
				return;
			void ed.persistAll();
		};
		document.addEventListener('visibilitychange', onHidden);
		return () => document.removeEventListener('visibilitychange', onHidden);
	});

	$effect(() => {
		const onKey = (event: KeyboardEvent) => {
			// Escape first, and before the publish guard below: the guard exists
			// so the compose shortcuts cannot fire while the confirm popover is
			// open, and it used to swallow Escape too — which is the one key a
			// keyboard user needs to get out of that popover.
			if (event.key === 'Escape') {
				ed.scheduleOpen = false;
				if (ed.isPostConfirmOpen) ed.dismissPostConfirm();
				ed.isAddOverrideOpen = false;
				ed.isAccountsPopoverOpen = false;
				ed.quotePickerFor = null;
				return;
			}
			if (ed.pendingPublish || ed.editLocked) return;
			const meta = event.metaKey || event.ctrlKey;
			if (meta && event.key.toLowerCase() === 's') {
				event.preventDefault();
				void ed.persistAll();
			}
			if (meta && event.key === 'Enter') {
				event.preventDefault();
				void ed.onPublish();
			}
			// Alt+Arrow reorders thread posts while typing.
			if (
				event.altKey &&
				(event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
				document.activeElement?.hasAttribute('data-segment-index')
			) {
				const idx = Number(document.activeElement?.getAttribute('data-segment-index'));
				if (!Number.isNaN(idx)) {
					event.preventDefault();
					ed.handleReorderKeyboard(idx, event.key === 'ArrowUp' ? -1 : 1);
				}
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	field(
		ed,
		'loadedDraftContentFor',
		() => loadedDraftContentFor,
		(v) => (loadedDraftContentFor = v)
	);
	provide(ed, { flushPending, handleWindowClick });
}
