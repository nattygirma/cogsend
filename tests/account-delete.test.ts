import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSession, getSessionUser } from '#lib/server/auth.js';
import { newId, type AppDb } from '#lib/server/db/client.js';
import { draftMedia, drafts, sessions, users } from '#lib/server/db/schema.js';
import { createTestAdmin, createTestDb, TEST_ENV } from '#lib/server/db/test.js';
import { DELETE, GET } from '../src/routes/api/auth/me/+server';

/**
 * Deleting an account destroys everything in it: drafts, connections, API keys
 * and the login itself. A live session must not be enough on its own — an
 * unattended browser or a stolen cookie would then be a one-request wipe — so
 * the route asks for the password again, and throttles it like the login form.
 */
describe('deleting an account', () => {
	let db: AppDb;
	let close: () => void;
	let count: () => number;

	const request = (body: unknown, locals: Record<string, unknown>) =>
		DELETE({
			request: new Request('http://localhost/api/auth/me', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			locals,
			cookies: { set() {}, delete() {}, get: () => undefined },
			url: new URL('http://localhost/api/auth/me')
		} as never) as Promise<Response>;

	const media = { delete: async () => {}, put: async () => {}, get: async () => null };

	const localsFor = (user: { id: string; email: string }, overrides = {}) => ({
		db,
		env: TEST_ENV,
		authMethod: 'session' as const,
		user: { ...user, timezone: 'UTC', totpEnabled: false, mfaVerified: true },
		media,
		...overrides
	});

	/** An account created after the owner's, so ownership is never a tie. */
	async function member(email: string) {
		const row = await createTestAdmin(db, { email });
		const later = new Date(Date.now() + 60_000);
		await db.update(users).set({ createdAt: later }).where(eq(users.id, row.id));
		return row;
	}

	beforeAll(async () => {
		({ db, close, count } = await createTestDb());
	});
	afterAll(() => close());

	it('refuses a machine credential and asks for the password', async () => {
		await db.delete(users);
		const owner = await createTestAdmin(db);
		expect(
			(await request({ password: 'admin123' }, localsFor(owner, { authMethod: 'bearer' }))).status
		).toBe(401);
		const missing = await request({}, localsFor(owner));
		expect(missing.status).toBe(400);
		expect((await missing.json()).error).toBe('Enter your password to confirm');
		const wrong = await request({ password: 'not-the-password' }, localsFor(owner));
		expect(wrong.status).toBe(401);
		expect((await wrong.json()).error).toBe('That password is not correct');
		expect(await db.select().from(users)).toHaveLength(1);
	});

	it('keeps the owner while other people still have accounts', async () => {
		await db.delete(users);
		const owner = await createTestAdmin(db, { email: 'owner@localhost' });
		const other = await member('member@localhost');
		const refused = await request({ password: 'admin123' }, localsFor(owner));
		expect(refused.status).toBe(409);
		expect((await refused.json()).error).toMatch(/You own this workspace/);

		// A member leaves freely, and then the owner can too.
		expect((await request({ password: 'admin123' }, localsFor(other))).status).toBe(200);
		expect((await request({ password: 'admin123' }, localsFor(owner))).status).toBe(200);
		expect(await db.select().from(users)).toHaveLength(0);
	});

	it('deletes only its own account, with every session', async () => {
		await db.delete(users);
		const owner = await createTestAdmin(db, { email: 'stays@localhost' });
		const other = await member('leaves@localhost');
		await createSession(db, TEST_ENV, other.id, true, true, other.passwordHash);
		await createSession(db, TEST_ENV, owner.id, true, true, owner.passwordHash);

		const res = await request({ password: 'admin123' }, localsFor(other));
		expect(res.status).toBe(200);
		expect(await db.select().from(users).where(eq(users.id, other.id))).toHaveLength(0);
		expect(await db.select().from(sessions).where(eq(sessions.userId, other.id))).toHaveLength(0);
		expect(await db.select().from(users).where(eq(users.id, owner.id))).toHaveLength(1);
		expect(await db.select().from(sessions).where(eq(sessions.userId, owner.id))).toHaveLength(1);
	});

	async function library(userId: string, n: number) {
		const draftId = newId();
		const now = new Date();
		await db.insert(drafts).values({
			id: draftId,
			userId,
			title: 'many',
			baseBody: 'text',
			status: 'draft',
			createdAt: now,
			updatedAt: now
		});
		await db.insert(draftMedia).values(
			Array.from({ length: n }, (_, i) => ({
				id: newId(),
				draftId,
				storageKey: `library/${draftId}/${i}.png`,
				mime: 'image/png',
				size: 10,
				createdAt: now
			}))
		);
		return draftId;
	}

	it('deletes a library larger than one batch in one request', async () => {
		await db.delete(users);
		const row = await createTestAdmin(db, { email: 'library@localhost' });
		// Two batches' worth: 250 rows at 200 per batch.
		const draftId = await library(row.id, 250);
		const batchSizes: number[] = [];
		const res = await request(
			{ password: 'admin123' },
			localsFor(row, {
				media: {
					// The point of the bulk call: two subrequests, not 250.
					deleteMany: async (keys: string[]) => {
						batchSizes.push(keys.length);
					},
					delete: async () => {
						throw new Error('delete() must not be used when deleteMany exists');
					},
					put: async () => {},
					get: async () => null
				}
			})
		);
		expect(res.status).toBe(200);
		// Each image goes with its thumbnail cache key, its preview and its JPEG
		// copy, still one call per batch and inside R2's 1,000 keys a call.
		expect(batchSizes).toEqual([800, 200]);
		expect(await db.select().from(users).where(eq(users.id, row.id))).toHaveLength(0);
		expect(await db.select().from(draftMedia).where(eq(draftMedia.draftId, draftId))).toHaveLength(
			0
		);
	});

	it('spreads a library too large for one request over several, resuming each time', async () => {
		await db.delete(users);
		const row = await createTestAdmin(db, { email: 'huge@localhost' });
		const draftId = await library(row.id, 2100); // 10 batches of 200, then 100 left over
		const locals = localsFor(row, {
			media: {
				deleteMany: async () => {},
				delete: async () => {},
				put: async () => {},
				get: async () => null
			}
		});

		const before = count();
		const first = await request({ password: 'admin123' }, locals);
		expect(first.status).toBe(202);
		expect((await first.json()).deletedMedia).toBe(2000);
		// D1 allows 50 statements per invocation on the free plan: the largest
		// batch this route will attempt has to fit, with the auth checks included.
		expect(count() - before).toBeLessThan(50);
		// The account is still there, and so are the rows for what is left —
		// that is what makes the next call resume instead of starting over.
		expect(await db.select().from(users).where(eq(users.id, row.id))).toHaveLength(1);
		expect(await db.select().from(draftMedia).where(eq(draftMedia.draftId, draftId))).toHaveLength(
			100
		);

		const second = await request({ password: 'admin123' }, locals);
		expect(second.status).toBe(200);
		expect(await db.select().from(users).where(eq(users.id, row.id))).toHaveLength(0);
	});

	it('answers GET with the signed-in account and whether it owns the workspace', async () => {
		await db.delete(users);
		const owner = await createTestAdmin(db, { email: 'get@localhost' });
		const other = await member('other@localhost');
		const read = async (user: { id: string; email: string } | null) =>
			(
				(await GET({
					locals: user ? localsFor(user) : { db, env: TEST_ENV, user: null }
				} as never)) as Response
			).json();
		expect(await read(owner)).toMatchObject({ user: { email: 'get@localhost' }, isOwner: true });
		expect(await read(other)).toMatchObject({ user: { email: 'other@localhost' }, isOwner: false });
		expect(await read(null)).toEqual({ user: null, isOwner: false });
		expect(await getSessionUser(db, TEST_ENV, 'nope')).toBeNull();
	});
});
