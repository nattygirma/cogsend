import type { PageServerLoad } from './$types';
import { platformRank } from '#lib/domain/platforms.js';
import {
	loadDashboardAccounts,
	loadDashboardCounts,
	loadUpcomingPosts
} from '#lib/server/calendar.js';
import { requireUser } from '#lib/server/require.js';
import { schedulerHealth } from '#lib/server/scheduler.js';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals.user);
	const now = Date.now();
	const [counts, upcoming, accounts, health] = await Promise.all([
		loadDashboardCounts(locals.db, user.id, now),
		loadUpcomingPosts(locals.db, user.id, 8),
		loadDashboardAccounts(locals.db, user.id),
		schedulerHealth(locals.db)
	]);
	return {
		user: locals.user,
		displayName: user.displayName ?? null,
		timezone: user.timezone || 'UTC',
		now,
		scheduledCount: counts.scheduled,
		publishedThisWeek: counts.publishedThisWeek,
		draftCount: counts.drafts,
		failedCount: counts.failed,
		upcoming,
		accounts: accounts.sort((a, b) => platformRank(a.platform) - platformRank(b.platform)),
		schedulerOk: health.ok,
		schedulerNeverTicked: health.lastTickAt === null,
		schedulerError: health.error ?? null,
		stuckPublishing: health.stuckPublishing,
		overdue: health.overdue
	};
};
