<script lang="ts">
	import { dialogFocus } from '#lib/components/dialog-focus.js';
	import VideoCover from '../video/VideoCover.svelte';
	import ConfirmDialog from '../ConfirmDialog.svelte';
	import type { Composer } from './hooks/composer';

	/** The composer’s dialogs: video cover, discard and remove-media confirmations. */
	let { ed }: { ed: Composer } = $props();
</script>

{#if ed.coverFor}
	{@const coverItem = ed.media.find((m) => m.id === ed.coverFor)}
	{#if coverItem}
		<VideoCover
			open
			src={ed.mediaSrc(coverItem)}
			atMs={coverItem.meta?.cover?.atMs ?? null}
			hasCover={Boolean(coverItem.meta?.cover)}
			busy={ed.coverBusy}
			onSave={(jpeg, atMs) => void ed.chooseCover(jpeg, atMs)}
			onRemove={() => void ed.removeCover()}
			onClose={() => (ed.coverFor = null)}
		/>
	{/if}
{/if}

<ConfirmDialog
	open={ed.isDiscardOpen}
	idPrefix="discard-draft-dialog"
	title={ed.discardCopy.title}
	body={ed.discardCopy.body}
	confirmLabel={ed.discardCopy.confirm}
	cancelLabel="Keep"
	tone="danger"
	busy={ed.discarding || ed.saving || ed.publishing}
	onConfirm={() => void ed.confirmDiscard()}
	onCancel={() => {
		if (!ed.discarding) ed.isDiscardOpen = false;
	}}
/>

{#if ed.pendingMediaRemove}
	<div
		role="presentation"
		class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) ed.pendingMediaRemove = null;
		}}
	>
		<div
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="remove-media-title"
			aria-describedby="remove-media-body"
			class="w-full max-w-sm rounded-[1.5rem] border border-stone-200/80 bg-white/95 p-5 shadow-xl backdrop-blur-xl"
			use:dialogFocus={{
				initial: ed.keepMediaBtn,
				// Always dismissable: closing does not cancel the request, and a
				// hung DELETE must not trap a keyboard user in the dialog.
				onEscape: () => (ed.pendingMediaRemove = null)
			}}
		>
			<h2 id="remove-media-title" class="text-sm font-extrabold text-stone-900">
				Remove this {ed.media.some((m) => m.id === ed.pendingMediaRemove && ed.isVideoItem(m))
					? 'video'
					: 'image'}?
			</h2>
			<p id="remove-media-body" class="mt-1 text-sm font-medium text-stone-500">
				It will be deleted from this draft.
			</p>
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					bind:this={ed.keepMediaBtn}
					disabled={ed.mediaBusy}
					onclick={() => (ed.pendingMediaRemove = null)}
					class="rounded-full border border-stone-200/80 px-4 py-1.5 text-sm font-bold text-stone-600 disabled:opacity-50"
				>
					Keep
				</button>
				<button
					type="button"
					data-testid="confirm-dialog-ok-media"
					disabled={ed.mediaBusy}
					onclick={() => void ed.confirmRemoveMedia()}
					class="rounded-full bg-stone-900 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
				>
					{ed.mediaBusy ? 'Removing…' : 'Remove'}
				</button>
			</div>
		</div>
	</div>
{/if}
