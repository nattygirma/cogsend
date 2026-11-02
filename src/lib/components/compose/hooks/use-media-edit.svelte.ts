import { PUBLISH_IN_PROGRESS_ERROR, PUBLISHED_EDIT_ERROR } from '#lib/domain/published-lock.js';
import { showToast } from '#lib/components/toast.svelte.js';
import { composeSession } from '#lib/components/compose-session.svelte.js';
import { humanizeError } from '#lib/domain/human-error.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Alt text, removing media and discarding the post. */
export interface MediaEditApi {
	readonly altPending: Record<string, string>;
	readonly altTimers: Record<string, NodeJS.Timeout>;
	readonly canDiscard: boolean;
	readonly confirmDiscard: () => Promise<void>;
	readonly confirmRemoveMedia: () => Promise<void>;
	readonly discardCopy: {
		label: string;
		title: string;
		body: string;
		confirm: string;
		done: string;
	};
	discarding: boolean;
	readonly flushAltPending: () => Promise<void>;
	isDiscardOpen: boolean;
	keepMediaBtn: HTMLButtonElement | null;
	readonly mediaBusy: boolean;
	pendingMediaRemove: string | null;
	readonly requestDiscard: () => void;
	readonly requestRemoveMedia: (mediaId: string) => void;
	readonly toggleAlt: (id: string) => void;
	readonly updateMediaAlt: (mediaId: string, altText: string) => Promise<void>;
}

export function useMediaEdit(ed: Composer): void {
	const altTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	const altPending: Record<string, string> = {};
	async function fireAltUpdate(mediaId: string, altText: string, id: string) {
		try {
			const res = await fetch(`/api/drafts/${id}/media`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaId, altText })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Failed to save alt text');
			}
			delete altPending[mediaId];
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to save alt text';
			// Refused for the same reasons as a body save, and said the same way:
			// the banners explain it. A send in flight keeps the edit pending,
			// and applyTargets sends it once the send settles.
			if (message === PUBLISH_IN_PROGRESS_ERROR) {
				ed.sendBlocked = true;
				void ed.refreshTargets();
				return;
			}
			if (message === PUBLISHED_EDIT_ERROR) {
				ed.publishedLock = true;
				return;
			}
			showToast(message, 'error');
		}
	}
	async function updateMediaAlt(mediaId: string, altText: string) {
		if (ed.editLocked) return;
		ed.media = ed.media.map((m) => (m.id === mediaId ? { ...m, altText } : m));
		if (!ed.draftId) return;
		altPending[mediaId] = altText;
		clearTimeout(altTimers[mediaId]);
		const id = ed.draftId;
		altTimers[mediaId] = setTimeout(() => void fireAltUpdate(mediaId, altText, id), 500);
	}
	async function flushAltPending() {
		const entries = Object.entries(altPending);
		for (const [mediaId] of entries) clearTimeout(altTimers[mediaId]);
		for (const [mediaId, altText] of entries) {
			if (ed.draftId) await fireAltUpdate(mediaId, altText, ed.draftId);
		}
	}

	let pendingMediaRemove = $state<string | null>(null);
	// Ids with a delete in flight: the dialog stays usable for a *different*
	// image while one is being removed.
	let mediaRemoving = $state<string[]>([]);
	let keepMediaBtn: HTMLButtonElement | null = $state(null);
	const mediaBusy = $derived(
		pendingMediaRemove !== null && mediaRemoving.includes(pendingMediaRemove)
	);
	let isDiscardOpen = $state(false);
	let discarding = $state(false);

	// Single-post trash = discard whole draft. Hidden when there is nothing
	// to discard (fresh /compose with empty text and no media).
	const canDiscard = $derived(
		ed.draftId !== null || ed.baseBody.trim() !== '' || ed.media.length > 0
	);

	// The same test decides whether the header's Write has anything to put away.
	$effect(() => {
		composeSession.hasContent = canDiscard;
	});

	// Deleting a scheduled or partly published post is more than discarding a
	// draft: it will not go out, and what already went out stays on the platform.
	const discardCopy = $derived.by(() => {
		const outThere = ed.postState.published.length
			? ` What's already published on ${ed.postState.published.map(ed.destinationName).join(', ')} stays there.`
			: '';
		if (ed.hasSchedule) {
			return {
				label: 'Delete scheduled post',
				title: 'Delete this scheduled post?',
				body: `It won't be published, and its images are deleted.${outThere} This cannot be undone.`,
				confirm: 'Delete',
				done: 'Scheduled post deleted'
			};
		}
		if (ed.postState.published.length) {
			return {
				label: 'Delete post',
				title: 'Delete this post?',
				body: `It's deleted here, with its images.${outThere} This cannot be undone.`,
				confirm: 'Delete',
				done: 'Post deleted'
			};
		}
		return {
			label: 'Discard draft',
			title: 'Discard this draft?',
			body: 'This will permanently delete the draft and its images. This cannot be undone.',
			confirm: 'Discard',
			done: 'Draft discarded'
		};
	});

	function requestDiscard() {
		if (
			discarding ||
			ed.saving ||
			ed.publishing ||
			ed.uploadingSegment !== null ||
			ed.videoJobs.length
		) {
			showToast('Please wait…', 'warn');
			return;
		}
		if (!canDiscard) return;
		isDiscardOpen = true;
	}

	async function confirmDiscard() {
		if (discarding) return;
		if (ed.saving || ed.publishing) {
			showToast('Please wait…', 'warn');
			return;
		}
		const id = ed.draftId;
		// Nothing persisted yet: just clear local state, no API call.
		if (!id) {
			isDiscardOpen = false;
			ed.clearComposer();
			showToast('Draft discarded', 'success');
			return;
		}
		const done = discardCopy.done;
		discarding = true;
		try {
			const res = await fetch(`/api/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Could not discard draft');
			}
			isDiscardOpen = false;
			ed.clearComposer();
			showToast(done, 'success');
		} catch (e) {
			showToast(humanizeError(e instanceof Error ? e.message : 'Could not discard draft'), 'error');
		} finally {
			discarding = false;
		}
	}

	function requestRemoveMedia(mediaId: string) {
		if (ed.editLocked) return;
		pendingMediaRemove = mediaId;
	}

	async function confirmRemoveMedia() {
		const mediaId = pendingMediaRemove;
		if (!mediaId || !ed.draftId || mediaRemoving.includes(mediaId)) return;
		mediaRemoving = [...mediaRemoving, mediaId];
		try {
			const res = await fetch(
				`/api/drafts/${ed.draftId}/media?mediaId=${encodeURIComponent(mediaId)}`,
				{ method: 'DELETE' }
			);
			if (res.status === 401) {
				showToast('Your session expired — sign in again to keep editing', 'error', {
					label: 'Sign in',
					href: '/login'
				});
				return;
			}
			if (!res.ok) throw new Error('Failed to remove image');
			ed.media = ed.media.filter((m) => m.id !== mediaId);
			// Close only the dialog that is still about this image: one opened
			// for another image while this request was in flight stays.
			if (pendingMediaRemove === mediaId) pendingMediaRemove = null;
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to remove image', 'error');
		} finally {
			mediaRemoving = mediaRemoving.filter((id) => id !== mediaId);
		}
	}

	function toggleAlt(id: string) {
		ed.altOpen = { ...ed.altOpen, [id]: !ed.altOpen[id] };
	}

	field(ed, 'canDiscard', () => canDiscard);
	field(ed, 'discardCopy', () => discardCopy);
	field(
		ed,
		'discarding',
		() => discarding,
		(v) => (discarding = v)
	);
	field(
		ed,
		'isDiscardOpen',
		() => isDiscardOpen,
		(v) => (isDiscardOpen = v)
	);
	field(
		ed,
		'keepMediaBtn',
		() => keepMediaBtn,
		(v) => (keepMediaBtn = v)
	);
	field(ed, 'mediaBusy', () => mediaBusy);
	field(
		ed,
		'pendingMediaRemove',
		() => pendingMediaRemove,
		(v) => (pendingMediaRemove = v)
	);
	provide(ed, {
		altPending,
		altTimers,
		confirmDiscard,
		confirmRemoveMedia,
		flushAltPending,
		requestDiscard,
		requestRemoveMedia,
		toggleAlt,
		updateMediaAlt
	});
}
