<script lang="ts">
	import { ChevronDown, TriangleAlert } from '@lucide/svelte';
	import SocialIcon from '../SocialIcon.svelte';
	import { platformColorClass } from '../platform-color';
	import { platformName } from '#lib/domain/platforms.js';
	import type { ComposeCheck } from './checks';

	interface Props {
		checks: ComposeCheck[];
		/** Platforms the post goes to: only those can be unchecked. */
		selectedPlatforms: Set<string>;
		onUncheck: (platform: string) => void;
	}

	let { checks, selectedPlatforms, onUncheck }: Props = $props();

	let open = $state(false);
</script>

<div
	class="rounded-lg border border-amber-200 bg-amber-50"
	data-testid="compose-checks"
	role="status"
>
	<button
		type="button"
		class="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-amber-900"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<TriangleAlert class="h-4 w-4 shrink-0" />
		<span class="flex-1"
			>{checks.length === 1 ? '1 thing to fix' : `${checks.length} things to fix`} before publishing</span
		>
		<ChevronDown class="h-4 w-4 transition-transform {open ? 'rotate-180' : ''}" />
	</button>
	{#if open}
		<ul class="space-y-1.5 border-t border-amber-200 px-3 py-2">
			{#each checks as check (check.key)}
				<li class="flex items-start gap-2 text-[13px] text-stone-700">
					{#if check.platform}
						<SocialIcon
							platform={check.platform}
							className={`mt-0.5 h-4 w-4 shrink-0 ${platformColorClass(check.platform)}`}
						/>
					{/if}
					<span class="min-w-0 flex-1">
						{check.message}
						{#if check.platform && selectedPlatforms.has(check.platform)}
							·
							<button
								type="button"
								class="font-semibold text-accent hover:underline"
								onclick={() => onUncheck(check.platform!)}
								>Uncheck {platformName(check.platform)}</button
							>
						{:else if check.href}
							· <a href={check.href} class="font-semibold text-accent hover:underline"
								>{check.hrefLabel}</a
							>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
