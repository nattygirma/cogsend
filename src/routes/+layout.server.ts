import type { LayoutServerLoad } from './$types';
import { readStoredAppName } from '#lib/server/app-settings.js';
import { isOwner } from '#lib/server/auth.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	// Name and photo ride along on the session read in hooks, so this load
	// does not query the user again.
	const storedAppName = await readStoredAppName(locals.db);
	return {
		user: locals.user,
		displayName: locals.user?.displayName ?? null,
		profilePictureUrl: locals.user?.profilePictureUrl ?? '',
		onboarding: locals.user?.onboarding ?? null,
		appName: storedAppName ?? locals.env.APP_NAME,
		// On appkeep, signing out and account details belong to appkeep.
		appkeep: locals.env.appkeep,
		// Pages hide what only the workspace owner may change.
		isOwner: locals.user ? await isOwner(locals.db, locals.user.id) : false
	};
};
