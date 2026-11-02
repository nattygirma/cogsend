import { count, ne } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { isOwner } from '#lib/server/auth.js';
import { first } from '#lib/server/db/client.js';
import { users } from '#lib/server/db/schema.js';
import { requireUser } from '#lib/server/require.js';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals.user);
	const owner = await isOwner(locals.db, user.id);
	// The owner can only leave once nobody else is left in the workspace.
	const others = owner
		? ((await first(locals.db.select({ n: count() }).from(users).where(ne(users.id, user.id))))
				?.n ?? 0)
		: 0;
	return {
		email: user.email,
		timezone: user.timezone,
		owner,
		otherAccounts: others
	};
};
