import type { RequestHandler } from './$types';
import { createSession, findUserByEmail, getAdminUser } from '#lib/server/auth.js';
import { hashPassword, verifyPassword } from '#lib/server/crypto.js';
import {
	PASSWORD_GATE_GLOBAL_MAX,
	assertAuthGateOpen,
	assertPasswordGateOpen,
	clearPasswordGate,
	clientAddressBucket,
	recordAuthGateFailure,
	recordPasswordFailure
} from '#lib/server/auth-gate.js';
import { rateLimitKey } from '#lib/server/rate-limit.js';
import { setSessionCookie } from '#lib/server/cookies.js';
import { fail, handleError, ok } from '#lib/server/http.js';

// An unknown address is checked against this hash, so a wrong email takes as
// long as a wrong password and the response time cannot confirm an account.
let dummyHash: Promise<string> | null = null;
function timingHash(): Promise<string> {
	dummyHash ??= hashPassword('not-a-real-password');
	return dummyHash;
}

const LOCKED = 'Too many attempts — try again in 15 minutes';
const INVALID = 'Invalid email or password';

export const POST: RequestHandler = async ({ request, locals, cookies, url }) => {
	try {
		const body = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') return fail('Invalid JSON body', 400);
		const email = String(body.email || '').trim();
		const password = String(body.password || '');
		const remember = body.remember !== false;
		if (!email || !password) return fail('Email and password required');
		const user = await findUserByEmail(locals.db, email);
		const ip = rateLimitKey(request.headers);
		// Guesses at addresses that have no account are counted per client
		// address, on rows anchored to the owner (gate rows belong to a user).
		// That count is checked for every sign-in from the address, so a locked
		// address stays locked whichever email it tries next, and the lockout
		// cannot confirm which email is real. Without an address there is
		// nothing to hold such a guess to, so it is not counted.
		const anchor = await getAdminUser(locals.db);
		const bucket = clientAddressBucket(ip);
		const unknownScope = bucket ? `unknown:${bucket}` : undefined;
		if (anchor && unknownScope) {
			await assertAuthGateOpen(locals.db, locals.env, anchor.id, 'password', {
				scope: unknownScope
			});
		}
		if (user) await assertPasswordGateOpen(locals.db, locals.env, user.id, ip);

		const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await timingHash()));
		if (!user) {
			if (!anchor || !unknownScope) return fail(INVALID, 401);
			const own = await recordAuthGateFailure(locals.db, locals.env, anchor.id, 'password', {
				scope: unknownScope
			});
			// A second write, as a wrong password makes, so timing cannot tell the two apart.
			await recordAuthGateFailure(locals.db, locals.env, anchor.id, 'password-all', {
				max: PASSWORD_GATE_GLOBAL_MAX,
				scope: 'unknown-email'
			});
			return fail(own.locked ? LOCKED : INVALID, 401);
		}
		if (!passwordOk) {
			const gate = await recordPasswordFailure(locals.db, locals.env, user.id, ip);
			return fail(gate.locked ? LOCKED : INVALID, 401);
		}
		await clearPasswordGate(locals.db, locals.env, user.id, ip);
		const { raw, maxAge } = await createSession(
			locals.db,
			locals.env,
			user.id,
			remember,
			true,
			user.passwordHash
		);
		setSessionCookie(cookies, locals.env, url.host, raw, maxAge);
		return ok({ user: { id: user.id, email: user.email } });
	} catch (err) {
		return handleError(err);
	}
};
