<script lang="ts">
	import { initialsOf } from '#lib/components/initials.js';
	import type { PreviewAccount } from '#lib/domain/platform-preview.js';

	let {
		account,
		size,
		square = false,
		class: className = ''
	}: { account: PreviewAccount; size: number; square?: boolean; class?: string } = $props();
</script>

<span
	class="flex shrink-0 items-center justify-center overflow-hidden bg-stone-300 font-semibold text-stone-700 {square
		? 'rounded-md'
		: 'rounded-full'} {className}"
	style="width: {size}px; height: {size}px; font-size: {Math.round(size * 0.36)}px"
	aria-hidden="true"
>
	{#if account.avatarUrl}
		<img
			src={account.avatarUrl}
			alt=""
			referrerpolicy="no-referrer"
			class="h-full w-full object-cover"
		/>
	{:else}
		{initialsOf(account.name)}
	{/if}
</span>
