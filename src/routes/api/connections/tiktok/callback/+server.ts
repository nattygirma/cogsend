import { createOAuthCallback } from '#lib/server/oauth-callback.js';
import { decryptSecret } from '#lib/server/crypto.js';
import { tiktokExchangeCode } from '#lib/server/providers/tiktok.js';

export const GET = createOAuthCallback({
	platform: 'tiktok',
	pendingMarker: 'tiktok',
	accountIdKey: 'tiktokOpenId',
	async complete({ pending, code, env }) {
		const clientSecret = await decryptSecret(pending.clientSecretEnc, env.APP_ENCRYPTION_KEY);
		const exchanged = await tiktokExchangeCode({
			clientKey: pending.clientId,
			clientSecret,
			code,
			appUrl: env.APP_URL
		});
		return {
			// The secret stays in the row, as for X and LinkedIn: refreshing a
			// TikTok token needs it.
			credentials: { ...exchanged.credentials },
			displayName: exchanged.displayName,
			handle: exchanged.handle,
			avatarUrl: exchanged.avatarUrl,
			meta: { tiktokOpenId: exchanged.openId }
		};
	}
});
