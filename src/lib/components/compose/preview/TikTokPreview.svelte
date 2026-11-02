<script lang="ts">
	import {
		Bookmark,
		Forward,
		Heart,
		House,
		MessageCircleMore,
		MessageSquare,
		Music,
		Plus,
		Search,
		UserRound,
		UsersRound,
		VideoOff
	} from '@lucide/svelte';
	import type { AccountPreview } from '#lib/domain/platform-preview.js';
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
	const video = $derived(post.media.find(isVideoItem));
	const nav = [
		{ icon: House, label: 'Home' },
		{ icon: UsersRound, label: 'Friends' },
		null,
		{ icon: MessageSquare, label: 'Inbox' },
		{ icon: UserRound, label: 'Profile' }
	];
</script>

<div
	class="relative mx-auto flex aspect-[9/17.5] w-full max-w-[320px] flex-col overflow-hidden rounded-2xl bg-black text-white"
	data-testid="preview-tiktok"
>
	<div class="relative min-h-0 flex-1">
		{#if video}
			<PreviewVideo item={video} src={mediaSrc(video)} fit="contain" playIcon={false} />
		{:else}
			<div class="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-white/60">
				<VideoOff class="h-8 w-8" aria-hidden="true" />
				TikTok posts need a video
			</div>
		{/if}
		<div
			class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-4 bg-gradient-to-b from-black/40 to-transparent pt-3 pb-8 text-[15px] font-semibold"
		>
			<span class="text-white/60">Following</span>
			<span class="border-b-2 border-white pb-1">For You</span>
			<Search class="absolute top-3 right-3 h-5 w-5" aria-hidden="true" />
		</div>
		<div
			class="pointer-events-none absolute right-2 bottom-3 flex flex-col items-center gap-4 text-[11px] font-semibold drop-shadow"
			aria-hidden="true"
		>
			<span class="relative mb-2">
				<Avatar account={preview.account} size={44} class="border border-white" />
				<span
					class="absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-[#fe2c55]"
				>
					<Plus class="h-3.5 w-3.5" strokeWidth={3} />
				</span>
			</span>
			<span class="flex flex-col items-center gap-0.5"><Heart class="h-8 w-8 fill-white" />0</span>
			<span class="flex flex-col items-center gap-0.5"
				><MessageCircleMore class="h-8 w-8 fill-white stroke-black/40" />0</span
			>
			<span class="flex flex-col items-center gap-0.5"
				><Bookmark class="h-8 w-8 fill-white" />0</span
			>
			<span class="flex flex-col items-center gap-0.5"><Forward class="h-8 w-8 fill-white" />0</span
			>
			<span
				class="flex h-10 w-10 animate-[spin_6s_linear_infinite] items-center justify-center rounded-full bg-[#222] ring-8 ring-[#161616]"
			>
				<Avatar account={preview.account} size={22} />
			</span>
		</div>
		<div
			class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 pt-10 pr-16 pb-3 text-[14px] leading-[19px]"
		>
			<p class="font-semibold">{preview.account.name}</p>
			{#if post.text.trim()}
				<p class="mt-1">
					<FoldedText text={post.text} max={80} moreClass="font-semibold text-white" />
				</p>
			{/if}
			<p class="mt-2 flex items-center gap-1.5 text-[13px]">
				<Music class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				<span class="truncate">original sound - {preview.account.name}</span>
			</p>
		</div>
	</div>
	<nav
		class="flex shrink-0 items-center justify-around border-t border-white/10 bg-black px-2 pt-2 pb-3 text-[10px]"
		aria-hidden="true"
	>
		{#each nav as item, i (i)}
			{#if item}
				<span class="flex flex-col items-center gap-0.5 {i === 0 ? '' : 'text-white/70'}">
					<item.icon class="h-5 w-5 {i === 0 ? 'fill-white' : ''}" />
					{item.label}
				</span>
			{:else}
				<span
					class="flex h-7 w-11 items-center justify-center rounded-lg bg-white shadow-[-3px_0_0_#25f4ee,3px_0_0_#fe2c55]"
				>
					<Plus class="h-4 w-4 text-black" strokeWidth={3} />
				</span>
			{/if}
		{/each}
	</nav>
</div>
