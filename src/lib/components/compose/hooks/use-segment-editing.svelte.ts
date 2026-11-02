import { splitAtMarkers, joinThreadSegments, updateSegment } from '#lib/domain/thread-segments.js';
import {
	attachXQuote,
	trailingXQuote,
	keepXQuoteOnX,
	shareXQuote,
	swapXQuote,
	type QuotableTarget,
	quotableXPosts
} from '#lib/domain/x-quote.js';
import { tick } from 'svelte';
import {
	customizePlatformBody,
	effectivePlatformBody,
	resetPlatformToFollow
} from '#lib/domain/platform-sync.js';
import { showToast } from '#lib/components/toast.svelte.js';
import { platformNames } from '#lib/domain/platforms.js';
import { draftExcerpt } from '#lib/domain/excerpt.js';
import type { Composer } from './composer';
import { provide } from './expose';

/** Typing into a thread card and X quote links. */
export interface SegmentEditingApi {
	readonly canQuoteOnlyOnX: (i: number) => boolean;
	readonly handleSegmentInput: (i: number, e: Event) => void;
	readonly makeQuote: (i: number, linkIndex: number) => void;
	readonly quoteOnlyOnX: (i: number) => void;
	readonly quotePost: (i: number, url: string) => void;
	readonly removeQuote: (i: number) => void;
	readonly sharedQuote: (i: number) => { global: string; xFollows: boolean } | null;
	readonly shareQuoteWithAll: (i: number) => void;
	readonly syncSegmentInput: (i: number) => Promise<void>;
	readonly toggleQuotePicker: (i: number) => Promise<void>;
}

export function useSegmentEditing(ed: Composer): void {
	function handleSegmentInput(i: number, e: Event) {
		const typed = (e.target as HTMLTextAreaElement).value;
		const inputType = (e as InputEvent).inputType ?? '';
		// Markers are looked for in what was typed, not with the hidden quote link
		// put back after it: the quote then stays on the last piece instead of
		// being split off into a card of its own.
		const pieces = splitAtMarkers(typed);
		if (!pieces) {
			const val = restoreQuote(i, typed, inputType, i);
			ed.setActiveBody(joinThreadSegments(updateSegment(ed.segments, i, val)));
			void syncSegmentInput(i);
			return;
		}
		const last = pieces.length - 1;
		pieces[last] = restoreQuote(i, pieces[last], inputType, i + last);
		ed.setActiveBody(
			joinThreadSegments([...ed.segments.slice(0, i), ...pieces, ...ed.segments.slice(i + 1)])
		);
		ed.shiftMediaAfter(i, pieces.length - 1);
		const focusAt = i + pieces.length - 1;
		setTimeout(() => {
			ed.textareaRefs[focusAt]?.focus();
		}, 0);
	}

	/**
	 * The text box shows the card without its quoted link, so put the link back
	 * after what was typed. Another X link pasted while a post is quoted stays
	 * in the text as a plain link: replacing the quote would lose the first one.
	 * `landsOn` is the card the text ends up on, which differs from `i` when a
	 * marker split the card.
	 */
	function restoreQuote(i: number, typed: string, inputType: string, landsOn: number): string {
		const hidden = ed.hiddenQuote(i);
		if (hidden) return attachXQuote(typed, hidden.url, hidden.sep);
		const pasted = inputType.startsWith('insertFromPaste') || inputType === 'insertFromDrop';
		if (ed.xQuoteActive && !pasted && trailingXQuote(typed)) ed.revealTrailing = landsOn;
		return typed;
	}

	// The text box only follows the card when the text it should show changes.
	// Pulling a pasted link into the quote card can leave that text unchanged
	// while the box still holds the link, so set it directly.
	async function syncSegmentInput(i: number) {
		await tick();
		const el = ed.textareaRefs[i];
		const want = ed.hiddenQuote(i)?.visible ?? ed.segments[i] ?? '';
		if (el && el.value !== want) el.value = want;
	}

	function setSegmentText(i: number, text: string) {
		ed.setActiveBody(joinThreadSegments(updateSegment(ed.segments, i, text)));
		void syncSegmentInput(i);
	}

	function removeQuote(i: number) {
		const quote = trailingXQuote(ed.segments[i] ?? '');
		if (!quote) return;
		if (ed.revealTrailing === i) ed.revealTrailing = null;
		setSegmentText(i, quote.visible);
	}

	function canQuoteOnlyOnX(i: number): boolean {
		return (
			ed.activeTab === 'global' &&
			ed.quoteLinkPlatforms.length > 0 &&
			keepXQuoteOnX(ed.segments[i] ?? '', 0) !== null
		);
	}

	/** X gets its own tab holding the quote; Global, which the others get, loses the link. */
	function quoteOnlyOnX(i: number) {
		const split = keepXQuoteOnX(ed.baseBody, i);
		if (!split) return;
		ed.revealTrailing = null;
		ed.quotePickerFor = null;
		ed.overrides = customizePlatformBody(ed.overrides, 'x', split.x);
		ed.baseBody = split.global;
		ed.markDirty();
		void syncSegmentInput(i);
		showToast(
			'Only X quotes this post now. X has its own tab, so edits on Global no longer reach it.'
		);
	}

	function sharedQuote(i: number) {
		if (ed.xWithheldFrom.length === 0) return null;
		return shareXQuote(ed.baseBody, effectivePlatformBody(ed.baseBody, ed.overrides, 'x'), i);
	}

	function shareQuoteWithAll(i: number) {
		const shared = sharedQuote(i);
		if (!shared) return;
		// Named before the tab switch below empties the list.
		const others = ed.xWithheldFrom;
		ed.baseBody = shared.global;
		if (shared.xFollows) {
			ed.overrides = resetPlatformToFollow(ed.overrides, 'x');
			ed.activeTab = 'global';
		}
		ed.markDirty();
		showToast(
			shared.xFollows
				? 'Every platform gets the link again.'
				: `${platformNames(others)} ${others.length === 1 ? 'gets' : 'get'} the link too. X keeps its own tab.`
		);
	}

	function makeQuote(i: number, linkIndex: number) {
		setSegmentText(i, swapXQuote(ed.segments[i] ?? '', linkIndex));
	}

	function quotePost(i: number, url: string) {
		const current = ed.segments[i] ?? '';
		ed.quotePickerFor = null;
		setSegmentText(i, current === '' ? url : attachXQuote(current, url, '\n'));
	}

	async function toggleQuotePicker(i: number) {
		if (ed.quotePickerFor === i) {
			ed.quotePickerFor = null;
			return;
		}
		ed.quotePickerFor = i;
		void revealQuotePicker();
		if (ed.quotePicks) return;
		ed.quotePicksFailed = false;
		try {
			// Upcoming posts come first in this list, so ask for enough to reach the
			// recent published ones behind a long schedule.
			const res = await fetch('/api/queue?limit=300');
			if (!res.ok) throw new Error('Could not load your posts');
			const payload = (await res.json()) as { targets?: QuotableTarget[] };
			ed.quotePicks = quotableXPosts(payload.targets ?? []).map((p) => ({
				url: p.url,
				text: draftExcerpt(p.body, 90),
				when: p.at
					? new Date(p.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
					: ''
			}));
		} catch {
			ed.quotePicksFailed = true;
		}
		void revealQuotePicker();
	}

	// The list opens below the card: above it, on the first card, it ran off the
	// top of the page, where no scrolling reaches. Below can be under the fold or
	// behind the fixed bottom bar, so scroll it into view; the list's scroll
	// margin and the spacer under it keep it clear of the bar.
	async function revealQuotePicker() {
		await tick();
		document.querySelector('[data-testid="quote-picker"]')?.scrollIntoView({ block: 'nearest' });
	}

	provide(ed, {
		canQuoteOnlyOnX,
		handleSegmentInput,
		makeQuote,
		quoteOnlyOnX,
		quotePost,
		removeQuote,
		sharedQuote,
		shareQuoteWithAll,
		syncSegmentInput,
		toggleQuotePicker
	});
}
