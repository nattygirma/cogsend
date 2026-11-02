import { supportsThreads } from '#lib/domain/platforms.js';
import {
	remapSegmentIndexAfterInsert,
	joinThreadSegments,
	addSegment,
	removeSegment,
	reorderSegments,
	remapSegmentIndexAfterReorder
} from '#lib/domain/thread-segments.js';
import { type MediaMove, persistMediaLayout } from '#lib/domain/media-sync.js';
import { showToast } from '#lib/components/toast.svelte.js';
import type { MediaItem } from '../types';
import { remapSegmentIndexAfterRemoval } from '#lib/domain/media-limits.js';
import type { PlatformId } from '#lib/domain/platform-sync.js';
import { attachXQuote } from '#lib/domain/x-quote.js';
import { splitLongText } from '#lib/domain/text-split.js';
import type { Composer } from './composer';
import { provide } from './expose';

/** Adding, removing, reordering and splitting thread posts. */
export interface ThreadOpsApi {
	readonly handleDrop: (e: DragEvent, index: number) => void;
	readonly handlePaste: (e: ClipboardEvent, index: number) => void;
	readonly handleReorderKeyboard: (index: number, direction: 1 | -1) => void;
	readonly onAddSegment: () => void;
	readonly onRemoveSegment: (index: number) => void;
	readonly shiftMediaAfter: (index: number, added: number) => void;
}

export function useThreadOps(ed: Composer): void {
	/**
	 * Keep images on the cards they belong to when cards are inserted after
	 * card `index`. A single-post view (LinkedIn) edits a flattened body whose
	 * cards are not the thread's, so the thread's images stay where they are.
	 */
	function shiftMediaAfter(index: number, added: number) {
		if (added === 0) return;
		if (ed.activeTab !== 'global' && !supportsThreads(ed.activeTab)) return;
		const remapped = ed.media.map((m) => ({
			...m,
			segmentIndex: remapSegmentIndexAfterInsert(m.segmentIndex ?? 0, index, added)
		}));
		const moves = remapped
			.filter((m, k) => m.segmentIndex !== (ed.media[k]?.segmentIndex ?? 0))
			.map((m) => ({ id: m.id, segmentIndex: m.segmentIndex }));
		ed.media = remapped;
		void queueMediaSync(moves, [], { saveBodyFirst: true });
	}

	function onAddSegment() {
		if (ed.editLocked) return;
		const idx = ed.segments.length;
		ed.setActiveBody(joinThreadSegments(addSegment(ed.segments)));
		ed.focusedSegment = idx;
		setTimeout(() => {
			ed.textareaRefs[idx]?.focus();
		}, 0);
	}

	// Media segmentIndex lives in its own table and the UI applies changes
	// optimistically, so these writes are queued in order, retried once and
	// awaited before publish — publish reads the stored index, and a silently
	// dropped move would attach an image to the wrong thread post.
	function queueMediaSync(
		moves: MediaMove[],
		removals: string[] = [],
		opts: { saveBodyFirst?: boolean } = {}
	) {
		const id = ed.draftId;
		if (!id || (!moves.length && !removals.length)) return ed.mediaSync;
		ed.mediaSync = ed.mediaSync
			.catch(() => {})
			.then(async () => {
				// The server refuses an image on a card the stored draft does not
				// have yet, so a move onto a card a split just created waits for
				// the body that created it instead of the autosave. persistClean,
				// because a save already in flight may predate the split.
				if (opts.saveBodyFirst) await ed.persistClean();
				const result = await persistMediaLayout({ draftId: id, moves, removals });
				if (!result.ok) {
					showToast('Couldn’t save the image layout — check the images and try again', 'error');
				}
			});
		return ed.mediaSync;
	}

	function onRemoveSegment(index: number) {
		if (ed.editLocked) return;
		// An upload in flight was told which post it belongs to.
		if (ed.videoJobs.some((job) => job.segmentIndex >= index)) {
			showToast('Wait for the video to finish uploading', 'warn');
			return;
		}
		if (ed.uploadingSegment === index) ed.uploadingSegment = null;
		else if (ed.uploadingSegment !== null && ed.uploadingSegment > index) ed.uploadingSegment -= 1;
		ed.revealTrailing = null;
		ed.setActiveBody(joinThreadSegments(removeSegment(ed.segments, index)));
		ed.focusedSegment = Math.max(0, Math.min(index, ed.segments.length - 2));
		const kept: MediaItem[] = [];
		const moves: MediaMove[] = [];
		const removals: string[] = [];
		for (const m of ed.media) {
			const mapped = remapSegmentIndexAfterRemoval(m.segmentIndex ?? 0, index);
			if (mapped === null) {
				removals.push(m.id);
				continue;
			}
			if (mapped !== (m.segmentIndex ?? 0)) moves.push({ id: m.id, segmentIndex: mapped });
			kept.push({ ...m, segmentIndex: mapped });
		}
		ed.media = kept;
		void queueMediaSync(moves, removals);
	}

	function applyReorder(from: number, to: number) {
		if (ed.editLocked) return;
		if (from === to) return;
		const next = reorderSegments(ed.segments, from, to);
		if (next === ed.segments) return;
		ed.revealTrailing = null;
		ed.setActiveBody(joinThreadSegments(next));
		ed.focusedSegment = to;
		const remapped = ed.media.map((m) => ({
			...m,
			segmentIndex: remapSegmentIndexAfterReorder(m.segmentIndex ?? 0, from, to)
		}));
		const moves = remapped
			.filter((m, i) => m.segmentIndex !== (ed.media[i]?.segmentIndex ?? 0))
			.map((m) => ({ id: m.id, segmentIndex: m.segmentIndex ?? 0 }));
		ed.media = remapped;
		void queueMediaSync(moves);
	}

	function handleReorderKeyboard(index: number, direction: -1 | 1) {
		const to = index + direction;
		if (to < 0 || to >= ed.segments.length) return;
		applyReorder(index, to);
		setTimeout(() => {
			ed.textareaRefs[to]?.focus();
		}, 0);
	}

	function handleSplitPaste(segmentIndex: number, pasted: string): boolean {
		const text = pasted.replace(/\r\n/g, '\n');
		const hasDelimiter = text.includes('\n---\n') || /\n---\n/.test(text);
		const selectedCaps = ([...ed.selectedPlatforms] as PlatformId[]).map((p) => ({
			platform: p,
			max: ed.platformMax(p, ed.accountsFor(p))
		}));
		let capPlatform = selectedCaps[0]?.platform;
		let cap = selectedCaps[0]?.max ?? ed.maxChars;
		for (const c of selectedCaps) {
			if (c.max < cap) {
				cap = c.max;
				capPlatform = c.platform;
			}
		}
		if (ed.activeTab !== 'global') {
			cap = ed.platformMax(ed.activeTab, ed.accountsFor(ed.activeTab));
			capPlatform = ed.activeTab;
		}
		const countFn = (s: string) => ed.countForPlatform(s, capPlatform ?? 'generic');
		// A card holding only a quote looks empty, so the pasted thread fills it
		// from the top and the quote stays on its first post, with room left for
		// the link.
		const hidden = ed.hiddenQuote(segmentIndex);
		const quoteOnly = hidden !== null && hidden.visible.trim() === '' ? hidden : null;
		const fit = quoteOnly
			? cap - (countFn(attachXQuote('a', quoteOnly.url, '\n')) - countFn('a'))
			: cap;
		if (!hasDelimiter && splitLongText(text, fit, countFn).length <= 1) return false;
		const pieces = hasDelimiter
			? text
					.split(/\n?---\n?/)
					.map((s) => s.trim())
					.filter(Boolean)
			: splitLongText(text, fit, countFn);
		if (pieces.length <= 1) return false;
		if (quoteOnly) pieces[0] = attachXQuote(pieces[0], quoteOnly.url, '\n');
		const wasEmpty = quoteOnly !== null || (ed.segments[segmentIndex] ?? '').trim() === '';
		const next = wasEmpty
			? [...ed.segments.slice(0, segmentIndex), ...pieces, ...ed.segments.slice(segmentIndex + 1)]
			: [
					...ed.segments.slice(0, segmentIndex + 1),
					...pieces,
					...ed.segments.slice(segmentIndex + 1)
				];
		const delta = next.length - ed.segments.length;
		ed.setActiveBody(joinThreadSegments(next));
		shiftMediaAfter(segmentIndex, delta);
		ed.focusedSegment = wasEmpty ? segmentIndex + pieces.length - 1 : segmentIndex + pieces.length;
		showToast(`Split into ${pieces.length} posts`, 'success');
		return true;
	}

	function handlePaste(e: ClipboardEvent, index: number) {
		if (ed.editLocked) return;
		const data = e.clipboardData;
		if (!data) return;
		const files: File[] = [];
		for (let i = 0; i < data.items.length; i++) {
			const item = data.items[i];
			if (item.kind === 'file' && ed.isMediaFile(item.type)) {
				const f = item.getAsFile();
				if (f) files.push(f);
			}
		}
		if (files.length) {
			e.preventDefault();
			void ed.attachFilesToSegment(index, files);
			return;
		}
		const pasted = data.getData('text/plain');
		if (pasted && handleSplitPaste(index, pasted)) e.preventDefault();
	}

	function handleDrop(e: DragEvent, index: number) {
		e.preventDefault();
		if (ed.editLocked) return;
		if (e.dataTransfer?.files?.length) {
			const files = Array.from(e.dataTransfer.files).filter((f) => ed.isMediaFile(f.type));
			if (files.length) void ed.attachFilesToSegment(index, files);
		}
	}

	provide(ed, {
		handleDrop,
		handlePaste,
		handleReorderKeyboard,
		onAddSegment,
		onRemoveSegment,
		shiftMediaAfter
	});
}
