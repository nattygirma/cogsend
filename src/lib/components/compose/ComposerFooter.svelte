<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Check } from '@lucide/svelte';
	import SharePreview from '../SharePreview.svelte';
	import PublishMenu from './PublishMenu.svelte';
	import ScheduleButton from './ScheduleButton.svelte';

	interface Props {
		saveIndicator: 'saving' | 'saved' | 'failed' | null;
		saving: boolean;
		onRetrySave: () => void;
		canShare: boolean;
		draftId: string | null;
		ensureSaved: () => Promise<string | null>;
		scheduleOpen: boolean;
		/** The scheduled or picked time, or null when none is set yet. */
		scheduleLabel: string | null;
		/** Publishing or unscheduling: nothing may start another. */
		busy: boolean;
		onOpenSchedule: () => void;
		canSaveDraft: boolean;
		onSaveDraft: () => void;
		publishBusy: boolean;
		publishLabel: string;
		onPublish: () => void;
		/** The confirm and schedule panels, which open above the buttons. */
		popovers: Snippet;
	}

	let {
		saveIndicator,
		saving,
		onRetrySave,
		canShare,
		draftId,
		ensureSaved,
		scheduleOpen,
		scheduleLabel,
		busy,
		onOpenSchedule,
		canSaveDraft,
		onSaveDraft,
		publishBusy,
		publishLabel,
		onPublish,
		popovers
	}: Props = $props();
</script>

<div
	class="flex shrink-0 flex-wrap items-center gap-2 border-t border-stone-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"
	data-testid="compose-action-bar"
>
	<div class="flex min-w-0 flex-1 items-center gap-3">
		{#if saveIndicator}
			<p
				data-testid="save-status"
				class="flex items-center gap-1 text-[12px] font-medium whitespace-nowrap {saveIndicator ===
				'failed'
					? 'text-rose-600'
					: 'text-stone-500'}"
			>
				{#if saveIndicator === 'failed'}
					Not saved ·
					<button
						type="button"
						disabled={saving}
						onclick={onRetrySave}
						class="-my-3 inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline disabled:opacity-50"
					>
						Retry
					</button>
				{:else if saveIndicator === 'saving'}
					Saving…
				{:else}
					<Check class="h-3.5 w-3.5 text-emerald-600" /> Saved
				{/if}
			</p>
		{/if}
		{#if canShare}
			<SharePreview {draftId} {ensureSaved} placement="above" />
		{/if}
	</div>

	<div class="post-actions-container relative flex items-center justify-end gap-2">
		<ScheduleButton
			label={scheduleLabel}
			open={scheduleOpen}
			disabled={busy}
			onClick={onOpenSchedule}
		/>
		<button
			type="button"
			class="btn hidden h-11 bg-stone-100 px-4 text-stone-800 hover:bg-stone-200 sm:inline-flex"
			disabled={!canSaveDraft}
			onclick={onSaveDraft}
		>
			Save as draft
		</button>
		<PublishMenu
			label={publishLabel}
			busy={publishBusy}
			disabled={busy}
			{onPublish}
			onSchedule={onOpenSchedule}
		/>
		{@render popovers()}
	</div>
</div>
