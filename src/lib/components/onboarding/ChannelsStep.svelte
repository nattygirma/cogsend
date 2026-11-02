<script lang="ts">
	import { PLATFORM_ORDER } from '#lib/domain/platforms.js';
	import { isOAuthPlatform } from '#lib/domain/platform-setup.js';
	import ChannelTile from './ChannelTile.svelte';
	import type { Onboarding } from './use-onboarding.svelte.js';

	interface Props {
		guide: Onboarding;
		isOwner: boolean;
	}

	let { guide, isOwner }: Props = $props();

	function connect(platform: string) {
		if (isOAuthPlatform(platform)) void guide.connectOAuth(platform);
	}
</script>

<div class="mx-auto max-w-5xl">
	<div class="mb-6 text-center">
		<h2 class="text-2xl font-semibold tracking-tight text-stone-900">Connect your channels</h2>
		<p class="mt-2 text-sm text-stone-500">
			Add the accounts you want to post to. You can add more later.
		</p>
	</div>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each PLATFORM_ORDER as platform (platform)}
			<ChannelTile
				{platform}
				{isOwner}
				count={guide.countFor(platform)}
				needsSetup={guide.needsSetup(platform)}
				busy={guide.connecting === platform}
				onConnect={() => connect(platform)}
			/>
		{/each}
	</div>
</div>
