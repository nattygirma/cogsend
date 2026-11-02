<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		action,
		children,
		class: className = '',
		padded = true
	}: {
		title?: string;
		subtitle?: string;
		action?: Snippet;
		children: Snippet;
		class?: string;
		/** False for cards whose content runs edge to edge (lists, tables). */
		padded?: boolean;
	} = $props();
</script>

<section class="card {className}">
	{#if title}
		<header class="flex items-start justify-between gap-4 px-5 pt-5 pb-1">
			<div class="min-w-0">
				<h2 class="text-[15px] font-semibold tracking-tight text-stone-900">{title}</h2>
				{#if subtitle}<p class="mt-0.5 text-xs text-stone-500">{subtitle}</p>{/if}
			</div>
			{#if action}{@render action()}{/if}
		</header>
	{/if}
	<div class={padded ? 'p-5' : ''}>{@render children()}</div>
</section>
