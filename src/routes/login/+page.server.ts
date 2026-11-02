import { redirect } from '@sveltejs/kit';
import { needsSetup } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	// No account yet: the page points at sign-up, whose first account owns the instance.
	return { firstAccount: await needsSetup(locals.db) };
};
