<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	let {
		title,
		icon: Icon,
		children,
		action
	}: {
		title: string;
		icon?: Component<{ class?: string }>;
		children?: Snippet;
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center justify-center px-6 py-14 text-center">
	{#if Icon}
		<span
			class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-stone-400"
		>
			<Icon class="h-5 w-5" />
		</span>
	{/if}
	<p class="font-semibold text-stone-900">{title}</p>
	{#if children}<div class="mt-1.5 max-w-sm text-sm text-stone-500">{@render children()}</div>{/if}
	{#if action}<div class="mt-5">{@render action()}</div>{/if}
</div>
