import { createOAuthCallback } from '#lib/server/oauth-callback.js';
import { decryptSecret } from '#lib/server/crypto.js';
import { youtubeExchangeCode } from '#lib/server/providers/youtube.js';

export const GET = createOAuthCallback({
	platform: 'youtube',
	pendingMarker: 'youtube',
	accountIdKey: 'channelId',
	async complete({ pending, code, env }) {
		const clientSecret = await decryptSecret(pending.clientSecretEnc, env.APP_ENCRYPTION_KEY);
		const exchanged = await youtubeExchangeCode({
			clientId: pending.clientId,
			clientSecret,
			code,
			appUrl: env.APP_URL
		});
		return {
			// The client secret is kept with the tokens: refreshing needs it, and
			// refreshIfNeeded has no access to the deployment's settings.
			credentials: {
				accessToken: exchanged.accessToken,
				refreshToken: exchanged.refreshToken,
				expiresAt: exchanged.expiresAt,
				tokenType: 'Bearer',
				scopes: exchanged.scopes,
				clientId: pending.clientId,
				clientSecret,
				channelId: exchanged.channelId
			},
			displayName: exchanged.displayName,
			handle: exchanged.handle,
			avatarUrl: exchanged.avatarUrl,
			meta: { channelId: exchanged.channelId }
		};
	}
});
