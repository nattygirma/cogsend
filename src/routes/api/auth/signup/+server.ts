import type { RequestHandler } from './$types';
import { createSession, findUserByEmail } from '#lib/server/auth.js';
import { hashPassword } from '#lib/server/crypto.js';
import { setSessionCookie } from '#lib/server/cookies.js';
import { newId } from '#lib/server/db/client.js';
import { users } from '#lib/server/db/schema.js';
import { fail, handleError, ok } from '#lib/server/http.js';
import { emailProblem, normalizeEmail, passwordProblem } from '#lib/domain/credentials.js';

const DISPLAY_NAME_MAX = 80;

/**
 * Anyone can create an account. The first one becomes the instance owner
 * (auth.ts getAdminUser); the rest manage their own posts and accounts.
 */
export const POST: RequestHandler = async ({ request, locals, cookies, url }) => {
	try {
		const body = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') return fail('Invalid JSON body', 400);
		const payload = body as Record<string, unknown>;
		const email = normalizeEmail(String(payload.email ?? ''));
		const password = String(payload.password ?? '');
		const displayName = String(payload.displayName ?? '')
			.trim()
			.slice(0, DISPLAY_NAME_MAX);
		const issue = emailProblem(email) ?? passwordProblem(password);
		if (issue) return fail(issue, 400);
		if (await findUserByEmail(locals.db, email)) {
			return fail('An account with this email already exists — sign in instead', 409);
		}
		const passwordHash = await hashPassword(password);
		const now = new Date();
		const id = newId();
		try {
			await locals.db.insert(users).values({
				id,
				email,
				passwordHash,
				displayName: displayName || null,
				// A new account starts on the setup guide.
				settingsJson: JSON.stringify({ onboarding: { step: 1, done: false } }),
				createdAt: now,
				updatedAt: now
			});
		} catch {
			// Two sign-ups racing for one address: the unique index decides.
			return fail('An account with this email already exists — sign in instead', 409);
		}
		const { raw, maxAge } = await createSession(
			locals.db,
			locals.env,
			id,
			true,
			true,
			passwordHash
		);
		setSessionCookie(cookies, locals.env, url.host, raw, maxAge);
		return ok({ user: { id, email } }, 201);
	} catch (err) {
		return handleError(err);
	}
};
