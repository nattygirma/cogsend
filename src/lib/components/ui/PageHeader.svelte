<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		eyebrow,
		subtitle,
		actions
	}: {
		title: string;
		eyebrow?: string;
		subtitle?: string;
		actions?: Snippet;
	} = $props();
</script>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
	<div class="min-w-0">
		{#if eyebrow}
			<p class="mb-1.5 text-[11px] font-semibold tracking-[0.14em] text-stone-500 uppercase">
				{eyebrow}
			</p>
		{/if}
		<h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-[28px]">{title}</h1>
		{#if subtitle}
			<p class="mt-2 max-w-2xl text-sm text-stone-500">{subtitle}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</div>
