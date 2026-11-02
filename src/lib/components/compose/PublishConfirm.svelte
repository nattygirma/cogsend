<script lang="ts">
	import { Send } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import SocialIcon from '../SocialIcon.svelte';
	import { platformColorClass } from '../platform-color';
	import { dialogFocus } from '../dialog-focus';
	import { platformName } from '#lib/domain/platforms.js';
	import type { Connection } from './types';

	let {
		accounts,
		replacesSchedule,
		unscheduledNames,
		saving,
		ready,
		skipAsk,
		onConfirm,
		onDismiss,
		onSkipAskChange
	}: {
		accounts: Connection[];
		/** Publishing now takes over a post that was waiting for its time. */
		replacesSchedule: boolean;
		/** Accounts the publish leaves out, which therefore get unscheduled. */
		unscheduledNames: string[];
		saving: boolean;
		/** The draft has been saved, so publishing can start. */
		ready: boolean;
		skipAsk: boolean;
		onConfirm: () => void;
		onDismiss: () => void;
		onSkipAskChange: (skip: boolean) => void;
	} = $props();

	let okButton: HTMLButtonElement | null = $state(null);
</script>

<div
	class="absolute right-0 bottom-full z-40 mb-3 w-72 origin-bottom-right rounded-xl border border-stone-200 bg-white p-3 text-stone-900 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.2)]"
	transition:fly={{ y: 10, duration: 250, opacity: 0 }}
	role="dialog"
	aria-label="Confirm post"
	use:dialogFocus={{
		onEscape: onDismiss,
		// Publishing is not destructive — the draft is saved — so the confirm
		// button is preferred. It is disabled while the draft is still being
		// saved, and the action falls back to the first control that can take
		// focus.
		initial: okButton
	}}
>
	<div class="px-2 pt-2 pb-4 text-center">
		<h4 class="mb-1 text-[14px] font-extrabold text-stone-900">Confirm Post</h4>
		<p class="text-[12px] font-medium text-stone-500">
			Publishing to {accounts.length}
			{accounts.length === 1 ? 'destination' : 'destinations'}{replacesSchedule
				? ' now instead of at the scheduled time'
				: ''}.
		</p>
		{#if unscheduledNames.length}
			<p data-testid="publish-unschedules" class="mt-1 text-[12px] font-medium text-amber-700">
				{unscheduledNames.join(', ')}
				{unscheduledNames.length === 1 ? 'is' : 'are'} unticked, so
				{unscheduledNames.length === 1 ? 'it' : 'they'} will be unscheduled.
			</p>
		{/if}
	</div>

	<div class="mb-4 flex justify-center -space-x-2" data-testid="publish-confirm-destinations">
		{#each accounts as account (account.id)}
			<div
				class="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-stone-50 shadow-sm"
				title="{platformName(account.platform)}: {account.displayName || account.handle}"
			>
				<SocialIcon
					platform={account.platform}
					className={`h-3.5 w-3.5 ${platformColorClass(account.platform)}`}
				/>
			</div>
		{/each}
	</div>

	<button
		type="button"
		bind:this={okButton}
		data-testid="confirm-dialog-ok"
		class="btn btn-primary w-full"
		disabled={saving || !ready}
		onclick={onConfirm}
	>
		{saving ? 'Saving…' : 'Publish Now'}
		<Send class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="mt-1 w-full rounded-full py-1.5 text-[12px] font-bold text-stone-500 transition-colors hover:text-stone-900"
		onclick={onDismiss}
	>
		Keep editing
	</button>
	<label
		class="mt-1 flex items-center justify-center gap-1.5 text-[11px] font-medium text-stone-500"
	>
		<input
			type="checkbox"
			checked={skipAsk}
			onchange={(e) => onSkipAskChange(e.currentTarget.checked)}
		/>
		Publish without asking next time
	</label>
</div>
