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
import { useWorkerEnv } from './cloudflare-workers';
import { POST as facebookPOST } from '../src/routes/api/connections/facebook/+server';

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
			useWorkerEnv({
				ALTSTACK: {
					connectUrl: (p: string, next?: string) =>
						`/_altstack/connect/${p}?next=${encodeURIComponent(next ?? '/')}`
				}
			});
			const res = await facebookPOST({
				request: new Request('http://localhost/api/connections/facebook', { method: 'POST' }),
				locals: {
					db,
					env: { ...TEST_ENV, appkeep: true },
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
			useWorkerEnv({
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
			});
			const { seen, fetchImpl } = recorder(() => ({
				id: 'P1',
				name: 'Glow Skin',
				username: 'glowskin',
				picture: { data: { url: 'https://img.test/p1.png' } }
			}));
			vi.stubGlobal('fetch', fetchImpl);

			expect(await importAppkeepConnections(db, TEST_ENV as never, userId, 'facebook')).toBe(1);
			// Again on a second visit: still one row for the Page.
			await importAppkeepConnections(db, TEST_ENV as never, userId, 'facebook');

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
	});
});
