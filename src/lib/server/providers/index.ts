import { isZernioConnection } from '#lib/domain/zernio.js';
import { blueskyProvider } from './bluesky';
import { facebookProvider } from './facebook';
import { instagramProvider } from './instagram';
import { linkedinProvider } from './linkedin';
import { threadsProvider } from './threads';
import { tiktokProvider } from './tiktok';
export {
	instagramProvider,
	instagramAuthorizeUrl,
	instagramExchangeCode,
	instagramVerify,
	PERSONAL_ACCOUNT_MESSAGE
} from './instagram';
import { xProvider } from './x';
import { youtubeProvider } from './youtube';
import { zernioProviderFor } from './zernio';
import { appkeepConnectionId, viaAppkeep } from './appkeep';
import type { PlatformId, PlatformProvider } from './types';

const providers: Record<PlatformId, PlatformProvider> = {
	bluesky: blueskyProvider,
	linkedin: linkedinProvider,
	threads: threadsProvider,
	instagram: instagramProvider,
	facebook: facebookProvider,
	youtube: youtubeProvider,
	tiktok: tiktokProvider,
	x: xProvider
};

export function getProvider(platform: PlatformId | string): PlatformProvider {
	const p = providers[platform as PlatformId];
	if (!p) throw new Error(`Unknown platform: ${platform}`);
	return p;
}

type ConnectionLike = { platform: string; metaJson?: string | null };

/** The provider a stored connection publishes through: the platform's own, the
 *  same through appkeep when appkeep holds the token, or Zernio when the row
 *  carries the marker. */
export function providerFor(conn: ConnectionLike): PlatformProvider {
	if (isZernioConnection(conn.metaJson)) return zernioProviderFor(conn.platform as PlatformId);
	const appkeepId = appkeepConnectionId(conn.metaJson);
	return appkeepId ? viaAppkeep(getProvider(conn.platform), appkeepId) : getProvider(conn.platform);
}

/** Key for publishCallEstimate: Zernio costs the same whatever the platform. */
export function estimateKeyFor(conn: ConnectionLike): string {
	return isZernioConnection(conn.metaJson) ? 'zernio' : conn.platform;
}

export * from './types';
export { zernioProviderFor, buildZernioPostBody, ZERNIO_MAX_POLLS } from './zernio';
export { providerFetch, timedFetch } from './timed-fetch';
export { APPKEEP_TOKEN, appkeepConnectionId, appkeepFetch, viaAppkeep } from './appkeep';
export { blueskyProvider, blueskyCreateSession, buildLinkFacets } from './bluesky';
export {
	linkedinProvider,
	linkedinAuthorizeUrl,
	linkedinExchangeCode,
	linkedinVerify,
	LINKEDIN_MAX_CHARS,
	LINKEDIN_MAX_IMAGES,
	LINKEDIN_MAX_IMAGE_BYTES
} from './linkedin';
export {
	threadsProvider,
	threadsAuthorizeUrl,
	threadsExchangeCode,
	threadsVerify,
	THREADS_MAX_CHARS
} from './threads';
export {
	xProvider,
	xAuthorizeUrl,
	xExchangeCode,
	xVerify,
	xPostUrl,
	generateCodeVerifier,
	codeChallenge,
	packXPendingSecret,
	unpackXPendingSecret,
	X_SCOPES,
	X_MAX_CHARS,
	X_MAX_IMAGES,
	X_MAX_IMAGE_BYTES
} from './x';
export {
	facebookProvider,
	facebookAuthorizeUrl,
	facebookExchangeCode,
	facebookVerify
} from './facebook';
export {
	tiktokProvider,
	tiktokAuthorizeUrl,
	tiktokExchangeCode,
	tiktokVerify,
	tiktokCreatorInfo,
	TIKTOK_MAX_CAPTION
} from './tiktok';
export {
	youtubeProvider,
	youtubeAuthorizeUrl,
	youtubeExchangeCode,
	youtubeVerify,
	youtubeVideoUrl
} from './youtube';
