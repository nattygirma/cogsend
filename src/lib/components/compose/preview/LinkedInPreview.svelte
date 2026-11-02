<script lang="ts">
	import {
		Earth,
		Ellipsis,
		MessageSquareText,
		Plus,
		Repeat2,
		Send,
		ThumbsUp
	} from '@lucide/svelte';
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
	const actions = [
		{ icon: ThumbsUp, label: 'Like' },
		{ icon: MessageSquareText, label: 'Comment' },
		{ icon: Repeat2, label: 'Repost' },
		{ icon: Send, label: 'Send' }
	];
</script>

<div
	class="overflow-hidden rounded-lg border border-stone-200 bg-white text-[rgba(0,0,0,0.9)]"
	data-testid="preview-linkedin"
>
	<div class="flex items-start gap-2 px-4 pt-3">
		<Avatar account={preview.account} size={48} />
		<div class="min-w-0 flex-1 leading-4">
			<p class="truncate text-[14px] leading-5 font-semibold">{preview.account.name}</p>
			<p class="truncate text-[12px] text-[rgba(0,0,0,0.6)]">@{preview.account.handle}</p>
			<p class="mt-0.5 flex items-center gap-1 text-[12px] text-[rgba(0,0,0,0.6)]">
				Now · <Earth class="h-3 w-3" aria-hidden="true" />
			</p>
		</div>
		<span
			class="flex items-center gap-1 text-[16px] font-semibold text-[#0a66c2]"
			aria-hidden="true"
		>
			<Plus class="h-4 w-4" strokeWidth={2.5} /> Follow
		</span>
		<Ellipsis class="mt-0.5 ml-2 h-5 w-5 text-[rgba(0,0,0,0.6)]" aria-hidden="true" />
	</div>
	{#if post.text.trim()}
		<p class="px-4 pt-3 pb-2 text-[14px] leading-5">
			<FoldedText text={post.text} max={210} more="…more" moreClass="text-[rgba(0,0,0,0.6)]" />
		</p>
	{:else if !post.media.length}
		<p class="px-4 pt-3 pb-2 text-[14px] text-[rgba(0,0,0,0.6)]">What do you want to talk about?</p>
	{/if}
	{#if post.media.length}
		<FeedMedia media={post.media} {mediaSrc} {isVideoItem} gridAspect={1.2} class="mt-2" />
	{/if}
	<div
		class="mx-4 mt-1 flex items-center justify-between border-t border-[#e8e8e8] py-1 text-[14px] font-semibold text-[rgba(0,0,0,0.6)]"
		aria-hidden="true"
	>
		{#each actions as action (action.label)}
			<span class="flex items-center gap-1.5 px-1.5 py-2.5">
				<action.icon class="h-5 w-5" />
				{action.label}
			</span>
		{/each}
	</div>
</div>
