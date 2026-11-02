import {
	type PlatformId,
	isPlatformCustomized,
	customizePlatformBody,
	resetPlatformToFollow
} from '#lib/domain/platform-sync.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Selecting accounts, customizing per platform and the publish button state. */
export interface AccountActionsApi {
	readonly addOverride: (accountId: string) => void;
	readonly canShare: boolean;
	readonly clearPostConfirm: () => void;
	readonly clearSelection: () => void;
	readonly countForCard: (text: string) => number;
	readonly dismissPostConfirm: () => void;
	readonly publishButtonBusy: boolean;
	readonly publishButtonLabel:
		'Saving…' | 'Scheduling…' | 'Publishing…' | 'Publish now' | 'Publish';
	readonly publishReplacesSchedule: boolean;
	readonly resetToGlobal: (platform: PlatformId) => void;
	readonly saveIndicator: 'saving' | 'saved' | 'failed' | null;
	readonly selectAllAccounts: () => void;
	readonly selectOnly: (id: string) => void;
	readonly showPostStatus: boolean;
	readonly startPublishBusy: () => void;
	readonly stopPublishBusy: () => void;
	readonly toggleAccountSelection: (id: string) => void;
	readonly unscheduledByPublish: string[];
}

export function useAccountActions(ed: Composer): void {
	const activeConnectionIds = $derived(
		ed.sortedConnections.filter((c) => !c.status || c.status === 'active').map((c) => c.id)
	);

	function selectAllAccounts() {
		if (activeConnectionIds.every((id) => ed.selected.has(id))) return;
		ed.selected = new Set([...ed.selected, ...activeConnectionIds]);
		ed.selectionTouched = true;
		ed.markDirty();
	}

	function clearSelection() {
		if (!ed.selected.size) return;
		ed.selected = new Set();
		ed.selectionTouched = true;
		ed.markDirty();
	}

	function selectOnly(id: string) {
		if (ed.selected.size === 1 && ed.selected.has(id)) return;
		ed.selected = new Set([id]);
		ed.selectionTouched = true;
		ed.markDirty();
	}

	function toggleAccountSelection(id: string) {
		const next = new Set(ed.selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		ed.selected = next;
		ed.selectionTouched = true;
		ed.markDirty();
	}

	function addOverride(accountId: string) {
		const conn = ed.connections.find((c) => c.id === accountId);
		if (!conn) return;
		const platform = conn.platform as PlatformId;
		if (!isPlatformCustomized(ed.overrides, platform)) {
			ed.overrides = customizePlatformBody(ed.overrides, platform, ed.baseBody);
			ed.markDirty();
		}
		ed.activeTab = platform;
		ed.isAddOverrideOpen = false;
	}

	function resetToGlobal(platform: PlatformId) {
		ed.overrides = resetPlatformToFollow(ed.overrides, platform);
		if (ed.activeTab === platform) ed.activeTab = 'global';
		ed.markDirty();
	}

	function countForCard(text: string): number {
		return ed.countForPlatform(
			text,
			ed.activeTab === 'global' ? ed.globalLimit.platform : ed.activeTab
		);
	}

	function clearPostConfirm() {
		// Invalidate any in-flight pre-publish save's dialog update.
		ed.publishRequestSeq++;
		ed.pendingPublish = null;
		ed.isPostConfirmOpen = false;
	}

	function dismissPostConfirm() {
		// User close attempts (Keep editing, outside click) are ignored while
		// the skip-ask path is saving before it hands the publish off.
		if (ed.publishing) return;
		clearPostConfirm();
	}

	function startPublishBusy() {
		if (ed.publishBusyTimer) clearTimeout(ed.publishBusyTimer);
		ed.publishBusyVisible = false;
		ed.publishBusyTimer = setTimeout(() => {
			ed.publishBusyVisible = true;
			ed.publishBusyTimer = null;
		}, 400);
	}

	function stopPublishBusy() {
		if (ed.publishBusyTimer) {
			clearTimeout(ed.publishBusyTimer);
			ed.publishBusyTimer = null;
		}
		ed.publishBusyVisible = false;
	}

	const publishButtonBusy = $derived(
		ed.publishing && (ed.saving || ed.busyAction === 'schedule' || ed.publishBusyVisible)
	);

	// A post that has been anywhere says where; the lock banner covers a post
	// that went out everywhere.
	const showPostStatus = $derived(
		ed.mounted &&
			!ed.publishedLock &&
			!ed.loadFailedId &&
			Boolean(ed.draftId) &&
			(ed.sendingNow ||
				ed.postState.waiting.length > 0 ||
				ed.postState.processing.length > 0 ||
				ed.postState.published.length > 0 ||
				ed.postState.failed.length > 0)
	);
	// On a scheduled post, Publish sends it now instead of at its time.
	const publishIdleLabel = $derived(ed.hasSchedule ? 'Publish now' : 'Publish');
	// The confirmed publish sends something that was waiting for its time.
	const publishReplacesSchedule = $derived(
		ed.postState.waiting.some((w) =>
			(ed.pendingPublish?.connectionIds ?? []).includes(w.connectionId)
		)
	);
	// Waiting accounts the confirmed publish leaves out: they get unscheduled.
	const unscheduledByPublish = $derived(
		ed.postState.waiting
			.map((w) => w.connectionId)
			.filter((id) => !(ed.pendingPublish?.connectionIds ?? []).includes(id))
	);

	const publishButtonLabel = $derived(
		ed.publishing
			? ed.saving
				? 'Saving…'
				: ed.busyAction === 'schedule'
					? 'Scheduling…'
					: ed.publishBusyVisible
						? 'Publishing…'
						: publishIdleLabel
			: publishIdleLabel
	);
	// A preview link is for what has not gone out yet, and a draft that failed to
	// load has nothing trustworthy saved to show.
	const canShare = $derived(
		!ed.editLocked && !ed.loadFailedId && (ed.draftId !== null || ed.baseBody.trim() !== '')
	);

	// Autosave is otherwise silent, and a phone has no Cmd+S to fall back on.
	// A pending autosave already reads as "Saving…"; an empty new draft is never
	// saved, so it shows nothing.
	const saveIndicator = $derived.by((): 'saving' | 'saved' | 'failed' | null => {
		if (ed.loadFailedId || ed.loadingDraftId || ed.editLocked) return null;
		if (ed.saveFailed) return 'failed';
		if (ed.saving || (ed.dirty && (ed.draftId || ed.baseBody.trim()))) return 'saving';
		return ed.draftId ? 'saved' : null;
	});

	field(ed, 'canShare', () => canShare);
	field(ed, 'publishButtonBusy', () => publishButtonBusy);
	field(ed, 'publishButtonLabel', () => publishButtonLabel);
	field(ed, 'publishReplacesSchedule', () => publishReplacesSchedule);
	field(ed, 'saveIndicator', () => saveIndicator);
	field(ed, 'showPostStatus', () => showPostStatus);
	field(ed, 'unscheduledByPublish', () => unscheduledByPublish);
	provide(ed, {
		addOverride,
		clearPostConfirm,
		clearSelection,
		countForCard,
		dismissPostConfirm,
		resetToGlobal,
		selectAllAccounts,
		selectOnly,
		startPublishBusy,
		stopPublishBusy,
		toggleAccountSelection
	});
}
