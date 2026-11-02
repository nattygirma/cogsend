import type { PlatformId } from '#lib/domain/platforms.js';
import type { AppDb } from './db/client';
import type { AppEnv } from './env';
import { upsertConnection } from './oauth-callback';
import { APPKEEP_TOKEN, appkeepFetch } from './providers/appkeep';
import {
	facebookVerify,
	instagramVerify,
	linkedinVerify,
	threadsVerify,
	tiktokVerify,
	xVerify,
	youtubeVerify,
	type ConnectionCredentials,
	type FetchLike
} from './providers/index';

/** On appkeep every platform connects through appkeep's own apps (see providers/appkeep.ts). */
export const APPKEEP_PLATFORMS = [
	'x',
	'threads',
	'instagram',
	'facebook',
	'youtube',
	'tiktok',
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
	disconnect(connectionId: string): Promise<boolean>;
};

/** `locals.bindings.ALTSTACK`: appkeep's binding for this copy of the app. */
function altstack(bindings: unknown): Altstack {
	const binding = (bindings as { ALTSTACK?: Altstack } | undefined)?.ALTSTACK;
	if (!binding) throw new Error('appkeep connections are only available on appkeep');
	return binding;
}

/** Where Connect sends the person: appkeep's login for the platform, then back to Accounts. */
export function appkeepConnectUrl(bindings: unknown, platform: AppkeepPlatform): string {
	return altstack(bindings).connectUrl(platform, '/accounts');
}

/** Removes the account from appkeep too, so it stops being usable and doesn't come back on the next import. */
export async function appkeepDisconnect(bindings: unknown, connectionId: string): Promise<void> {
	await altstack(bindings).disconnect(connectionId);
}

/** Each platform's id for the account, as stored in credentials and meta (reconnects match on it). */
const ACCOUNT_ID_KEY = {
	x: 'xUserId',
	threads: 'threadsUserId',
	instagram: 'igUserId',
	facebook: 'pageId',
	tiktok: 'tiktokOpenId',
	youtube: 'channelId',
	linkedin: 'personUrn'
} as const satisfies Record<AppkeepPlatform, keyof ConnectionCredentials>;

const VERIFY = {
	x: xVerify,
	threads: threadsVerify,
	instagram: instagramVerify,
	facebook: facebookVerify,
	tiktok: tiktokVerify,
	youtube: youtubeVerify,
	linkedin: linkedinVerify
} satisfies Record<
	AppkeepPlatform,
	(creds: ConnectionCredentials, fetchImpl: FetchLike) => Promise<unknown>
>;

/** The longest post each platform takes, where the provider reads it from meta. */
const MAX_CHARACTERS: Partial<Record<AppkeepPlatform, number>> = { linkedin: 3000, threads: 500 };

/** The ids a provider needs for an account appkeep holds, from appkeep's id and name for it. */
function accountIds(platform: AppkeepPlatform, c: AppkeepConnection): ConnectionCredentials {
	const username = c.name.replace(/^@/, '');
	switch (platform) {
		// Appkeep names a LinkedIn member by their OpenID sub; posts go to their person URN.
		case 'linkedin':
			return { personUrn: `urn:li:person:${c.external_id}`, openIdSub: c.external_id };
		case 'x':
			return { xUserId: c.external_id, xUsername: username };
		case 'threads':
			return { threadsUserId: c.external_id, threadsUsername: username };
		default:
			return { [ACCOUNT_ID_KEY[platform]]: c.external_id };
	}
}

/** Who an appkeep connection is, read through it, for the Accounts page. */
export async function verifyAppkeepConnection(
	platform: AppkeepPlatform,
	connectionId: string,
	creds: ConnectionCredentials
): Promise<{ displayName?: string; avatarUrl?: string; handle?: string }> {
	return VERIFY[platform]({ ...creds, accessToken: APPKEEP_TOKEN }, appkeepFetch(connectionId));
}

/**
 * Adds (or revives) a row for each account appkeep holds for `platform`, so a
 * second or third account shows up next to the first. Runs when the person
 * comes back from connecting.
 */
export async function importAppkeepConnections(
	db: AppDb,
	env: AppEnv,
	bindings: unknown,
	userId: string,
	platform: AppkeepPlatform
): Promise<number> {
	const found = (await altstack(bindings).connections(platform)).filter(
		(c) => c.status === 'active'
	);
	const key = ACCOUNT_ID_KEY[platform];
	for (const c of found) {
		const ids = accountIds(platform, c);
		// The name appkeep stored is enough to show; the profile adds a photo and handle.
		const info = await verifyAppkeepConnection(platform, c.id, ids).catch(
			() => ({}) as Awaited<ReturnType<typeof verifyAppkeepConnection>>
		);
		const max = MAX_CHARACTERS[platform];
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
				meta: { [key]: ids[key], ...(max ? { maxCharacters: max } : {}), appkeepConnectionId: c.id }
			}
		);
	}
	return found.length;
}
