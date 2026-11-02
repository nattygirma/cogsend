import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { newId, type AppDb } from '#lib/server/db/client.js';
import { connections, oauthPending, users } from '#lib/server/db/schema.js';
import { createTestDb, TEST_ENV } from '#lib/server/db/test.js';
import { decryptJson, encryptSecret } from '#lib/server/crypto.js';
import { bindOAuthState } from '#lib/server/oauth-state.js';
import { GET as facebookCallback } from '../src/routes/api/connections/facebook/callback/+server';
import { POST as facebookPOST } from '../src/routes/api/connections/facebook/+server';

async function redirected(call: () => unknown): Promise<{ status: number; location: string }> {
	try {
		await call();
	} catch (e) {
		const err = e as { status?: number; location?: string };
		if (typeof err?.status === 'number')
			return { status: err.status, location: String(err.location ?? '') };
		throw e;
	}
	throw new Error('expected a redirect');
}

describe('facebook connect and callback', () => {
	let db: AppDb;
	let close: () => void;
	let userId: string;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const now = new Date();
		userId = newId();
		await db.insert(users).values({
			id: userId,
			email: 'fb-oauth@localhost',
			passwordHash: 'x',
			timezone: 'UTC',
			createdAt: now,
			updatedAt: now
		});
	});
	afterAll(() => {
		vi.unstubAllGlobals();
		close();
	});

	const postConnect = (env: Record<string, unknown>) =>
		facebookPOST({
			request: new Request('http://localhost/api/connections/facebook', { method: 'POST' }),
			locals: {
				db,
				env,
				user: {
					id: userId,
					email: 'fb-oauth@localhost',
					timezone: 'UTC',
					totpEnabled: true,
					mfaVerified: true
				},
				authMethod: 'session'
			},
			cookies: { get: () => 'sess-fb' },
			url: new URL('http://localhost/api/connections/facebook')
		} as never) as Promise<Response>;

	it('answers "not configured" without the app credentials', async () => {
		const res = await postConnect(TEST_ENV);
		expect(res.ok).toBe(false);
		expect((await res.json()).code).toBe('platform_not_configured');
	});

	it('hands back the authorize URL, with the configuration id when there is one', async () => {
		const res = await postConnect({
			...TEST_ENV,
			FACEBOOK_APP_ID: 'fb-app',
			FACEBOOK_APP_SECRET: 'fb-secret',
			FACEBOOK_CONFIG_ID: 'cfg1'
		});
		const url = new URL((await res.json()).authorizeUrl);
		expect(url.searchParams.get('client_id')).toBe('fb-app');
		expect(url.searchParams.get('config_id')).toBe('cfg1');
		const pending = await db
			.select()
			.from(oauthPending)
			.where(eq(oauthPending.instanceUrl, 'facebook'));
		expect(pending).toHaveLength(1);
		await db.delete(oauthPending).where(eq(oauthPending.instanceUrl, 'facebook'));
	});

	async function connect(pages: Array<Record<string, unknown>>) {
		const pendingId = newId();
		await db.insert(oauthPending).values({
			id: pendingId,
			userId,
			instanceUrl: 'facebook',
			clientId: 'fb-app',
			clientSecretEnc: await encryptSecret('fb-secret', TEST_ENV.APP_ENCRYPTION_KEY),
			expiresAt: new Date(Date.now() + 10 * 60_000),
			createdAt: new Date()
		});
		const state = await bindOAuthState({
			secret: TEST_ENV.AUTH_SECRET!,
			pendingId,
			sessionId: 'sess-fb'
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => {
				const url = String(input instanceof Request ? input.url : input);
				if (url.includes('grant_type=fb_exchange_token'))
					return Response.json({ access_token: 'long-user' });
				if (url.includes('/oauth/access_token?')) return Response.json({ access_token: 'short' });
				if (url.includes('/me/accounts')) return Response.json({ data: pages });
				return new Response('unmocked', { status: 404 });
			})
		);
		const url = new URL(
			`http://localhost/api/connections/facebook/callback?code=CODE&state=${encodeURIComponent(state)}`
		);
		return redirected(() =>
			facebookCallback({
				url,
				locals: { db, env: TEST_ENV },
				cookies: { get: () => 'sess-fb' }
			} as never)
		);
	}

	it('stores one account per Page, and a renamed Page reconnects in place', async () => {
		const first = await connect([
			{ id: '1', name: 'Bakery', username: 'bakery', access_token: 'pt1' },
			{ id: '2', name: 'Cafe', access_token: 'pt2' }
		]);
		expect(first.location).toContain('connected=facebook');
		const again = await connect([
			{ id: '1', name: 'Bakery & Co', username: 'bakeryco', access_token: 'pt1b' }
		]);
		expect(again.location).toContain('connected=facebook');

		const rows = await db.select().from(connections).where(eq(connections.userId, userId));
		expect(rows).toHaveLength(2);
		const bakery = rows.find((r) => JSON.parse(r.metaJson ?? '{}').pageId === '1')!;
		expect(bakery.handle).toBe('bakeryco');
		expect(bakery.displayName).toBe('Bakery & Co');
		const creds = await decryptJson<Record<string, unknown>>(
			bakery.credentialsEncrypted,
			TEST_ENV.APP_ENCRYPTION_KEY
		);
		expect(creds).toEqual({ accessToken: 'pt1b', pageId: '1', clientId: 'fb-app' });
		const cafe = rows.find((r) => JSON.parse(r.metaJson ?? '{}').pageId === '2')!;
		expect(cafe.handle).toBe('Cafe');
	});

	it('sends the person back with what to do when no Page was granted', async () => {
		const out = await connect([]);
		expect(decodeURIComponent(out.location)).toContain('No Facebook Pages');
	});
});
