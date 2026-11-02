import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { connections, users } from '#lib/server/db/schema.js';
import { newId, type AppDb } from '#lib/server/db/client.js';
import { TEST_ENV, createTestDb } from '#lib/server/db/test.js';
import { decryptJson, encryptJson } from '#lib/server/crypto.js';
import type { ConnectionCredentials } from '#lib/server/providers/types.js';
import { GET } from '../src/routes/api/connections/[id]/tiktok-creator/+server';

/**
 * The composer asks this route every time it shows the TikTok settings, as
 * TikTok's guidelines require. It answers only for the caller's own TikTok
 * account, and a token it refreshed on the way is stored, because TikTok
 * rotates the refresh token and the old one may not work again.
 */
describe('GET /api/connections/[id]/tiktok-creator', () => {
	let db: AppDb;
	let close: () => void;
	let ownerId: string;
	let strangerId: string;

	const creds: ConnectionCredentials = {
		accessToken: 'act',
		refreshToken: 'rft',
		expiresAt: Date.now() - 1000,
		clientId: 'key',
		clientSecret: 'secret',
		tiktokOpenId: 'open-1'
	};

	async function addConnection(overrides: Partial<typeof connections.$inferInsert> = {}) {
		const id = newId();
		const now = new Date();
		await db.insert(connections).values({
			id,
			userId: ownerId,
			platform: 'tiktok',
			handle: '@maker',
			credentialsEncrypted: await encryptJson(creds, TEST_ENV.APP_ENCRYPTION_KEY),
			status: 'active',
			createdAt: now,
			updatedAt: now,
			...overrides
		});
		return id;
	}

	const get = (id: string, user = ownerId, authMethod: 'session' | 'bearer' = 'session') =>
		GET({
			params: { id },
			locals: {
				db,
				user: {
					id: user,
					email: `${user}@localhost`,
					timezone: 'UTC',
					totpEnabled: true,
					mfaVerified: true
				},
				authMethod,
				apiKeyScopes: authMethod === 'bearer' ? ['read', 'write'] : null,
				env: TEST_ENV
			}
		} as never) as Promise<Response>;

	const row = async (id: string) =>
		(await db.select().from(connections).where(eq(connections.id, id)))[0];

	function stubTikTok(token: () => Response) {
		const calls: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
			const url = String(input instanceof Request ? input.url : input);
			calls.push(url);
			if (url.includes('/oauth/token/')) return token();
			if (url.includes('/creator_info/'))
				return Response.json({
					data: {
						creator_username: 'maker',
						creator_nickname: 'Maker',
						creator_avatar_url: 'https://p/a.jpg',
						privacy_level_options: ['SELF_ONLY'],
						comment_disabled: true,
						duet_disabled: false,
						stitch_disabled: false,
						max_video_post_duration_sec: 180
					},
					error: { code: 'ok' }
				});
			return new Response('unmocked', { status: 404 });
		});
		return calls;
	}

	beforeAll(async () => {
		const ctx = await createTestDb();
		db = ctx.db;
		close = ctx.close;
		ownerId = newId();
		strangerId = newId();
		const now = new Date();
		for (const id of [ownerId, strangerId]) {
			await db.insert(users).values({
				id,
				email: `${id}@localhost`,
				passwordHash: 'x',
				timezone: 'UTC',
				createdAt: now,
				updatedAt: now
			});
		}
	});
	afterEach(() => vi.unstubAllGlobals());
	afterAll(() => close());

	it('answers with what the account may post, and keeps the rotated token', async () => {
		const id = await addConnection();
		stubTikTok(() =>
			Response.json({ access_token: 'act2', refresh_token: 'rft2', expires_in: 86400 })
		);
		const res = await get(id);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			nickname: 'Maker',
			username: 'maker',
			avatarUrl: 'https://p/a.jpg',
			privacyLevels: ['SELF_ONLY'],
			commentDisabled: true,
			duetDisabled: false,
			stitchDisabled: false,
			maxDurationSec: 180
		});
		const stored = await decryptJson<ConnectionCredentials>(
			(await row(id)).credentialsEncrypted,
			TEST_ENV.APP_ENCRYPTION_KEY
		);
		expect(stored.accessToken).toBe('act2');
		expect(stored.refreshToken).toBe('rft2');
	});

	it('is not there for someone else’s account, another platform, or an API key', async () => {
		const id = await addConnection();
		const other = await addConnection({ platform: 'x' });
		const calls = stubTikTok(() => Response.json({ access_token: 'a', refresh_token: 'r' }));
		expect((await get(id, strangerId)).status).toBe(404);
		expect((await get(other)).status).toBe(404);
		expect((await get(id, ownerId, 'bearer')).status).toBe(401);
		expect(calls).toEqual([]);
	});

	it('asks through appkeep for an account appkeep holds, without refreshing here', async () => {
		const id = await addConnection({
			credentialsEncrypted: await encryptJson(
				{ accessToken: 'appkeep-connection', tiktokOpenId: 'open-1' },
				TEST_ENV.APP_ENCRYPTION_KEY
			),
			metaJson: JSON.stringify({ tiktokOpenId: 'open-1', appkeepConnectionId: 'con_tt' })
		});
		const seen: Array<{ url: string; headers: Headers }> = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			seen.push({ url: String(input), headers: new Headers(init?.headers) });
			return Response.json({
				data: { privacy_level_options: ['SELF_ONLY'] },
				error: { code: 'ok' }
			});
		});
		const res = await get(id);
		expect(res.status).toBe(200);
		expect(seen).toHaveLength(1);
		expect(seen[0].url).toContain('/creator_info/');
		expect(seen[0].headers.get('x-altstack-connection')).toBe('con_tt');
		expect(seen[0].headers.get('authorization')).toBeNull();
		expect((await row(id)).status).toBe('active');
	});

	it('marks the account expired when TikTok refuses the refresh', async () => {
		const id = await addConnection();
		stubTikTok(() => Response.json({ error: 'invalid_grant', error_description: 'expired' }));
		const res = await get(id);
		expect(res.status).toBe(401);
		expect((await row(id)).status).toBe('expired');
	});
});
