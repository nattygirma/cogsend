<script lang="ts">
	import { Quote } from '@lucide/svelte';
	import type { SegmentContext } from './segment-context';

	interface Props {
		ctx: SegmentContext;
		index: number;
	}

	let { ctx, index }: Props = $props();

	const quote = $derived(ctx.cardQuote(index));
</script>

<div class="quote-picker-container">
	{#if ctx.xQuoteActive && !quote && !ctx.editLocked}
		<button
			type="button"
			data-testid="quote-post-{index}"
			class="toolbar-btn {ctx.quotePickerFor === index ? 'bg-stone-100 text-stone-900' : ''}"
			aria-label={`Quote one of your X posts in post ${index + 1}`}
			aria-expanded={ctx.quotePickerFor === index}
			title="Quote one of your X posts"
			onclick={() => void ctx.toggleQuotePicker(index)}
		>
			<Quote class="h-4 w-4" /> Quote
		</button>
		{#if ctx.quotePickerFor === index}
			<div
				class="absolute inset-x-2 top-full z-40 mt-1 scroll-mb-32 rounded-[1rem] border border-stone-200/80 bg-white p-2 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.15)] after:pointer-events-none after:absolute after:top-full after:left-0 after:h-32 after:w-px after:content-[''] sm:right-auto sm:w-80"
				role="dialog"
				aria-label="Quote one of your X posts"
				data-testid="quote-picker"
			>
				<div class="mb-1 px-2 py-1">
					<span class="text-[10px] font-bold tracking-widest text-stone-500 uppercase"
						>Your X posts</span
					>
				</div>
				{#if ctx.quotePicksFailed}
					<p class="px-2 py-2 text-[12px] font-medium text-red-600">
						Could not load your posts. Paste any X post link instead.
					</p>
				{:else if ctx.quotePicks === null}
					<p class="px-2 py-2 text-[12px] font-medium text-stone-500">Loading…</p>
				{:else if ctx.quotePicks.length === 0}
					<p class="px-2 py-2 text-[12px] font-medium text-stone-500">
						No published X posts yet. Paste any X post link instead.
					</p>
				{:else}
					<div class="max-h-[40vh] overflow-y-auto">
						{#each ctx.quotePicks as pick (pick.url)}
							<button
								type="button"
								class="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-stone-50"
								onclick={() => ctx.quotePost(index, pick.url)}
							>
								{#if pick.when}
									<span class="text-[11px] font-bold text-stone-500">{pick.when}</span>
								{/if}
								<span class="line-clamp-2 text-[12px] font-medium text-stone-800"
									>{pick.text || pick.url}</span
								>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
