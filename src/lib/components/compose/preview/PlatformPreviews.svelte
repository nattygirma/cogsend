<script lang="ts">
	import PlatformLogo from '#lib/components/PlatformLogo.svelte';
	import { platformColorClass } from '#lib/components/platform-color.js';
	import { platformName } from '#lib/domain/platforms.js';
	import type { YouTubePrivacy } from '#lib/domain/platform-options.js';
	import type { AccountPreview } from '#lib/domain/platform-preview.js';
	import FacebookPreview from './FacebookPreview.svelte';
	import InstagramPreview from './InstagramPreview.svelte';
	import LinkedInPreview from './LinkedInPreview.svelte';
	import ThreadsPreview from './ThreadsPreview.svelte';
	import TikTokPreview from './TikTokPreview.svelte';
	import XPreview from './XPreview.svelte';
	import YouTubePreview from './YouTubePreview.svelte';
	import type { ActiveTab, MediaItem } from '../types';

	/** Each selected account's post drawn as its own platform shows it, one tab per account. */
	let {
		previews,
		focus,
		youtube,
		mediaSrc,
		isVideoItem
	}: {
		previews: AccountPreview<MediaItem>[];
		/** The editor's tab: picking a platform there shows that platform here. */
		focus: ActiveTab;
		youtube: { title: string; privacy: YouTubePrivacy };
		mediaSrc: (m: MediaItem) => string;
		isVideoItem: (m: { mime?: string | null }) => boolean;
	} = $props();

	let picked = $state<string | null>(null);

	$effect(() => {
		if (focus === 'global') return;
		const match = previews.find((p) => p.account.platform === focus);
		if (match) picked = match.account.id;
	});

	const current = $derived(previews.find((p) => p.account.id === picked) ?? previews[0]);

	// Two accounts on one platform are told apart by their names.
	function tabLabel(p: AccountPreview<MediaItem>): string {
		const shared = previews.filter((o) => o.account.platform === p.account.platform).length > 1;
		return shared ? p.account.name : platformName(p.account.platform);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const i = previews.indexOf(current);
		const next =
			previews[(i + (e.key === 'ArrowRight' ? 1 : -1) + previews.length) % previews.length];
		picked = next.account.id;
		(e.currentTarget as HTMLElement)
			.querySelector<HTMLElement>(`[data-account="${next.account.id}"]`)
			?.focus();
		e.preventDefault();
	}
</script>

<div data-testid="post-preview">
	{#if previews.length > 1}
		<div
			role="tablist"
			aria-label="Preview for"
			tabindex="-1"
			class="mb-4 flex flex-wrap gap-1.5"
			onkeydown={onKeydown}
		>
			{#each previews as p (p.account.id)}
				{@const active = p === current}
				<button
					type="button"
					role="tab"
					data-account={p.account.id}
					data-testid="preview-tab-{p.account.platform}"
					aria-selected={active}
					tabindex={active ? 0 : -1}
					title="{platformName(p.account.platform)} · {p.account.name}"
					class="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors {active
						? 'border-stone-900 bg-stone-900 text-white'
						: 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900'}"
					onclick={() => (picked = p.account.id)}
				>
					<span class={active ? 'text-white' : platformColorClass(p.account.platform)}>
						<PlatformLogo platform={p.account.platform} size={14} />
					</span>
					<span class="max-w-[9rem] truncate">{tabLabel(p)}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if current}
		<div role={previews.length > 1 ? 'tabpanel' : undefined}>
			{#key current.account.id}
				{#if current.account.platform === 'x'}
					<XPreview preview={current} {mediaSrc} {isVideoItem} />
				{:else if current.account.platform === 'threads'}
					<ThreadsPreview preview={current} {mediaSrc} {isVideoItem} />
				{:else if current.account.platform === 'instagram'}
					<InstagramPreview preview={current} {mediaSrc} {isVideoItem} />
				{:else if current.account.platform === 'facebook'}
					<FacebookPreview preview={current} {mediaSrc} {isVideoItem} />
				{:else if current.account.platform === 'youtube'}
					<YouTubePreview
						preview={current}
						{mediaSrc}
						{isVideoItem}
						title={youtube.title}
						privacy={youtube.privacy}
					/>
				{:else if current.account.platform === 'tiktok'}
					<TikTokPreview preview={current} {mediaSrc} {isVideoItem} />
				{:else}
					<LinkedInPreview preview={current} {mediaSrc} {isVideoItem} />
				{/if}
			{/key}
		</div>
	{/if}
</div>
