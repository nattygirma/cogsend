<script lang="ts">
	import { ChevronDown, Settings } from '@lucide/svelte';
	import SocialIcon from '../SocialIcon.svelte';
	import TikTokSettings from '../TikTokSettings.svelte';
	import YouTubeSettings from '../YouTubeSettings.svelte';
	import { platformColorClass } from '../platform-color';
	import { platformName } from '#lib/domain/platforms.js';
	import type { TikTokOptions, YouTubeOptions } from '#lib/domain/platform-options.js';

	type SettingsPlatform = 'youtube' | 'tiktok';

	interface Props {
		/** The platforms in the post that have settings of their own. */
		platforms: SettingsPlatform[];
		/** Per platform, how many choices are still to make before it can post. */
		required: Partial<Record<SettingsPlatform, number>>;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		youtube: YouTubeOptions;
		/** The YouTube text, whose first line stands in for an empty title. */
		youtubeText: string;
		onYouTubeChange: (next: YouTubeOptions) => void;
		tiktok: TikTokOptions;
		tiktokConnectionIds: string[];
		videoDurationMs: number | null;
		onTikTokChange: (next: TikTokOptions) => void;
	}

	let {
		platforms,
		required,
		open,
		onOpenChange,
		youtube,
		youtubeText,
		onYouTubeChange,
		tiktok,
		tiktokConnectionIds,
		videoDurationMs,
		onTikTokChange
	}: Props = $props();

	let chosen = $state<SettingsPlatform | null>(null);
	// The picked tab while it is still in the post; otherwise the first that is.
	const active = $derived(chosen && platforms.includes(chosen) ? chosen : platforms[0]);
	const requiredTotal = $derived(
		platforms.reduce((sum, platform) => sum + (required[platform] ?? 0), 0)
	);
</script>

<section aria-label="Settings">
	<button
		type="button"
		data-testid="compose-settings-toggle"
		class="flex h-12 w-full items-center gap-3 rounded-xl bg-accent px-4 text-left text-white transition-colors hover:bg-accent-hover"
		aria-expanded={open}
		aria-controls="compose-settings-body"
		onclick={() => onOpenChange(!open)}
	>
		<Settings class="h-4 w-4" />
		<span class="text-[14px] font-semibold">Settings</span>
		{#if requiredTotal > 0}
			<span
				class="rounded-full bg-rose-500 px-1.5 text-[11px] leading-5 font-semibold text-white ring-2 ring-accent"
				title="Settings to choose before publishing"
				>{requiredTotal}<span class="sr-only"> to choose</span></span
			>
		{/if}
		<span class="ml-auto flex items-center gap-1.5 opacity-90">
			{#each platforms as platform (platform)}
				<SocialIcon {platform} className="h-4 w-4" />
			{/each}
		</span>
		<ChevronDown class="h-4 w-4 transition-transform {open ? 'rotate-180' : ''}" />
	</button>

	{#if open}
		<div id="compose-settings-body" class="mt-2 rounded-xl border border-stone-200 bg-white">
			<div class="flex gap-1 border-b border-stone-100 px-2 pt-2" role="tablist">
				{#each platforms as platform (platform)}
					<button
						type="button"
						role="tab"
						data-testid={`${platform}-settings-toggle`}
						aria-selected={active === platform}
						class="-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors {active ===
						platform
							? 'border-accent text-stone-900'
							: 'border-transparent text-stone-500 hover:text-stone-900'}"
						onclick={() => (chosen = platform)}
					>
						<SocialIcon {platform} className={`h-4 w-4 ${platformColorClass(platform)}`} />
						{platformName(platform)}
						{#if required[platform]}
							<span class="h-1.5 w-1.5 rounded-full bg-rose-500" aria-label="needs a choice"></span>
						{/if}
					</button>
				{/each}
			</div>
			<div class="p-4" role="tabpanel">
				{#if active === 'youtube'}
					<YouTubeSettings options={youtube} text={youtubeText} onchange={onYouTubeChange} />
				{:else if active === 'tiktok'}
					<TikTokSettings
						options={tiktok}
						connectionIds={tiktokConnectionIds}
						{videoDurationMs}
						onchange={onTikTokChange}
					/>
				{/if}
			</div>
		</div>
	{/if}
</section>
