<script lang="ts">
	import CopyButton from '../CopyButton.svelte';

	interface Props {
		label: string;
		text: string;
		/** Names what the copy button copies, for screen readers. */
		copyLabel: string;
		testId?: string;
	}

	let { label, text, copyLabel, testId }: Props = $props();
</script>

<div>
	<p class="mb-1.5 text-[12px] font-semibold text-stone-500">{label}</p>
	<div class="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-1.5 pl-3.5">
		<pre
			class="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-[12.5px] leading-relaxed text-stone-800"
			data-testid={testId}><code>{text}</code></pre>
		<CopyButton value={text} ariaLabel={copyLabel} />
	</div>
</div>
