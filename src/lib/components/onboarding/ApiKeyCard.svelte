<script lang="ts">
	import { KeyRound, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import SnippetBlock from './SnippetBlock.svelte';
	import type { ApiKeyInfo } from './use-onboarding.svelte.js';

	interface Props {
		activeKey: ApiKeyInfo | null;
		newKey: string | null;
		busy: boolean;
		onCreate: () => void;
	}

	let { activeKey, newKey, busy, onCreate }: Props = $props();
</script>

<section class="card p-5" data-testid="onboarding-key-card">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="flex items-start gap-3">
			<span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
				<KeyRound class="h-4 w-4" />
			</span>
			<div>
				<h3 class="text-[15px] font-semibold text-stone-900">1. Create an API key</h3>
				<p class="mt-0.5 text-[13px] text-stone-500">
					Your agent signs in to PostEasy with it. It can draft, schedule and publish as you.
				</p>
			</div>
		</div>
		{#if !newKey}
			<button
				type="button"
				class="btn {activeKey ? 'btn-secondary' : 'btn-primary'}"
				disabled={busy}
				onclick={onCreate}
			>
				{#if busy}<LoaderCircle class="h-4 w-4 animate-spin" />{/if}
				{activeKey ? 'Create a new key' : 'Create API key'}
			</button>
		{/if}
	</div>

	{#if newKey}
		<div class="mt-4 space-y-3">
			<SnippetBlock
				label="Your new key"
				text={newKey}
				copyLabel="Copy the API key"
				testId="onboarding-new-key"
			/>
			<p class="flex items-start gap-2 text-[12.5px] text-amber-700">
				<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				Copy it now: it won't be shown again. The commands below already include it.
			</p>
		</div>
	{:else if activeKey}
		<p class="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-[12.5px] text-stone-600">
			You already have a key starting <code class="font-mono text-stone-900"
				>{activeKey.prefix}</code
			>. A new key replaces it, and anything using the old one stops working.
		</p>
	{/if}
</section>
