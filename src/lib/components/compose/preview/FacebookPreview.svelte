<script lang="ts">
	import { Earth, Ellipsis, Heart, MessageCircle, Share2, ThumbsUp, X } from '@lucide/svelte';
	import type { AccountPreview } from '#lib/domain/platform-preview.js';
	import Avatar from './Avatar.svelte';
	import FeedMedia from './FeedMedia.svelte';
	import FoldedText from './FoldedText.svelte';
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
	// Facebook sets a short status with nothing attached in large type.
	const big = $derived(!post.media.length && [...post.text.trim()].length <= 85);
	const actions = [
		{ icon: ThumbsUp, label: 'Like' },
		{ icon: MessageCircle, label: 'Comment' },
		{ icon: Share2, label: 'Share' }
	];
</script>

<div
	class="overflow-hidden rounded-xl border border-stone-200 bg-white text-[#050505] shadow-sm"
	data-testid="preview-facebook"
>
	<div class="flex items-start gap-2.5 px-4 pt-3">
		<Avatar account={preview.account} size={40} />
		<div class="min-w-0 flex-1">
			<p class="truncate text-[15px] leading-5 font-semibold">{preview.account.name}</p>
			<p class="flex items-center gap-1 text-[13px] text-[#65676b]">
				Just now · <Earth class="h-3 w-3" aria-hidden="true" />
			</p>
		</div>
		<span class="flex gap-3 text-[#65676b]" aria-hidden="true">
			<Ellipsis class="h-5 w-5" />
			<X class="h-5 w-5" />
		</span>
	</div>
	{#if post.text.trim()}
		<p class="px-4 pt-2.5 pb-3 {big ? 'text-[24px] leading-[30px]' : 'text-[15px] leading-5'}">
			<FoldedText
				text={post.text}
				max={240}
				more="... See more"
				moreClass="font-semibold text-[#050505]"
			/>
		</p>
	{:else if !post.media.length}
		<p class="px-4 pt-2.5 pb-3 text-[15px] text-[#65676b]">What's on your mind?</p>
	{:else}
		<div class="h-3"></div>
	{/if}
	{#if post.media.length}
		<FeedMedia
			media={post.media}
			{mediaSrc}
			{isVideoItem}
			gridAspect={1}
			minAspect={0.8}
			maxAspect={1.91}
		/>
	{/if}
	<div class="mx-4 flex items-center gap-1.5 py-2.5 text-[15px] text-[#65676b]" aria-hidden="true">
		<span class="flex -space-x-1">
			<span
				class="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1877f2] ring-2 ring-white"
			>
				<ThumbsUp class="h-2.5 w-2.5 fill-white text-white" />
			</span>
			<span
				class="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#f33e58] ring-2 ring-white"
			>
				<Heart class="h-2.5 w-2.5 fill-white text-white" />
			</span>
		</span>
		0
	</div>
	<div
		class="mx-4 flex items-center justify-around border-t border-[#ced0d4] py-1 text-[15px] font-semibold text-[#65676b]"
		aria-hidden="true"
	>
		{#each actions as action (action.label)}
			<span class="flex items-center gap-2 px-2 py-1.5">
				<action.icon class="h-5 w-5" />
				{action.label}
			</span>
		{/each}
	</div>
</div>
