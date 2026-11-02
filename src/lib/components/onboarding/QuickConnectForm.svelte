<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';

	interface Props {
		busy: boolean;
		onBluesky: (handle: string, appPassword: string) => void;
		onCancel: () => void;
	}

	let { busy, onBluesky, onCancel }: Props = $props();

	let handle = $state('');
	let appPassword = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onBluesky(handle.trim(), appPassword.trim());
	}
</script>

<form
	class="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
	onsubmit={submit}
	data-testid="onboarding-bluesky-form"
>
	<p class="text-[13px] text-stone-600">
		Use an <strong>app password</strong> from Bluesky (Settings → Privacy and security → App passwords),
		never your main password.
	</p>
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="block">
			<span class="field-label">Handle</span>
			<input class="field" bind:value={handle} placeholder="you.bsky.social" required />
		</label>
		<label class="block">
			<span class="field-label">App password</span>
			<input class="field" type="password" bind:value={appPassword} required />
		</label>
	</div>
	<div class="flex justify-end gap-2">
		<button type="button" class="btn btn-ghost btn-sm" onclick={onCancel}>Cancel</button>
		<button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
			{#if busy}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{/if}
			Connect Bluesky
		</button>
	</div>
</form>
