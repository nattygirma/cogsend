<script lang="ts">
	import type { Snippet } from 'svelte';
	import logoGlyph from '#lib/assets/logo-glyph.svg';
	import PlatformLogo from '#lib/components/PlatformLogo.svelte';

	let {
		appName,
		children
	}: {
		appName: string;
		children: Snippet;
	} = $props();

	const PLATFORMS = ['x', 'instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'threads'];
</script>

<div class="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
	<aside
		class="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col"
	>
		<div
			class="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl"
			aria-hidden="true"
		></div>
		<div
			class="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-violet-400/20 blur-3xl"
			aria-hidden="true"
		></div>
		<div class="relative flex items-center gap-3">
			<span class="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
				<img src={logoGlyph} alt="" class="h-6 w-6" aria-hidden="true" data-testid="brand-mark" />
			</span>
			<span class="text-lg font-semibold tracking-tight">{appName}</span>
		</div>
		<div class="relative mt-auto max-w-md">
			<h2 class="text-[34px] leading-tight font-semibold tracking-tight">
				Schedule once. Publish to X, Instagram, Facebook, YouTube, TikTok, LinkedIn and more.
			</h2>
			<p class="mt-4 text-[15px] text-indigo-100">
				Write a post, tailor it per platform, and let it go out on time — from one calendar.
			</p>
			<ul class="mt-10 flex flex-wrap gap-3" aria-label="Supported platforms">
				{#each PLATFORMS as platform (platform)}
					<li
						class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15 backdrop-blur"
					>
						<PlatformLogo {platform} size={18} />
					</li>
				{/each}
			</ul>
		</div>
	</aside>

	<main id="main-content" class="flex items-center justify-center px-4 py-12 sm:px-8">
		<div class="w-full max-w-[400px]">
			<div class="mb-8 flex items-center gap-2.5 lg:hidden">
				<img src={logoGlyph} alt="" class="h-8 w-8" aria-hidden="true" />
				<span class="text-lg font-semibold tracking-tight">{appName}</span>
			</div>
			{@render children()}
		</div>
	</main>
</div>
