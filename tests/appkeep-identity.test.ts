import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { handle } from '../src/hooks.server';
import { useWorkerEnv } from './cloudflare-workers';
import { appkeepIdentity, appkeepLoginUrl } from '#lib/server/appkeep.js';
import { ensureSchema } from '#lib/server/db/init-sql.js';

/**
 * On appkeep, appkeep signs people in and forwards who they are as
 * x-altstack-* headers, stripping any a browser sent. Those headers are only
 * trusted when the app really runs there (ALTSTACK_DEPLOYMENT_ID is set):
 * anywhere else they are text a client typed, and must sign nobody in.
 */

function d1Shim(client: Client): D1Database {
	const rows = async (sql: string, args: unknown[] = []) =>
		(await client.execute({ sql, args: args as never })) as unknown as { rows: unknown[] };
	return {
		exec: (sql: string) => client.executeMultiple(sql) as unknown as Promise<unknown>,
		batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => {
			const out = [];
			for (const s of stmts) out.push(await s.run());
			return out;
		},
		prepare: (sql: string) => {
			const stmt = (bindArgs: unknown[] = []) => ({
				run: async () => {
					await client.execute({ sql, args: bindArgs as never });
					return { success: true, meta: {} };
				},
				all: async () => ({ results: (await rows(sql, bindArgs)).rows, success: true, meta: {} }),
				raw: async () =>
					(await rows(sql, bindArgs)).rows.map((row) =>
						Object.values(row as Record<string, unknown>)
					),
				first: async () => (await rows(sql, bindArgs)).rows[0] ?? null,
				bind: (...args: unknown[]) => stmt(args)
			});
			return stmt();
		}
	} as unknown as D1Database;
}

const KEY = 'feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface';
const PERSON = {
	'x-altstack-owner-id': 'usr_1',
	'x-altstack-owner-email': 'Maria@Example.com',
	'x-altstack-owner-name': encodeURIComponent('María López'),
	'x-altstack-role': 'owner'
};

describe('appkeep identity', () => {
	let client: Client;
	let binding: D1Database;

	beforeAll(async () => {
		client = createClient({ url: ':memory:' });
		binding = d1Shim(client);
		await ensureSchema(binding);
	});
	afterAll(() => client.close());

	async function request(
		path: string,
		opts: { appkeep: boolean; headers?: Record<string, string> }
	): Promise<{ routedAs: string | null; status: number; location: string | null }> {
		let routedAs: string | null = null;
		const url = new URL(`https://posteasy.appkeep.app${path}`);
		useWorkerEnv({
			DB: binding,
			APP_ENCRYPTION_KEY: KEY,
			MEDIA: {},
			...(opts.appkeep
				? {
						ALTSTACK_DEPLOYMENT_ID: 'dep_test',
						ALTSTACK_APP_URL: 'https://posteasy.appkeep.app'
					}
				: { APP_URL: 'https://posteasy.appkeep.app' })
		});
		const locals: Record<string, unknown> = {};
		const response = await handle({
			event: {
				url,
				request: new Request(url, { headers: opts.headers ?? {} }),
				cookies: {
					get: () => undefined,
					set: () => {},
					delete: () => {},
					getAll: () => [],
					serialize: () => ''
				},
				locals,
				fetch: async () => new Response('ok'),
				params: {},
				route: { id: path },
				setHeaders: {}
			},
			resolve: async () => {
				routedAs = (locals.user as { email?: string } | null)?.email ?? 'nobody';
				return new Response('routed', { status: 200 });
			}
		} as never);
		return { routedAs, status: response.status, location: response.headers.get('location') };
	}

	it('reads who is signed in from the headers appkeep sends', () => {
		expect(appkeepIdentity(new Headers(PERSON))).toEqual({
			email: 'maria@example.com',
			name: 'María López',
			avatarUrl: null
		});
		expect(appkeepIdentity(new Headers({ 'x-altstack-owner-email': 'a@b.co' }))).toBeNull();
		expect(
			appkeepIdentity(
				new Headers({ ...PERSON, 'x-altstack-owner-avatar': 'http://insecure.example/a.png' })
			)?.avatarUrl
		).toBeNull();
		expect(appkeepLoginUrl('/calendar?week=1')).toBe(
			'/_altstack/login?next=%2Fcalendar%3Fweek%3D1'
		);
	});

	it('signs the appkeep person in, creating their account on the first visit', async () => {
		const first = await request('/', { appkeep: true, headers: PERSON });
		expect(first.routedAs).toBe('maria@example.com');
		const second = await request('/calendar', { appkeep: true, headers: PERSON });
		expect(second.routedAs).toBe('maria@example.com');
		const rows = await client.execute(
			"SELECT settings_json FROM users WHERE email = 'maria@example.com'"
		);
		expect(rows.rows).toHaveLength(1);
		// A first visit starts on the setup guide, as a sign-up does.
		expect(String(rows.rows[0].settings_json)).toContain('"onboarding"');
	});

	it('sends a signed-out visitor to appkeep sign-in, back to the page they wanted', async () => {
		const result = await request('/calendar?week=2', { appkeep: true });
		expect(result.status).toBe(303);
		expect(result.location).toBe('/_altstack/login?next=%2Fcalendar%3Fweek%3D2');
	});

	it("hands this app's own sign-in, sign-up and sign-out to appkeep", async () => {
		expect((await request('/login', { appkeep: true })).location).toBe('/_altstack/login?next=%2F');
		expect((await request('/signup', { appkeep: true, headers: PERSON })).location).toBe('/');
		expect((await request('/api/auth/login', { appkeep: true })).status).toBe(404);
		expect((await request('/api/auth/signup', { appkeep: true })).status).toBe(404);
	});

	it('trusts nobody by those headers when it is not running on appkeep', async () => {
		const result = await request('/calendar', { appkeep: false, headers: PERSON });
		expect(result.routedAs).toBeNull();
		expect(result.status).toBe(303);
		expect(result.location).toBe('/login');
		const forged = await client.execute(
			"SELECT count(*) AS n FROM users WHERE email = 'maria@example.com'"
		);
		// Only the appkeep-mode visits above created the row; this one added nothing.
		expect(Number(forged.rows[0].n)).toBe(1);
	});
});
