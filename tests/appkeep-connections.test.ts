import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { newId, type AppDb } from '#lib/server/db/client.js';
import { connections, users } from '#lib/server/db/schema.js';
import { createTestDb, TEST_ENV } from '#lib/server/db/test.js';
import { decryptJson } from '#lib/server/crypto.js';
import { importAppkeepConnections } from '#lib/server/appkeep-connections.js';
import {
	APPKEEP_TOKEN,
	appkeepFetch,
	providerFor,
	viaAppkeep,
	type ConnectionCredentials,
	type PlatformProvider
} from '#lib/server/providers/index.js';
import { POST as facebookPOST } from '../src/routes/api/connections/facebook/+server';
import { DELETE as disconnectRoute } from '../src/routes/api/connections/[id]/+server';
import { ProviderError } from '#lib/server/providers/types.js';

/**
 * On appkeep, appkeep holds the Instagram, Facebook, TikTok and YouTube
 * tokens. The app stores a connection id, and every call it makes sends that
 * id where the token would have gone; appkeep adds the token on the way out.
 */

type Seen = { url: string; headers: Headers; body: unknown };

function recorder(respond: (url: string) => unknown = () => ({})) {
	const seen: Seen[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		seen.push({ url, headers: new Headers(init?.headers), body: init?.body });
		return Response.json(respond(url));
	}) as unknown as typeof fetch;
	return { seen, fetchImpl };
}

describe('appkeep connections', () => {
	it('sends the connection id instead of the token, wherever a provider put it', async () => {
		const { seen, fetchImpl } = recorder();
		const f = appkeepFetch('con_1', fetchImpl);
		await f(`https://graph.facebook.com/v26.0/P1?fields=id&access_token=${APPKEEP_TOKEN}`);
		await f('https://graph.facebook.com/v26.0/P1/feed', {
			method: 'POST',
			body: new URLSearchParams({ message: 'hi', access_token: APPKEEP_TOKEN })
		});
		await f('https://open.tiktokapis.com/v2/user/info/', {
			headers: { Authorization: `Bearer ${APPKEEP_TOKEN}` }
		});
		await f('https://open-upload.tiktokapis.com/video/?upload_id=u1', { method: 'PUT' });

		expect(seen[0].url).toBe('https://graph.facebook.com/v26.0/P1?fields=id');
		expect(String(seen[1].body)).toBe('message=hi');
		expect(seen[2].headers.get('authorization')).toBeNull();
		for (const s of seen.slice(0, 3)) expect(s.headers.get('x-altstack-connection')).toBe('con_1');
		// An upload URL the platform handed out carries its own authorisation.
		expect(seen[3].headers.get('x-altstack-connection')).toBeNull();
		expect(JSON.stringify(seen)).not.toContain(APPKEEP_TOKEN);
	});

	it('publishes through appkeep, and leaves refreshing to it', async () => {
		const base = {
			id: 'youtube',
			capabilities: { maxImages: 0, maxImageBytes: 0, supportsThreads: false },
			validate: () => [],
			async publish(_content, creds, _meta, fetchImpl) {
				await fetchImpl!('https://www.googleapis.com/youtube/v3/channels', {
					headers: { Authorization: `Bearer ${creds.accessToken}` }
				});
				return { ok: true, platformPostId: 'v1' };
			},
			refreshIfNeeded: async (c) => c,
			refreshImpossibleReason: () => 'reconnect'
		} as PlatformProvider;
		const { seen, fetchImpl } = recorder();
		const wrapped = viaAppkeep(base, 'con_yt');
		expect(wrapped.refreshIfNeeded).toBeUndefined();
		expect(wrapped.refreshImpossibleReason).toBeUndefined();
		await wrapped.publish({ text: 'x', media: [] } as never, { channelId: 'UC1' }, {}, fetchImpl);
		const got = { url: seen[0].url, connection: seen[0].headers.get('x-altstack-connection') };
		expect(got).toEqual({
			url: 'https://www.googleapis.com/youtube/v3/channels',
			connection: 'con_yt'
		});

		// A stored row carrying the connection id gets the wrapped provider.
		const row = {
			platform: 'youtube',
			metaJson: JSON.stringify({ channelId: 'UC1', appkeepConnectionId: 'con_yt' })
		};
		expect(providerFor(row).refreshIfNeeded).toBeUndefined();
		expect(providerFor({ platform: 'youtube', metaJson: '{}' }).refreshIfNeeded).toBeDefined();
	});

	describe('connecting', () => {
		let db: AppDb;
		let close: () => void;
		let userId: string;

		beforeAll(async () => {
			({ db, close } = await createTestDb());
			const now = new Date();
			userId = newId();
			await db.insert(users).values({
				id: userId,
				email: 'appkeep@localhost',
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

		it("sends Connect to appkeep's login instead of this app's", async () => {
			const res = await facebookPOST({
				request: new Request('http://localhost/api/connections/facebook', { method: 'POST' }),
				locals: {
					db,
					env: { ...TEST_ENV, appkeep: true },
					bindings: {
						ALTSTACK: {
							connectUrl: (p: string, next?: string) =>
								`/_altstack/connect/${p}?next=${encodeURIComponent(next ?? '/')}`
						}
					},
					user: {
						id: userId,
						email: 'appkeep@localhost',
						timezone: 'UTC',
						totpEnabled: true,
						mfaVerified: true
					},
					authMethod: 'session'
				},
				cookies: { get: () => 'session-1' }
			} as never);
			expect(await res.json()).toEqual({
				authorizeUrl: '/_altstack/connect/facebook?next=%2Faccounts'
			});
		});

		it('adds each Page appkeep connected, holding only its connection id', async () => {
			const bindings = {
				ALTSTACK: {
					connections: async (p: string) =>
						p === 'facebook'
							? [
									{
										id: 'con_p1',
										provider: 'facebook',
										external_id: 'P1',
										name: 'Glow Page',
										status: 'active',
										scopes: ['pages_manage_posts']
									},
									{
										id: 'con_p2',
										provider: 'facebook',
										external_id: 'P2',
										name: 'Old Page',
										status: 'expired',
										scopes: []
									}
								]
							: []
				}
			};
			const { seen, fetchImpl } = recorder(() => ({
				id: 'P1',
				name: 'Glow Skin',
				username: 'glowskin',
				picture: { data: { url: 'https://img.test/p1.png' } }
			}));
			vi.stubGlobal('fetch', fetchImpl);

			expect(
				await importAppkeepConnections(db, TEST_ENV as never, bindings, userId, 'facebook')
			).toBe(1);
			// Again on a second visit: still one row for the Page.
			await importAppkeepConnections(db, TEST_ENV as never, bindings, userId, 'facebook');

			const rows = await db.select().from(connections).where(eq(connections.userId, userId));
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				platform: 'facebook',
				displayName: 'Glow Skin',
				status: 'active',
				avatarUrl: 'https://img.test/p1.png'
			});
			expect(JSON.parse(rows[0].metaJson!)).toEqual({
				pageId: 'P1',
				appkeepConnectionId: 'con_p1'
			});
			const creds = await decryptJson<ConnectionCredentials>(
				rows[0].credentialsEncrypted,
				TEST_ENV.APP_ENCRYPTION_KEY
			);
			expect(creds).toMatchObject({ accessToken: APPKEEP_TOKEN, pageId: 'P1' });
			// The profile was read through the connection, never with a token.
			expect(seen[0].headers.get('x-altstack-connection')).toBe('con_p1');
			expect(seen[0].url).not.toContain('access_token');
		});

		it('stores a LinkedIn member under the person URN posts go to', async () => {
			const bindings = {
				ALTSTACK: {
					connections: async (p: string) =>
						p === 'linkedin'
							? [
									{
										id: 'con_li',
										provider: 'linkedin',
										external_id: 'SUB1',
										name: 'Glow Founder',
										status: 'active',
										scopes: ['openid', 'profile', 'w_member_social']
									}
								]
							: []
				}
			};
			const { seen, fetchImpl } = recorder(() => ({ sub: 'SUB1', name: 'Glow Founder' }));
			vi.stubGlobal('fetch', fetchImpl);
			await importAppkeepConnections(db, TEST_ENV as never, bindings, userId, 'linkedin');
			const [row] = await db.select().from(connections).where(eq(connections.platform, 'linkedin'));
			expect(JSON.parse(row.metaJson!)).toEqual({
				personUrn: 'urn:li:person:SUB1',
				maxCharacters: 3000,
				appkeepConnectionId: 'con_li'
			});
			const creds = await decryptJson<ConnectionCredentials>(
				row.credentialsEncrypted,
				TEST_ENV.APP_ENCRYPTION_KEY
			);
			expect(creds).toMatchObject({ personUrn: 'urn:li:person:SUB1', openIdSub: 'SUB1' });
			expect(seen[0].url).toBe('https://api.linkedin.com/v2/userinfo');
			expect(seen[0].headers.get('x-altstack-connection')).toBe('con_li');
		});

		it('adds every X account appkeep holds, so several can sit side by side', async () => {
			const xAccount = (id: string, username: string) => ({
				id,
				provider: 'x',
				external_id: id.toUpperCase(),
				name: `@${username}`,
				status: 'active',
				scopes: ['tweet.write']
			});
			const bindings = {
				ALTSTACK: {
					connections: async (p: string) =>
						p === 'x' ? [xAccount('con_x1', 'glowskin'), xAccount('con_x2', 'glowlabs')] : []
				}
			};
			vi.stubGlobal('fetch', recorder(() => ({ data: {} })).fetchImpl);
			expect(await importAppkeepConnections(db, TEST_ENV as never, bindings, userId, 'x')).toBe(2);
			const rows = await db.select().from(connections).where(eq(connections.platform, 'x'));
			expect(rows.map((r) => r.handle).sort()).toEqual(['@glowlabs', '@glowskin']);
			const creds = await Promise.all(
				rows.map((r) =>
					decryptJson<ConnectionCredentials>(r.credentialsEncrypted, TEST_ENV.APP_ENCRYPTION_KEY)
				)
			);
			expect(creds.map((c) => [c.xUserId, c.xUsername]).sort()).toEqual([
				['CON_X1', 'glowskin'],
				['CON_X2', 'glowlabs']
			]);
		});

		it('removing an account here removes it from appkeep too', async () => {
			const [row] = await db.select().from(connections).where(eq(connections.platform, 'x'));
			const removed: string[] = [];
			const res = await disconnectRoute({
				params: { id: row.id },
				locals: {
					db,
					env: { ...TEST_ENV, appkeep: true },
					bindings: {
						ALTSTACK: { disconnect: async (id: string) => (removed.push(id), true) }
					},
					user: { id: userId, email: 'appkeep@localhost', timezone: 'UTC' },
					authMethod: 'session'
				}
			} as never);
			expect(res.status).toBe(200);
			expect(removed).toEqual([JSON.parse(row.metaJson!).appkeepConnectionId]);
			expect(await db.select().from(connections).where(eq(connections.id, row.id))).toEqual([]);
		});
	});

	it('says plainly when an X post needs money on the balance, instead of retrying it', async () => {
		const fetchImpl = (async () =>
			Response.json(
				{
					error: {
						code: 'insufficient_funds',
						message: 'Add money to your AppKeep balance to post to X. Each post costs $0.02.',
						top_up_url: '/_altstack/wallet'
					}
				},
				{ status: 402 }
			)) as unknown as typeof fetch;
		const err = await appkeepFetch('con_x', fetchImpl)('https://api.x.com/2/tweets', {
			method: 'POST',
			headers: { Authorization: `Bearer ${APPKEEP_TOKEN}` }
		}).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(err).toMatchObject({ status: 402, code: 'forbidden', retryable: false });
		expect((err as Error).message).toContain('Add money to your AppKeep balance');
	});
});
