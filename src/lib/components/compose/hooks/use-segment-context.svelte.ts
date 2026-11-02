import type { SegmentContext } from '../segment-context';
import type { Composer } from './composer';
import { provide } from './expose';

/** The context each thread card reads. */
export interface SegmentContextApi {
	readonly segmentCtx: SegmentContext;
}

export function useSegmentContext(ed: Composer): void {
	// Getters, not values: each card reads the editor's state as it changes.
	const segmentCtx: SegmentContext = {
		get segments() {
			return ed.segments;
		},
		get editLocked() {
			return ed.editLocked;
		},
		get maxChars() {
			return ed.maxChars;
		},
		get counters() {
			return ed.counters;
		},
		get tabSupportsThreads() {
			return ed.tabSupportsThreads;
		},
		get canDiscard() {
			return ed.canDiscard;
		},
		get discardCopy() {
			return ed.discardCopy;
		},
		get revealTrailing() {
			return ed.revealTrailing;
		},
		set revealTrailing(value) {
			ed.revealTrailing = value;
		},
		get coverFor() {
			return ed.coverFor;
		},
		set coverFor(value) {
			ed.coverFor = value;
		},
		get uploadingSegment() {
			return ed.uploadingSegment;
		},
		get altOpen() {
			return ed.altOpen;
		},
		get fileRefs() {
			return ed.fileRefs;
		},
		get textareaRefs() {
			return ed.textareaRefs;
		},
		get xQuoteActive() {
			return ed.xQuoteActive;
		},
		get quoteLinkPlatforms() {
			return ed.quoteLinkPlatforms;
		},
		get xWithheldFrom() {
			return ed.xWithheldFrom;
		},
		get quotePickerFor() {
			return ed.quotePickerFor;
		},
		get quotePicks() {
			return ed.quotePicks;
		},
		get quotePicksFailed() {
			return ed.quotePicksFailed;
		},
		countForCard: ed.countForCard,
		cardMedia: ed.cardMedia,
		cardQuote: ed.cardQuote,
		hiddenQuote: ed.hiddenQuote,
		cardFit: ed.cardFit,
		jobsFor: ed.jobsFor,
		isVideoItem: ed.isVideoItem,
		handleSegmentInput: ed.handleSegmentInput,
		handlePaste: ed.handlePaste,
		handleDrop: ed.handleDrop,
		syncSegmentInput: ed.syncSegmentInput,
		attachFilesToSegment: ed.attachFilesToSegment,
		toggleAlt: ed.toggleAlt,
		updateMediaAlt: ed.updateMediaAlt,
		requestRemoveMedia: ed.requestRemoveMedia,
		uncheckPlatform: ed.uncheckPlatform,
		onAddSegment: ed.onAddSegment,
		onRemoveSegment: ed.onRemoveSegment,
		requestDiscard: ed.requestDiscard,
		removeQuote: ed.removeQuote,
		canQuoteOnlyOnX: ed.canQuoteOnlyOnX,
		quoteOnlyOnX: ed.quoteOnlyOnX,
		sharedQuote: ed.sharedQuote,
		shareQuoteWithAll: ed.shareQuoteWithAll,
		makeQuote: ed.makeQuote,
		quotePost: ed.quotePost,
		toggleQuotePicker: ed.toggleQuotePicker,
		insertText: ed.insertText,
		moveSegment: ed.handleReorderKeyboard
	};

	provide(ed, { segmentCtx });
}
