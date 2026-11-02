<script lang="ts">
	import {
		Ellipsis,
		EllipsisVertical,
		MessageSquareText,
		Repeat,
		Search,
		Share,
		ThumbsDown,
		ThumbsUp,
		VideoOff
	} from '@lucide/svelte';
	import { youtubeFormat, type AccountPreview } from '#lib/domain/platform-preview.js';
	import { formatDuration } from '#lib/domain/video-rules.js';
	import type { YouTubePrivacy } from '#lib/domain/platform-options.js';
	import Avatar from './Avatar.svelte';
	import FoldedText from './FoldedText.svelte';
	import PreviewVideo from './PreviewVideo.svelte';
	import type { MediaItem } from '../types';

	let {
		preview,
		mediaSrc,
		isVideoItem,
		title,
		privacy
	}: {
		preview: AccountPreview<MediaItem>;
		mediaSrc: (m: MediaItem) => string;
		isVideoItem: (m: { mime?: string | null }) => boolean;
		/** The title YouTube will get: the one chosen in Settings, else the first line. */
		title: string;
		privacy: YouTubePrivacy;
	} = $props();

	const post = $derived(preview.posts[0] ?? { text: '', media: [] });
	const video = $derived(post.media.find(isVideoItem));
	const format = $derived(youtubeFormat(post.media));
	const duration = $derived(
		video?.meta?.durationMs != null ? formatDuration(video.meta.durationMs) : null
	);
	const privacyLabel = { private: 'Private', unlisted: 'Unlisted', public: 'Public' };
</script>

{#if format === 'short' && video}
	<div
		class="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-2xl bg-black text-white"
		data-testid="preview-youtube-short"
	>
		<PreviewVideo item={video} src={mediaSrc(video)} playIcon={false} />
		<div
			class="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-4 bg-gradient-to-b from-black/40 to-transparent px-3 pt-3 pb-8"
			aria-hidden="true"
		>
			<Search class="h-6 w-6" />
			<EllipsisVertical class="h-6 w-6" />
		</div>
		<div
			class="pointer-events-none absolute right-2 bottom-4 flex flex-col items-center gap-4 text-[12px] font-medium drop-shadow"
			aria-hidden="true"
		>
			{#each [{ icon: ThumbsUp, label: 'Like' }, { icon: ThumbsDown, label: 'Dislike' }, { icon: MessageSquareText, label: '0' }, { icon: Share, label: 'Share' }, { icon: Repeat, label: 'Remix' }] as item (item.label)}
				<span class="flex flex-col items-center gap-1">
					<span class="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
						<item.icon class="h-6 w-6 fill-white/90" />
					</span>
					{item.label}
				</span>
			{/each}
			<Avatar account={preview.account} size={34} square class="border-2 border-white" />
		</div>
		<div
			class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-12 pr-16 pb-4 text-[14px]"
		>
			<div class="flex items-center gap-2">
				<Avatar account={preview.account} size={30} />
				<span class="truncate font-medium">@{preview.account.handle}</span>
				<span class="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black"
					>Subscribe</span
				>
			</div>
			<p class="mt-2 line-clamp-2 leading-[19px]">{title || post.text}</p>
		</div>
	</div>
{:else}
	<div
		class="overflow-hidden rounded-2xl bg-white text-[#0f0f0f]"
		data-testid="preview-youtube-video"
	>
		<div class="relative aspect-video overflow-hidden rounded-xl bg-black">
			{#if video}
				<PreviewVideo item={video} src={mediaSrc(video)} fit="contain" />
				{#if duration}
					<span
						class="pointer-events-none absolute right-2 bottom-2 rounded bg-black/80 px-1 text-[12px] font-medium text-white"
						>{duration}</span
					>
				{/if}
			{:else}
				<div
					class="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-white/60"
				>
					<VideoOff class="h-8 w-8" aria-hidden="true" />
					YouTube posts need a video
				</div>
			{/if}
		</div>
		<h3 class="mt-3 line-clamp-2 text-[18px] leading-[26px] font-bold break-words">
			{title || 'Untitled video'}
		</h3>
		<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
			<Avatar account={preview.account} size={40} />
			<div class="min-w-0">
				<p class="truncate text-[15px] font-semibold">{preview.account.name}</p>
				<p class="truncate text-[12px] text-[#606060]">@{preview.account.handle}</p>
			</div>
			<span class="rounded-full bg-[#0f0f0f] px-4 py-2 text-[14px] font-medium text-white"
				>Subscribe</span
			>
			<div class="ml-auto flex items-center gap-2 text-[14px] font-medium" aria-hidden="true">
				<span class="flex items-center rounded-full bg-[#f2f2f2]">
					<span class="flex items-center gap-1.5 border-r border-[#d9d9d9] py-2 pr-3 pl-3"
						><ThumbsUp class="h-5 w-5" /></span
					>
					<span class="py-2 pr-3 pl-2.5"><ThumbsDown class="h-5 w-5" /></span>
				</span>
				<span class="flex items-center gap-1.5 rounded-full bg-[#f2f2f2] px-3 py-2"
					><Share class="h-5 w-5" />Share</span
				>
				<span class="rounded-full bg-[#f2f2f2] p-2"><Ellipsis class="h-5 w-5" /></span>
			</div>
		</div>
		<div class="mt-3 rounded-xl bg-[#f2f2f2] px-3 py-2.5 text-[14px] leading-5">
			<p class="font-semibold">0 views · Just now · {privacyLabel[privacy]}</p>
			{#if post.text.trim()}
				<p class="mt-1">
					<FoldedText
						text={post.text}
						max={160}
						more="...more"
						moreClass="font-semibold text-[#0f0f0f]"
					/>
				</p>
			{/if}
		</div>
	</div>
{/if}
