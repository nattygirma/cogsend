<script lang="ts">
	import type { Component } from 'svelte';

	let {
		label,
		value,
		hint,
		icon: Icon,
		tone = 'neutral',
		href
	}: {
		label: string;
		value: string | number;
		hint?: string;
		icon?: Component<{ class?: string }>;
		tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';
		href?: string;
	} = $props();

	const toneClass = {
		neutral: 'bg-stone-100 text-stone-600',
		accent: 'bg-accent-soft text-accent',
		ok: 'bg-emerald-50 text-emerald-600',
		warn: 'bg-amber-50 text-amber-600',
		bad: 'bg-rose-50 text-rose-600'
	};
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="card block p-5 {href ? 'transition-shadow hover:shadow-md' : ''}"
>
	<div class="flex items-center justify-between">
		<span class="text-[13px] font-medium text-stone-500">{label}</span>
		{#if Icon}
			<span class="flex h-8 w-8 items-center justify-center rounded-lg {toneClass[tone]}">
				<Icon class="h-4 w-4" />
			</span>
		{/if}
	</div>
	<p class="mt-3 text-3xl font-semibold tracking-tight text-stone-900 tabular-nums">{value}</p>
	{#if hint}<p class="mt-1.5 text-xs text-stone-500">{hint}</p>{/if}
</svelte:element>
