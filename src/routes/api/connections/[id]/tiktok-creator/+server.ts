import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { decryptJson, encryptJson } from '#lib/server/crypto.js';
import { first } from '#lib/server/db/client.js';
import { connections } from '#lib/server/db/schema.js';
import { fail, handleError, ok } from '#lib/server/http.js';
import { ProviderError, type ConnectionCredentials } from '#lib/server/providers/types.js';
import { APPKEEP_TOKEN, appkeepConnectionId, appkeepFetch } from '#lib/server/providers/appkeep.js';
import { tiktokCreatorInfo, tiktokProvider } from '#lib/server/providers/tiktok.js';
import { requireSession } from '#lib/server/require.js';

/**
 * What the TikTok account may post right now, for the composer's TikTok
 * settings. TikTok's guidelines have the app ask every time those settings are
 * shown, so nothing here is cached. Session-only, like verify: answering may
 * refresh the token and store the rotated one.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	let conn: typeof connections.$inferSelect | undefined;
	try {
		const user = requireSession(locals.user, locals.authMethod);
		conn = await first(
			locals.db
				.select()
				.from(connections)
				.where(
					and(
						eq(connections.id, params.id),
						eq(connections.userId, user.id),
						eq(connections.platform, 'tiktok'),
						eq(connections.status, 'active')
					)
				)
		);
	} catch (err) {
		return handleError(err);
	}
	if (!conn) return fail('Not found', 404);
	const owned = and(eq(connections.id, conn.id), eq(connections.userId, conn.userId));
	try {
		const creds = await decryptJson<ConnectionCredentials>(
			conn.credentialsEncrypted,
			locals.env.APP_ENCRYPTION_KEY
		);
		// Appkeep holds this account's token and keeps it fresh.
		const appkeepId = appkeepConnectionId(conn.metaJson);
		if (appkeepId)
			return ok(
				await tiktokCreatorInfo({ ...creds, accessToken: APPKEEP_TOKEN }, appkeepFetch(appkeepId))
			);
		const fresh = await tiktokProvider.refreshIfNeeded!(creds);
		if (fresh.accessToken !== creds.accessToken || fresh.refreshToken !== creds.refreshToken) {
			await locals.db
				.update(connections)
				.set({
					credentialsEncrypted: await encryptJson(fresh, locals.env.APP_ENCRYPTION_KEY),
					updatedAt: new Date()
				})
				.where(owned);
		}
		return ok(await tiktokCreatorInfo(fresh));
	} catch (err) {
		if (err instanceof ProviderError && err.code === 'auth') {
			await locals.db
				.update(connections)
				.set({ status: 'expired', updatedAt: new Date() })
				.where(owned);
			return fail('TikTok rejected the token — reconnect', 401);
		}
		if (err instanceof ProviderError && err.code === 'rate_limited') return fail(err.message, 429);
		if (err instanceof ProviderError) return fail(err.message, 502);
		return handleError(err);
	}
};
