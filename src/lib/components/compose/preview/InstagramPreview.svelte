<script lang="ts">
	import {
		Bookmark,
		Camera,
		ChevronLeft,
		ChevronRight,
		Ellipsis,
		Heart,
		ImageOff,
		MessageCircle,
		Music,
		Send
	} from '@lucide/svelte';
	import { aspectOf } from '#lib/domain/media-layout.js';
	import { instagramFormat, type AccountPreview } from '#lib/domain/platform-preview.js';
	import Avatar from './Avatar.svelte';
	import FoldedText from './FoldedText.svelte';
	import PreviewVideo from './PreviewVideo.svelte';
	import type { MediaItem } from '../types';

	let {
		preview,
		mediaSrc,
		isVideoItem
	}: {
		preview: AccountPreview<MediaItem>;
		mediaSrc: (m: MediaItem) => string;
		isVideoItem: (m: { mime?: string | null }) => boolean;
	} = $props();

	const post = $derived(preview.posts[0] ?? { text: '', media: [] });
	const format = $derived(instagramFormat(post.media));
	const reel = $derived(post.media.find(isVideoItem));
	// The feed crops every slide to the first one's shape, between 4:5 and 1.91:1.
	const aspect = $derived(Math.min(1.91, Math.max(0.8, aspectOf(post.media[0] ?? {}) ?? 1)));

	let slide = $state(0);
	$effect(() => {
		if (slide >= post.media.length) slide = Math.max(0, post.media.length - 1);
	});
</script>

{#if format === 'reel' && reel}
	<div
		class="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-2xl bg-black text-white"
		data-testid="preview-instagram-reel"
	>
		<PreviewVideo item={reel} src={mediaSrc(reel)} playIcon={false} />
		<div
			class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/40 to-transparent px-4 pt-3 pb-8"
		>
			<span class="text-[22px] font-bold tracking-tight">Reels</span>
			<Camera class="h-6 w-6" aria-hidden="true" />
		</div>
		<div
			class="pointer-events-none absolute right-2.5 bottom-4 flex flex-col items-center gap-5 drop-shadow"
			aria-hidden="true"
		>
			<Heart class="h-7 w-7" />
			<MessageCircle class="h-7 w-7 -scale-x-100" />
			<Send class="h-7 w-7" />
			<Ellipsis class="h-6 w-6" />
			<Avatar account={preview.account} size={26} square class="border-2 border-white" />
		</div>
		<div
			class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-12 pr-14 pb-4 text-[13px] leading-[18px]"
		>
			<div class="flex items-center gap-2">
				<Avatar account={preview.account} size={30} />
				<span class="truncate font-semibold">{preview.account.handle}</span>
				<span class="rounded-md border border-white/70 px-2 py-0.5 text-[12px] font-semibold"
					>Follow</span
				>
			</div>
			{#if post.text.trim()}
				<p class="mt-2">
					<FoldedText text={post.text} max={50} moreClass="text-white/70" />
				</p>
			{/if}
			<p class="mt-2 flex items-center gap-1.5 text-[12px]">
				<Music class="h-3 w-3" aria-hidden="true" />
				<span class="truncate">{preview.account.handle} · Original audio</span>
			</p>
		</div>
	</div>
{:else}
	<div
		class="mx-auto max-w-[470px] overflow-hidden rounded-2xl border border-stone-200 bg-white text-[#0c1014]"
		data-testid="preview-instagram-post"
	>
		<div class="flex items-center gap-2.5 px-3 py-2.5">
			<span
				class="rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]"
			>
				<span class="block rounded-full bg-white p-[2px]">
					<Avatar account={preview.account} size={28} />
				</span>
			</span>
			<span class="truncate text-[14px] font-semibold">{preview.account.handle}</span>
			<Ellipsis class="ml-auto h-5 w-5" aria-hidden="true" />
		</div>
		{#if post.media.length}
			<div class="relative overflow-hidden bg-black" style="aspect-ratio: {aspect}">
				<div
					class="flex h-full transition-transform duration-300"
					style="transform: translateX(-{slide * 100}%)"
				>
					{#each post.media as item (item.id)}
						<img
							src={mediaSrc(item)}
							alt={item.altText || ''}
							class="h-full w-full shrink-0 object-cover"
						/>
					{/each}
				</div>
				{#if format === 'carousel'}
					<span
						class="absolute top-3 right-3 rounded-full bg-black/70 px-2 py-0.5 text-[12px] font-medium text-white"
						>{slide + 1}/{post.media.length}</span
					>
					{#if slide > 0}
						<button
							type="button"
							class="absolute top-1/2 left-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black shadow"
							aria-label="Previous photo"
							onclick={() => (slide -= 1)}
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
					{/if}
					{#if slide < post.media.length - 1}
						<button
							type="button"
							class="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black shadow"
							aria-label="Next photo"
							onclick={() => (slide += 1)}
						>
							<ChevronRight class="h-4 w-4" />
						</button>
					{/if}
				{/if}
			</div>
		{:else}
			<div
				class="flex aspect-square flex-col items-center justify-center gap-2 bg-stone-100 text-[13px] text-stone-500"
			>
				<ImageOff class="h-8 w-8" aria-hidden="true" />
				Instagram posts need a photo or video
			</div>
		{/if}
		<div class="flex items-center gap-4 px-3 pt-3" aria-hidden="true">
			<Heart class="h-6 w-6" />
			<MessageCircle class="h-6 w-6 -scale-x-100" />
			<Send class="h-6 w-6" />
			{#if format === 'carousel'}
				<span class="flex flex-1 justify-center gap-1">
					{#each post.media as item, i (item.id)}
						<span class="h-1.5 w-1.5 rounded-full {i === slide ? 'bg-[#0095f6]' : 'bg-stone-300'}"
						></span>
					{/each}
				</span>
			{:else}
				<span class="flex-1"></span>
			{/if}
			<Bookmark class="h-6 w-6" />
		</div>
		<div class="px-3 pt-2 pb-3 text-[14px] leading-[18px]">
			{#if post.text.trim()}
				<FoldedText text={post.text} max={125}>
					{#snippet lead()}<span class="mr-1 font-semibold">{preview.account.handle}</span
						>{/snippet}
				</FoldedText>
			{/if}
			<p class="mt-1.5 text-[12px] text-stone-500">Just now</p>
		</div>
	</div>
{/if}
