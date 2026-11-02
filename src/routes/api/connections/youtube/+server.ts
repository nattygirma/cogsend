import type { RequestHandler } from './$types';
import { randomHex } from '#lib/domain/bytes.js';
import { OAUTH_PENDING_TTL_MS } from '#lib/domain/oauth-pending.js';
import { encryptSecret } from '#lib/server/crypto.js';
import { oauthPending } from '#lib/server/db/schema.js';
import { handleError, ok } from '#lib/server/http.js';
import { appkeepConnectUrl } from '#lib/server/appkeep-connections.js';
import { resolvePlatformCredentials } from '#lib/server/platform-credentials.js';
import { platformNotConfigured } from '#lib/server/platform-setup.js';
import { youtubeAuthorizeUrl } from '#lib/server/providers/youtube.js';
import { SESSION_COOKIE } from '#lib/server/auth.js';
import { bindOAuthState } from '#lib/server/oauth-state.js';
import { requireSession } from '#lib/server/require.js';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	try {
		const user = requireSession(locals.user, locals.authMethod);
		// On appkeep, appkeep's own Youtube app runs the login and keeps the token.
		if (locals.env.appkeep)
			return ok({ authorizeUrl: appkeepConnectUrl(locals.bindings, 'youtube') });
		const credentials = await resolvePlatformCredentials(locals.db, locals.env, 'youtube');
		const clientId = credentials?.values.YOUTUBE_CLIENT_ID;
		const clientSecret = credentials?.values.YOUTUBE_CLIENT_SECRET;
		if (!clientId || !clientSecret) return platformNotConfigured('youtube');
		const state = randomHex(16);
		const sessionId = cookies.get(SESSION_COOKIE) ?? `machine:${user.id}`;
		const bound = await bindOAuthState({
			secret: locals.env.AUTH_SECRET,
			pendingId: state,
			sessionId
		});
		await locals.db.insert(oauthPending).values({
			id: state,
			userId: user.id,
			instanceUrl: 'youtube',
			clientId,
			clientSecretEnc: await encryptSecret(clientSecret, locals.env.APP_ENCRYPTION_KEY),
			expiresAt: new Date(Date.now() + OAUTH_PENDING_TTL_MS),
			createdAt: new Date()
		});
		return ok({
			authorizeUrl: youtubeAuthorizeUrl(clientId, locals.env.APP_URL, bound)
		});
	} catch (err) {
		return handleError(err);
	}
};
