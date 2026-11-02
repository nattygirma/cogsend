<script lang="ts">
	import { ArrowRight, Rocket } from '@lucide/svelte';

	interface Props {
		/** The step the person reached, shown as progress. */
		step: number;
	}

	let { step }: Props = $props();
</script>

<a
	href="?onboarding=1"
	class="card mb-6 flex items-center gap-4 p-5 transition-shadow hover:shadow-md"
	data-testid="get-started-card"
>
	<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
		<Rocket class="h-5 w-5" />
	</span>
	<span class="min-w-0 flex-1">
		<span class="block text-[15px] font-semibold text-stone-900">Get started</span>
		<span class="block text-[13px] text-stone-500">
			Connect your channels and your AI agent, then write your first post · step {step} of 3
		</span>
	</span>
	<span class="btn btn-primary btn-sm">Continue <ArrowRight class="h-3.5 w-3.5" /></span>
</a>
