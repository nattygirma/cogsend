<script lang="ts">
	import './layout.css';
	import { goto, invalidateAll, preloadData, pushState } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Settings,
		LogOut,
		ChevronsUpDown,
		CalendarDays,
		Users,
		ChartColumn,
		LayoutDashboard,
		ListChecks,
		Code,
		Menu,
		Plus,
		UserRound,
		Rocket,
		X
	} from '@lucide/svelte';
	import { onMount, type ComponentProps } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import favicon from '#lib/assets/favicon.svg';
	import faviconDark from '#lib/assets/favicon-dark.svg';
	import logoGlyph from '#lib/assets/logo-glyph.svg';
	import { composeSession } from '#lib/components/compose-session.svelte.js';
	import { initialsOf } from '#lib/components/initials.js';
	import { menuNav } from '#lib/components/menu-nav.js';
	import { publishActivity } from '#lib/components/publish-tracker.svelte.js';
	import Toast from '#lib/components/Toast.svelte';
	import ComposerModal from '#lib/components/compose/ComposerModal.svelte';
	import OnboardingModal from '#lib/components/onboarding/OnboardingModal.svelte';
	import { onboardingAutoOpens } from '#lib/domain/profile-settings.js';
	import {
		markUpdateSeen,
		noteRelease,
		readUpdateSeen,
		updateNotice
	} from '#lib/components/update-notice.svelte.js';
	import { browserTimeZone } from '#lib/domain/time-zone.js';

	let profileTrigger: HTMLButtonElement | null = $state(null);

	let { children, data } = $props();

	let showProfileDropdown = $state(false);
	let showMobileNav = $state(false);

	const NAV = [
		{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
		{ href: '/calendar', label: 'Calendar', icon: CalendarDays },
		{ href: '/posts', label: 'Posts', icon: ListChecks },
		{ href: '/accounts', label: 'Accounts', icon: Users },
		{ href: '/insights', label: 'Insights', icon: ChartColumn }
	];
	const NAV_SECONDARY = [
		{ href: '/settings', label: 'Settings', icon: Settings },
		{ href: '/api', label: 'API & MCP', icon: Code }
	];

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}

	const userEmail: string | null = $derived(data.user?.email ?? null);
	const displayName: string | null = $derived(data.displayName ?? null);
	const profilePictureUrl: string | null = $derived(data.profilePictureUrl ?? null);
	const avatarSrc = $derived(profilePictureUrl || null);
	// Initials stay underneath the picture. A failed URL (and only that URL)
	// drops the image; the next URL is tried again.
	let failedAvatarSrc = $state<string | null>(null);
	const isLoginRoute = $derived(
		page.url.pathname.startsWith('/login') || page.url.pathname.startsWith('/signup')
	);
	// A preview link looks the same to its owner as to whoever it was sent to.
	const isShareRoute = $derived(page.url.pathname.startsWith('/p/'));

	// The composer is a modal over the page the person was on. Opened from a
	// link, it takes the compose URL without leaving that page (shallow
	// routing), so Back closes it and the page behind keeps its state; the
	// compose route itself opens it over an empty canvas.
	const composerOpen = $derived(Boolean(page.state.composer) || page.url.pathname === '/compose');
	// The compose route's data, from the link that opened the modal or from
	// the route itself, under the names the editor takes.
	const composerData = $derived.by((): ComponentProps<typeof ComposerModal>['data'] => {
		const d = (page.state.composer ?? page.data) as Record<string, unknown>;
		return {
			initialConnections: (d.connections ?? []) as ComposerProps['initialConnections'],
			initialSettings: (d.settings ?? null) as ComposerProps['initialSettings'],
			initialDraft: (d.draft ?? null) as ComposerProps['initialDraft'],
			displayName: (d.displayName ?? null) as string | null,
			canMakeJpegCopies: Boolean(d.canMakeJpegCopies)
		};
	});
	type ComposerProps = ComponentProps<typeof ComposerModal>['data'];

	async function openComposer(href: string) {
		const result = await preloadData(href);
		if (result.type === 'loaded' && result.status === 200) {
			pushState(href, { composer: result.data as Record<string, unknown>, composerHref: href });
		} else {
			await goto(href);
		}
	}

	// The setup guide opens by itself for an account that has not finished or
	// closed it (a new sign-up, or one coming back from a connect it started),
	// and on demand from the dashboard or the profile menu (?onboarding).
	let guideClosed = $state(false);
	const guideRequested = $derived(page.url.searchParams.has('onboarding'));
	const guideOpen = $derived(
		Boolean(userEmail) &&
			!isLoginRoute &&
			!isShareRoute &&
			!composerOpen &&
			(guideRequested || (!guideClosed && onboardingAutoOpens(data.onboarding)))
	);

	async function closeGuide() {
		guideClosed = true;
		if (guideRequested) {
			const params = new URLSearchParams(page.url.search);
			params.delete('onboarding');
			const query = params.toString();
			await goto(`${page.url.pathname}${query ? `?${query}` : ''}`, { replaceState: true });
		}
		await invalidateAll();
	}

	async function finishGuide(target: 'compose' | 'dashboard') {
		await closeGuide();
		if (target === 'compose') await openComposer('/compose');
		else if (page.url.pathname !== '/') await goto('/');
	}

	async function closeComposer() {
		await composeSession.flush?.();
		if (page.state.composer) history.back();
		else await goto('/');
	}

	// Every link to the compose page opens the modal instead of navigating,
	// wherever it is (sidebar, dashboard, calendar, posts). Inside the open
	// composer the editor handles its own links.
	function interceptComposeLinks(event: MouseEvent) {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const anchor = (event.target as HTMLElement | null)?.closest('a');
		if (!anchor?.href) return;
		const url = new URL(anchor.href, window.location.href);
		if (url.origin !== window.location.origin || url.pathname !== '/compose') return;
		event.preventDefault();
		showMobileNav = false;
		if (composerOpen) {
			if (!url.searchParams.has('id') && composeSession.startNew) composeSession.startNew();
			else void goto(url.pathname + url.search);
			return;
		}
		void openComposer(url.pathname + url.search);
	}

	// Insights counts days in the account's zone, and nothing else knows it: the
	// browser does. Recorded in the background whenever the two disagree, so a
	// move or a trip follows along; a failure only means the next visit tries again.
	onMount(() => {
		const user = data.user;
		const zone = browserTimeZone();
		if (!user || !zone || zone === user.timezone) return;
		void fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ timezone: zone })
		}).catch(() => {});
	});

	// Asked once per signed-in page load (and again after signing in, which does
	// not reload the layout). The server caches GitHub's answer for an hour, so
	// this is a D1 read, and it never holds up the page.
	let releaseAskedFor: string | null = null;
	onMount(readUpdateSeen);
	$effect(() => {
		const user = data.user;
		// Keyed on the user: signing in does not reload the layout.
		const key = user ? user.id : null;
		if (!key || key === releaseAskedFor) return;
		releaseAskedFor = key;
		void fetch('/api/release')
			.then((res) => (res.ok ? res.json() : null))
			.then(noteRelease)
			.catch(() => {});
	});
	const showUpdateDot = $derived(!!updateNotice.tag && updateNotice.seen !== updateNotice.tag);

	let logoutError = $state<string | null>(null);
	async function logout() {
		showProfileDropdown = false;
		logoutError = null;
		if (data.appkeep) {
			window.location.href = '/_altstack/logout';
			return;
		}
		try {
			const res = await fetch('/api/auth/logout', { method: 'POST' });
			if (!res.ok) throw new Error(`Logout failed (${res.status})`);
			await invalidateAll();
			await goto('/login');
		} catch (err) {
			// Without this the redirect to /login bounces a still-signed-in user
			// back to the page they were on, and the button looks broken.
			await invalidateAll();
			logoutError =
				err instanceof Error && err.message.startsWith('Logout failed')
					? 'Could not sign out — try again'
					: 'Could not sign out — check your connection';
		}
	}

	// Close dropdowns when clicking outside
	function handleOutsideClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.profile-dropdown-container')) {
			showProfileDropdown = false;
		}
	}

	function handleMenuKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			showProfileDropdown = false;
			showMobileNav = false;
		}
	}
</script>

<svelte:head>
	<title>{data.appName} — write & schedule</title>
	<meta
		name="description"
		content="Social media scheduler for X, Instagram, Facebook, YouTube, TikTok, LinkedIn, Threads and Bluesky"
	/>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="icon" href={faviconDark} type="image/svg+xml" media="(prefers-color-scheme: dark)" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<svelte:window onclick={handleOutsideClick} onkeydown={handleMenuKeydown} />
<svelte:document onclickcapture={interceptComposeLinks} />
<a
	href="#main-content"
	class="sr-only z-50 rounded-full bg-stone-900 px-4 py-2 text-sm font-bold text-white focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
	>Skip to content</a
>

{#if isLoginRoute || isShareRoute || !userEmail}
	{@render children()}
{:else}
	<div class="min-h-dvh bg-canvas font-sans text-stone-900 selection:bg-indigo-100">
		<!-- Mobile top bar -->
		<header
			class="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur lg:hidden"
		>
			<button
				type="button"
				class="btn btn-ghost btn-sm -ml-2 px-2"
				aria-label="Open navigation"
				aria-expanded={showMobileNav}
				onclick={() => (showMobileNav = true)}
			>
				<Menu class="h-5 w-5" />
			</button>
			<img src={logoGlyph} alt="" class="h-6 w-6" aria-hidden="true" />
			<span class="font-semibold tracking-tight">{data.appName}</span>
			<a href="/compose" data-testid="write-new-post-mobile" class="btn btn-primary btn-sm ml-auto"
				><Plus class="h-4 w-4" /> New post</a
			>
		</header>

		{#if showMobileNav}
			<button
				type="button"
				class="fixed inset-0 z-40 bg-stone-900/30 lg:hidden"
				aria-label="Close navigation"
				onclick={() => (showMobileNav = false)}
				transition:fade={{ duration: 150 }}
			></button>
		{/if}

		<!-- Sidebar -->
		<aside
			class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-stone-200 bg-white transition-transform duration-200 lg:translate-x-0 {showMobileNav
				? 'translate-x-0'
				: '-translate-x-full'}"
			aria-label="Sidebar"
		>
			<div class="flex h-16 items-center gap-2.5 px-5">
				<img src={logoGlyph} alt="" class="h-7 w-7" aria-hidden="true" />
				<span class="text-[15px] font-semibold tracking-tight">{data.appName}</span>
				<button
					type="button"
					class="btn btn-ghost btn-sm ml-auto px-2 lg:hidden"
					aria-label="Close navigation"
					onclick={() => (showMobileNav = false)}
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="px-3 pb-3">
				<a href="/compose" class="btn btn-primary w-full" data-testid="write-new-post-sidebar">
					<Plus class="h-4 w-4" /> New post
				</a>
			</div>

			<nav aria-label="Primary" class="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
				<p
					class="px-3 pt-1 pb-2 text-[11px] font-semibold tracking-[0.12em] text-stone-400 uppercase"
				>
					Workspace
				</p>
				{#each NAV as item (item.href)}
					{@const on = isActive(item.href)}
					<a
						href={item.href}
						onclick={() => (showMobileNav = false)}
						aria-current={on ? 'page' : undefined}
						class="group flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors {on
							? 'bg-accent-soft text-accent-ink'
							: 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}"
					>
						<item.icon
							class="h-[18px] w-[18px] {on
								? 'text-accent'
								: 'text-stone-400 group-hover:text-stone-600'}"
						/>
						<span class="flex-1">{item.label}</span>
						{#if item.href === '/posts' && publishActivity.unseenFailure}
							<span
								class="h-2 w-2 rounded-full bg-rose-500"
								aria-hidden="true"
								data-testid="publish-failure-dot"
							></span>
							<span class="sr-only">— a post failed to publish</span>
						{/if}
					</a>
				{/each}

				<p
					class="px-3 pt-5 pb-2 text-[11px] font-semibold tracking-[0.12em] text-stone-400 uppercase"
				>
					Configure
				</p>
				{#each NAV_SECONDARY as item (item.href)}
					{@const on = isActive(item.href)}
					<a
						href={item.href}
						onclick={() => (showMobileNav = false)}
						aria-current={on ? 'page' : undefined}
						class="group flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors {on
							? 'bg-accent-soft text-accent-ink'
							: 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}"
					>
						<item.icon
							class="h-[18px] w-[18px] {on
								? 'text-accent'
								: 'text-stone-400 group-hover:text-stone-600'}"
						/>
						<span class="flex-1">{item.label}</span>
						{#if item.href === '/settings' && showUpdateDot}
							<span
								class="h-2 w-2 rounded-full bg-amber-500"
								aria-hidden="true"
								data-testid="update-dot"
							></span>
						{/if}
					</a>
				{/each}
			</nav>

			<!-- Signed-in user -->
			<div class="profile-dropdown-container relative border-t border-stone-200 p-3">
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-stone-100"
					onclick={() => (showProfileDropdown = !showProfileDropdown)}
					aria-haspopup="menu"
					aria-expanded={showProfileDropdown}
					aria-controls="profile-menu"
					aria-label={showUpdateDot ? 'Profile menu, update available' : 'Profile menu'}
					bind:this={profileTrigger}
				>
					<span
						class="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-[12px] font-semibold text-accent-ink"
						aria-hidden="true"
					>
						{initialsOf(displayName, userEmail)}
						{#if avatarSrc && failedAvatarSrc !== avatarSrc}
							<img
								src={avatarSrc}
								alt=""
								referrerpolicy="no-referrer"
								class="absolute inset-0 h-full w-full object-cover"
								onerror={() => (failedAvatarSrc = avatarSrc)}
							/>
						{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[13px] font-semibold text-stone-900"
							>{displayName?.trim() || userEmail}</span
						>
						{#if displayName?.trim()}
							<span class="block truncate text-[12px] text-stone-500">{userEmail}</span>
						{/if}
					</span>
					<ChevronsUpDown class="h-4 w-4 shrink-0 text-stone-400" />
				</button>

				{#if showProfileDropdown}
					<div
						id="profile-menu"
						class="absolute right-3 bottom-full left-3 z-50 mb-2 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.2)]"
						transition:fly={{ y: 5, duration: 150, opacity: 0 }}
						role="menu"
						aria-label="Profile"
						use:menuNav={{
							trigger: profileTrigger,
							onEscape: () => (showProfileDropdown = false)
						}}
					>
						{#if updateNotice.tag}
							<a
								href="/settings#instance"
								class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-stone-700 hover:bg-stone-100"
								onclick={() => {
									showProfileDropdown = false;
									markUpdateSeen();
								}}
								role="menuitem"
								data-testid="update-menu-item"
							>
								<span class="mx-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true"
								></span>
								{updateNotice.tag} is available
							</a>
						{/if}
						<a
							href="/account"
							class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-stone-700 hover:bg-stone-100"
							onclick={() => (showProfileDropdown = false)}
							role="menuitem"
						>
							<UserRound class="h-4 w-4 text-stone-400" /> Account
						</a>
						<a
							href="/settings"
							class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-stone-700 hover:bg-stone-100"
							onclick={() => (showProfileDropdown = false)}
							role="menuitem"
						>
							<Settings class="h-4 w-4 text-stone-400" /> Settings
						</a>
						<a
							href="{page.url.pathname}?onboarding=1"
							class="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-stone-700 hover:bg-stone-100"
							onclick={() => {
								showProfileDropdown = false;
								guideClosed = false;
							}}
							role="menuitem"
						>
							<Rocket class="h-4 w-4 text-stone-400" /> Setup guide
						</a>
						<div class="my-1 h-px bg-stone-100"></div>
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-stone-700 hover:bg-stone-100"
							onclick={logout}
							role="menuitem"
						>
							<LogOut class="h-4 w-4 text-stone-400" /> Sign out
						</button>
						{#if logoutError}
							<p class="px-3 pb-2 text-[11px] font-medium text-rose-600" data-testid="logout-error">
								{logoutError}
							</p>
						{/if}
					</div>
				{/if}
			</div>
		</aside>

		<!-- No z-index on <main>: a stacking context here would trap page
		     dialogs below the sidebar. -->
		<main
			id="main-content"
			tabindex="-1"
			class="relative min-h-dvh px-4 py-8 focus:outline-none sm:px-8 lg:ml-64 lg:px-10 lg:py-10"
		>
			<div class="mx-auto w-full max-w-6xl">
				{@render children()}
			</div>
		</main>
	</div>
{/if}
{#if composerOpen && userEmail && !isShareRoute}
	<ComposerModal data={composerData} onClose={() => void closeComposer()} />
{/if}
{#if guideOpen}
	<OnboardingModal
		initial={data.onboarding && !data.onboarding.done ? data.onboarding : { step: 1, done: true }}
		isOwner={Boolean(data.isOwner)}
		onClose={() => void closeGuide()}
		onFinish={(target) => void finishGuide(target)}
	/>
{/if}
<Toast />
