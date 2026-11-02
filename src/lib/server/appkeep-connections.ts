import { env as workerEnv } from 'cloudflare:workers';
import type { PlatformId } from '#lib/domain/platforms.js';
import type { AppDb } from './db/client';
import type { AppEnv } from './env';
import { upsertConnection } from './oauth-callback';
import { APPKEEP_TOKEN, appkeepFetch } from './providers/appkeep';
import {
	facebookVerify,
	instagramVerify,
	linkedinVerify,
	tiktokVerify,
	youtubeVerify,
	type ConnectionCredentials,
	type FetchLike
} from './providers/index';

/** Platforms appkeep connects for this app on appkeep (see providers/appkeep.ts). */
export const APPKEEP_PLATFORMS = [
	'instagram',
	'facebook',
	'tiktok',
	'youtube',
	'linkedin'
] as const;
type AppkeepPlatform = (typeof APPKEEP_PLATFORMS)[number];

export const isAppkeepPlatform = (platform: string): platform is AppkeepPlatform =>
	(APPKEEP_PLATFORMS as readonly string[]).includes(platform);

type AppkeepConnection = {
	id: string;
	provider: string;
	external_id: string;
	name: string;
	status: string;
	scopes: string[];
};
type Altstack = {
	connections(provider?: string): Promise<AppkeepConnection[]>;
	connectUrl(provider: string, next?: string): string;
};

function altstack(): Altstack {
	const binding = (workerEnv as { ALTSTACK?: Altstack }).ALTSTACK;
	if (!binding) throw new Error('appkeep connections are only available on appkeep');
	return binding;
}

/** Where Connect sends the person: appkeep's login for the platform, then back to Accounts. */
export function appkeepConnectUrl(platform: AppkeepPlatform): string {
	return altstack().connectUrl(platform, '/accounts');
}

/** Each platform's id for the account, as stored in credentials and meta (reconnects match on it). */
const ACCOUNT_ID_KEY = {
	instagram: 'igUserId',
	facebook: 'pageId',
	tiktok: 'tiktokOpenId',
	youtube: 'channelId',
	linkedin: 'personUrn'
} as const satisfies Record<AppkeepPlatform, keyof ConnectionCredentials>;

const VERIFY = {
	instagram: instagramVerify,
	facebook: facebookVerify,
	tiktok: tiktokVerify,
	youtube: youtubeVerify,
	linkedin: linkedinVerify
} satisfies Record<
	AppkeepPlatform,
	(creds: ConnectionCredentials, fetchImpl: FetchLike) => Promise<unknown>
>;

/** Who an appkeep connection is, read through it, for the Accounts page. */
export async function verifyAppkeepConnection(
	platform: AppkeepPlatform,
	connectionId: string,
	creds: ConnectionCredentials
): Promise<{ displayName?: string; avatarUrl?: string; handle?: string }> {
	return VERIFY[platform]({ ...creds, accessToken: APPKEEP_TOKEN }, appkeepFetch(connectionId));
}

/**
 * Adds (or revives) a row for each account appkeep holds for `platform`.
 * Runs when the person comes back from connecting, so an account they
 * removed here stays removed until they connect it again.
 */
export async function importAppkeepConnections(
	db: AppDb,
	env: AppEnv,
	userId: string,
	platform: AppkeepPlatform
): Promise<number> {
	const found = (await altstack().connections(platform)).filter((c) => c.status === 'active');
	const key = ACCOUNT_ID_KEY[platform];
	for (const c of found) {
		// Appkeep names a LinkedIn member by their OpenID sub; posts go to their person URN.
		const ids: ConnectionCredentials =
			platform === 'linkedin'
				? { personUrn: `urn:li:person:${c.external_id}`, openIdSub: c.external_id }
				: { [key]: c.external_id };
		// The name appkeep stored is enough to show; the profile adds a photo and handle.
		const info = await verifyAppkeepConnection(platform, c.id, ids).catch(
			() => ({}) as Awaited<ReturnType<typeof verifyAppkeepConnection>>
		);
		await upsertConnection(
			db,
			env,
			userId,
			{ platform: platform as PlatformId, accountIdKey: key },
			{
				credentials: { accessToken: APPKEEP_TOKEN, scopes: c.scopes, ...ids },
				displayName: info.displayName || c.name,
				handle: info.handle || c.name,
				avatarUrl: info.avatarUrl ?? null,
				meta: {
					[key]: ids[key],
					...(platform === 'linkedin' ? { maxCharacters: 3000 } : {}),
					appkeepConnectionId: c.id
				}
			}
		);
	}
	return found.length;
}
