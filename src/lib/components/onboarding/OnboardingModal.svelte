<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowLeft, ArrowRight, X } from '@lucide/svelte';
	import { dialogFocus } from '#lib/components/dialog-focus.js';
	import type { OnboardingState, OnboardingStep } from '#lib/domain/profile-settings.js';
	import AgentsStep from './AgentsStep.svelte';
	import ChannelsStep from './ChannelsStep.svelte';
	import DoneStep from './DoneStep.svelte';
	import OnboardingStepper from './OnboardingStepper.svelte';
	import { useOnboarding } from './use-onboarding.svelte.js';

	interface Props {
		initial: OnboardingState | null;
		isOwner: boolean;
		onClose: () => void;
		/** After the last step: where the person chose to go. */
		onFinish: (target: 'compose' | 'dashboard') => void;
	}

	let { initial, isOwner, onClose, onFinish }: Props = $props();

	const STEPS = ['Connect Channels', 'Connect Agents', 'Write your first post'];
	// svelte-ignore state_referenced_locally
	const guide = useOnboarding(initial);

	onMount(() => {
		void guide.load();
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	const hasKey = $derived(Boolean(guide.newKey || guide.activeKey));
	const nextLabel = $derived(
		guide.step === 1
			? guide.connections.length
				? 'Next'
				: 'Skip for now'
			: hasKey
				? 'Next'
				: 'Skip for now'
	);

	// Saved before closing, so the page reloaded next does not reopen it.
	async function close() {
		await guide.dismiss();
		onClose();
	}

	async function finish(target: 'compose' | 'dashboard') {
		await guide.finish();
		onFinish(target);
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-900/40 backdrop-blur-[2px] sm:items-center sm:p-6"
	role="presentation"
>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-title"
		tabindex="-1"
		data-testid="onboarding-modal"
		use:dialogFocus={{ onEscape: () => void close() }}
		class="flex h-full w-full flex-col overflow-hidden bg-white sm:h-[min(90vh,860px)] sm:max-w-[1100px] sm:rounded-2xl sm:shadow-[0_32px_80px_-24px_rgb(28_25_23/0.45)]"
	>
		<header class="relative border-b border-stone-200 px-5 pt-5 pb-4 sm:px-8 sm:pt-7 sm:pb-6">
			<h1 id="onboarding-title" class="sr-only">Set up PostEasy</h1>
			<OnboardingStepper
				step={guide.step}
				labels={STEPS}
				onSelect={(step: OnboardingStep) => guide.goTo(step)}
			/>
			<button
				type="button"
				class="btn btn-ghost btn-sm absolute top-3 right-3 px-2 sm:top-5 sm:right-5"
				aria-label="Close setup guide"
				onclick={() => void close()}
			>
				<X class="h-5 w-5" />
			</button>
		</header>

		<div class="flex-1 overflow-y-auto bg-canvas px-5 py-6 sm:px-8 sm:py-8">
			{#if guide.error}
				<p
					class="mx-auto mb-4 max-w-3xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700"
					role="alert"
				>
					{guide.error}
				</p>
			{/if}
			{#if guide.step === 1}
				<ChannelsStep {guide} {isOwner} />
			{:else if guide.step === 2}
				<AgentsStep {guide} />
			{:else}
				<DoneStep
					channels={guide.connections.length}
					agentConnected={hasKey}
					onWrite={() => void finish('compose')}
					onDashboard={() => void finish('dashboard')}
				/>
			{/if}
		</div>

		<footer
			class="flex items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-3.5 sm:px-8"
		>
			<div>
				{#if guide.step > 1}
					<button
						type="button"
						class="btn btn-ghost"
						onclick={() => guide.goTo((guide.step - 1) as OnboardingStep)}
					>
						<ArrowLeft class="h-4 w-4" /> Back
					</button>
				{/if}
			</div>
			{#if guide.step < 3}
				<button
					type="button"
					class="btn {nextLabel === 'Next' ? 'btn-primary' : 'btn-secondary'}"
					data-testid="onboarding-next"
					onclick={() => guide.goTo((guide.step + 1) as OnboardingStep)}
				>
					{nextLabel}
					<ArrowRight class="h-4 w-4" />
				</button>
			{/if}
		</footer>
	</div>
</div>
