<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tone = 'neutral',
		dot = false,
		children
	}: {
		tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info';
		dot?: boolean;
		children: Snippet;
	} = $props();

	const toneClass = {
		neutral: 'border-stone-200 bg-stone-50 text-stone-600',
		accent: 'border-indigo-200 bg-accent-soft text-accent-ink',
		ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		warn: 'border-amber-200 bg-amber-50 text-amber-700',
		bad: 'border-rose-200 bg-rose-50 text-rose-700',
		info: 'border-sky-200 bg-sky-50 text-sky-700'
	};
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-semibold {toneClass[
		tone
	]}"
>
	{#if dot}<span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{/if}
	{@render children()}
</span>
