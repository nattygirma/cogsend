<script lang="ts">
	import { Ellipsis, Heart, MessageCircle, Repeat, Send } from '@lucide/svelte';
	import { aspectOf } from '#lib/domain/media-layout.js';
	import type { AccountPreview } from '#lib/domain/platform-preview.js';
	import Avatar from './Avatar.svelte';
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

	const actions = [Heart, MessageCircle, Repeat, Send];

	// Threads keeps one photo at its shape and scrolls several sideways at a common height.
	function tileWidth(item: MediaItem, many: boolean): string {
		const aspect = Math.min(1.5, Math.max(0.6, aspectOf(item) ?? 0.8));
		return many ? `${Math.round(240 * aspect)}px` : '100%';
	}
</script>

<div class="rounded-2xl border border-stone-200 bg-white text-black" data-testid="preview-threads">
	{#each preview.posts as post, index (index)}
		<article class="flex gap-3 px-4 pt-4 {index === preview.posts.length - 1 ? 'pb-4' : ''}">
			<div class="flex flex-col items-center">
				<Avatar account={preview.account} size={36} />
				{#if index < preview.posts.length - 1}
					<span class="mt-2 w-0.5 flex-1 rounded-full bg-[#e5e5e5]" aria-hidden="true"></span>
				{/if}
			</div>
			<div class="min-w-0 flex-1 pb-1">
				<div class="flex items-center gap-1.5 text-[15px] leading-5">
					<span class="truncate font-semibold">{preview.account.handle}</span>
					<span class="text-[#999]">now</span>
					<Ellipsis class="ml-auto h-5 w-5 shrink-0 text-black" aria-hidden="true" />
				</div>
				{#if post.text.trim()}
					<p class="mt-0.5 text-[15px] leading-[21px] break-words whitespace-pre-wrap">
						{post.text}
					</p>
				{:else if index === 0 && !post.media.length}
					<p class="mt-0.5 text-[15px] text-[#999]">Start a thread…</p>
				{/if}
				{#if post.media.length}
					{@const many = post.media.length > 1}
					<div class="mt-2 flex gap-1.5 overflow-x-auto {many ? '-mr-4 pr-4' : ''}">
						{#each post.media as item (item.id)}
							<div
								class="shrink-0 overflow-hidden rounded-lg border border-black/10 bg-stone-100"
								style="width: {tileWidth(item, many)}; {many
									? 'height: 240px'
									: `aspect-ratio: ${Math.min(1.5, Math.max(0.75, aspectOf(item) ?? 0.8))}`}"
							>
								{#if isVideoItem(item)}
									<PreviewVideo {item} src={mediaSrc(item)} />
								{:else}
									<img
										src={mediaSrc(item)}
										alt={item.altText || ''}
										class="h-full w-full object-cover"
									/>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
				<div class="mt-3 flex items-center gap-5 text-black" aria-hidden="true">
					{#each actions as Icon, i (i)}
						<Icon class="h-[19px] w-[19px]" strokeWidth={1.75} />
					{/each}
				</div>
			</div>
		</article>
	{/each}
</div>
