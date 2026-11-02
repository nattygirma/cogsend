<script lang="ts">
	import { CalendarPlus, ChevronDown, LoaderCircle, Send } from '@lucide/svelte';

	interface Props {
		label: string;
		busy: boolean;
		disabled: boolean;
		onPublish: () => void;
		onSchedule: () => void;
	}

	let { label, busy, disabled, onPublish, onSchedule }: Props = $props();

	let open = $state(false);
	let container: HTMLDivElement | null = $state(null);
</script>

<svelte:window
	onclick={(event) => {
		if (open && container && !container.contains(event.target as Node)) open = false;
	}}
/>

<div class="relative flex" bind:this={container}>
	<button
		type="button"
		data-testid="publish-now"
		class="btn btn-primary h-11 rounded-r-none px-5"
		{disabled}
		aria-busy={busy}
		onclick={onPublish}
	>
		<span>{label}</span>
		{#if busy}
			<LoaderCircle class="h-4 w-4 animate-spin" />
		{:else}
			<Send class="h-4 w-4" />
		{/if}
	</button>
	<button
		type="button"
		class="btn btn-primary h-11 rounded-l-none border-l border-indigo-400/60 px-2.5"
		{disabled}
		aria-label="More publishing options"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<ChevronDown class="h-4 w-4" />
	</button>
	{#if open}
		<div
			class="absolute right-0 bottom-full z-40 mb-2 w-52 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.2)]"
			role="menu"
		>
			<button
				type="button"
				role="menuitem"
				class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-stone-700 hover:bg-stone-100"
				onclick={() => {
					open = false;
					onSchedule();
				}}
			>
				<CalendarPlus class="h-4 w-4 text-stone-400" /> Add to calendar…
			</button>
		</div>
	{/if}
</div>
