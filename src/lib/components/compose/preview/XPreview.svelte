<script lang="ts">
	import {
		Bookmark,
		ChartNoAxesColumn,
		Ellipsis,
		Heart,
		MessageCircle,
		Repeat2,
		Share
	} from '@lucide/svelte';
	import type { AccountPreview } from '#lib/domain/platform-preview.js';
	import Avatar from './Avatar.svelte';
	import FeedMedia from './FeedMedia.svelte';
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

	const actions = [MessageCircle, Repeat2, Heart, ChartNoAxesColumn];
</script>

<div
	class="overflow-hidden rounded-2xl border border-[#eff3f4] bg-white font-sans text-[#0f1419]"
	data-testid="preview-x"
>
	{#each preview.posts as post, index (index)}
		<article class="flex gap-3 px-4 pt-3 {index === preview.posts.length - 1 ? 'pb-3' : ''}">
			<div class="flex flex-col items-center">
				<Avatar account={preview.account} size={40} />
				{#if index < preview.posts.length - 1}
					<span class="mt-1 w-0.5 flex-1 bg-[#cfd9de]" aria-hidden="true"></span>
				{/if}
			</div>
			<div class="min-w-0 flex-1 pb-1">
				<div class="flex items-center gap-1 text-[15px] leading-5">
					<span class="truncate font-bold">{preview.account.name}</span>
					<span class="truncate text-[#536471]">@{preview.account.handle} · now</span>
					<Ellipsis class="ml-auto h-[18px] w-[18px] shrink-0 text-[#536471]" aria-hidden="true" />
				</div>
				{#if post.text.trim()}
					<p class="mt-0.5 text-[15px] leading-5 break-words whitespace-pre-wrap">{post.text}</p>
				{:else if index === 0 && !post.media.length}
					<p class="mt-0.5 text-[15px] leading-5 text-[#536471]">What's happening?</p>
				{/if}
				{#if post.media.length}
					<FeedMedia
						media={post.media}
						{mediaSrc}
						{isVideoItem}
						minAspect={0.75}
						maxAspect={2}
						class="mt-3 rounded-2xl border border-[#cfd9de]"
					/>
				{/if}
				<div class="mt-3 flex items-center justify-between text-[#536471]" aria-hidden="true">
					{#each actions as Icon, i (i)}
						<Icon class="h-[18px] w-[18px]" />
					{/each}
					<span class="flex gap-3">
						<Bookmark class="h-[18px] w-[18px]" />
						<Share class="h-[18px] w-[18px]" />
					</span>
				</div>
			</div>
		</article>
	{/each}
</div>
