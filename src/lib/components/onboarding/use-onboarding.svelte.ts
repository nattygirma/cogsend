import { isOAuthPlatform, type OAuthPlatformId } from '#lib/domain/platform-setup.js';
import type { OnboardingState, OnboardingStep } from '#lib/domain/profile-settings.js';
import type { AgentId } from '#lib/domain/agent-setup.js';

export interface OnboardingConnection {
	id: string;
	platform: string;
	displayName: string | null;
	handle: string | null;
	avatarUrl: string | null;
	status: string;
}

export interface ApiKeyInfo {
	prefix: string;
	createdAt: string;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Saved in the background: a lost write only means the guide reopens a step back. */
function saveProgress(state: OnboardingState) {
	return fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ onboarding: state })
	}).catch(() => {});
}

/**
 * The setup guide's state and actions: the accounts to show, the key the
 * agent step creates, and the progress kept in the user's settings so an
 * OAuth round trip (which leaves the app) comes back to the same step.
 */
export function useOnboarding(initial: OnboardingState | null) {
	let step = $state<OnboardingStep>(initial?.step ?? 1);
	// Reopened after finishing, moving between steps must not un-finish it.
	const done = Boolean(initial?.done);
	let connections = $state<OnboardingConnection[]>([]);
	let configured = $state<Partial<Record<OAuthPlatformId, boolean>>>({});
	let appUrl = $state('');
	let loading = $state(true);
	let error = $state<string | null>(null);
	let connecting = $state<string | null>(null);
	let activeKey = $state<ApiKeyInfo | null>(null);
	let newKey = $state<string | null>(null);
	let creatingKey = $state(false);
	let agent = $state<AgentId>('claude-desktop');

	const activeConnections = $derived(connections.filter((c) => c.status !== 'disconnected'));

	async function load() {
		loading = true;
		error = null;
		try {
			const [conns, key] = await Promise.all([fetch('/api/connections'), fetch('/api/key')]);
			const payload = await readJson(conns);
			if (!conns.ok) throw new Error(String(payload.error || 'Could not load your accounts'));
			connections = (payload.connections as OnboardingConnection[]) ?? [];
			configured = (payload.configured as typeof configured) ?? {};
			appUrl = typeof payload.appUrl === 'string' ? payload.appUrl : window.location.origin;
			if (key.ok) activeKey = ((await readJson(key)).active as ApiKeyInfo | null) ?? null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load your accounts';
		} finally {
			loading = false;
		}
	}

	function goTo(next: OnboardingStep) {
		step = next;
		void saveProgress({ step: next, done });
	}

	/** Leaves for the platform's consent page; the callback lands on /accounts,
	 *  where the still-unfinished guide opens again on this step. */
	async function connectOAuth(platform: OAuthPlatformId, body: object = {}) {
		connecting = platform;
		error = null;
		try {
			await saveProgress({ step: 1, done: false });
			const res = await fetch(`/api/connections/${platform}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = await readJson(res);
			if (!res.ok || typeof payload.authorizeUrl !== 'string')
				throw new Error(String(payload.error || 'Could not start connecting'));
			window.location.href = payload.authorizeUrl;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not start connecting';
			connecting = null;
		}
	}

	async function createKey() {
		creatingKey = true;
		error = null;
		try {
			const res = await fetch('/api/key', { method: 'POST' });
			const payload = await readJson(res);
			if (!res.ok || typeof payload.key !== 'string')
				throw new Error(String(payload.error || 'Could not create a key'));
			newKey = payload.key;
			activeKey = {
				prefix: String(payload.prefix ?? ''),
				createdAt: String(payload.createdAt ?? '')
			};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create a key';
		} finally {
			creatingKey = false;
		}
	}

	return {
		get step() {
			return step;
		},
		get connections() {
			return activeConnections;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get connecting() {
			return connecting;
		},
		get appUrl() {
			return appUrl;
		},
		get activeKey() {
			return activeKey;
		},
		get newKey() {
			return newKey;
		},
		get creatingKey() {
			return creatingKey;
		},
		get agent() {
			return agent;
		},
		set agent(value: AgentId) {
			agent = value;
		},
		needsSetup(platform: string): boolean {
			return isOAuthPlatform(platform) && configured[platform] === false;
		},
		countFor(platform: string): number {
			return activeConnections.filter((c) => c.platform === platform).length;
		},
		load,
		goTo,
		connectOAuth,
		createKey,
		finish: () => saveProgress({ step: 3, done: true }),
		dismiss: () => saveProgress({ step, done, dismissed: true })
	};
}

export type Onboarding = ReturnType<typeof useOnboarding>;
