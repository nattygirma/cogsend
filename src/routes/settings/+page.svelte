<script lang="ts">
	import { formatDistanceToNow } from 'date-fns';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Check, Copy } from '@lucide/svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import AccountAvatar from '#lib/components/AccountAvatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import UpdatePanel from '#lib/components/UpdatePanel.svelte';
	import { markUpdateSeen, noteRelease } from '#lib/components/update-notice.svelte.js';
	import { humanizeError } from '#lib/domain/human-error.js';
	import { sessionExpiredIfUnauthorized } from '#lib/components/session-expired.js';
	import {
		accountLabel,
		displayHandle,
		platformName,
		platformRank
	} from '#lib/domain/platforms.js';
	import { INSTANCE_NAME_MAX } from '#lib/domain/instance-name.js';
	import { tickAdvice, type TickAdvice } from '#lib/domain/scheduler-status.js';

	let { data } = $props();
	let msg = $state<string | null>(null);
	let err = $state<string | null>(null);
	let prefAccounts = $state<string[]>([]);
	let allAccounts = $state<
		{
			id: string;
			platform: string;
			handle: string | null;
			displayName: string | null;
			avatarUrl: string | null;
		}[]
	>([]);
	let prefSaved = $state<string | null>(null);
	let prefBusy = $state(false);
	// svelte-ignore state_referenced_locally
	let instanceName = $state(data.appName ?? '');
	// svelte-ignore state_referenced_locally
	let savedInstanceName = $state((data.appName ?? '').trim());
	let instanceBusy = $state(false);
	let offerPrereleases = $state(false);
	let schedulerMessage = $state<string | null>(null);
	// Scheduled publishing: what the last deploy did with the cron trigger, when
	// the scheduler last ticked, and the token an external cron can use.
	type TickHealth = {
		ok: boolean;
		lastTickAt: string | null;
		neverTicked: boolean;
		overdue: number;
		stuckPublishing: number;
		deployCron: { status: 'attached' | 'disabled' | 'unavailable'; code: string | null } | null;
	};
	let tickHealth = $state<TickHealth | null>(null);
	type TickTokenMeta = { configured: boolean; prefix: string | null; createdAt: string | null };
	let tickToken = $state<TickTokenMeta | null>(null);
	let tickTokenRevealed = $state<string | null>(null);
	let tickTokenCopied = $state(false);
	let tickTokenBusy = $state(false);
	let tickConfirm: 'rotate' | 'revoke' | null = $state(null);
	let tickTestBusy = $state(false);
	let tickTestMessage = $state<string | null>(null);
	// The update check: a courtesy, so a failure is one quiet line saying why,
	// since installing by tag below still works without it.
	type ReleaseCheck = {
		current: string;
		latest: { tag: string; version: string; url: string } | null;
		updateAvailable: boolean;
		checkedAt: string | null;
		error?: string;
		/** Updates come from the host (appkeep, or a redeploy), not from here. */
		disabled?: boolean;
	};
	let release = $state<ReleaseCheck | null>(null);
	// Seeing the notice here is what clears the header's dot.
	$effect(() => {
		if (!release) return;
		noteRelease(release);
		if (release.updateAvailable) markUpdateSeen();
	});
	let releaseBusy = $state(false);
	let tickOrigin = $state('');
	const tickUrl = $derived(tickOrigin ? `${tickOrigin}/api/internal/tick` : '/api/internal/tick');
	const tickStatusLine = $derived.by(() => {
		const h = tickHealth;
		if (!h) return 'Checking…';
		if (h.stuckPublishing) {
			return `${h.stuckPublishing} post${h.stuckPublishing === 1 ? '' : 's'} stuck publishing`;
		}
		const detail = h.overdue > 0 ? ` · ${h.overdue} post${h.overdue === 1 ? '' : 's'} due now` : '';
		if (!h.lastTickAt) return `No tick yet${detail}`;
		return `Last tick ${tickDate(h.lastTickAt)}${detail}`;
	});
	const tickState = $derived<TickAdvice>(
		tickAdvice(
			{
				ok: tickHealth?.ok ?? false,
				lastTickAt: tickHealth?.lastTickAt ? new Date(tickHealth.lastTickAt) : null,
				stuckPublishing: tickHealth?.stuckPublishing ?? 0
			},
			tickHealth?.deployCron ? { ...tickHealth.deployCron, updatedAt: null } : null
		)
	);
	const sections = $derived([
		{ id: 'defaults', label: 'Posting defaults' },
		{ id: 'api-access', label: 'API & MCP' },
		...(data.isOwner
			? [
					{ id: 'scheduler', label: 'Scheduled publishing' },
					{ id: 'instance', label: 'Workspace' }
				]
			: [])
	]);
	type KeyMeta = {
		prefix: string;
		createdAt: string;
		lastUsedAt: string | null;
		scopes?: string[] | null;
	};
	let keyActive = $state<KeyMeta | null>(null);
	let keyScopes = $state<'read' | 'read-write'>('read-write');
	let keyLoading = $state(true);
	// The stored key status actually arrived: without it a failed fetch would
	// render "No active key" and invite a rotation that was never needed.
	let keyLoaded = $state(false);
	let keyBusy = $state(false);
	let keyRevealed = $state<string | null>(null);
	let keyCopied = $state(false);
	let keyConfirm: 'rotate' | 'revoke' | null = $state(null);
	let keyJustRotated = $state(false);
	let mcpCopied = $state<string | null>(null);
	let mcpCopiedTimer: ReturnType<typeof setTimeout> | null = null;
	let mcpClient = $state<'claude' | 'codex'>('claude');
	const mcpUrl = $derived(tickOrigin ? `${tickOrigin}/api/mcp` : '/api/mcp');
	const claudeMcpConfig = $derived(
		JSON.stringify(
			{
				mcpServers: {
					posteasy: {
						type: 'http',
						url: mcpUrl,
						headers: { Authorization: 'Bearer ${POSTEASY_API_KEY}' }
					}
				}
			},
			null,
			2
		)
	);
	const codexMcpConfig = $derived(
		[
			'[mcp_servers.posteasy]',
			`url = "${mcpUrl}"`,
			'bearer_token_env_var = "POSTEASY_API_KEY"',
			'default_tools_approval_mode = "prompt"'
		].join('\n')
	);
	const mcpClients = $derived([
		{
			id: 'claude' as const,
			label: 'Claude Code',
			file: '.mcp.json',
			what: 'config',
			text: claudeMcpConfig
		},
		{
			id: 'codex' as const,
			label: 'OpenAI Codex',
			file: '~/.codex/config.toml',
			what: 'config',
			text: codexMcpConfig
		}
	]);
	// The form stays disabled until the first load resolves: applying slow
	// fetch results over user edits (and then saving them) would silently
	// reset their choices. `prefsLoaded` separates "the request finished" from
	// "the stored values arrived", so a failed load cannot leave the form
	// editing — and saving — the compile-time defaults.
	let prefsLoading = $state(true);
	let prefsLoaded = $state(false);
	// Client-only preference, mirrored with the editor via localStorage.
	const SKIP_ASK_KEY = 'posteasy-skip-publish-confirm';
	let askPublish = $state(true);

	let loadGen = 0;

	async function load() {
		const gen = ++loadGen;
		if (!prefsLoaded) prefsLoading = true;
		if (!keyLoaded) keyLoading = true;
		err = null;
		let settingsOk = true;
		let keyOk = true;
		const settled = { settings: false, key: false };
		const finish = (which: keyof typeof settled) => {
			if (gen !== loadGen) return;
			settled[which] = true;
			if (which === 'settings') prefsLoading = false;
			if (which === 'key') keyLoading = false;
			if (settled.settings && settled.key && (!settingsOk || !keyOk)) {
				err = 'Could not load your settings';
			}
		};
		// Each block paints from its own response. The profile card does not
		// wait on the release check or the scheduler.
		const track = (
			input: Promise<Response>,
			apply: (res: Response) => Promise<void>,
			which?: keyof typeof settled
		) => {
			void input
				.then(async (res) => {
					if (gen !== loadGen) return;
					if (sessionExpiredIfUnauthorized(res)) {
						err = 'Your session expired — sign in again';
						prefsLoading = false;
						keyLoading = false;
						return;
					}
					try {
						await apply(res);
					} finally {
						if (which) finish(which);
					}
				})
				.catch(() => {
					if (gen !== loadGen) return;
					err = humanizeError('fetch failed');
					if (which) finish(which);
				});
		};
		track(
			fetch('/api/settings'),
			async (res) => {
				settingsOk = res.ok;
				if (res.ok) {
					const s = await res.json();
					if (gen !== loadGen) return;
					// Don't clobber an instance name the user already edited.
					if (instanceName.trim() === savedInstanceName) {
						instanceName = s.instanceName ?? '';
						savedInstanceName = instanceName.trim();
					}
					offerPrereleases = s.offerPrereleases === true;
					if (!prefsLoaded) {
						prefAccounts = s.settings?.defaultAccountIds ?? [];
					}
					prefsLoaded = true;
				}
			},
			'settings'
		);
		track(fetch('/api/connections'), async (res) => {
			if (!res.ok || gen !== loadGen) return;
			const c = await res.json();
			if (gen !== loadGen) return;
			allAccounts = [...(c.connections || [])].sort(
				(a, b) => platformRank(a.platform) - platformRank(b.platform)
			);
		});
		track(
			fetch('/api/key'),
			async (res) => {
				keyOk = res.ok;
				if (res.ok) {
					const k = await res.json();
					if (gen !== loadGen) return;
					keyActive = k.active;
					keyLoaded = true;
				}
			},
			'key'
		);
		track(fetch('/api/scheduler/health'), async (res) => {
			if (!res.ok || gen !== loadGen) return;
			const h = await res.json();
			if (gen !== loadGen) return;
			schedulerMessage = h.message ?? null;
			tickHealth = {
				ok: Boolean(h.ok),
				lastTickAt: h.lastTickAt ?? null,
				neverTicked: Boolean(h.neverTicked),
				overdue: h.overdue ?? 0,
				stuckPublishing: h.stuckPublishing ?? 0,
				deployCron: h.deployCron ?? null
			};
		});
		track(fetch('/api/scheduler/tick-token'), async (res) => {
			if (!res.ok || gen !== loadGen) return;
			if (gen !== loadGen) return;
			tickToken = await res.json();
		});
		track(fetch('/api/release'), async (res) => {
			if (!res.ok || gen !== loadGen) return;
			if (gen !== loadGen) return;
			release = await res.json();
		});
	}

	/** Same rules as the server, so a typo never costs the user their other edits. */
	async function saveInstanceName(e: Event) {
		e.preventDefault();
		const name = instanceName.trim();
		if (name.length > INSTANCE_NAME_MAX) {
			err = `Keep the instance name under ${INSTANCE_NAME_MAX} characters`;
			return;
		}
		instanceBusy = true;
		err = null;
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instanceName: name })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not save');
			instanceName = payload.instanceName ?? name;
			savedInstanceName = instanceName.trim();
			msg = 'Instance name saved';
			// The title and header come from the layout, which reads the stored
			// name: refresh them without a full reload.
			await invalidateAll();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not save');
		} finally {
			instanceBusy = false;
		}
	}

	async function savePrefs(e: Event) {
		e.preventDefault();
		prefBusy = true;
		err = null;
		prefSaved = null;
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					defaultAccountIds: prefAccounts
				})
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Could not save');
			prefSaved = 'Defaults saved';
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not save');
		} finally {
			prefBusy = false;
		}
	}

	function togglePrefAccount(id: string) {
		prefAccounts = prefAccounts.includes(id)
			? prefAccounts.filter((a) => a !== id)
			: [...prefAccounts, id];
	}

	async function rotateKey() {
		keyBusy = true;
		err = null;
		try {
			const res = await fetch('/api/key', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ scopes: keyScopes === 'read' ? ['read'] : ['read', 'write'] })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Could not create key');
			// The raw key exists only in this response — show it once.
			keyRevealed = payload.key;
			keyCopied = false;
			keyJustRotated = Boolean(keyActive);
			keyConfirm = null;
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not create key');
		} finally {
			keyBusy = false;
		}
	}

	async function revokeKey() {
		keyBusy = true;
		err = null;
		try {
			const res = await fetch('/api/key', { method: 'DELETE' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not revoke key');
			keyConfirm = null;
			keyRevealed = null;
			msg = 'API key revoked';
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not revoke key');
		} finally {
			keyBusy = false;
		}
	}

	async function copyKey() {
		if (!keyRevealed) return;
		try {
			await navigator.clipboard.writeText(keyRevealed);
			keyCopied = true;
		} catch {
			err = 'Copy failed — select the key manually';
		}
	}

	function dismissRevealed() {
		// Deliberately one-way: once dismissed the raw key is unrecoverable.
		keyRevealed = null;
		keyCopied = false;
		keyJustRotated = false;
	}

	async function copyMcpExample(name: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			mcpCopied = name;
			if (mcpCopiedTimer) clearTimeout(mcpCopiedTimer);
			mcpCopiedTimer = setTimeout(() => (mcpCopied = null), 2000);
		} catch {
			err = 'Could not copy the example — select and copy it instead.';
		}
	}

	function mcpTabKey(event: KeyboardEvent) {
		const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const at = mcpClients.findIndex((client) => client.id === mcpClient);
		mcpClient = mcpClients[(at + step + mcpClients.length) % mcpClients.length].id;
		document.getElementById(`mcp-tab-${mcpClient}`)?.focus();
	}

	function keyDate(iso: string | null): string {
		if (!iso) return 'never';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? 'never' : formatDistanceToNow(d, { addSuffix: true });
	}

	function tickDate(iso: string | null): string {
		if (!iso) return 'never';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? 'never' : formatDistanceToNow(d, { addSuffix: true });
	}

	async function generateTickToken() {
		tickTokenBusy = true;
		err = null;
		try {
			const res = await fetch('/api/scheduler/tick-token', { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Could not create a tick token');
			tickTokenRevealed = payload.token;
			tickTokenCopied = false;
			tickConfirm = null;
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not create a tick token');
		} finally {
			tickTokenBusy = false;
		}
	}

	async function revokeTickToken() {
		tickTokenBusy = true;
		err = null;
		try {
			const res = await fetch('/api/scheduler/tick-token', { method: 'DELETE' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not revoke the tick token');
			tickConfirm = null;
			tickTokenRevealed = null;
			msg = 'Tick token revoked';
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not revoke the tick token');
		} finally {
			tickTokenBusy = false;
		}
	}

	async function copyTickValue(value: string, which: 'token' | 'url') {
		try {
			await navigator.clipboard.writeText(value);
			if (which === 'token') tickTokenCopied = true;
			else msg = 'Tick URL copied';
		} catch {
			err = 'Copy failed — select the text manually';
		}
	}

	async function saveOfferPrereleases(on: boolean) {
		err = null;
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ offerPrereleases: on })
			});
			if (!res.ok) throw new Error();
			// Which releases count changed: ask again rather than wait for the cache.
			await checkForUpdates();
		} catch {
			offerPrereleases = !on;
			err = 'Could not save the pre-release setting';
		}
	}

	async function checkForUpdates() {
		releaseBusy = true;
		try {
			const res = await fetch('/api/release?refresh=1');
			if (res.ok) release = await res.json();
		} catch {
			// Silent: the update check is a courtesy, not a setting.
		} finally {
			releaseBusy = false;
		}
	}

	async function testTick() {
		tickTestBusy = true;
		tickTestMessage = null;
		err = null;
		try {
			const res = await fetch('/api/scheduler/test', { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'The tick failed');
			// The tick stops at the first post that might not fit this request's
			// Cloudflare call limit; the rest stay due.
			const later = payload.deferred > 0 ? ' The rest go out on the next tick.' : '';
			tickTestMessage =
				payload.processed === 0 && !later
					? 'Tick ran: nothing was due.'
					: `Tick ran: ${payload.processed} post${payload.processed === 1 ? '' : 's'} handled.${later}`;
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'The tick failed');
		} finally {
			tickTestBusy = false;
		}
	}

	onMount(() => {
		tickOrigin = window.location.origin;
		void load();
		try {
			askPublish = localStorage.getItem(SKIP_ASK_KEY) !== '1';
		} catch {
			// storage unavailable: default holds
		}
	});

	function setAskPublish(on: boolean) {
		askPublish = on;
		try {
			if (on) localStorage.removeItem(SKIP_ASK_KEY);
			else localStorage.setItem(SKIP_ASK_KEY, '1');
		} catch {
			// prefs are cosmetic
		}
	}
</script>

<PageHeader
	eyebrow="Workspace"
	title="Settings"
	subtitle="Posting defaults, API access and how this workspace runs. Your name, email and password live on your Account page."
>
	{#snippet actions()}
		<a href="/account" class="btn btn-secondary">Account settings</a>
	{/snippet}
</PageHeader>

<div class="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
	<nav aria-label="Settings sections" class="hidden lg:block">
		<ul class="sticky top-10 space-y-0.5 text-[13px] font-medium">
			{#each sections as section (section.id)}
				<li>
					<a
						href={`#${section.id}`}
						class="block rounded-lg px-3 py-2 text-stone-600 transition-colors hover:bg-white hover:text-stone-900"
						>{section.label}</a
					>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="min-w-0">
		{#if msg || err}
			<div
				class="mb-6 rounded-xl px-3 py-2 text-sm {err
					? 'bg-red-50 text-red-700'
					: 'bg-emerald-50 text-emerald-800'}"
				role="alert"
			>
				{err || msg}
			</div>
		{/if}

		<div class="grid gap-6">
			<section id="defaults" class="card scroll-mt-24 p-6 sm:p-7">
				<h2 class="mb-1.5 text-[16px] font-semibold tracking-tight text-stone-900">
					New post defaults
				</h2>
				<p class="mb-6 text-[13px] font-medium text-stone-500">
					Applied to new drafts. Deep-linked drafts keep their own accounts.
				</p>
				<form class="space-y-6" onsubmit={savePrefs}>
					<div class="space-y-2" role="group" aria-labelledby="preselected-label">
						<span
							id="preselected-label"
							class="block text-[11px] font-bold tracking-widest text-stone-500 uppercase"
						>
							Preselected accounts <span class="tracking-normal text-stone-500 normal-case"
								>(empty = all active)</span
							>
						</span>
						<div class="flex flex-col gap-1 pt-1">
							{#each allAccounts as a (a.id)}
								{@const isOn = prefAccounts.includes(a.id)}
								<button
									type="button"
									onclick={() => togglePrefAccount(a.id)}
									disabled={prefsLoading || !prefsLoaded}
									aria-pressed={isOn}
									class="group flex w-full items-center justify-between rounded-xl border border-transparent p-2 text-left transition-colors hover:border-stone-100 hover:bg-stone-50 disabled:opacity-50"
								>
									<div class="flex items-center gap-3 overflow-hidden">
										<div class="shrink-0 transition-transform group-hover:scale-105">
											<AccountAvatar
												platform={a.platform}
												handle={a.handle}
												displayName={a.displayName}
												avatarUrl={a.avatarUrl}
												size={32}
												selected={false}
												title={accountLabel(a.displayName, a.handle) || undefined}
											/>
										</div>
										<div class="flex flex-col overflow-hidden">
											<span class="truncate text-[13px] font-bold text-stone-900"
												>{a.displayName || displayHandle(a.handle) || 'account'}</span
											>
											<span class="truncate text-[11px] font-medium text-stone-500"
												>{platformName(a.platform)}</span
											>
										</div>
									</div>
									<div class="ml-2 shrink-0">
										<!-- Visual Switch -->
										<div
											class="relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {isOn
												? 'bg-stone-900'
												: 'bg-stone-200'}"
										>
											<span
												class="inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {isOn
													? 'translate-x-4'
													: 'translate-x-0'}"
											></span>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>

					<div class="pt-2">
						<!-- Container click is mouse-only convenience; keyboard users toggle via the switch button. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="flex cursor-pointer items-center gap-3"
							onclick={() => setAskPublish(!askPublish)}
						>
							<button
								type="button"
								role="switch"
								aria-checked={askPublish}
								aria-labelledby="ask-publish-label"
								onclick={(e) => {
									e.stopPropagation();
									setAskPublish(!askPublish);
								}}
								class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {askPublish
									? 'bg-stone-900'
									: 'bg-stone-200'}"
							>
								<span
									class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {askPublish
										? 'translate-x-4'
										: 'translate-x-0'}"
								></span>
							</button>
							<span id="ask-publish-label" class="text-[13px] font-medium text-stone-600"
								>Ask for confirmation before publishing</span
							>
						</div>
					</div>

					<div class="flex items-center gap-3 border-t border-stone-100 pt-4">
						{#if !prefsLoading && !prefsLoaded}
							<button
								type="button"
								onclick={() => void load()}
								class="rounded-full border border-stone-300 px-6 py-2.5 text-[13px] font-bold text-stone-700 transition-colors hover:bg-stone-100"
								>Retry</button
							>
						{:else}
							<button
								type="submit"
								disabled={prefBusy || prefsLoading || !prefsLoaded}
								class="btn btn-primary">{prefsLoading ? 'Loading…' : 'Save defaults'}</button
							>
						{/if}
						{#if prefSaved}
							<span class="text-[13px] font-bold text-emerald-700">{prefSaved}</span>
						{/if}
					</div>
				</form>
			</section>

			<section
				id="api-access"
				class="card min-w-0 scroll-mt-24 p-6 sm:p-7"
				aria-label="API access"
				data-testid="api-key-section"
			>
				<h2 class="mb-1.5 text-[16px] font-semibold tracking-tight text-stone-900">API access</h2>
				<p class="mb-6 max-w-md text-[13px] leading-relaxed font-medium text-stone-500">
					Use this personal API key for scripts, Shortcuts, and cron jobs. Choose whether it can
					only read or also change and publish drafts. For security, it cannot manage social
					accounts, change credentials, or generate new API keys. See the
					<a
						href="/api"
						class="font-bold text-stone-900 underline underline-offset-2 hover:text-stone-700"
						>API reference</a
					> for full details.
				</p>
				<fieldset class="mb-5 space-y-2" data-testid="api-key-scopes">
					<legend class="mb-2 text-[12px] font-bold text-stone-700">New key permissions</legend>
					<label class="flex cursor-pointer items-start gap-2 text-[13px] text-stone-700">
						<input type="radio" name="api-key-scopes" value="read" bind:group={keyScopes} />
						<span><strong>Read-only</strong> — view connections, drafts, and queue.</span>
					</label>
					<label class="flex cursor-pointer items-start gap-2 text-[13px] text-stone-700">
						<input type="radio" name="api-key-scopes" value="read-write" bind:group={keyScopes} />
						<span
							><strong>Read + write</strong> — manage drafts and publish; includes read. (Default)</span
						>
					</label>
				</fieldset>
				{#if keyLoading}
					<p class="text-sm font-medium text-stone-500">Loading…</p>
				{:else if keyRevealed}
					<div class="space-y-4" data-testid="api-key-reveal">
						<div class="rounded-xl border border-amber-200/50 bg-amber-50/50 p-4">
							<p class="text-[13px] font-bold text-amber-900">
								{#if keyJustRotated}New key — the old one stopped working.{:else}New key generated.{/if}
							</p>
							<p class="mt-1 text-[13px] font-medium text-amber-700">
								Copy it now: it is never shown again.
							</p>
						</div>
						<code
							class="block rounded-xl border border-stone-200/80 bg-stone-50 px-4 py-3 font-mono text-[13px] break-all text-stone-900 shadow-sm select-all"
							data-testid="api-key-value">{keyRevealed}</code
						>
						<div class="flex flex-wrap items-center gap-2 pt-2">
							<button type="button" onclick={copyKey} class="btn btn-primary">
								{keyCopied ? 'Copied' : 'Copy key'}
							</button>
							<button
								type="button"
								onclick={dismissRevealed}
								class="rounded-full bg-stone-100 px-6 py-2.5 text-[13px] font-bold text-stone-700 transition-all hover:bg-stone-200"
							>
								I have saved it
							</button>
						</div>
					</div>
				{:else if keyActive}
					<div
						class="mb-5 flex flex-col justify-between gap-4 rounded-xl border border-stone-200/80 bg-stone-50/50 p-4 sm:flex-row sm:items-center"
						data-testid="api-key-status"
					>
						<div>
							<p class="flex items-center gap-2 text-[13px] font-extrabold text-stone-900">
								Active key
								<code
									class="rounded bg-emerald-100/50 px-1.5 py-0.5 font-mono text-[12px] text-emerald-700"
								>
									{keyActive.prefix}…
								</code>
							</p>
							<p class="mt-1 text-[11px] font-medium text-stone-500">
								Created {keyDate(keyActive.createdAt)} · Last used {keyDate(keyActive.lastUsedAt)}
							</p>
							<p class="mt-1 text-[11px] font-medium text-stone-500">
								Scope: {(keyActive.scopes ?? ['read', 'write']).includes('write')
									? 'Read + write'
									: 'Read-only'}
							</p>
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							onclick={() => (keyConfirm = 'rotate')}
							disabled={keyBusy}
							class="rounded-full bg-stone-100 px-6 py-2.5 text-[13px] font-bold text-stone-700 transition-all hover:bg-stone-200 disabled:opacity-50"
						>
							Generate replacement
						</button>
						<button
							type="button"
							onclick={() => (keyConfirm = 'revoke')}
							disabled={keyBusy}
							class="rounded-full bg-red-50 px-6 py-2.5 text-[13px] font-bold text-red-600 transition-all hover:bg-red-100 disabled:opacity-50"
						>
							Revoke
						</button>
					</div>
				{:else if !keyLoaded}
					<div class="rounded-xl border border-stone-200/80 bg-stone-50/50 p-4">
						<p class="text-[13px] font-medium text-stone-500">
							Could not load your API key status.
						</p>
					</div>
					<button
						type="button"
						onclick={() => void load()}
						class="rounded-full border border-stone-300 px-6 py-2.5 text-[13px] font-bold text-stone-700 transition-colors hover:bg-stone-100"
						>Retry</button
					>
				{:else}
					<div
						class="mb-5 rounded-xl border border-stone-200/80 bg-stone-50/50 p-4"
						data-testid="api-key-status"
					>
						<p class="text-[13px] font-medium text-stone-500">
							No active key. Generate one to call the API without logging in.
						</p>
					</div>
					<button
						type="button"
						onclick={() => (keyConfirm = 'rotate')}
						disabled={keyBusy}
						class="btn btn-primary"
					>
						Generate API key
					</button>
				{/if}

				<section class="mt-8 min-w-0 border-t border-stone-200/80 pt-7" data-testid="mcp-setup">
					<h3 class="text-[15px] font-extrabold tracking-tight text-stone-900">
						Connect an MCP client
					</h3>
					<p class="mt-2 max-w-prose text-[13px] leading-relaxed font-medium text-stone-500">
						PostEasy's stateless Streamable HTTP server lets coding agents work with drafts and
						publishing. Use an active personal API key; the endpoint does not use your browser
						session.
					</p>

					<div
						class="mt-4 flex items-center gap-3 rounded-xl border border-stone-200/80 bg-stone-50 py-1 pr-1 pl-3"
					>
						<span class="shrink-0 text-[12px] font-bold text-stone-500">Endpoint</span>
						<code
							class="min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto font-mono text-[12px] whitespace-nowrap text-stone-900 select-all"
							data-testid="mcp-endpoint">{mcpUrl}</code
						>
						<CopyButton value={mcpUrl} ariaLabel="Copy the MCP endpoint URL" />
					</div>

					<div class="mt-6 min-w-0">
						<div
							role="tablist"
							aria-label="MCP client"
							class="grid grid-cols-2 gap-1 rounded-full bg-stone-100 p-1 sm:inline-grid"
						>
							{#each mcpClients as client (client.id)}
								<button
									type="button"
									role="tab"
									id="mcp-tab-{client.id}"
									aria-selected={mcpClient === client.id}
									aria-controls="mcp-panel-{client.id}"
									tabindex={mcpClient === client.id ? 0 : -1}
									onclick={() => (mcpClient = client.id)}
									onkeydown={mcpTabKey}
									class="rounded-full px-1.5 py-1.5 text-[11px] font-bold whitespace-nowrap transition-colors sm:px-4 sm:text-[12px] {mcpClient ===
									client.id
										? 'bg-white text-stone-900 shadow-sm'
										: 'text-stone-500 hover:text-stone-900'}"
								>
									{client.label}
								</button>
							{/each}
						</div>

						{#each mcpClients as client (client.id)}
							<div
								role="tabpanel"
								id="mcp-panel-{client.id}"
								aria-labelledby="mcp-tab-{client.id}"
								hidden={mcpClient !== client.id}
								class="mt-3"
							>
								<div class="overflow-hidden rounded-xl bg-stone-950">
									<div
										class="flex items-center justify-between gap-3 border-b border-white/10 py-1.5 pr-1.5 pl-4"
									>
										<span class="truncate font-mono text-[11px] text-stone-400">{client.file}</span>
										<button
											type="button"
											onclick={() => copyMcpExample(client.id, client.text)}
											aria-label="Copy the {client.label} {client.what}"
											class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
										>
											{#if mcpCopied === client.id}
												<Check class="h-3.5 w-3.5 text-emerald-400" /> Copied
											{:else}
												<Copy class="h-3.5 w-3.5" /> Copy
											{/if}
										</button>
									</div>
									<pre
										class="overflow-x-auto p-4 text-[12px] leading-relaxed text-stone-100 [color-scheme:dark]"><code
											>{client.text}</code
										></pre>
								</div>
								<p class="mt-2.5 max-w-prose text-[12px] leading-relaxed text-stone-500">
									{#if client.id === 'claude'}
										Add this to <code class="font-mono text-stone-900">.mcp.json</code>. Claude Code
										expands the environment variable in remote HTTP headers. Set
										<code class="font-mono text-stone-900">POSTEASY_API_KEY</code> securely in the environment
										before starting Claude Code; never put its value in this file.
									{:else if client.id === 'codex'}
										Add this to <code class="font-mono text-stone-900">~/.codex/config.toml</code>.
										Codex reads the bearer value from the named environment variable. The prompt
										approval mode asks before tool calls.
									{/if}
								</p>
							</div>
						{/each}
					</div>

					<p class="mt-5 max-w-prose text-[12px] leading-relaxed text-stone-500">
						Give an agent a Read-only key unless it needs to change drafts or publish, and have your
						client ask before it publishes. Tools, scopes and Cloudflare Access headers are in the
						<a href="/api#mcp-server-heading" class="font-bold text-stone-900 underline"
							>API reference</a
						>.
					</p>
				</section>
			</section>

			{#if data.isOwner}
				<section
					id="scheduler"
					class="card scroll-mt-24 p-6 sm:p-7"
					aria-label="Scheduled publishing"
					data-testid="scheduler-section"
				>
					<h2 class="mb-1.5 text-[16px] font-semibold tracking-tight text-stone-900">
						Scheduled publishing
					</h2>
					<p class="mb-6 max-w-md text-[13px] leading-relaxed font-medium text-stone-500">
						Posts whose time has come are published by a <em>tick</em>. The Worker's own cron
						trigger does that every minute and needs nothing from you; an external cron — any
						service that can send one POST per minute — does the same thing, which is useful when
						the account has no cron trigger left (the free plan allows five per account).
					</p>

					<div
						class="mb-5 flex flex-col justify-between gap-3 rounded-xl border border-stone-200/80 bg-stone-50/50 p-4 sm:flex-row sm:items-center"
						data-testid="scheduler-status"
					>
						<div>
							<p
								class="text-[13px] font-extrabold text-stone-900"
								data-testid="scheduler-status-line"
							>
								{tickStatusLine}
							</p>
							{#if schedulerMessage}
								<p class="mt-1 text-[11px] font-medium text-stone-500">{schedulerMessage}</p>
							{/if}
						</div>
						<button
							type="button"
							onclick={() => void testTick()}
							disabled={tickTestBusy}
							class="shrink-0 rounded-full bg-stone-100 px-5 py-2 text-[13px] font-bold text-stone-700 transition-all hover:bg-stone-200 disabled:opacity-50"
						>
							{tickTestBusy ? 'Ticking…' : 'Tick now'}
						</button>
					</div>
					{#if tickTestMessage}
						<p class="mb-5 text-[12px] font-medium text-emerald-700" role="status">
							{tickTestMessage}
						</p>
					{/if}

					{#if tickState.level !== 'ok'}
						<div
							class="mb-5 rounded-xl border p-4 text-[13px] leading-relaxed font-medium {tickState.level ===
							'warn'
								? 'border-amber-200/60 bg-amber-50/60 text-amber-900'
								: 'border-stone-200/80 bg-stone-50/50 text-stone-600'}"
							data-testid="scheduler-advice"
						>
							{tickState.message}
						</div>
					{/if}

					{#if tickTokenRevealed}
						<div class="space-y-4" data-testid="tick-token-reveal">
							<div class="rounded-xl border border-amber-200/50 bg-amber-50/50 p-4">
								<p class="text-[13px] font-bold text-amber-900">New tick token</p>
								<p class="mt-1 text-[13px] font-medium text-amber-700">
									Paste it into your cron service now: it is never shown again.
								</p>
							</div>
							<code
								class="block rounded-xl border border-stone-200/80 bg-stone-50 px-4 py-3 font-mono text-[13px] break-all text-stone-900 shadow-sm select-all"
								data-testid="tick-token-value">{tickTokenRevealed}</code
							>
							<div class="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onclick={() => void copyTickValue(tickTokenRevealed ?? '', 'token')}
									class="btn btn-primary">{tickTokenCopied ? 'Copied' : 'Copy token'}</button
								>
								<button
									type="button"
									onclick={() => {
										tickTokenRevealed = null;
										tickTokenCopied = false;
									}}
									class="rounded-full bg-stone-100 px-6 py-2.5 text-[13px] font-bold text-stone-700 transition-all hover:bg-stone-200"
									>I have saved it</button
								>
							</div>
						</div>
					{:else}
						<div
							class="mb-5 rounded-xl border border-stone-200/80 bg-stone-50/50 p-4"
							data-testid="tick-token-status"
						>
							{#if tickToken?.configured}
								<p
									class="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-stone-900"
								>
									Tick token
									<code
										class="rounded bg-emerald-100/50 px-1.5 py-0.5 font-mono text-[12px] text-emerald-700"
									>
										{tickToken.prefix}…
									</code>
								</p>
								<p class="mt-1 text-[11px] font-medium text-stone-500">
									Created {keyDate(tickToken.createdAt)} · shown once when generated
								</p>
							{:else}
								<p class="text-[13px] font-medium text-stone-500">
									No tick token. Generate one to let an external cron publish scheduled posts.
								</p>
							{/if}
						</div>
						<div class="flex flex-wrap gap-2">
							{#if tickToken?.configured}
								<button
									type="button"
									onclick={() => (tickConfirm = 'rotate')}
									disabled={tickTokenBusy}
									class="rounded-full bg-stone-100 px-6 py-2.5 text-[13px] font-bold text-stone-700 transition-all hover:bg-stone-200 disabled:opacity-50"
								>
									Generate replacement
								</button>
								<button
									type="button"
									onclick={() => (tickConfirm = 'revoke')}
									disabled={tickTokenBusy}
									class="rounded-full bg-red-50 px-6 py-2.5 text-[13px] font-bold text-red-600 transition-all hover:bg-red-100 disabled:opacity-50"
								>
									Revoke
								</button>
							{:else}
								<button
									type="button"
									onclick={() => (tickConfirm = 'rotate')}
									disabled={tickTokenBusy}
									class="btn btn-primary"
									data-testid="tick-token-generate"
								>
									Generate tick token
								</button>
							{/if}
						</div>
					{/if}

					<details class="mt-6">
						<summary class="cursor-pointer text-[13px] font-bold text-stone-900">
							How to call the tick from another service
						</summary>
						<div class="mt-3 space-y-3 text-[13px] leading-relaxed font-medium text-stone-600">
							<p>Send a POST with the token as a bearer credential:</p>
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
								<code
									class="min-w-0 flex-1 rounded-xl border border-stone-200/80 bg-stone-50 px-4 py-2.5 font-mono text-[12px] break-all text-stone-900 select-all"
									data-testid="tick-url">{tickUrl}</code
								>
								<button
									type="button"
									onclick={() => void copyTickValue(tickUrl, 'url')}
									class="shrink-0 rounded-full bg-stone-100 px-5 py-2 text-[13px] font-bold text-stone-700 transition-all hover:bg-stone-200"
								>
									Copy URL
								</button>
							</div>
							<pre
								class="overflow-x-auto rounded-xl border border-stone-200/80 bg-stone-50 px-4 py-3 font-mono text-[12px] text-stone-900">curl -X POST {tickUrl} \
  -H "Authorization: Bearer &lt;tick token&gt;"</pre>
							<p>
								In cron-job.org: create a job, method <strong>POST</strong>, schedule every minute,
								and add the header <code>Authorization: Bearer &lt;tick token&gt;</code>.
								UptimeRobot's free plan can do the same every five minutes; the repository also
								ships a GitHub Actions workflow for it. Ticks are idempotent, so a slow or
								duplicated caller is harmless.
							</p>
						</div>
					</details>
				</section>

				<section id="instance" class="card scroll-mt-24 p-6 sm:p-7">
					<h2 class="mb-1.5 text-[16px] font-semibold tracking-tight text-stone-900">Instance</h2>
					<p class="mb-6 max-w-md text-[13px] leading-relaxed font-medium text-stone-500">
						Shown in the page title, the header and the login screen. Leave it empty for the
						default.
					</p>
					<form
						class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center"
						onsubmit={saveInstanceName}
					>
						<input
							type="text"
							bind:value={instanceName}
							maxlength={INSTANCE_NAME_MAX}
							placeholder="PostEasy"
							aria-label="Instance name"
							class="w-full flex-1 rounded-xl border border-stone-200/80 bg-stone-50 px-4 py-2.5 text-[13px] font-bold text-stone-900 focus:border-stone-400 focus:bg-white focus:outline-none pointer-coarse:text-base"
						/>
						<button
							type="submit"
							disabled={instanceBusy || instanceName.trim() === savedInstanceName}
							class="btn btn-primary w-full shrink-0 sm:w-auto">Save</button
						>
					</form>
					<p class="mb-2 text-[12px] font-medium text-stone-500">
						Version {__APP_VERSION__}{schedulerMessage ? ` · ${schedulerMessage}` : ''}
					</p>
					{#if release?.disabled}
						<p class="mb-5 text-[12px] font-medium text-stone-500" data-testid="updates-managed">
							Updates are installed by whoever hosts this PostEasy, so there is nothing to update
							here.
						</p>
					{:else}
						<p class="mb-5 text-[12px] font-medium text-stone-500" data-testid="version-line">
							{#if release?.updateAvailable && release.latest}
								<a
									href={release.latest.url}
									class="font-bold text-stone-900 underline underline-offset-2 hover:text-stone-700"
									>Version {release.latest.version} is available</a
								>
								<span class="text-stone-500">
									— you run {release.current}. Update from here below, or from a checkout (<a
										href="https://github.com/cogsend/cogsend/blob/main/docs/updates.md"
										class="font-bold text-stone-900 underline underline-offset-2 hover:text-stone-700"
										>Updating</a
									>)</span
								>
							{:else}
								<button
									type="button"
									onclick={() => void checkForUpdates()}
									disabled={releaseBusy}
									class="font-bold underline underline-offset-2 hover:text-stone-700 disabled:opacity-50"
									>Check for updates</button
								>
								{#if release?.checkedAt}
									<span class="text-stone-400"> · checked {tickDate(release.checkedAt)}</span>
								{/if}
								{#if release?.error && !release.latest}
									<span class="block text-stone-500" data-testid="release-check-error"
										>Could not reach GitHub to check ({release.error}). Try again later, or install
										a release by its tag below.</span
									>
								{/if}
							{/if}
						</p>
						<UpdatePanel
							latestTag={release?.updateAvailable ? (release.latest?.tag ?? null) : null}
						/>
						<label class="mt-4 flex items-start gap-2 text-[12px] font-medium text-stone-500">
							<input
								type="checkbox"
								bind:checked={offerPrereleases}
								onchange={() => void saveOfferPrereleases(offerPrereleases)}
								class="mt-0.5"
								data-testid="offer-prereleases"
							/>
							<span
								>Offer pre-releases too: release candidates, for testing a release before it is
								published. Not for an instance you rely on.</span
							>
						</label>
					{/if}
				</section>
			{/if}
		</div>
	</div>
</div>

<ConfirmDialog
	open={tickConfirm !== null}
	idPrefix="tick-token-dialog"
	title={tickConfirm === 'revoke' ? 'Revoke tick token?' : 'New tick token?'}
	body={tickConfirm === 'revoke'
		? 'An external cron using the current token stops publishing immediately.'
		: tickToken?.configured
			? 'The current token stops working immediately. The new one is shown once.'
			: 'The token is shown once. Copy it into your cron service before closing.'}
	confirmLabel={tickConfirm === 'revoke' ? 'Revoke' : 'Generate'}
	cancelLabel="Keep"
	tone={tickConfirm === 'revoke' ? 'danger' : 'primary'}
	busy={tickTokenBusy}
	onConfirm={() => void (tickConfirm === 'revoke' ? revokeTickToken() : generateTickToken())}
	onCancel={() => (tickConfirm = null)}
/>

<ConfirmDialog
	open={keyConfirm !== null}
	idPrefix="api-key-dialog"
	title={keyConfirm === 'revoke' ? 'Revoke API key?' : 'Generate API key?'}
	body={keyConfirm === 'revoke'
		? 'Scripts and automations using the current key stop working immediately.'
		: keyActive
			? 'Generating a replacement revokes the previous key immediately. The new key is shown once.'
			: 'The new key is shown once. Copy it before closing.'}
	confirmLabel={keyConfirm === 'revoke' ? 'Revoke' : 'Generate'}
	cancelLabel="Keep"
	tone={keyConfirm === 'revoke' ? 'danger' : 'primary'}
	busy={keyBusy}
	onConfirm={() => void (keyConfirm === 'revoke' ? revokeKey() : rotateKey())}
	onCancel={() => (keyConfirm = null)}
/>
