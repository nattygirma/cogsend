import type { PlatformFit } from '#lib/domain/video-rules.js';
import type { XQuote } from '#lib/domain/x-quote.js';
import type { MediaItem, VideoJob } from './types';

/**
 * What a post card reads from and does to the editor that owns the post.
 * The editor hands over one object whose getters read its own state, so the
 * card stays reactive without the post's state being copied into it.
 */
export interface SegmentContext {
	readonly segments: string[];
	readonly editLocked: boolean;
	readonly maxChars: number;
	readonly counters: { x: { max: number } };
	readonly tabSupportsThreads: boolean;
	readonly canDiscard: boolean;
	readonly discardCopy: { label: string };
	revealTrailing: number | null;
	coverFor: string | null;
	readonly uploadingSegment: number | null;
	readonly altOpen: Record<string, boolean>;
	readonly fileRefs: (HTMLInputElement | null)[];
	readonly textareaRefs: (HTMLTextAreaElement | null)[];
	readonly xQuoteActive: boolean;
	readonly quoteLinkPlatforms: string[];
	readonly xWithheldFrom: string[];
	readonly quotePickerFor: number | null;
	readonly quotePicks: Array<{ url: string; text: string; when: string }> | null;
	readonly quotePicksFailed: boolean;

	countForCard(text: string): number;
	cardMedia(index: number): MediaItem[];
	cardQuote(index: number): XQuote | null;
	hiddenQuote(index: number): XQuote | null;
	cardFit(index: number): PlatformFit[];
	jobsFor(index: number): VideoJob[];
	isVideoItem(m: { mime?: string | null }): boolean;
	handleSegmentInput(index: number, e: Event): void;
	handlePaste(e: ClipboardEvent, index: number): void;
	handleDrop(e: DragEvent, index: number): void;
	syncSegmentInput(index: number): Promise<void>;
	attachFilesToSegment(index: number, files: File[]): Promise<void>;
	toggleAlt(id: string): void;
	updateMediaAlt(mediaId: string, altText: string): Promise<void>;
	requestRemoveMedia(mediaId: string): void;
	uncheckPlatform(platform: string): void;
	onAddSegment(): void;
	onRemoveSegment(index: number): void;
	requestDiscard(): void;
	removeQuote(index: number): void;
	canQuoteOnlyOnX(index: number): boolean;
	quoteOnlyOnX(index: number): void;
	sharedQuote(index: number): unknown;
	shareQuoteWithAll(index: number): void;
	makeQuote(index: number, linkIndex: number): void;
	quotePost(index: number, url: string): void;
	toggleQuotePicker(index: number): Promise<void>;
	insertText(index: number, text: string): void;
	moveSegment(index: number, delta: -1 | 1): void;
}
