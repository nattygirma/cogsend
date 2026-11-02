<script lang="ts">
	import { ImagePlus, Trash2 } from '@lucide/svelte';
	import CharacterCounter from './CharacterCounter.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import QuotePicker from './QuotePicker.svelte';
	import type { SegmentContext } from './segment-context';

	interface Props {
		ctx: SegmentContext;
		index: number;
		count: number;
	}

	let { ctx, index, count }: Props = $props();

	/** What the file picker accepts. Videos in other containers are converted to MP4. */
	const ACCEPTED_MEDIA =
		'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm';
</script>

<!-- Positioned: the quote list opens under the whole toolbar, which keeps it
     on a phone screen. -->
<div class="relative flex flex-wrap items-center gap-1.5 border-t border-stone-100 px-3 py-2.5">
	{#if !ctx.editLocked}
		<button
			type="button"
			data-testid="attach-image-{index}"
			disabled={ctx.uploadingSegment === index}
			class="toolbar-btn"
			aria-label={ctx.uploadingSegment === index
				? `Uploading to post ${index + 1}`
				: `Add image to post ${index + 1}`}
			title={ctx.uploadingSegment === index ? 'Uploading…' : 'Insert media'}
			onclick={() => ctx.fileRefs[index]?.click()}
		>
			<ImagePlus class="h-4 w-4" />
			<span>{ctx.uploadingSegment === index ? 'Uploading…' : 'Insert Media'}</span>
		</button>
		<input
			bind:this={ctx.fileRefs[index]}
			type="file"
			accept={ACCEPTED_MEDIA}
			multiple
			class="hidden"
			data-testid="file-input-{index}"
			onchange={(e) => {
				const list = e.currentTarget.files;
				if (list?.length) void ctx.attachFilesToSegment(index, Array.from(list));
				e.currentTarget.value = '';
			}}
		/>
		<EmojiPicker
			{index}
			disabled={ctx.editLocked}
			onPick={(emoji) => ctx.insertText(index, emoji)}
		/>
		<QuotePicker {ctx} {index} />
		{#if ctx.segments.length > 1}
			<button
				type="button"
				data-testid="remove-segment-{index}"
				onclick={() => ctx.onRemoveSegment(index)}
				class="toolbar-btn text-rose-600 hover:bg-rose-50 hover:text-rose-700"
				title="Remove post from thread"
				aria-label="Remove post from thread"
			>
				<Trash2 class="h-4 w-4" />
			</button>
		{:else if index === 0 && ctx.canDiscard}
			<button
				type="button"
				data-testid="discard-draft"
				onclick={ctx.requestDiscard}
				class="toolbar-btn text-rose-600 hover:bg-rose-50 hover:text-rose-700"
				title={ctx.discardCopy.label}
				aria-label={ctx.discardCopy.label}
			>
				<Trash2 class="h-4 w-4" />
			</button>
		{/if}
	{/if}
	<div class="ml-auto">
		<CharacterCounter {count} max={ctx.maxChars} testId="segment-count-{index}" />
	</div>
</div>
