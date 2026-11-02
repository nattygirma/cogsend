<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { OnboardingStep } from '#lib/domain/profile-settings.js';

	interface Props {
		step: OnboardingStep;
		labels: string[];
		onSelect: (step: OnboardingStep) => void;
	}

	let { step, labels, onSelect }: Props = $props();
</script>

<!-- Narrow screens: the count alone; the labels need the width. -->
<p
	class="text-center text-[13px] font-semibold text-stone-500 sm:hidden"
	data-testid="onboarding-step-count"
>
	Step {step} of {labels.length} · <span class="text-stone-900">{labels[step - 1]}</span>
</p>

<ol class="hidden items-center justify-center gap-3 sm:flex" aria-label="Setup steps">
	{#each labels as label, i (label)}
		{@const n = (i + 1) as OnboardingStep}
		{@const done = n < step}
		{@const active = n === step}
		<li class="flex items-center gap-3">
			<button
				type="button"
				class="flex items-center gap-2.5 rounded-full py-1 pr-2 text-[14px] font-semibold transition-colors {active
					? 'text-stone-900'
					: 'text-stone-500 hover:text-stone-900'}"
				aria-current={active ? 'step' : undefined}
				onclick={() => onSelect(n)}
			>
				<span
					class="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold {active
						? 'bg-accent text-white shadow-[0_2px_8px_-2px_rgb(79_70_229/0.5)]'
						: done
							? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
							: 'bg-stone-100 text-stone-500'}"
				>
					{#if done}<Check class="h-4 w-4" />{:else}{n}{/if}
				</span>
				{label}
			</button>
			{#if i < labels.length - 1}
				<span class="h-px w-12 bg-stone-300" aria-hidden="true"></span>
			{/if}
		</li>
	{/each}
</ol>
