<script lang="ts">
	import AddCommentButton from './AddCommentButton.svelte';
	import SegmentCard from './SegmentCard.svelte';
	import type { SegmentContext } from './segment-context';

	interface Props {
		ctx: SegmentContext;
	}

	let { ctx }: Props = $props();
</script>

<div class="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-3">
	{#each ctx.segments as segment, index (index)}
		<SegmentCard {ctx} {segment} {index} />
	{/each}
	{#if !ctx.editLocked && ctx.tabSupportsThreads}
		<AddCommentButton onAdd={ctx.onAddSegment} />
	{/if}
</div>
