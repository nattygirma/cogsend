<script lang="ts">
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import EditorToolbar from './EditorToolbar.svelte';
	import MediaStrip from './MediaStrip.svelte';
	import { autoResize } from './auto-resize';
	import type { SegmentContext } from './segment-context';

	interface Props {
		ctx: SegmentContext;
		segment: string;
		index: number;
	}

	let { ctx, segment, index }: Props = $props();

	const count = $derived(ctx.countForCard(segment));
	const isThread = $derived(ctx.segments.length > 1);
</script>

<div class="flex gap-2">
	<!-- min-w-0 is load-bearing: the link preview's title truncates (nowrap), and
	     a flex item's default min-width:auto let that one line set the card's
	     min-content width, stretching it past the column instead of ellipsizing. -->
	<div
		data-testid="segment-card-{index}"
		class="flex min-w-0 flex-1 flex-col rounded-xl border border-stone-200 bg-white transition-shadow focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100"
	>
		<div class="px-4 pt-3.5 pb-3">
			<textarea
				use:autoResize={segment}
				bind:this={ctx.textareaRefs[index]}
				value={ctx.hiddenQuote(index)?.visible ?? segment}
				data-segment-index={index}
				data-testid="segment-input-{index}"
				readonly={ctx.editLocked}
				oninput={(e) => ctx.handleSegmentInput(index, e)}
				onpaste={(e) => ctx.handlePaste(e, index)}
				onblur={() => {
					if (ctx.revealTrailing !== index) return;
					ctx.revealTrailing = null;
					void ctx.syncSegmentInput(index);
				}}
				ondrop={(e) => ctx.handleDrop(e, index)}
				ondragover={(e) => e.preventDefault()}
				placeholder={index === 0 ? "What's happening?" : 'Add a comment or the next post…'}
				aria-label={index === 0 ? 'Post text' : `Post ${index + 1} text`}
				class="w-full resize-none bg-transparent text-[15px] leading-relaxed text-stone-900 placeholder:text-stone-400 focus:outline-none pointer-coarse:text-base {index ===
				0
					? 'min-h-[180px]'
					: 'min-h-[72px]'}"
				rows="1"></textarea>
			<MediaStrip {ctx} {segment} {index} />
		</div>
		<EditorToolbar {ctx} {index} {count} />
	</div>

	{#if isThread && !ctx.editLocked}
		<div class="flex flex-col pt-1 text-stone-400">
			<button
				type="button"
				class="flex h-7 w-7 items-center justify-center rounded-md hover:bg-stone-200/60 hover:text-stone-700 disabled:opacity-30"
				disabled={index === 0}
				aria-label={`Move post ${index + 1} up`}
				title="Move up"
				onclick={() => ctx.moveSegment(index, -1)}
			>
				<ChevronUp class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="flex h-7 w-7 items-center justify-center rounded-md hover:bg-stone-200/60 hover:text-stone-700 disabled:opacity-30"
				disabled={index === ctx.segments.length - 1}
				aria-label={`Move post ${index + 1} down`}
				title="Move down"
				onclick={() => ctx.moveSegment(index, 1)}
			>
				<ChevronDown class="h-4 w-4" />
			</button>
		</div>
	{/if}
</div>
