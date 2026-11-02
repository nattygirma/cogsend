import { providerFetch } from './timed-fetch';
import {
	ProviderError,
	type ConnectionCredentials,
	type FetchLike,
	type PlatformProvider
} from './types';

/**
 * On appkeep, Instagram, Facebook, TikTok and YouTube are connected through
 * appkeep's own apps with those platforms: the person clicks Connect, appkeep
 * runs the login and keeps the token, and this app only ever holds the
 * connection's id. Calls carry an `x-altstack-connection` header and appkeep
 * adds the token on the way out (refreshing it when it has to).
 *
 * The providers are unchanged: they get this placeholder as their token, and
 * the fetch below swaps it for the header wherever they would have sent it.
 */
export const APPKEEP_TOKEN = 'appkeep-connection';

/** The connection id a stored row publishes through, when appkeep holds its token. */
export function appkeepConnectionId(metaJson: string | null | undefined): string | null {
	if (!metaJson) return null;
	try {
		const id = (JSON.parse(metaJson) as { appkeepConnectionId?: unknown }).appkeepConnectionId;
		return typeof id === 'string' && id ? id : null;
	} catch {
		return null;
	}
}

/** fetch() that sends `connectionId` in place of the placeholder token, wherever a provider put it. */
export function appkeepFetch(connectionId: string, base: FetchLike = providerFetch): FetchLike {
	return (input, init) => {
		if (input instanceof Request) return base(input, init);
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		let body = init?.body;
		let tagged = false;
		if (url.searchParams.get('access_token') === APPKEEP_TOKEN) {
			url.searchParams.delete('access_token');
			tagged = true;
		}
		if (headers.get('authorization') === `Bearer ${APPKEEP_TOKEN}`) {
			headers.delete('authorization');
			tagged = true;
		}
		if (body instanceof URLSearchParams && body.get('access_token') === APPKEEP_TOKEN) {
			body = new URLSearchParams(body);
			body.delete('access_token');
			tagged = true;
		}
		// Upload URLs a platform handed out carry their own authorisation.
		if (!tagged) return base(input, init);
		headers.set('x-altstack-connection', connectionId);
		return base(url.toString(), { ...init, headers, body }).then(paidOrThrow);
	};
}

/** A post appkeep charges for (on X) and the balance can't cover: say so plainly, and don't retry. */
async function paidOrThrow(res: Response): Promise<Response> {
	if (res.status !== 402) return res;
	const body = (await res
		.clone()
		.json()
		.catch(() => null)) as { error?: { code?: string; message?: string } } | null;
	if (body?.error?.code !== 'insufficient_funds') return res;
	throw new ProviderError(body.error.message || 'Add money to your balance to post here', {
		status: 402,
		code: 'forbidden'
	});
}

/** A provider that publishes through an appkeep connection. Appkeep refreshes tokens and knows who the account is, so this does neither. */
export function viaAppkeep(provider: PlatformProvider, connectionId: string): PlatformProvider {
	const wrap = (fetchImpl?: FetchLike) => appkeepFetch(connectionId, fetchImpl);
	const withToken = (creds: ConnectionCredentials) => ({ ...creds, accessToken: APPKEEP_TOKEN });
	return {
		...provider,
		publish: (content, creds, meta, fetchImpl, opts) =>
			provider.publish(content, withToken(creds), meta, wrap(fetchImpl), opts),
		// Identity healing reads the token itself (Threads' debug_token); appkeep already knows the account.
		alignCredentials: undefined,
		refreshIfNeeded: undefined,
		refreshImpossibleReason: undefined
	};
}
