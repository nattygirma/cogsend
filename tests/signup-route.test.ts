import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminUser, isOwner } from '#lib/server/auth.js';
import type { AppDb } from '#lib/server/db/client.js';
import { sessions, users } from '#lib/server/db/schema.js';
import { createTestDb, TEST_ENV } from '#lib/server/db/test.js';
import { POST as signupPOST } from '../src/routes/api/auth/signup/+server';
import { POST as loginPOST } from '../src/routes/api/auth/login/+server';
import { load as signupLoad } from '../src/routes/signup/+page.server';
import { parseProfileSettings } from '#lib/domain/profile-settings.js';

function post(
	handler: typeof signupPOST | typeof loginPOST,
	path: string,
	db: AppDb,
	body: unknown
) {
	const cookies: Record<string, string> = {};
	return {
		cookies,
		response: handler({
			request: new Request(`http://localhost${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			locals: { db, env: TEST_ENV },
			cookies: {
				set: (name: string, value: string) => (cookies[name] = value),
				get: () => undefined,
				delete() {}
			},
			url: new URL(`http://localhost${path}`)
		} as never) as Promise<Response>
	};
}

const signup = (db: AppDb, body: unknown) => post(signupPOST, '/api/auth/signup', db, body);
const login = (db: AppDb, body: unknown) => post(loginPOST, '/api/auth/login', db, body);

describe('signing up', () => {
	let db: AppDb;
	let close: () => void;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
	});
	afterAll(() => close());

	it('creates the first account, signs it in, and makes it the owner', async () => {
		const { response, cookies } = signup(db, {
			email: ' Owner@Example.com ',
			password: 'a long enough password',
			displayName: 'Owner'
		});
		const res = await response;
		expect(res.status).toBe(201);
		const rows = await db.select().from(users);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ email: 'owner@example.com', displayName: 'Owner' });
		// The password is stored hashed, never as typed.
		expect(rows[0].passwordHash).not.toContain('a long enough password');
		expect(cookies.pe_session).toBeTruthy();
		const [session] = await db.select().from(sessions);
		expect(session).toMatchObject({ userId: rows[0].id, mfaVerified: true });
		expect(await isOwner(db, rows[0].id)).toBe(true);
		// A new account starts on the setup guide.
		expect(parseProfileSettings(rows[0].settingsJson).onboarding).toEqual({
			step: 1,
			done: false
		});
	});

	it('refuses a taken email whatever its case, a short password and a bad address', async () => {
		const taken = await signup(db, { email: 'OWNER@example.com', password: 'another password' })
			.response;
		expect(taken.status).toBe(409);
		expect((await taken.json()).error).toMatch(/already exists/);

		const short = await signup(db, { email: 'new@example.com', password: 'short' }).response;
		expect(short.status).toBe(400);
		expect((await short.json()).error).toMatch(/at least 8 characters/);

		const bad = await signup(db, { email: 'not-an-email', password: 'long enough pw' }).response;
		expect(bad.status).toBe(400);
		expect(await db.select().from(users)).toHaveLength(1);
	});

	it('adds later accounts as members who sign in with their own email', async () => {
		const owner = await getAdminUser(db);
		const res = await signup(db, { email: 'member@example.com', password: 'member password' })
			.response;
		expect(res.status).toBe(201);
		const { id } = ((await res.json()) as { user: { id: string } }).user;
		expect(await isOwner(db, id)).toBe(false);
		expect((await getAdminUser(db))?.id).toBe(owner?.id);

		const { response, cookies } = login(db, {
			email: 'Member@Example.com',
			password: 'member password'
		});
		const signedIn = await response;
		expect(signedIn.status).toBe(200);
		expect(((await signedIn.json()) as { user: { id: string } }).user.id).toBe(id);
		expect(cookies.pe_session).toBeTruthy();

		const wrong = await login(db, { email: 'member@example.com', password: 'owner password' })
			.response;
		expect(wrong.status).toBe(401);
	});

	it('sends a signed-in visitor home instead of showing the form', async () => {
		await expect(
			signupLoad({
				locals: { db, env: TEST_ENV, user: { id: 'x', email: 'x@y' } }
			} as never)
		).rejects.toMatchObject({ status: 303, location: '/' });
		await expect(
			signupLoad({ locals: { db, env: TEST_ENV, user: null } } as never)
		).resolves.toEqual({ firstAccount: false });
	});
});
