<script lang="ts">
	import { PartyPopper } from '@lucide/svelte';

	interface Props {
		channels: number;
		agentConnected: boolean;
		onWrite: () => void;
		onDashboard: () => void;
	}

	let { channels, agentConnected, onWrite, onDashboard }: Props = $props();
</script>

<div class="mx-auto flex max-w-lg flex-col items-center py-6 text-center">
	<span
		class="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"
	>
		<PartyPopper class="h-6 w-6" />
	</span>
	<h2 class="text-2xl font-semibold tracking-tight text-stone-900">You're all set</h2>
	<p class="mt-2 text-sm text-stone-500" data-testid="onboarding-summary">
		{channels
			? `${channels} channel${channels === 1 ? '' : 's'} connected`
			: 'No channels connected yet'}
		· {agentConnected ? 'agent key created' : 'no agent connected'}
	</p>
	<div class="mt-7 flex flex-wrap justify-center gap-2">
		<button type="button" class="btn btn-primary" onclick={onWrite}>Write your first post</button>
		<button type="button" class="btn btn-secondary" onclick={onDashboard}>Go to dashboard</button>
	</div>
</div>
