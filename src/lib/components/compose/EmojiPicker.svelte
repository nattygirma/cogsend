<script lang="ts">
	import { Smile } from '@lucide/svelte';

	interface Props {
		index: number;
		disabled: boolean;
		onPick: (emoji: string) => void;
	}

	let { index, disabled, onPick }: Props = $props();

	const EMOJI = [
		'😀',
		'😂',
		'😍',
		'🥳',
		'😎',
		'🤔',
		'🙌',
		'👏',
		'🔥',
		'✨',
		'🎉',
		'🚀',
		'💡',
		'✅',
		'❤️',
		'👀',
		'📣',
		'📸',
		'🎥',
		'📅',
		'💬',
		'👉',
		'🙏',
		'💪'
	];

	let open = $state(false);
	let container: HTMLDivElement | null = $state(null);
</script>

<svelte:window
	onclick={(event) => {
		if (open && container && !container.contains(event.target as Node)) open = false;
	}}
/>

<div class="relative" bind:this={container}>
	<button
		type="button"
		class="toolbar-btn"
		{disabled}
		aria-label={`Insert an emoji in post ${index + 1}`}
		aria-expanded={open}
		title="Emoji"
		onclick={() => (open = !open)}
	>
		<Smile class="h-4 w-4" />
	</button>
	{#if open}
		<div
			class="absolute top-full left-0 z-40 mt-2 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-stone-200 bg-white p-2 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.2)]"
			role="dialog"
			aria-label="Emoji"
		>
			{#each EMOJI as emoji (emoji)}
				<button
					type="button"
					class="flex h-7 w-7 items-center justify-center rounded-md text-[17px] hover:bg-stone-100"
					onclick={() => {
						onPick(emoji);
						open = false;
					}}>{emoji}</button
				>
			{/each}
		</div>
	{/if}
</div>
