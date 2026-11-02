<script lang="ts">
	import { BadgeCheck, Play } from '@lucide/svelte';
	import type { MediaItem } from './types';

	interface Props {
		/** The posts of the thread as the selected tab will publish them. */
		posts: Array<{ text: string; media: MediaItem[] }>;
		/** Who the post appears from: "Global Edit" for all platforms. */
		identity: { name: string; avatarUrl: string | null; initials: string };
		mediaSrc: (m: MediaItem) => string;
		isVideoItem: (m: { mime?: string | null }) => boolean;
	}

	let { posts, identity, mediaSrc, isVideoItem }: Props = $props();
</script>

<div class="space-y-6" data-testid="post-preview">
	{#each posts as post, index (index)}
		<article class="flex gap-3">
			<div class="flex flex-col items-center">
				<span
					class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200 text-[13px] font-semibold text-stone-600"
					aria-hidden="true"
				>
					{#if identity.avatarUrl}
						<img
							src={identity.avatarUrl}
							alt=""
							referrerpolicy="no-referrer"
							class="h-full w-full object-cover"
						/>
					{:else}
						{identity.initials}
					{/if}
				</span>
				{#if index < posts.length - 1}
					<span class="mt-2 w-0.5 flex-1 rounded-full bg-stone-200" aria-hidden="true"></span>
				{/if}
			</div>
			<div class="min-w-0 flex-1 pt-0.5">
				<p class="flex items-center gap-1 text-[15px] font-semibold text-stone-900">
					{identity.name}
					<BadgeCheck class="h-4 w-4 text-accent" aria-hidden="true" />
				</p>
				{#if post.text.trim()}
					<p
						class="mt-1 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-stone-800"
					>
						{post.text}
					</p>
				{:else if index === 0 && !post.media.length}
					<p class="mt-1 text-[15px] text-stone-400">Your post shows here as you write it.</p>
				{/if}
				{#if post.media.length}
					<div class="mt-3 grid gap-1.5 {post.media.length > 1 ? 'grid-cols-2' : ''}">
						{#each post.media.slice(0, 4) as item (item.id)}
							{#if isVideoItem(item)}
								<div class="relative overflow-hidden rounded-lg bg-stone-900">
									<video
										src={mediaSrc(item)}
										class="aspect-video w-full object-cover"
										muted
										preload="metadata"
										aria-label="Attached video"
									></video>
									<Play
										class="absolute top-1/2 left-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/90"
									/>
								</div>
							{:else}
								<img
									src={mediaSrc(item)}
									alt={item.altText || ''}
									class="w-full rounded-lg bg-stone-100 object-cover {post.media.length > 1
										? 'aspect-square'
										: 'max-h-72'}"
								/>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		</article>
	{/each}
</div>
