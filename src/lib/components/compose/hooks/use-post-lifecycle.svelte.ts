import { showToast } from '#lib/components/toast.svelte.js';
import { tick } from 'svelte';
import { composeSession } from '#lib/components/compose-session.svelte.js';
import { goto } from '$app/navigation';
import { humanizeError } from '#lib/domain/human-error.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Watching a sent post, starting a new one, duplicating a published one. */
export interface PostLifecycleApi {
	readonly confirmPublish: () => void;
	readonly duplicatePublished: () => Promise<void>;
	duplicating: boolean;
	readonly startNewPost: () => Promise<void>;
	readonly verifyConnection: (connectionId: string) => Promise<void>;
}

export function usePostLifecycle(ed: Composer): void {
	// Watch the post while a send is near or running, so the editor pauses
	// before the server starts refusing edits and shows the outcome after.
	const watchDelay = $derived.by((): number | null => {
		if (!ed.draftId || ed.publishedLock) return null;
		if (ed.sendingNow) return 10_000;
		// The platform finishes a video on its own; this only notices when.
		if (ed.postState.processing.length) return 30_000;
		if (!ed.postState.nextAt) return null;
		const until = ed.postState.nextAt.getTime() - ed.clock;
		if (until > 2 * 60_000) return null;
		return until > -10 * 60_000 ? 15_000 : 60_000;
	});

	$effect(() => {
		if (!ed.draftId || ed.publishedLock) return;
		if (!ed.postState.waiting.length && !ed.postState.processing.length && !ed.sendingNow) return;
		const timer = setInterval(() => (ed.clock = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const delay = watchDelay;
		if (delay === null) return;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void ed.refreshTargets();
		}, delay);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			ed.clock = Date.now();
			if (ed.postState.waiting.length > 0 || ed.postState.processing.length > 0 || ed.sendingNow) {
				void ed.refreshTargets();
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	let startingNew = $state(false);

	/**
	 * Put the open post away and start a blank one (the header's Write on this
	 * page). The post is saved first and the editor cleared only after, so
	 * nothing typed is lost; a save that fails keeps the post open.
	 */
	async function startNewPost() {
		if (startingNew) return;
		if (
			ed.publishing ||
			ed.discarding ||
			ed.unscheduling ||
			ed.uploadingSegment !== null ||
			ed.videoJobs.length ||
			ed.loadingDraftId
		) {
			showToast('Please wait…', 'warn');
			return;
		}
		startingNew = true;
		try {
			let note: { message: string; tone: 'success' | 'warn'; href: string } | null = null;
			if (ed.publishedLock || ed.loadFailedId) {
				// Nothing here can be saved: it went out everywhere, or never loaded.
			} else if (ed.sendingNow) {
				if (ed.dirty) {
					note = {
						message: "Your last change wasn't saved — the post was being sent",
						tone: 'warn',
						href: '/posts'
					};
				}
			} else if (ed.draftId || ed.baseBody.trim()) {
				await ed.mediaSync;
				await ed.flushAltPending();
				const id = await ed.persistClean();
				if (!id || ed.dirty || Object.keys(ed.altPending).length) {
					// The save said why (a toast, or the sending and lock banners);
					// a post still changing under the save stays open too.
					if (id) showToast("Couldn't save this post — it's still open", 'error');
					return;
				}
				note = ed.hasSchedule
					? { message: 'Saved — still scheduled', tone: 'success', href: '/posts?tab=scheduled' }
					: ed.postState.published.length || ed.postState.failed.length
						? { message: 'Post saved', tone: 'success', href: '/posts' }
						: { message: 'Saved to drafts', tone: 'success', href: '/posts?tab=drafts' };
			}
			ed.clearComposer();
			if (note) showToast(note.message, note.tone, { label: 'View', href: note.href });
			await tick();
			document.querySelector<HTMLTextAreaElement>('[data-testid="segment-input-0"]')?.focus();
		} finally {
			startingNew = false;
		}
	}

	$effect(() => {
		composeSession.active = true;
		composeSession.startNew = () => void startNewPost();
		composeSession.flush = ed.flushPending;
		return () => {
			composeSession.active = false;
			composeSession.hasContent = false;
			composeSession.startNew = null;
			composeSession.flush = null;
			// The composer can close without a navigation (the browser's Back
			// over a page it opened on): what was typed still gets saved.
			void ed.flushPending();
		};
	});

	let duplicating = $state(false);

	/** A published post is read-only; its copy is a new draft to edit and send. */
	async function duplicatePublished() {
		const id = ed.draftId;
		if (!id || duplicating) return;
		duplicating = true;
		try {
			const res = await fetch(`/api/drafts/${encodeURIComponent(id)}/duplicate`, {
				method: 'POST'
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not duplicate');
			const copy = payload.draft?.id;
			if (!copy) throw new Error('Could not duplicate');
			await goto(`/compose?id=${copy}`);
		} catch (e) {
			showToast(humanizeError(e instanceof Error ? e.message : 'Could not duplicate'), 'error');
		} finally {
			duplicating = false;
		}
	}

	function confirmPublish() {
		const pending = ed.pendingPublish;
		if (!pending || ed.publishing || pending.saving || !pending.draftId) return;
		ed.handOffPublish(pending.draftId, pending.connectionIds);
	}

	async function verifyConnection(connectionId: string) {
		ed.reconnecting = connectionId;
		try {
			const res = await fetch(`/api/connections/${connectionId}/verify`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Could not verify this account');
			showToast('Account reconnected', 'success');
			await ed.loadConnections();
		} catch (e) {
			showToast(
				humanizeError(e instanceof Error ? e.message : 'Could not verify this account'),
				'error'
			);
		} finally {
			ed.reconnecting = null;
		}
	}

	field(
		ed,
		'duplicating',
		() => duplicating,
		(v) => (duplicating = v)
	);
	provide(ed, { confirmPublish, duplicatePublished, startNewPost, verifyConnection });
}
