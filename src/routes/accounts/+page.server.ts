import type { PageServerLoad } from './$types';
import { listConnections } from '#lib/server/connection-list.js';
import { requireUser } from '#lib/server/require.js';
import { oauthPlatformRecord } from '#lib/domain/platform-setup.js';
import { importAppkeepConnections, isAppkeepPlatform } from '#lib/server/appkeep-connections.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals.user);
	// Back from connecting through appkeep (?connected=facebook): add the accounts it now holds.
	const connected = url.searchParams.get('connected');
	const importError: string | null =
		locals.env.appkeep && connected && isAppkeepPlatform(connected)
			? await importAppkeepConnections(locals.db, locals.env, user.id, connected).then(
					() => null,
					(err) => {
						console.error('[accounts] appkeep import failed', err);
						return err instanceof Error ? err.message : String(err);
					}
				)
			: null;
	try {
		return {
			...(await listConnections(locals.db, locals.env, user.id)),
			importError,
			loadFailed: false
		};
	} catch (err) {
		// A transient D1 error must not turn the page into a 500: the client
		// keeps its retry path, which this flag arms.
		console.error('[accounts] list failed', err);
		return {
			connections: [],
			configured: oauthPlatformRecord(() => false),
			secrets: {},
			sources: oauthPlatformRecord(() => null),
			savedClientIds: oauthPlatformRecord(() => null),
			appUrl: locals.env.APP_URL,
			importError,
			loadFailed: true
		};
	}
};
