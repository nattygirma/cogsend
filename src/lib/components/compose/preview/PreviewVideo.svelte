<script lang="ts">
	import { Play } from '@lucide/svelte';
	import { coverUrl } from '#lib/domain/media-layout.js';
	import type { MediaItem } from '../types';

	/** A muted video that plays and pauses on a tap, as feeds play them. */
	let {
		item,
		src,
		fit = 'cover',
		playIcon = true,
		class: className = ''
	}: {
		item: MediaItem;
		src: string;
		fit?: 'cover' | 'contain';
		playIcon?: boolean;
		class?: string;
	} = $props();

	let video = $state<HTMLVideoElement>();
	let paused = $state(true);

	function toggle() {
		if (!video) return;
		if (video.paused) void video.play().catch(() => {});
		else video.pause();
	}
</script>

<button
	type="button"
	class="relative block h-full w-full cursor-pointer bg-black {className}"
	aria-label={paused ? 'Play video' : 'Pause video'}
	onclick={toggle}
>
	<video
		bind:this={video}
		bind:paused
		{src}
		poster={item.previewUrl ? undefined : (coverUrl(item) ?? undefined)}
		class="h-full w-full {fit === 'cover' ? 'object-cover' : 'object-contain'}"
		muted
		loop
		playsinline
		preload="metadata"
	></video>
	{#if paused && playIcon}
		<span
			class="absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/40"
		>
			<Play class="ml-1 h-7 w-7 fill-white text-white" aria-hidden="true" />
		</span>
	{/if}
</button>
