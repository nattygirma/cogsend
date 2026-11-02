<script lang="ts">
	import SocialIcon from '../SocialIcon.svelte';
	import { platformColorClass } from '../platform-color';
	import { platformName } from '#lib/domain/platforms.js';

	let { platforms, size = 22 }: { platforms: string[]; size?: number } = $props();
</script>

<span class="flex items-center -space-x-1.5" aria-label={platforms.map(platformName).join(', ')}>
	{#each platforms as platform (platform)}
		<span
			class="flex items-center justify-center rounded-full border border-stone-200 bg-white {platformColorClass(
				platform
			)}"
			style="width: {size}px; height: {size}px"
			title={platformName(platform)}
		>
			<SocialIcon {platform} className="h-[55%] w-[55%]" />
		</span>
	{/each}
</span>
