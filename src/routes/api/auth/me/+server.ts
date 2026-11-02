import { eq, inArray, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { isOwner } from '#lib/server/auth.js';
import { clearMfaCookie, clearSessionCookie } from '#lib/server/cookies.js';
import { chunkIds, first } from '#lib/server/db/client.js';
import { draftMedia, drafts, users } from '#lib/server/db/schema.js';
import { fail, handleError, ok } from '#lib/server/http.js';
import { requireSession } from '#lib/server/require.js';
import {
	assertPasswordGateOpen,
	clearPasswordGate,
	recordPasswordFailure
} from '#lib/server/auth-gate.js';
import { rateLimitKey } from '#lib/server/rate-limit.js';
import { verifyPassword } from '#lib/server/crypto.js';
import { deleteMediaObjects } from '#lib/server/media.js';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	return ok({
		user: user ? { id: user.id, email: user.email, timezone: user.timezone } : null,
		isOwner: user ? await isOwner(locals.db, user.id) : false
	});
};

/** Objects removed per round trip to R2. R2 takes 1,000 keys in one call, and
 *  the row deletes that follow cost D1 statements (50 per invocation on Free),
 *  so this stays well inside both budgets. */
const MEDIA_DELETE_BATCH = 200;
/** Batches per request — 2,000 objects, which is 10 subrequests and ~30 D1
 *  statements, both well inside the free plan's limit of 50. A library larger
 *  than that is deleted over several requests rather than one that cannot
 *  finish; the rows for each batch go as it lands, so a retry resumes. */
const MAX_MEDIA_BATCHES = 10;

/**
 * Remove media objects for this user, deleting each batch's rows as it goes so
 * that a request which dies part-way leaves rows only for what is still there —
 * the next call resumes instead of walking the same list again. Returns whether
 * everything is gone.
 */
async function deleteMedia(
	locals: App.Locals,
	userId: string
): Promise<{ deleted: number; done: boolean }> {
	let deleted = 0;
	for (let batch = 0; batch < MAX_MEDIA_BATCHES; batch++) {
		const files = await locals.db
			.select({ id: draftMedia.id, storageKey: draftMedia.storageKey })
			.from(draftMedia)
			.innerJoin(drafts, eq(draftMedia.draftId, drafts.id))
			.where(eq(drafts.userId, userId))
			.limit(MEDIA_DELETE_BATCH);
		if (!files.length) return { deleted, done: true };

		await deleteMediaObjects(
			locals.media,
			files.map((f) => f.storageKey)
		);

		// One statement per 100 ids: the ids come from a select this request
		// already paid for, and D1 caps a statement at 100 bound parameters.
		for (const chunk of chunkIds(files.map((f) => f.id))) {
			await locals.db.delete(draftMedia).where(inArray(draftMedia.id, chunk));
		}
		deleted += files.length;
		// A short batch is the last one: there is nothing left to read.
		if (files.length < MEDIA_DELETE_BATCH) return { deleted, done: true };
	}
	return { deleted, done: false };
}

/**
 * Permanently delete the signed-in account and all of its data (drafts,
 * connections, targets, keys — everything cascades off users).
 *
 * Session-only, and re-authenticated with the password behind the same gate as
 * the sign-in form: a live session alone (an unattended browser, a stolen
 * cookie) must not be able to destroy an account. The owner holds what the
 * whole instance shares, so it goes last, once nobody else is left.
 */
export const DELETE: RequestHandler = async ({ request, locals, cookies, url }) => {
	try {
		const user = requireSession(locals.user, locals.authMethod);
		const body = await request.json().catch(() => null);
		const password = String((body as Record<string, unknown> | null)?.password ?? '');
		if (!password) return fail('Enter your password to confirm', 400);
		const row = await first(locals.db.select().from(users).where(eq(users.id, user.id)));
		if (!row) return fail('Account not found', 404);

		if (await isOwner(locals.db, row.id)) {
			const others = await first(
				locals.db.select({ id: users.id }).from(users).where(ne(users.id, row.id)).limit(1)
			);
			if (others) {
				return fail(
					'You own this workspace. Other people still have accounts here, so it cannot be deleted until they delete theirs.',
					409
				);
			}
		}

		const ip = rateLimitKey(request.headers);
		await assertPasswordGateOpen(locals.db, locals.env, row.id, ip);
		if (!(await verifyPassword(password, row.passwordHash))) {
			const gate = await recordPasswordFailure(locals.db, locals.env, row.id, ip);
			return fail(
				gate.locked ? 'Too many attempts — try again later' : 'That password is not correct',
				401
			);
		}
		await clearPasswordGate(locals.db, locals.env, row.id, ip);

		// Cascade wipes all rows but not R2 bytes: remove media objects first so a
		// crash leaves retryable rows instead of orphaned bytes. A library too
		// large for one request is deleted in installments — the account stays
		// until the objects are gone, and the caller is told to come back.
		const { deleted, done } = await deleteMedia(locals, user.id);
		if (!done) {
			return ok(
				{
					ok: false,
					deletedMedia: deleted,
					message: 'Still deleting media — confirm again to continue'
				},
				202
			);
		}
		await locals.db.delete(users).where(eq(users.id, user.id));
		clearSessionCookie(cookies, locals.env, url.host);
		clearMfaCookie(cookies, locals.env, url.host);
		return ok({ ok: true });
	} catch (err) {
		return handleError(err);
	}
};
