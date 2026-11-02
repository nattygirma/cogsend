import { redirect } from '@sveltejs/kit';
import { needsSetup } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { firstAccount: await needsSetup(locals.db) };
};
