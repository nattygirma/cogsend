import { showToast } from '#lib/components/toast.svelte.js';
import type { PlatformId } from '#lib/domain/platform-sync.js';
import { mediaSizeProblem } from '#lib/domain/media-limits.js';
import { humanizeError } from '#lib/domain/human-error.js';
import { platformName, displayHandle } from '#lib/domain/platforms.js';
import { handOff, cancelWaitingExcept } from '#lib/components/publish-tracker.svelte.js';
import type { TargetSnapshot } from '#lib/domain/post-state.js';
import { setPostsNotice } from '#lib/components/posts-notice.js';
import { goto } from '$app/navigation';
import { isFullyPublished } from '#lib/domain/published-lock.js';
import { earliestFutureScheduleValue } from '#lib/domain/schedule-helpers.js';
import type { Connection } from '../types';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Publishing: the confirmation, the hand-off and reading targets back. */
export interface PublishApi {
	readonly destinationName: (connectionId: string) => string;
	readonly finishPosted: (tab: 'scheduled', message: string, tone: 'success' | 'warn') => void;
	readonly handOffPublish: (id: string, connectionIds: string[]) => void;
	readonly onPublish: () => Promise<void>;
	readonly pendingAccounts: Connection[];
	pendingPublish: { draftId: string | null; connectionIds: string[]; saving: boolean } | null;
	readonly platformOf: (connectionId: string) => string | undefined;
	publishRequestSeq: number;
	readonly refreshTargets: () => Promise<void>;
	readonly showSchedule: () => void;
	readonly unschedulePost: () => Promise<void>;
	unscheduling: boolean;
}

export function usePublish(ed: Composer): void {
	// saving=true while the pre-publish persist is in flight. The dialog opens
	// synchronously (before any await) so the Publish button feels instant;
	// the confirm button stays disabled until draftId lands.
	let pendingPublish = $state<{
		draftId: string | null;
		connectionIds: string[];
		saving: boolean;
	} | null>(null);
	// Invalidates a stale open-dialog update when the user hits "Keep editing"
	// mid-save or starts a newer publish. The background persist still saves
	// the draft; only the dialog update is dropped.
	let publishRequestSeq = 0;

	async function requestPublish(connectionIds: string[]) {
		ed.checksRevealed = true;
		// Prevent overlapping publishes/schedules (publishing covers both), and
		// a publish racing an unschedule of the same targets.
		if (ed.publishing || unscheduling || ed.editLocked) return;
		// Fast empty check before opening any UI: mirrors doPersist's
		// emptyNew guard so an empty composer toasts without flashing the
		// dialog (or the publishing spinner in skip-ask mode).
		if (ed.loadFailedId) {
			showToast('Could not load this draft — retry before publishing', 'warn');
			return;
		}
		if (!ed.draftId && !ed.baseBody.trim()) {
			showToast('Nothing to publish', 'warn');
			return;
		}
		if (!connectionIds.length) {
			showToast('Select at least one account', 'warn');
			return;
		}
		if (ed.threadsLinksOver && connectionIds.some((id) => platformOf(id) === 'threads')) {
			showToast(`Threads allows max 5 links per post (${ed.threadsLinkCount} found)`, 'warn');
			return;
		}
		if (ed.linkedinMediaOver && connectionIds.some((id) => platformOf(id) === 'linkedin')) {
			showToast(ed.linkedinMediaProblem ?? 'LinkedIn cannot take this media', 'warn');
			return;
		}
		if (ed.instagramMediaProblem && connectionIds.some((id) => platformOf(id) === 'instagram')) {
			showToast(ed.instagramMediaProblem, 'warn');
			return;
		}
		const singlePostProblem = connectionIds
			.map((id) => platformOf(id))
			.map((platform) => (platform ? ed.singlePostProblems.get(platform as PlatformId) : undefined))
			.find(Boolean);
		if (singlePostProblem) {
			showToast(singlePostProblem.message, 'warn');
			return;
		}
		const sizeProblem = mediaSizeProblem(
			connectionIds.map(platformOf).filter((p) => p !== undefined),
			ed.media
		);
		if (sizeProblem) {
			showToast(sizeProblem, 'warn');
			return;
		}
		if (ed.videoJobs.length) {
			showToast('Wait for the video to finish uploading', 'warn');
			return;
		}
		if (ed.videoProblem) {
			showToast(ed.videoProblem, 'warn');
			return;
		}
		if (ed.overSelectedLimit) {
			showToast('A post is over the character limit', 'warn');
			return;
		}
		// Skip-ask fast path: give instant button feedback (publishing=true)
		// before the save round-trips, then publish without a dialog.
		if (ed.skipAsk) {
			ed.publishing = true;
			ed.busyAction = 'publish';
			ed.startPublishBusy();
			try {
				const id = await ed.persistForAction();
				if (!id) {
					if (!ed.publishedLock && !ed.sendInFlight) showToast('Nothing to publish', 'warn');
					return;
				}
				pendingPublish = null;
				ed.isPostConfirmOpen = false;
				handOffPublish(id, connectionIds);
			} catch (e) {
				showToast(humanizeError(e instanceof Error ? e.message : 'Publish failed'), 'error');
			} finally {
				ed.publishing = false;
				ed.busyAction = null;
				ed.stopPublishBusy();
			}
			return;
		}
		// Dialog path: open instantly with a saving placeholder, then persist
		// in the background. State is set synchronously before the first
		// await so first paint happens in ~1 frame, not after 2-7 round-trips.
		// A clean, already-saved draft skips the persist entirely.
		const requestId = ++publishRequestSeq;
		const ready =
			ed.draftId !== null && !ed.dirty && !ed.saving && Object.keys(ed.altPending).length === 0;
		pendingPublish = { draftId: ed.draftId, connectionIds, saving: !ready };
		ed.isPostConfirmOpen = true;
		if (ready) return;
		try {
			const id = await ed.persistForAction();
			if (requestId !== publishRequestSeq) return;
			if (!id) {
				pendingPublish = null;
				ed.isPostConfirmOpen = false;
				if (!ed.publishedLock && !ed.sendInFlight) showToast('Nothing to publish', 'warn');
				return;
			}
			if (pendingPublish && requestId === publishRequestSeq) {
				pendingPublish = { draftId: id, connectionIds, saving: false };
			}
		} catch (e) {
			if (requestId !== publishRequestSeq) return;
			pendingPublish = null;
			ed.isPostConfirmOpen = false;
			showToast(humanizeError(e instanceof Error ? e.message : 'Publish failed'), 'error');
		}
	}

	function platformOf(connectionId: string): string | undefined {
		return ed.connections.find((c) => c.id === connectionId)?.platform;
	}

	const pendingAccounts = $derived(
		(pendingPublish?.connectionIds ?? [])
			.map((id) => ed.connections.find((c) => c.id === id))
			.filter((c) => c !== undefined)
	);

	async function onPublish() {
		ed.scheduleOpen = false;
		await requestPublish([...ed.selected]);
	}

	const destinationName = (connectionId: string): string => {
		// A disconnected account is gone from the list, but the post's own
		// targets still carry what it was.
		const c =
			ed.connections.find((x) => x.id === connectionId) ??
			ed.targets.find((t) => t.connectionId === connectionId)?.connection;
		if (!c) return 'Destination';
		if (!c.handle) return platformName(c.platform);
		return `${platformName(c.platform)} · ${displayHandle(c.handle)}`;
	};

	/**
	 * Hand the publish to the tracker and let go of the post: the composer is
	 * free for the next one at once, and the outcome comes back as a toast
	 * wherever the person is by then.
	 */
	function handOffPublish(id: string, connectionIds: string[]) {
		const names = new Map<string, string>();
		for (const c of ed.connections) names.set(c.id, destinationName(c.id));
		for (const t of ed.targets) {
			if (t.connectionId && !names.has(t.connectionId)) {
				names.set(t.connectionId, destinationName(t.connectionId));
			}
		}
		void handOff({
			draftId: id,
			connectionIds,
			nameOf: (connectionId) => names.get(connectionId) ?? 'Destination',
			unscheduleOthers: ed.postState.waiting.some((w) => !connectionIds.includes(w.connectionId)),
			targets: $state.snapshot(ed.targets) as TargetSnapshot[]
		});
		ed.clearPostConfirm();
		const message = `Publishing to ${connectionIds.length} ${connectionIds.length === 1 ? 'account' : 'accounts'}`;
		// Text typed while the save ran is not part of what goes out. Keep it
		// on screen: the sending lock says it waits, and the autosave stores it.
		if (ed.dirty) {
			showToast(message, 'success', { label: 'View in Posts', href: '/posts' });
			void refreshTargets();
			return;
		}
		if (ed.returnToPosts) {
			setPostsNotice(message, 'success');
			void goto('/posts');
			return;
		}
		ed.clearComposer();
		showToast(message, 'success', { label: 'View in Posts', href: '/posts' });
	}

	/**
	 * Close out a post that is now scheduled: back to
	 * Posts when it was opened from there, otherwise an empty composer for the
	 * next one, with a link to where the post went.
	 */
	function finishPosted(tab: 'scheduled', message: string, tone: 'success' | 'warn') {
		const href = `/posts?tab=${tab}`;
		// Text typed while the request ran was not part of what went out. Keep
		// it on screen: the autosave stores it, or the lock says it was refused.
		if (ed.dirty) {
			showToast(message, tone, { label: 'View', href });
			void refreshTargets();
			return;
		}
		if (ed.returnToPosts) {
			setPostsNotice(message, tone);
			void goto(href);
			return;
		}
		ed.clearComposer();
		showToast(message, tone, { label: 'View', href });
	}

	function applyTargets(list: TargetSnapshot[]) {
		ed.targets = list;
		// The clock only ticks while something waits, so it can be long stale.
		ed.clock = Date.now();
		ed.sendBlocked = false;
		ed.publishedLock = isFullyPublished(list);
		// The popover follows the stored time unless the user is picking one.
		if (!ed.scheduleTouched) ed.loadedSchedule = earliestFutureScheduleValue(list, new Date());
		// Alt text refused while the post was sending; the body retries through
		// the autosave, which alt text does not go through.
		if (!ed.editLocked && Object.keys(ed.altPending).length) void ed.flushAltPending();
	}

	let targetsRead: Promise<void> | null = null;

	/**
	 * Re-read where the open post stands; its content is left alone. One read
	 * at a time, and a caller that arrives mid-read waits and reads again, so
	 * what it acts on is never older than its own call.
	 */
	async function refreshTargets() {
		while (targetsRead) await targetsRead;
		targetsRead = readTargets();
		try {
			await targetsRead;
		} finally {
			targetsRead = null;
		}
	}

	async function readTargets() {
		const id = ed.draftId;
		if (!id || ed.loadingDraftId || ed.loadFailedId) return;
		try {
			const res = await fetch(`/api/drafts/${encodeURIComponent(id)}`);
			if (ed.draftId !== id) return;
			if (res.status === 404) {
				// Deleted elsewhere: nothing is being sent, so do not stay paused.
				ed.sendBlocked = false;
				return;
			}
			if (!res.ok) return;
			const data = await res.json().catch(() => null);
			if (ed.draftId !== id || !Array.isArray(data?.draft?.targets)) return;
			applyTargets(data.draft.targets);
		} catch {
			// Best-effort: the next watch tick or action tries again.
		}
	}

	/**
	 * Cancel the post's waiting accounts other than `keep`. The ids come from a
	 * fresh read, not the editor's copy, so an account scheduled from another
	 * tab is not missed. The server refuses any that started sending meanwhile.
	 */
	let unscheduling = $state(false);

	/** Take the post off the schedule and keep it open as a draft. */
	async function unschedulePost() {
		const id = ed.draftId;
		if (!id || unscheduling || ed.publishing || ed.editLocked) return;
		unscheduling = true;
		ed.scheduleOpen = false;
		try {
			const { cancelled, kept } = await cancelWaitingExcept(id, [], ed.targets);
			await refreshTargets();
			if (ed.draftId !== id) return;
			if (kept.length) {
				showToast(`Couldn't unschedule ${kept.map(destinationName).join(', ')}`, 'warn');
			} else if (!cancelled.length) {
				showToast('Nothing was scheduled', 'warn');
			} else if (ed.postState.published.length || ed.postState.failed.length) {
				showToast(`Unscheduled on ${cancelled.map(destinationName).join(', ')}`, 'success');
			} else {
				showToast("Unscheduled — it's a draft again", 'success');
			}
		} finally {
			unscheduling = false;
		}
	}

	/** Open the schedule popover, never toggle it shut (the banner's buttons). */
	function showSchedule() {
		if (!ed.scheduleOpen) ed.openSchedule();
	}

	field(ed, 'pendingAccounts', () => pendingAccounts);
	field(
		ed,
		'pendingPublish',
		() => pendingPublish,
		(v) => (pendingPublish = v)
	);
	field(
		ed,
		'publishRequestSeq',
		() => publishRequestSeq,
		(v) => (publishRequestSeq = v)
	);
	field(
		ed,
		'unscheduling',
		() => unscheduling,
		(v) => (unscheduling = v)
	);
	provide(ed, {
		destinationName,
		finishPosted,
		handOffPublish,
		onPublish,
		platformOf,
		refreshTargets,
		showSchedule,
		unschedulePost
	});
}
