<script lang="ts">
	import { Check, LoaderCircle, Plus, Wrench } from '@lucide/svelte';
	import PlatformLogo from '../PlatformLogo.svelte';
	import { platformColorClass } from '#lib/components/platform-color.js';
	import { platformName } from '#lib/domain/platforms.js';

	interface Props {
		platform: string;
		count: number;
		needsSetup: boolean;
		isOwner: boolean;
		busy: boolean;
		onConnect: () => void;
	}

	let { platform, count, needsSetup, isOwner, busy, onConnect }: Props = $props();
	const name = $derived(platformName(platform));
</script>

<div
	class="flex items-center gap-3 rounded-xl border p-3 transition-colors {count
		? 'border-emerald-200 bg-emerald-50/40'
		: 'border-stone-200 bg-white hover:border-stone-300'}"
	data-testid="onboarding-channel-{platform}"
>
	<span
		class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-50 ring-1 ring-stone-200 {platformColorClass(
			platform
		)}"
	>
		<PlatformLogo {platform} size={18} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="text-[14px] font-semibold text-stone-900">{name}</p>
		<p class="text-[12px] text-stone-500">
			{#if count}
				{count} connected
			{:else if needsSetup}
				Needs setup
			{:else}
				Not connected
			{/if}
		</p>
	</div>
	{#if count}
		<span class="flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
			<Check class="h-4 w-4" /> Connected
		</span>
	{:else if needsSetup}
		{#if isOwner}
			<a href="/accounts" class="btn btn-secondary btn-sm" aria-label="Set up {name} on Accounts">
				<Wrench class="h-3.5 w-3.5" /> Set up
			</a>
		{:else}
			<span class="shrink-0 text-[12px] text-stone-500">Owner sets up</span>
		{/if}
	{:else}
		<button
			type="button"
			class="btn btn-secondary btn-sm"
			disabled={busy}
			onclick={onConnect}
			aria-label="Connect {name}"
		>
			{#if busy}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Plus
					class="h-3.5 w-3.5"
				/>{/if}
			Connect
		</button>
	{/if}
</div>
