<script lang="ts">
	import type { Snippet } from 'svelte';
	import { foldText } from '#lib/domain/platform-preview.js';

	/** A caption cut where its platform folds it, opened by its "more". */
	let {
		text,
		max,
		more = '… more',
		moreClass = 'text-stone-500',
		lead
	}: {
		text: string;
		max: number;
		more?: string;
		moreClass?: string;
		/** Drawn inline before the text, as Instagram puts the handle there. */
		lead?: Snippet;
	} = $props();

	let open = $state(false);
	const folded = $derived(foldText(text, max));
</script>

<span class="break-words whitespace-pre-wrap"
	>{#if lead}{@render lead()}{/if}{open || !folded.folded
		? text
		: folded.shown}{#if folded.folded && !open}<button
			type="button"
			class="ml-0.5 cursor-pointer font-normal {moreClass}"
			onclick={() => (open = true)}>{more}</button
		>{/if}</span
>
