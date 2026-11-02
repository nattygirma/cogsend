import type { RequestHandler } from './$types';
import { and, eq, ne } from 'drizzle-orm';
import { SESSION_COOKIE, hashToken } from '#lib/server/auth.js';
import { sessions } from '#lib/server/db/schema.js';
import { handleError, ok } from '#lib/server/http.js';
import { requireSession } from '#lib/server/require.js';

/** Sign out every other browser and device; this one stays signed in. */
export const DELETE: RequestHandler = async ({ locals, cookies }) => {
	try {
		const user = requireSession(locals.user, locals.authMethod);
		const raw = cookies.get(SESSION_COOKIE);
		const current = raw ? await hashToken(raw, locals.env.AUTH_SECRET) : '';
		const removed = await locals.db
			.delete(sessions)
			.where(and(eq(sessions.userId, user.id), ne(sessions.token, current)))
			.returning({ id: sessions.id });
		return ok({ ok: true, signedOut: removed.length });
	} catch (err) {
		return handleError(err);
	}
};
