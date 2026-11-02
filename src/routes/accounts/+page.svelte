<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		ChevronDown,
		CircleCheck,
		ExternalLink,
		Link2,
		Plug,
		Plus,
		RefreshCw,
		Trash2,
		TriangleAlert,
		Wrench,
		X
	} from '@lucide/svelte';
	import { fade, fly } from 'svelte/transition';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import AccountAvatar from '#lib/components/AccountAvatar.svelte';
	import SocialIcon from '#lib/components/SocialIcon.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { platformColorClass } from '#lib/components/platform-color.js';
	import { accountLabel, displayHost, platformName, platformRank } from '#lib/domain/platforms.js';
	import { humanizeError } from '#lib/domain/human-error.js';
	import {
		PLATFORM_SETUP,
		callbackUri,
		emptyStateSentence,
		isOAuthPlatform,
		missingSecrets,
		needsSetup,
		oauthPlatformRecord,
		platformSecretNames,
		secretsPutCommandFor,
		secretLabel,
		setupGuideUrl,
		type OAuthPlatformId
	} from '#lib/domain/platform-setup.js';
	import { buildAgentPrompt } from '#lib/domain/agent-prompt.js';
	import { sessionExpiredIfUnauthorized } from '#lib/components/session-expired.js';
	import { dialogFocus } from '#lib/components/dialog-focus.js';
	import { ZERNIO_API_KEYS_URL } from '#lib/domain/zernio.js';
	import { zernioLink } from '#lib/domain/zernio-links.js';
	import { isPaidXSubscription } from '#lib/domain/x-limits.js';

	let { data } = $props();

	type Connection = {
		id: string;
		platform: string;
		handle: string | null;
		displayName: string | null;
		avatarUrl?: string | null;
		instanceUrl: string | null;
		status: string;
		metaJson?: {
			provider?: string;
			zernioProfileId?: string;
			maxCharacters?: number;
			xSubscription?: string;
			longPosts?: boolean;
		} | null;
	};
	type ZernioAccount = {
		id: string;
		platform: string;
		profileId: string;
		handle: string | null;
		displayName: string | null;
		avatarUrl: string | null;
		needsReconnection: boolean;
		imported: boolean;
	};
	const ZERNIO_PLATFORMS = ['x', 'threads', 'instagram', 'linkedin'] as const;
	const isZernioPlatform = (p: string): p is (typeof ZERNIO_PLATFORMS)[number] =>
		(ZERNIO_PLATFORMS as readonly string[]).includes(p);
	const viaZernio = (account: Connection) => account.metaJson?.provider === 'zernio';

	/** What the long-post line says decided it: the operator, or X's report. */
	function longPostSource(account: Connection): string {
		const meta = account.metaJson ?? {};
		if (typeof meta.longPosts === 'boolean') return 'set by you';
		if (!meta.xSubscription) return 'plan not checked yet';
		if (!isPaidXSubscription(meta.xSubscription)) return 'X reports no paid plan';
		const plan = meta.xSubscription === 'PremiumPlus' ? 'Premium+' : meta.xSubscription;
		return `X reports ${plan}`;
	}

	// Same order load() applies after a refresh, so the first paint matches it.
	// svelte-ignore state_referenced_locally
	let connections = $state<Connection[]>(
		[...(data.connections ?? [])].sort(
			(a: Connection, b: Connection) => platformRank(a.platform) - platformRank(b.platform)
		)
	);
	// svelte-ignore state_referenced_locally
	let configured = $state<Record<OAuthPlatformId, boolean>>(
		data.configured ?? oauthPlatformRecord(() => true)
	);
	// Per-secret presence from the API. The panel names the missing half of a
	// half-configured platform instead of repeating "no credentials yet" for a
	// client id that is already uploaded.
	// svelte-ignore state_referenced_locally
	let secretPresence = $state<Record<string, boolean>>(data.secrets ?? {});
	// Where each platform's app credentials come from: Worker secrets, or the
	// form in the setup panel. Only the form's own can be changed from here.
	// svelte-ignore state_referenced_locally
	let credentialSources = $state<Record<OAuthPlatformId, 'env' | 'app' | null>>(
		data.sources ?? oauthPlatformRecord(() => null)
	);
	// svelte-ignore state_referenced_locally
	let savedClientIds = $state<Record<OAuthPlatformId, string | null>>(
		data.savedClientIds ?? oauthPlatformRecord(() => null)
	);
	let appForm = $state<Record<string, string>>({});
	let appFormBusy = $state(false);
	let appFormError = $state<string | null>(null);
	let msg = $state<string | null>(null);
	// svelte-ignore state_referenced_locally
	let err = $state<string | null>(data.loadFailed ? 'Could not load accounts' : null);
	let loading = $state(false);
	// First-load flag: while true show skeleton rows instead of the
	// "No accounts yet" empty state (avoids flash on every visit).
	let initialLoading = $state(false);
	// Distinguishes "the list is empty" from "the list never arrived": the
	// former gets the connect prompt, the latter must not.
	// svelte-ignore state_referenced_locally
	let loadFailed = $state(Boolean(data.loadFailed));
	let verifying = $state<string | null>(null);
	let pendingDisconnect = $state<{ id: string; label: string } | null>(null);
	let disconnectBusy = $state(false);
	let showConnectDialog = $state(false);
	let modalForm = $state<'none' | 'zernio'>('none');
	// Set when the picked platform has no credentials on this deployment: the
	// dialog shows its setup steps instead of a request that can only fail.
	let setupPanel = $state<OAuthPlatformId | null>(null);
	// The deployment's own APP_URL, for the redirect URI the provider needs.
	// svelte-ignore state_referenced_locally
	let appUrl = $state(data.appUrl ?? '');
	let connectCloseBtn: HTMLButtonElement | null = $state(null);
	let zernioApiKey = $state('');
	let zernioProfiles = $state<Array<{ id: string; name: string }>>([]);
	let zernioAccounts = $state<ZernioAccount[] | null>(null);
	let zernioSelected = $state<string[]>([]);
	// svelte-ignore state_referenced_locally
	let zernioHasStoredKey = $state(connections.some(viaZernio));
	let zernioConnectPlatform = $state<(typeof ZERNIO_PLATFORMS)[number]>('x');
	let zernioConnectProfile = $state('');

	const availablePlatforms = [
		{
			id: 'x',
			name: 'X',
			description: 'Post with the X API (uses pay-per-use credits)',
			form: null
		},
		{
			id: 'threads',
			name: 'Threads',
			description: 'Connect your Threads account',
			form: null
		},
		{
			id: 'instagram',
			name: 'Instagram',
			description: 'Connect a Business or Creator account',
			form: null
		},
		{
			id: 'facebook',
			name: 'Facebook',
			description: 'Connect the Pages you manage',
			form: null
		},
		{
			id: 'youtube',
			name: 'YouTube',
			description: 'Upload videos to your channel',
			form: null
		},
		{
			id: 'tiktok',
			name: 'TikTok',
			description: 'Post videos to your TikTok account',
			form: null
		},
		{
			id: 'linkedin',
			name: 'LinkedIn',
			description: 'Connect your personal or company page',
			form: null
		}
	];

	const TILE_BG: Record<string, string> = {
		x: 'bg-stone-100',
		threads: 'bg-stone-100',
		instagram: 'bg-pink-50',
		facebook: 'bg-blue-50',
		youtube: 'bg-red-50',
		tiktok: 'bg-stone-100',
		linkedin: 'bg-blue-50'
	};

	const needsAttention = $derived(connections.filter((c) => c.status !== 'active').length);
	// App credentials are the instance's, shared by every member: only the
	// owner may enter or replace them. Undefined (no owner flag in the layout
	// data) keeps the single-account behaviour.
	const canManageApps = $derived((page.data as { isOwner?: boolean }).isOwner !== false);

	function connectFromCard(id: string) {
		err = null;
		const found = availablePlatforms.find((p) => p.id === id);
		if (found?.form) {
			openConnectDialog();
			modalForm = found.form;
			return;
		}
		pickPlatform(id);
	}

	async function load() {
		if (connections.length === 0) initialLoading = true;
		loadFailed = false;
		err = null;
		try {
			const res = await fetch('/api/connections');
			if (sessionExpiredIfUnauthorized(res)) {
				loadFailed = true;
				return;
			}
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				loadFailed = true;
				err = humanizeError(payload.error || 'Could not load accounts');
				return;
			}
			connections = [...(payload.connections || [])].sort(
				(a: Connection, b: Connection) => platformRank(a.platform) - platformRank(b.platform)
			);
			zernioHasStoredKey = connections.some(viaZernio);
			if (typeof payload.appUrl === 'string') appUrl = payload.appUrl;
			if (payload.configured && typeof payload.configured === 'object') {
				const reported = payload.configured as Partial<Record<OAuthPlatformId, boolean>>;
				configured = oauthPlatformRecord((id) => reported[id] !== false);
			}
			if (payload.secrets && typeof payload.secrets === 'object') {
				secretPresence = payload.secrets as Record<string, boolean>;
			}
			if (payload.sources && typeof payload.sources === 'object') {
				credentialSources = payload.sources;
			}
			if (payload.savedClientIds && typeof payload.savedClientIds === 'object') {
				savedClientIds = payload.savedClientIds;
			}
		} catch (e) {
			loadFailed = true;
			err = humanizeError(e instanceof Error ? e.message : 'Could not load accounts');
		} finally {
			initialLoading = false;
		}
	}

	async function connectOAuth(platform: OAuthPlatformId, body: Record<string, string>) {
		loading = true;
		err = null;
		try {
			const res = await fetch(`/api/connections/${platform}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				// The secrets can be missing even when `configured` said otherwise
				// (a deployment that lost them, or this page still loading). The
				// route answers with a code, so this opens the setup steps instead
				// of a red banner naming environment variables.
				if (payload.code === 'platform_not_configured' && isOAuthPlatform(platform)) {
					showSetupPanel(platform);
					loading = false;
					return;
				}
				throw new Error(payload.error || 'Failed');
			}
			window.location.href = payload.authorizeUrl;
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Failed');
			loading = false;
		}
	}

	async function loadZernioAccounts(e?: Event) {
		e?.preventDefault();
		loading = true;
		err = null;
		try {
			const res = await fetch('/api/connections/zernio/accounts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(zernioApiKey ? { apiKey: zernioApiKey } : {})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not reach Zernio');
			zernioProfiles = payload.profiles ?? [];
			zernioAccounts = payload.accounts ?? [];
			zernioHasStoredKey = payload.hasStoredKey === true || Boolean(zernioApiKey);
			zernioSelected = (zernioAccounts ?? []).filter((a) => !a.imported).map((a) => a.id);
			if (!zernioConnectProfile) zernioConnectProfile = zernioProfiles[0]?.id ?? '';
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not reach Zernio');
		} finally {
			loading = false;
		}
	}

	async function importZernioAccounts() {
		loading = true;
		err = null;
		try {
			const res = await fetch('/api/connections/zernio/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(zernioApiKey ? { apiKey: zernioApiKey } : {}),
					accountIds: zernioSelected
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not import');
			const n = (payload.connections ?? []).length;
			msg = `Imported ${n} account${n === 1 ? '' : 's'} from Zernio`;
			zernioApiKey = '';
			closeConnectDialog();
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not import');
		} finally {
			loading = false;
		}
	}

	async function connectThroughZernio(platform: string, profileId: string) {
		loading = true;
		err = null;
		try {
			const res = await fetch('/api/connections/zernio/connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(zernioApiKey ? { apiKey: zernioApiKey } : {}),
					platform,
					profileId
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not start the connection');
			window.location.href = payload.authorizeUrl;
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not start the connection');
			loading = false;
		}
	}

	function openZernioForm(platform?: OAuthPlatformId) {
		openConnectDialog();
		modalForm = 'zernio';
		zernioAccounts = null;
		if (platform && isZernioPlatform(platform)) zernioConnectPlatform = platform;
		if (zernioHasStoredKey) void loadZernioAccounts();
	}

	function toggleZernioAccount(id: string) {
		zernioSelected = zernioSelected.includes(id)
			? zernioSelected.filter((x) => x !== id)
			: [...zernioSelected, id];
	}

	function pickPlatform(id: string) {
		const found = availablePlatforms.find((p) => p.id === id);
		if (!found) return;
		if (found.form) {
			modalForm = found.form;
			return;
		}
		// A platform this deployment has no credentials for cannot be connected,
		// so say what it needs instead of requesting an authorize URL.
		if (needsSetup(id, configured)) {
			showSetupPanel(id as OAuthPlatformId);
			return;
		}
		if (isOAuthPlatform(id)) void connectOAuth(id, {});
	}

	function openConnectDialog() {
		// A new attempt supersedes whatever the last one reported.
		err = null;
		modalForm = 'none';
		setupPanel = null;
		showConnectDialog = true;
	}

	function showSetupPanel(platform: OAuthPlatformId) {
		err = null;
		appForm = {};
		appFormError = null;
		modalForm = 'none';
		setupPanel = platform;
		showConnectDialog = true;
	}

	/** The presence map and sources the platform-apps route answers with. */
	function applyCredentialStatus(payload: {
		configured?: typeof configured;
		secrets?: Record<string, boolean>;
		sources?: typeof credentialSources;
		savedClientIds?: typeof savedClientIds;
	}) {
		if (payload.configured) configured = payload.configured;
		if (payload.secrets) secretPresence = payload.secrets;
		if (payload.sources) credentialSources = payload.sources;
		if (payload.savedClientIds) savedClientIds = payload.savedClientIds;
	}

	async function saveAppCredentials(platform: OAuthPlatformId, e: Event) {
		e.preventDefault();
		appFormBusy = true;
		appFormError = null;
		try {
			const values: Record<string, string> = {};
			for (const name of platformSecretNames(platform)) {
				const value = (appForm[name] ?? '').trim();
				if (value) values[name] = value;
			}
			const res = await fetch(`/api/settings/platform-apps/${platform}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values)
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not save the credentials');
			appForm = {};
			applyCredentialStatus(payload);
			setupPanel = null;
			await connectOAuth(platform, {});
		} catch (e) {
			appFormError = humanizeError(e instanceof Error ? e.message : 'Failed');
		} finally {
			appFormBusy = false;
		}
	}

	async function removeAppCredentials(platform: OAuthPlatformId) {
		appFormBusy = true;
		appFormError = null;
		try {
			const res = await fetch(`/api/settings/platform-apps/${platform}`, { method: 'DELETE' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not remove the credentials');
			applyCredentialStatus(payload);
		} catch (e) {
			appFormError = humanizeError(e instanceof Error ? e.message : 'Failed');
		} finally {
			appFormBusy = false;
		}
	}

	function closeConnectDialog() {
		showConnectDialog = false;
		modalForm = 'none';
		setupPanel = null;
	}

	function backToPlatforms() {
		modalForm = 'none';
		setupPanel = null;
	}

	async function confirmDisconnect() {
		if (!pendingDisconnect) return;
		disconnectBusy = true;
		err = null;
		try {
			const res = await fetch(`/api/connections/${pendingDisconnect.id}`, {
				method: 'DELETE'
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(payload.error || 'Could not disconnect');
			}
			const removed = Number(payload.removed ?? 0);
			const archived = Number(payload.archived ?? 0);
			const details = [
				removed ? `${removed} scheduled post${removed === 1 ? '' : 's'} removed` : '',
				archived ? `${archived} published post${archived === 1 ? '' : 's'} kept` : ''
			].filter(Boolean);
			msg = `Disconnected ${pendingDisconnect.label}${details.length ? ` — ${details.join(' · ')}` : ''}`;
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not disconnect');
		} finally {
			disconnectBusy = false;
			pendingDisconnect = null;
		}
	}

	// Re-enter the OAuth flow for a dead connection. Server callbacks upsert
	// by (user, platform, handle) and flip status back to active, so targets
	// stay attached to the same connection row.
	function reconnectAccount(account: Connection) {
		err = null;
		if (viaZernio(account)) {
			const profileId = account.metaJson?.zernioProfileId ?? '';
			if (!isZernioPlatform(account.platform) || !profileId) {
				err = 'This account has no Zernio profile recorded — import it again';
				return;
			}
			void connectThroughZernio(account.platform, profileId);
			return;
		}
		if (isOAuthPlatform(account.platform)) {
			if (needsSetup(account.platform, configured)) {
				showSetupPanel(account.platform);
				return;
			}
			void connectOAuth(account.platform, {});
			return;
		}
		void verify(account.id);
	}

	async function verify(id: string, done = 'Account is active again') {
		verifying = id;
		err = null;
		try {
			const res = await fetch(`/api/connections/${id}/verify`, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Could not verify');
			msg = done;
			await load();
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not verify');
		} finally {
			verifying = null;
		}
	}

	let savingLongPosts = $state<string | null>(null);

	/** `null` hands the decision back to what X reports. */
	async function setLongPosts(account: Connection, longPosts: boolean | null) {
		savingLongPosts = account.id;
		err = null;
		try {
			const res = await fetch(`/api/connections/${account.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ longPosts })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Could not change long posts');
			connections = connections.map((c) =>
				c.id === account.id ? { ...c, metaJson: payload.connection.metaJson } : c
			);
		} catch (e) {
			err = humanizeError(e instanceof Error ? e.message : 'Could not change long posts');
		} finally {
			savingLongPosts = null;
		}
	}

	onMount(() => {
		const params = page.url.searchParams;
		const connected = params.get('connected');
		const failure = params.get('error');
		if (connected) msg = `Connected ${connected}`;
		if (failure) err = humanizeError(failure);
		// Connected on appkeep, but the account couldn't be read back into this app.
		if (data.importError) {
			msg = null;
			err = humanizeError(data.importError);
		}
		// Read once, then drop them from the address bar. The callback redirect
		// is a full page load, so a stale `?error=` used to be replayed on every
		// reload — an old failure sitting above a connection that has since
		// succeeded, which reads as "still broken" and cannot be dismissed.
		if (connected || failure) {
			const url = new URL(page.url.href);
			url.search = '';
			history.replaceState(history.state, '', url);
		}
	});
</script>

<PageHeader
	eyebrow="Integrations"
	title="Accounts"
	subtitle="Connect each social account once. Every post you write can then go to any of them, now or on a schedule."
>
	{#snippet actions()}
		<button type="button" onclick={openConnectDialog} class="btn btn-primary">
			<Plus class="h-4 w-4" />
			<span>Connect new</span>
		</button>
	{/snippet}
</PageHeader>

<div class="mb-6 flex flex-wrap items-center gap-2" data-testid="accounts-summary">
	<Badge tone={connections.length ? 'ok' : 'neutral'} dot>{connections.length} connected</Badge>
	{#if needsAttention > 0}
		<Badge tone="warn" dot>{needsAttention} need{needsAttention === 1 ? 's' : ''} attention</Badge>
	{/if}
	{#if !initialLoading && !loadFailed && connections.length === 0}
		<p class="text-sm text-stone-500">{emptyStateSentence(configured)}</p>
	{/if}
</div>

{#if msg || err}
	<div
		class="mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm {err
			? 'border-rose-200 bg-rose-50 text-rose-700'
			: 'border-emerald-200 bg-emerald-50 text-emerald-800'}"
		role="alert"
	>
		{#if err}
			<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
		{:else}
			<CircleCheck class="mt-0.5 h-4 w-4 shrink-0" />
		{/if}
		<span class="min-w-0 flex-1 break-words">{err || msg}</span>
		<button
			type="button"
			class="-my-1 rounded-md p-1 opacity-70 hover:opacity-100"
			aria-label="Dismiss message"
			onclick={() => {
				err = null;
				msg = null;
			}}
		>
			<X class="h-4 w-4" />
		</button>
	</div>
{/if}

{#if loadFailed && connections.length === 0}
	<div class="card mb-6 flex flex-wrap items-center gap-3 p-5">
		<p class="min-w-0 flex-1 text-sm text-stone-500">
			Accounts could not be loaded. The message above says why — retry in a moment.
		</p>
		<button type="button" onclick={() => void load()} class="btn btn-secondary btn-sm">Retry</button
		>
	</div>
{/if}

<div class="grid gap-5 xl:grid-cols-2">
	{#each availablePlatforms as platform (platform.id)}
		{@const list = connections.filter((c) => c.platform === platform.id)}
		{@const setupNeeded = needsSetup(platform.id, configured)}
		{@const savedHere = isOAuthPlatform(platform.id) && credentialSources[platform.id] === 'app'}
		<section class="card flex min-w-0 flex-col p-5" data-testid="platform-card-{platform.id}">
			<div class="flex items-center gap-3">
				<span
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl {TILE_BG[
						platform.id
					] ?? 'bg-stone-100'} {platformColorClass(platform.id)}"
					aria-hidden="true"
				>
					<SocialIcon platform={platform.id} className="h-5 w-5" />
				</span>
				<div class="min-w-0 flex-1">
					<h2 class="text-[15px] font-semibold tracking-tight text-stone-900">{platform.name}</h2>
					<p class="truncate text-xs text-stone-500">
						{list.length ? `${list.length} connected` : platform.description}
					</p>
				</div>
				{#if setupNeeded && isOAuthPlatform(platform.id)}
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						data-testid="setup-card-{platform.id}"
						aria-label={`Set up the ${platform.name} app`}
						onclick={() => showSetupPanel(platform.id as OAuthPlatformId)}
						disabled={!canManageApps}
					>
						<Wrench class="h-3.5 w-3.5" /> Set up
					</button>
				{:else}
					<button
						type="button"
						class="btn btn-primary btn-sm"
						data-testid="connect-card-{platform.id}"
						aria-label={`Add ${/^[AEIOU]/i.test(platform.name) ? 'an' : 'a'} ${platform.name} account`}
						onclick={() => connectFromCard(platform.id)}
						disabled={loading}
					>
						<Plug class="h-3.5 w-3.5" />
						{list.length ? 'Add another' : 'Connect'}
					</button>
				{/if}
			</div>

			{#if data.appkeep && platform.id === 'x'}
				<p
					class="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600"
					data-testid="x-fee-note"
				>
					X charges for every post, so each one is paid from your AppKeep balance: $0.02, or $0.25
					with a link.
					<a
						href="/_altstack/wallet?next=/accounts"
						class="font-semibold text-accent hover:underline">Add money</a
					>
				</p>
			{/if}

			{#if setupNeeded && isOAuthPlatform(platform.id)}
				{@const setup = PLATFORM_SETUP[platform.id as OAuthPlatformId]}
				<div
					class="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600"
				>
					{#if canManageApps}
						<p>
							<span class="font-semibold text-stone-900">Needs a developer app.</span>
							Create one in the
							<a
								href={setup.consoleUrl}
								target="_blank"
								rel="noreferrer"
								class="inline-flex items-center gap-0.5 font-semibold text-accent hover:underline"
								>{setup.consoleName} <ExternalLink class="h-3 w-3" /></a
							>, then press Set up to enter its credentials.
						</p>
						<p class="mt-2 text-[11px] text-stone-500">Redirect URL to register:</p>
						<div
							class="mt-1 flex items-center gap-1 rounded-lg border border-stone-200 bg-white py-1 pr-1 pl-3"
						>
							<code
								class="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-stone-900 select-all"
								data-testid="card-callback-uri-{platform.id}"
								>{callbackUri(platform.id as OAuthPlatformId, appUrl || page.url.origin)}</code
							>
							<CopyButton
								value={callbackUri(platform.id as OAuthPlatformId, appUrl || page.url.origin)}
								ariaLabel={`Copy the ${platform.name} redirect URL`}
							/>
						</div>
					{:else}
						<p>Ask the workspace owner to set up {platform.name}.</p>
					{/if}
				</div>
			{/if}

			<div class="mt-4 flex-1 space-y-2">
				{#if initialLoading && list.length === 0}
					<div class="h-14 animate-pulse rounded-xl bg-stone-100" aria-hidden="true"></div>
				{:else if list.length === 0}
					{#if !setupNeeded}
						<p class="text-sm text-stone-400">No {platform.name} accounts yet.</p>
					{/if}
				{:else}
					{#each list as account (account.id)}
						{@const needsReconnect = account.status !== 'active'}
						{@const label =
							accountLabel(account.displayName, account.handle, account.instanceUrl) ||
							platformName(account.platform)}
						<div
							class="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 px-3 py-2.5 {needsReconnect
								? 'bg-amber-50/40'
								: 'bg-white'}"
						>
							<AccountAvatar
								platform={account.platform}
								handle={account.handle}
								displayName={account.displayName}
								avatarUrl={account.avatarUrl}
								size={36}
								title={label}
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold text-stone-900" title={label}>
									{#if account.platform === 'linkedin' && account.displayName}
										{account.displayName}
									{:else}
										{accountLabel(account.displayName, account.handle)}
									{/if}
								</p>
								<p class="truncate text-[11px] text-stone-500">
									{platformName(account.platform)}{account.instanceUrl
										? ` · ${displayHost(account.instanceUrl)}`
										: ''}
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-1.5">
								{#if viaZernio(account)}
									<Badge tone="info">via Zernio</Badge>
								{/if}
								{#if needsReconnect}
									<Badge tone="warn" dot
										>{account.status === 'expired' ? 'Needs reconnect' : account.status}</Badge
									>
								{:else}
									<Badge tone="ok" dot>Connected</Badge>
								{/if}
							</div>
							<div class="flex items-center gap-0.5">
								<button
									type="button"
									onclick={() =>
										verify(
											account.id,
											needsReconnect ? 'Account is active again' : 'Connection works'
										)}
									disabled={verifying === account.id}
									class="btn btn-ghost btn-sm px-2"
									aria-label={`Check ${label}`}
									title="Check the connection"
								>
									<RefreshCw class="h-3.5 w-3.5 {verifying === account.id ? 'animate-spin' : ''}" />
								</button>
								{#if needsReconnect}
									<button
										type="button"
										onclick={() => reconnectAccount(account)}
										disabled={verifying === account.id || loading}
										class="btn btn-secondary btn-sm"
										aria-label={`Reconnect ${label}`}
									>
										<Link2 class="h-3.5 w-3.5" /> Reconnect
									</button>
								{/if}
								<button
									type="button"
									onclick={() => (pendingDisconnect = { id: account.id, label })}
									class="btn btn-ghost btn-sm px-2 hover:bg-rose-50 hover:text-rose-600"
									aria-label={`Disconnect ${label}`}
									title={`Disconnect ${label}`}
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
							{#if account.platform === 'x' && !viaZernio(account) && !needsReconnect}
								{@const long = (account.metaJson?.maxCharacters ?? 280) > 280}
								<p
									class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-t border-stone-100 pt-2 text-[12px] text-stone-500"
									data-testid="x-long-posts-{account.id}"
								>
									<span>
										Long posts {long ? 'on, up to 25,000 characters' : 'off, 280 characters'} ·
										{longPostSource(account)}
									</span>
									<button
										type="button"
										onclick={() => setLongPosts(account, !long)}
										disabled={savingLongPosts === account.id}
										class="font-semibold text-accent hover:underline"
										>{long ? 'Turn off' : 'Turn on'}</button
									>
									{#if typeof account.metaJson?.longPosts === 'boolean'}
										<button
											type="button"
											onclick={() => setLongPosts(account, null)}
											disabled={savingLongPosts === account.id}
											class="font-semibold text-stone-500 hover:underline"
											>Use what X reports</button
										>
									{/if}
									<button
										type="button"
										onclick={() => verify(account.id, 'Checked with X')}
										disabled={verifying === account.id}
										class="font-semibold text-stone-500 hover:underline"
										>{verifying === account.id ? 'Checking…' : 'Check plan'}</button
									>
								</p>
							{/if}
						</div>
					{/each}
				{/if}
			</div>

			{#if savedHere && canManageApps}
				<p class="mt-3 text-[11px] text-stone-500">
					Uses app credentials saved on this instance.
					<button
						type="button"
						class="font-semibold text-accent hover:underline"
						onclick={() => showSetupPanel(platform.id as OAuthPlatformId)}>Manage</button
					>
				</p>
			{/if}
		</section>
	{/each}
</div>

{#if !data.appkeep}
	<section
		class="card mt-5 flex flex-wrap items-center gap-4 border-dashed p-5"
		data-testid="zernio-banner"
	>
		<span
			class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600"
			aria-hidden="true"
		>
			<Plug class="h-5 w-5" />
		</span>
		<div class="min-w-0 flex-1">
			<h2 class="text-[15px] font-semibold tracking-tight text-stone-900">
				Connect through Zernio
			</h2>
			<p class="text-xs text-stone-500">
				No developer app of your own for X, Threads, Instagram or LinkedIn. Free plan available.
			</p>
		</div>
		<button type="button" class="btn btn-secondary btn-sm" onclick={() => openZernioForm()}>
			Use Zernio
		</button>
	</section>
{/if}

{#if showConnectDialog}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
		transition:fade={{ duration: 150 }}
		role="presentation"
	>
		<div
			class="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
			onclick={closeConnectDialog}
			aria-hidden="true"
		></div>

		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="connect-dialog-title"
			class="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_24px_60px_-16px_rgb(28_25_23/0.25)] sm:p-7"
			transition:fly={{ y: 20, duration: 250, opacity: 0 }}
			use:dialogFocus={{
				onEscape: () => {
					if (!loading) closeConnectDialog();
				}
			}}
		>
			<div class="mb-6 flex items-start justify-between">
				<div>
					<h2 id="connect-dialog-title" class="text-xl font-semibold tracking-tight text-stone-900">
						Add Integration
					</h2>
					<p class="mt-1 text-sm text-stone-500">Select a platform to connect to your workspace.</p>
				</div>
				<button
					type="button"
					bind:this={connectCloseBtn}
					onclick={closeConnectDialog}
					class="btn btn-ghost btn-sm ml-4 h-9 w-9 shrink-0 px-0"
					aria-label="Close add integration dialog"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			{#if setupPanel}
				{#key setupPanel}
					{@const setup = PLATFORM_SETUP[setupPanel]}
					{@const secretNames = platformSecretNames(setupPanel)}
					{@const missing = missingSecrets(setupPanel, secretPresence)}
					{@const alreadySet = secretNames.filter((name) => secretPresence[name])}
					{@const redirectUri = callbackUri(setupPanel, appUrl || page.url.origin)}
					{@const command = secretsPutCommandFor(missing)}
					{@const savedHere = credentialSources[setupPanel] === 'app'}
					{@const agentPrompt = buildAgentPrompt(
						setupPanel,
						appUrl || page.url.origin,
						page.data.appName ?? 'PostEasy'
					)}
					<div class="space-y-4" data-testid="platform-setup-panel">
						<button
							type="button"
							onclick={backToPlatforms}
							class="text-[13px] font-semibold text-stone-500 hover:text-stone-900"
							>← All platforms</button
						>
						<h3 class="text-[17px] font-semibold tracking-tight text-stone-900">
							{savedHere
								? `${platformName(setupPanel)} app credentials`
								: `${platformName(setupPanel)} isn't enabled yet`}
						</h3>
						<p class="text-xs font-medium text-stone-500">
							{#if savedHere}
								Saved on this instance{savedClientIds[setupPanel]
									? ` (client ID ending ${savedClientIds[setupPanel]})`
									: ''}. Enter new ones to replace them, or remove them.
							{:else}
								{platformName(setupPanel)} needs an app of your own. Create it, then enter its credentials
								here.
							{/if}
						</p>
						{#if !canManageApps}
							<p
								class="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600"
							>
								Ask the workspace owner to set up {platformName(setupPanel)}.
							</p>
						{:else}
							<div
								class="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200"
							>
								<details class="group">
									<summary
										data-testid="setup-step-1"
										class="flex cursor-pointer list-none items-center gap-2.5 p-3 text-xs font-bold text-stone-900 hover:bg-stone-50 [&::-webkit-details-marker]:hidden"
									>
										<span
											class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] text-white"
											>1</span
										>
										Create the app
										<ChevronDown
											class="ml-auto h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180"
										/>
									</summary>
									<div class="space-y-2 px-3 pb-3 text-xs font-medium text-stone-600">
										<p>
											In the <a
												href={setup.consoleUrl}
												target="_blank"
												rel="noreferrer"
												class="font-bold text-stone-900 underline">{setup.consoleName}</a
											>. {setup.consoleRequirement}
										</p>
										<p>Register this redirect URI in {setup.redirectField}:</p>
										<div
											class="flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-50 py-1 pr-1 pl-3"
										>
											<code
												class="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-stone-900 select-all"
												data-testid="setup-callback-uri">{redirectUri}</code
											>
											<CopyButton value={redirectUri} ariaLabel="Copy the redirect URI" />
										</div>
										<p class="pt-1">
											Or let a browser agent such as Claude in Chrome do it: copy this prompt and
											paste it into the agent. It stops whenever a step needs you.
										</p>
										<div
											class="flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-50 py-1 pr-1 pl-3"
										>
											<span class="min-w-0 flex-1 truncate text-[11px] font-bold text-stone-900"
												>Agent prompt for {platformName(setupPanel)}</span
											>
											<CopyButton value={agentPrompt} ariaLabel="Copy the agent prompt" />
										</div>
									</div>
								</details>
								<details class="group" open={savedHere}>
									<summary
										data-testid="setup-step-2"
										class="flex cursor-pointer list-none items-center gap-2.5 p-3 text-xs font-bold text-stone-900 hover:bg-stone-50 [&::-webkit-details-marker]:hidden"
									>
										<span
											class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] text-white"
											>2</span
										>
										Enter the app's credentials
										<ChevronDown
											class="ml-auto h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180"
										/>
									</summary>
									<form
										class="space-y-2 px-3 pb-3"
										data-testid="setup-app-form"
										onsubmit={(e) => saveAppCredentials(setupPanel!, e)}
									>
										{#each secretNames as secret (secret)}
											{@const optional = setup.optionalSecrets?.includes(secret)}
											<label class="block">
												<span class="text-[11px] font-bold text-stone-600"
													>{secretLabel(secret)}{optional ? ' (optional)' : ''}</span
												>
												<input
													type={secret.endsWith('_ID') ? 'text' : 'password'}
													autocomplete="off"
													spellcheck="false"
													required={!optional}
													bind:value={appForm[secret]}
													class="field mt-1 font-mono text-xs pointer-coarse:text-base"
												/>
											</label>
										{/each}
										<p class="text-[11px] font-medium text-stone-500">
											Stored encrypted on this instance, and never shown again.
										</p>
										{#if appFormError}
											<p class="text-xs font-bold text-red-600" role="alert">{appFormError}</p>
										{/if}
										<div class="flex items-center gap-3">
											<button type="submit" disabled={appFormBusy} class="btn btn-primary btn-sm"
												>{appFormBusy ? 'Saving…' : 'Save and connect'}</button
											>
											{#if savedHere}
												<button
													type="button"
													disabled={appFormBusy}
													onclick={() => removeAppCredentials(setupPanel!)}
													class="text-xs font-bold text-stone-500 underline-offset-2 hover:text-red-700 hover:underline"
													>Remove</button
												>
											{/if}
										</div>
									</form>
								</details>
								<details class="group">
									<summary
										data-testid="setup-step-3"
										class="flex cursor-pointer list-none items-center gap-2.5 p-3 text-xs font-bold text-stone-900 hover:bg-stone-50 [&::-webkit-details-marker]:hidden"
									>
										<span
											class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] text-white"
											>3</span
										>
										Or set them as Worker secrets
										<ChevronDown
											class="ml-auto h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180"
										/>
									</summary>
									<div class="space-y-2 px-3 pb-3 text-xs font-medium text-stone-600">
										<p>
											Put {#each missing as secret, index (secret)}{index > 0 ? ' and ' : ''}<code
													class="font-mono text-[11px] text-stone-900">{secret}</code
												>{/each} in
											<code class="font-mono text-[11px] text-stone-900">.dev.vars</code> — uncomment
											the line if it is already there, otherwise add it — then run
										</p>
										{#if alreadySet.length}
											<p>
												Already set on the Worker:
												{#each alreadySet as secret, index (secret)}{index > 0 ? ', ' : ''}<code
														class="font-mono text-[11px] text-stone-900">{secret}</code
													>{/each}.
											</p>
										{/if}
										<div
											class="flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-50 py-1 pr-1 pl-3"
										>
											<code
												class="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-stone-900 select-all"
												data-testid="setup-command">{command}</code
											>
											<CopyButton value={command} ariaLabel="Copy the secrets command" />
										</div>
										<p class="text-[11px] text-stone-500">
											No checkout on this machine? Add them in the Cloudflare dashboard instead:
											Workers → your Worker → Settings → Variables and Secrets, then press Deploy.
										</p>
										<p class="text-[11px] text-stone-500">
											Then reload this page: secrets go live as soon as the command finishes, with
											no redeploy step. Worker secrets take precedence over credentials entered
											above.
										</p>
									</div>
								</details>
							</div>
						{/if}
						{#if setup.note}
							<p class="text-xs font-medium text-stone-500">{setup.note}</p>
						{/if}
						<a
							href={setupGuideUrl(setupPanel)}
							target="_blank"
							rel="noreferrer"
							class="inline-block text-[13px] font-bold text-stone-900 underline"
							>Full {platformName(setupPanel)} steps</a
						>
						{#if isZernioPlatform(setupPanel)}
							<p
								class="rounded-xl border border-dashed border-stone-300 px-3 py-2.5 text-xs font-medium text-stone-600"
								data-testid="setup-zernio-callout"
							>
								Don't want to set up an app?
								<button
									type="button"
									onclick={() => openZernioForm(setupPanel ?? undefined)}
									class="font-bold text-stone-900 underline"
									>Connect {platformName(setupPanel)} through Zernio</button
								>
								instead.{setupPanel === 'x' ? '' : ' Free plan available.'}
							</p>
						{/if}
					</div>
				{/key}
			{:else if modalForm === 'none'}
				<div class="grid gap-3">
					{#each availablePlatforms as platform (platform.id)}
						<button
							type="button"
							class="group flex items-center justify-between rounded-xl border border-stone-200 bg-white p-3.5 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/40"
							onclick={() => pickPlatform(platform.id)}
						>
							<div class="flex items-center gap-4">
								<span
									class="flex h-10 w-10 items-center justify-center rounded-lg {TILE_BG[
										platform.id
									] ?? 'bg-stone-100'} {platformColorClass(platform.id)}"
								>
									{#if platform.id === 'zernio'}
										<Plug class="h-5 w-5" />
									{:else}
										<SocialIcon platform={platform.id} className="h-5 w-5" />
									{/if}
								</span>
								<div>
									<h3 class="text-[14px] font-semibold tracking-tight text-stone-900">
										{platform.name}
									</h3>
									<p class="mt-0.5 text-xs text-stone-500">
										{platform.description}
									</p>
								</div>
							</div>
							{#if needsSetup(platform.id, configured)}
								<span
									class="shrink-0 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[11px] font-bold tracking-tight text-stone-500"
									data-testid="needs-setup-{platform.id}">Needs setup</span
								>
							{:else}
								<div
									class="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition-all group-hover:border-accent group-hover:bg-accent group-hover:text-white"
								>
									<Plus class="h-4 w-4" />
								</div>
							{/if}
						</button>
					{/each}
				</div>
				{#if (Object.keys(credentialSources) as OAuthPlatformId[]).some((id) => credentialSources[id] === 'app')}
					<p class="mt-3 text-xs font-medium text-stone-500" data-testid="saved-app-credentials">
						App credentials saved here:
						{#each (Object.keys(credentialSources) as OAuthPlatformId[]).filter((id) => credentialSources[id] === 'app') as id, index (id)}{index >
							0
								? ', '
								: ' '}<button
								type="button"
								onclick={() => showSetupPanel(id)}
								class="font-bold text-stone-900 underline">{platformName(id)}</button
							>{/each}
					</p>
				{/if}
				<!-- On appkeep every platform connects in one click, so there's nothing to route through Zernio. -->
				{#if !data.appkeep}
					<div class="my-5 flex items-center gap-3" aria-hidden="true">
						<span class="h-px flex-1 bg-stone-200"></span>
						<span class="text-[11px] font-bold tracking-widest text-stone-400 uppercase">or</span>
						<span class="h-px flex-1 bg-stone-200"></span>
					</div>
					<button
						type="button"
						class="group flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-stone-300 bg-stone-50/60 p-3.5 text-left transition-all hover:border-stone-400 hover:bg-white"
						onclick={() => openZernioForm()}
						data-testid="zernio-card"
					>
						<div class="flex items-center gap-4">
							<span
								class="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-stone-600 shadow-sm transition-colors group-hover:text-stone-900"
							>
								<Plug class="h-5 w-5" />
							</span>
							<div>
								<h3 class="text-[14px] font-semibold tracking-tight text-stone-900">
									Connect through Zernio
								</h3>
								<p class="mt-0.5 text-xs text-stone-500">No developer apps needed</p>
							</div>
						</div>
						<span
							class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold tracking-tight text-emerald-700"
							>Free plan</span
						>
					</button>
				{/if}
			{:else if modalForm === 'zernio'}
				<div class="space-y-4">
					<button
						type="button"
						onclick={backToPlatforms}
						class="text-[13px] font-semibold text-stone-500 hover:text-stone-900"
						>← All platforms</button
					>
					<h3 class="text-[17px] font-semibold tracking-tight text-stone-900">Zernio</h3>
					<p class="text-xs font-medium text-stone-500">
						Zernio publishes with its own approved apps, so X, Threads and LinkedIn connect without
						a developer app of your own. It has a free plan (X needs a card), and posts still live
						and schedule here.
						<a
							href={zernioLink({ placement: 'accounts-dialog' })}
							target="_blank"
							rel="noreferrer"
							class="underline">About Zernio</a
						>
					</p>
					<form onsubmit={loadZernioAccounts} class="space-y-3">
						<input
							type="password"
							placeholder={zernioHasStoredKey
								? 'API key (saved — leave blank to reuse)'
								: 'Zernio API key'}
							aria-label="Zernio API key"
							bind:value={zernioApiKey}
							class="field pointer-coarse:text-base"
							required={!zernioHasStoredKey}
							autocomplete="off"
						/>
						<p class="text-[11px] font-medium text-stone-500">
							Create one at <a
								href={ZERNIO_API_KEYS_URL}
								target="_blank"
								rel="noreferrer"
								class="underline">zernio.com → API keys</a
							>. It needs the publishing and accounts groups; a read-only key cannot post.
						</p>
						{#if zernioAccounts === null}
							<button type="submit" disabled={loading} class="btn btn-primary w-full"
								>{loading ? 'Loading…' : 'Show my Zernio accounts'}</button
							>
						{/if}
					</form>
					{#if zernioAccounts !== null}
						{#if zernioAccounts.length === 0}
							<p class="text-xs font-medium text-stone-500">
								No X, Threads or LinkedIn accounts on this key yet. Connect one below.
							</p>
						{:else}
							<ul
								class="divide-y divide-stone-200/80 overflow-hidden rounded-xl border border-stone-200/80"
							>
								{#each zernioAccounts as account (account.id)}
									<li class="flex items-center gap-3 p-3 text-sm">
										<input
											type="checkbox"
											id={`zernio-${account.id}`}
											checked={account.imported || zernioSelected.includes(account.id)}
											disabled={account.imported}
											onchange={() => toggleZernioAccount(account.id)}
											class="h-4 w-4"
										/>
										<label for={`zernio-${account.id}`} class="min-w-0 flex-1 cursor-pointer">
											<span class="font-bold text-stone-900">{platformName(account.platform)}</span>
											<span class="ml-2 text-stone-500"
												>{accountLabel(account.displayName, account.handle)}</span
											>
										</label>
										{#if account.imported}
											<span class="text-[10px] font-bold tracking-widest text-emerald-700 uppercase"
												>Imported</span
											>
										{:else if account.needsReconnection}
											<span class="text-[10px] font-bold tracking-widest text-amber-700 uppercase"
												>Needs reconnect</span
											>
										{/if}
									</li>
								{/each}
							</ul>
							<button
								type="button"
								onclick={importZernioAccounts}
								disabled={loading || zernioSelected.length === 0}
								class="btn btn-primary w-full"
								>{loading
									? 'Importing…'
									: `Import ${zernioSelected.length} account${zernioSelected.length === 1 ? '' : 's'}`}</button
							>
						{/if}
						<div class="space-y-2 rounded-xl border border-stone-200/80 bg-stone-50 p-3">
							<p class="text-xs font-bold text-stone-900">Connect a new account through Zernio</p>
							<div class="flex flex-wrap gap-2">
								<select
									aria-label="Platform"
									bind:value={zernioConnectPlatform}
									class="rounded-lg border border-stone-200/80 bg-white px-2 py-1.5 text-xs font-bold text-stone-900 pointer-coarse:text-base"
								>
									{#each ZERNIO_PLATFORMS as id (id)}
										<option value={id}>{platformName(id)}</option>
									{/each}
								</select>
								<select
									aria-label="Zernio profile"
									bind:value={zernioConnectProfile}
									class="rounded-lg border border-stone-200/80 bg-white px-2 py-1.5 text-xs font-bold text-stone-900 pointer-coarse:text-base"
								>
									{#each zernioProfiles as profile (profile.id)}
										<option value={profile.id}>{profile.name}</option>
									{/each}
								</select>
								<button
									type="button"
									disabled={loading || !zernioConnectProfile}
									onclick={() => connectThroughZernio(zernioConnectPlatform, zernioConnectProfile)}
									class="btn btn-secondary btn-sm">{loading ? 'Redirecting…' : 'Connect'}</button
								>
							</div>
							<p class="text-[11px] font-medium text-stone-500">
								You authorize on the platform, come back here, and the account is imported.
							</p>
						</div>
					{/if}
					{#if err}
						<p class="text-sm text-red-600">{err}</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<ConfirmDialog
	open={pendingDisconnect !== null}
	idPrefix="disconnect-dialog"
	title={`Disconnect ${pendingDisconnect?.label ?? 'account'}?`}
	body="Scheduled posts are removed — any drafts still waiting come back to your Drafts tab. Published history stays in Posts, and reconnecting restores the same account."
	confirmLabel="Disconnect"
	busy={disconnectBusy}
	onConfirm={() => void confirmDisconnect()}
	onCancel={() => (pendingDisconnect = null)}
/>
