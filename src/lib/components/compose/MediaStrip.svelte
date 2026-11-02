<script lang="ts">
	import { X } from '@lucide/svelte';
	import LinkPreview from '../LinkPreview.svelte';
	import MediaPreview from '../MediaPreview.svelte';
	import MediaFit from '../video/MediaFit.svelte';
	import XQuoteCard from '../XQuoteCard.svelte';
	import { X_FOLD } from '#lib/domain/x-limits.js';
	import { xWeightedLength } from '#lib/domain/validation/text.js';
	import { parseXPostUrl, strayXPostLinks } from '#lib/domain/x-quote.js';
	import type { SegmentContext } from './segment-context';

	interface Props {
		ctx: SegmentContext;
		segment: string;
		index: number;
	}

	let { ctx, segment, index }: Props = $props();

	const segMedia = $derived(ctx.cardMedia(index));
	const quote = $derived(ctx.cardQuote(index));
	const strayLinks = $derived(ctx.xQuoteActive ? strayXPostLinks(segment) : []);
</script>

{#if segMedia.length > 0 || ctx.jobsFor(index).length > 0}
	{@const job = ctx.jobsFor(index)[0]}
	<div class="mt-3" data-testid="segment-media-{index}">
		<MediaPreview
			items={segMedia}
			maxHeight={400}
			extra={Math.max(0, segMedia.length - 4)}
			progress={job && !segMedia.length
				? {
						label: `${
							job.phase === 'uploading'
								? 'Uploading'
								: job.phase === 'converting'
									? 'Converting'
									: 'Reading'
						} ${Math.round(job.progress * 100)}%`,
						fraction: job.progress,
						onCancel: () => job.controller.abort(),
						cancelLabel: `Cancel the video for post ${index + 1}`,
						testId: `video-progress-${index}`,
						cancelTestId: `video-cancel-${index}`
					}
				: null}
		>
			{#snippet toolbar(m)}
				{@const hasAlt = Boolean((m.altText || '').trim())}
				{@const kind = ctx.isVideoItem(m) ? 'video' : 'image'}
				<button
					type="button"
					data-testid="alt-toggle-{m.id}"
					onclick={() => ctx.toggleAlt(m.id)}
					class="min-h-7 rounded-full px-2.5 text-[11px] font-bold tracking-wide shadow-sm backdrop-blur-sm {hasAlt
						? 'bg-black/60 text-white hover:bg-black/75'
						: 'bg-amber-400 text-black hover:bg-amber-300'}"
					title={hasAlt ? 'Edit alt text' : 'Add alt text (accessibility)'}
					aria-label={`${hasAlt ? 'Edit' : 'Add'} alt text for ${kind} ${index + 1}`}
				>
					ALT
				</button>
				{#if !ctx.editLocked && ctx.isVideoItem(m)}
					<button
						type="button"
						data-testid="video-cover-{m.id}"
						onclick={() => (ctx.coverFor = m.id)}
						class="min-h-7 rounded-full bg-black/60 px-2.5 text-[11px] font-bold tracking-wide text-white shadow-sm backdrop-blur-sm hover:bg-black/75"
						title="Choose the cover"
						aria-label={`Choose the cover for video ${index + 1}`}
					>
						COVER
					</button>
				{/if}
				{#if !ctx.editLocked}
					<button
						type="button"
						data-testid="remove-media-{m.id}"
						onclick={() => ctx.requestRemoveMedia(m.id)}
						class="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-sm hover:bg-black/75"
						title={`Remove ${kind} ${index + 1}`}
						aria-label={`Remove ${kind} ${index + 1}`}
					>
						<X class="h-3.5 w-3.5" />
					</button>
				{/if}
			{/snippet}
		</MediaPreview>
	</div>
{/if}

{#each segMedia as m (m.id)}
	{#if ctx.altOpen[m.id]}
		<!-- In flow under the media strip: as a thumb-anchored popover this
	     hung off the right edge whenever the thumb was not the first. -->
		<div class="mt-2 rounded-xl border border-stone-200/80 bg-white p-2 shadow-sm">
			<input
				type="text"
				value={m.altText || ''}
				data-testid="media-alt-{m.id}"
				readonly={ctx.editLocked}
				oninput={(e) => ctx.updateMediaAlt(m.id, e.currentTarget.value)}
				placeholder={ctx.isVideoItem(m) ? 'Describe this video…' : 'Describe this image…'}
				aria-label={`Alt text for ${ctx.isVideoItem(m) ? 'video' : 'image'} ${index + 1}`}
				class="w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] font-medium text-stone-900 focus:border-stone-400 focus:bg-white focus:outline-none pointer-coarse:text-base"
			/>
			<div class="mt-1 flex justify-end">
				<button
					type="button"
					data-testid="alt-done-{m.id}"
					onclick={() => ctx.toggleAlt(m.id)}
					class="text-[11px] font-bold text-stone-900 hover:underline">Done</button
				>
			</div>
		</div>
	{/if}
{/each}

<MediaFit
	problems={ctx.cardFit(index)}
	onUncheck={ctx.editLocked ? undefined : ctx.uncheckPlatform}
	testId="media-fit-{index}"
/>

{#if quote}
	<XQuoteCard
		url={quote.url}
		onRemove={ctx.editLocked ? undefined : () => ctx.removeQuote(index)}
		otherPlatforms={ctx.quoteLinkPlatforms}
		onOnlyOnX={!ctx.editLocked && ctx.canQuoteOnlyOnX(index)
			? () => ctx.quoteOnlyOnX(index)
			: undefined}
		withheldFrom={ctx.xWithheldFrom}
		onShareWithAll={!ctx.editLocked && ctx.sharedQuote(index)
			? () => ctx.shareQuoteWithAll(index)
			: undefined}
	/>
{:else}
	<LinkPreview text={segment} hasMedia={segMedia.length > 0} />
{/if}

{#if ctx.xQuoteActive && ctx.counters.x.max > X_FOLD && xWeightedLength(segment) > X_FOLD}
	<p class="mt-3 text-[12px] font-medium text-stone-500" data-testid="x-fold-{index}">
		X shows about the first {X_FOLD} characters, then Show more.
	</p>
{/if}

{#if strayLinks.length > 0 && !ctx.editLocked}
	<div
		class="mt-3 flex flex-col gap-2 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2"
		data-testid="x-quote-stray"
	>
		<p class="text-[12px] font-medium text-amber-900">
			{#if quote}
				X quotes one post, so {strayLinks.length === 1
					? 'this other X link shows'
					: 'these other X links show'} as a plain link.{ctx.tabSupportsThreads
					? ' To quote both, give each its own post with + Add comment / post.'
					: ''}
			{:else}
				X only quotes a link at the very end, so {strayLinks.length === 1
					? 'this X link shows'
					: 'these X links show'} as a plain link.
			{/if}
		</p>
		<div class="flex flex-wrap gap-2">
			{#each strayLinks as link (link.index)}
				{@const author = parseXPostUrl(link.url)?.handle}
				<button
					type="button"
					data-testid="x-quote-make"
					onclick={() => ctx.makeQuote(index, link.index)}
					class="max-w-full truncate rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-100"
				>
					{#if author}
						Quote @{author}'s post{quote ? ' instead' : ''}
					{:else}
						{quote ? 'Quote this post instead' : 'Make it the quote'}
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}
