<script lang="ts">
	import { CircleAlert, SquareCheck } from '@lucide/svelte';

	interface Props {
		count: number;
		max: number;
		testId: string;
	}

	let { count, max, testId }: Props = $props();

	const over = $derived(count > max);
</script>

<span
	data-testid={testId}
	class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold tabular-nums {over
		? 'border-rose-200 bg-rose-50 text-rose-600'
		: 'border-stone-200 bg-white text-stone-600'}"
>
	{#if over}
		<CircleAlert class="h-4 w-4" />
	{:else}
		<SquareCheck class="h-4 w-4 text-emerald-600" />
	{/if}
	{count}/{max}
</span>
