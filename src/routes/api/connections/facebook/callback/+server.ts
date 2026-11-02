import { createOAuthCallback } from '#lib/server/oauth-callback.js';
import { decryptSecret } from '#lib/server/crypto.js';
import { facebookExchangeCode } from '#lib/server/providers/facebook.js';

export const GET = createOAuthCallback({
	platform: 'facebook',
	pendingMarker: 'facebook',
	accountIdKey: 'pageId',
	async complete({ pending, code, env }) {
		const appSecret = await decryptSecret(pending.clientSecretEnc, env.APP_ENCRYPTION_KEY);
		const pages = await facebookExchangeCode({
			appId: pending.clientId,
			appSecret,
			code,
			appUrl: env.APP_URL
		});
		// One connection per Page the person granted. Page tokens never expire,
		// so the app secret stays out of the rows, as for Instagram.
		return pages.map((page) => ({
			credentials: {
				accessToken: page.accessToken,
				pageId: page.pageId,
				clientId: pending.clientId
			},
			displayName: page.name,
			handle: page.username || page.name,
			avatarUrl: page.avatarUrl ?? null,
			meta: { pageId: page.pageId }
		}));
	}
});
