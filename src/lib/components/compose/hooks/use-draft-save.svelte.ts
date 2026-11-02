import { type SaveSnapshot, variantOptionsFor, optionsNeedVariant } from '../save';
import {
	type PlatformId,
	customizedBodiesForSave,
	isPlatformCustomized
} from '#lib/domain/platform-sync.js';
import { PLATFORM_ORDER } from '#lib/domain/platforms.js';
import { showToast } from '#lib/components/toast.svelte.js';
import { humanizeError } from '#lib/domain/human-error.js';
import { PUBLISHED_EDIT_ERROR, PUBLISH_IN_PROGRESS_ERROR } from '#lib/domain/published-lock.js';
import type { Composer } from './composer';
import { provide } from './expose';

/** Saving the draft and its per-platform variants. */
export interface DraftSaveApi {
	readonly persistAll: (
		allowEmpty?: boolean,
		opts?: { navigate?: boolean | undefined }
	) => Promise<string | null>;
	readonly persistClean: (rounds?: number) => Promise<string | null>;
	readonly persistForAction: () => Promise<string | null>;
}

export function useDraftSave(ed: Composer): void {
	async function ensureDraft(
		snap: SaveSnapshot = {
			baseBody: ed.baseBody,
			overrides: ed.overrides,
			youtubeOptions: ed.youtubeOptions,
			tiktokOptions: ed.tiktokOptions,
			selectedConnectionIds: [...ed.selected]
		},
		navigate = true
	): Promise<string> {
		const generation = ed.editorGeneration;
		const current = ed.draftId;
		if (current) {
			const res = await fetch(`/api/drafts/${current}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseBody: snap.baseBody,
					selectedConnectionIds: snap.selectedConnectionIds
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to save draft');
			return current;
		}
		const res = await fetch('/api/drafts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				baseBody: snap.baseBody,
				selectedConnectionIds: snap.selectedConnectionIds
			})
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || 'Failed to create draft');
		// The editor moved on while this post was being created: it is saved,
		// but the editor now holds another one.
		if (generation !== ed.editorGeneration) return data.draft.id as string;
		ed.draftId = data.draft.id;
		// Mark content as loaded BEFORE touching the URL so the id-watcher
		// effect sees id === loadedDraftContentFor and skips a spurious
		// loadDraft() that would overwrite in-flight typing.
		ed.loadedDraftContentFor = ed.draftId;
		if (navigate) {
			// Shallow URL update only: goto() re-runs load and steals textarea
			// focus on first autosave; replaceState() keeps focus and state.
			ed.setComposeUrl(`/compose?id=${data.draft.id}`);
		}
		return data.draft.id as string;
	}

	async function saveVariants(
		id: string,
		snap: SaveSnapshot = {
			baseBody: ed.baseBody,
			overrides: ed.overrides,
			youtubeOptions: ed.youtubeOptions,
			tiktokOptions: ed.tiktokOptions,
			selectedConnectionIds: [...ed.selected]
		},
		// Which variants this post has stored, taken when its save began.
		stored: Set<PlatformId> = ed.storedVariants
	) {
		const toSave = customizedBodiesForSave(snap.baseBody, snap.overrides, PLATFORM_ORDER);
		// Write a variant only when this save actually needs one, and clear a
		// row only when it exists. The old shape fired a request for every
		// platform on every save (usually five no-op DELETEs), each a full
		// Worker invocation.
		const writes = PLATFORM_ORDER.map((platform) => {
			const customized = isPlatformCustomized(snap.overrides, platform);
			const options = variantOptionsFor(platform, snap);
			if (customized || optionsNeedVariant(platform, snap)) {
				// Mark at dispatch, not on response: if the write commits but
				// the response is lost, a later save must still be allowed to
				// DELETE the row instead of leaving a stale variant that would
				// override the main body at publish time.
				stored.add(platform);
				return {
					platform,
					action: 'put' as const,
					request: fetch(`/api/drafts/${id}/variants`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							platform,
							body: customized ? (toSave[platform] ?? '') : null,
							options
						})
					})
				};
			}
			if (!stored.has(platform)) return null;
			return {
				platform,
				action: 'delete' as const,
				request: fetch(`/api/drafts/${id}/variants?platform=${platform}`, {
					method: 'DELETE'
				})
			};
		});
		const pending = writes.filter((w): w is NonNullable<typeof w> => w !== null);
		const results = await Promise.all(pending.map((w) => w.request));
		for (let i = 0; i < results.length; i++) {
			const res = results[i];
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || `Failed to save ${pending[i].platform} variant`);
			}
			if (pending[i].action === 'delete') stored.delete(pending[i].platform);
		}
	}

	let savePromise: Promise<string | null> | null = null;
	let saveGeneration = -1;

	async function persistAll(
		allowEmpty = false,
		opts: { navigate?: boolean } = {}
	): Promise<string | null> {
		if (savePromise && saveGeneration === ed.editorGeneration) return savePromise;
		// A save for the post before a reset does not save this one: let it
		// land, then save this post in its own right.
		while (savePromise) await savePromise;
		savePromise = doPersist(allowEmpty, opts);
		saveGeneration = ed.editorGeneration;
		try {
			return await savePromise;
		} finally {
			savePromise = null;
		}
	}

	async function doPersist(
		allowEmpty = false,
		opts: { navigate?: boolean } = {}
	): Promise<string | null> {
		// Backstop for every caller (autosave, Cmd+S, publish, schedule,
		// beforeunload): never write a draft whose stored copy never loaded.
		if (ed.loadFailedId) return null;
		if (ed.publishedLock) return ed.draftId;
		if (ed.sendingNow) return null;
		const emptyNew = !ed.draftId && !ed.baseBody.trim();
		if (emptyNew && !allowEmpty) return null;
		// Nothing changed since the last successful save: skip the round trips.
		// Callers already gate on dirty; this makes the guarantee explicit for
		// every save path (autosave, Cmd+S, beforeunload, publish, schedule).
		if (
			ed.draftId &&
			ed.takeSnapshot() === ed.savedSnapshot &&
			Object.keys(ed.altPending).length === 0
		) {
			return ed.draftId;
		}
		ed.saving = true;
		const generation = ed.editorGeneration;
		const stored = ed.storedVariants;
		const before = ed.takeSnapshot();
		const snap: SaveSnapshot = {
			baseBody: ed.baseBody,
			overrides: ed.overrides,
			youtubeOptions: ed.youtubeOptions,
			tiktokOptions: ed.tiktokOptions,
			selectedConnectionIds: [...ed.selected]
		};
		try {
			const id = await ensureDraft(snap, opts.navigate ?? true);
			await saveVariants(id, snap, stored);
			if (generation !== ed.editorGeneration) return id;
			ed.loadedDraftContentFor = id;
			ed.saveFailed = false;
			if (ed.takeSnapshot() === before) {
				ed.savedSnapshot = before;
				ed.dirty = false;
			}
			return id;
		} catch (e) {
			if (generation !== ed.editorGeneration) {
				// The post this was saving is no longer open; its state is not
				// this editor's to change, but the loss is still worth saying.
				showToast(humanizeError(e instanceof Error ? e.message : 'Save failed'), 'error');
				return null;
			}
			if (e instanceof Error && e.message === PUBLISHED_EDIT_ERROR) {
				// Published from elsewhere (another tab, the scheduler) while
				// open here: say so with the lock banner, not a failed save.
				ed.publishedLock = true;
				ed.saveFailed = false;
				return null;
			}
			if (e instanceof Error && e.message === PUBLISH_IN_PROGRESS_ERROR) {
				// The scheduler is sending it right now. The edit stays dirty and
				// the autosave tries again once the send settles, unless it went
				// out everywhere, which the lock banner then reports.
				ed.sendBlocked = true;
				ed.saveFailed = false;
				void ed.refreshTargets();
				return null;
			}
			ed.saveFailed = true;
			showToast(humanizeError(e instanceof Error ? e.message : 'Save failed'), 'error');
			return null;
		} finally {
			ed.saving = false;
		}
	}

	async function persistClean(rounds = 3): Promise<string | null> {
		let id: string | null = null;
		for (let i = 0; i < rounds; i++) {
			id = await persistAll();
			if (!id || !ed.dirty) return id;
		}
		return id;
	}

	/**
	 * Persist only when there is something to persist. A clean, fully-saved
	 * draft returns its id immediately, so Publish/Schedule never wait on a
	 * redundant PATCH + variant fan-out before the real action starts.
	 */
	async function persistForAction(): Promise<string | null> {
		// Media moves are written next to the body; publish reads the stored
		// index, so any in-flight layout write has to land first.
		await ed.mediaSync;
		if (ed.draftId && !ed.dirty && !ed.saving && Object.keys(ed.altPending).length === 0)
			return ed.draftId;
		await ed.flushAltPending();
		return persistClean();
	}

	provide(ed, { persistAll, persistClean, persistForAction });
}
