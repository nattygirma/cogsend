<script lang="ts">
	import { aspectOf, gridFor } from '#lib/domain/media-layout.js';
	import PreviewVideo from './PreviewVideo.svelte';
	import type { MediaItem } from '../types';

	/**
	 * Attachments the way feeds lay them out: one at its own shape (within the
	 * feed's tallest and widest), two to four in a grid, the rest counted on
	 * the last tile.
	 */
	let {
		media,
		mediaSrc,
		isVideoItem,
		gridAspect = 16 / 9,
		minAspect = 0.8,
		maxAspect = 1.91,
		gap = 2,
		class: className = ''
	}: {
		media: MediaItem[];
		mediaSrc: (m: MediaItem) => string;
		isVideoItem: (m: { mime?: string | null }) => boolean;
		gridAspect?: number;
		minAspect?: number;
		maxAspect?: number;
		gap?: number;
		class?: string;
	} = $props();

	const shown = $derived(media.slice(0, 4));
	const grid = $derived(gridFor(shown.length));
	const singleAspect = $derived(
		Math.min(maxAspect, Math.max(minAspect, aspectOf(media[0] ?? {}) ?? 16 / 9))
	);
</script>

{#if media.length === 1}
	<div class="overflow-hidden bg-stone-100 {className}" style="aspect-ratio: {singleAspect}">
		{#if isVideoItem(media[0])}
			<PreviewVideo item={media[0]} src={mediaSrc(media[0])} />
		{:else}
			<img
				src={mediaSrc(media[0])}
				alt={media[0].altText || ''}
				class="h-full w-full object-cover"
			/>
		{/if}
	</div>
{:else if media.length > 1}
	<div
		class="grid overflow-hidden {className}"
		style="aspect-ratio: {gridAspect}; gap: {gap}px; grid-template-columns: 1fr 1fr; grid-template-rows: repeat({grid.rows}, 1fr)"
	>
		{#each shown as item, i (item.id)}
			<div
				class="relative min-h-0 overflow-hidden bg-stone-100"
				style="grid-column: {grid.cells[i].column}; grid-row: {grid.cells[i].row}"
			>
				{#if isVideoItem(item)}
					<PreviewVideo {item} src={mediaSrc(item)} />
				{:else}
					<img src={mediaSrc(item)} alt={item.altText || ''} class="h-full w-full object-cover" />
				{/if}
				{#if i === 3 && media.length > 4}
					<span
						class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white"
						>+{media.length - 4}</span
					>
				{/if}
			</div>
		{/each}
	</div>
{/if}
