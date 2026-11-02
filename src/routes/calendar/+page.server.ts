import type { PageServerLoad } from './$types';
import { bucketByDay, calendarWeek, parseWeekOffset } from '#lib/domain/calendar.js';
import { isPlatformId, platformRank } from '#lib/domain/platforms.js';
import {
	loadCalendarPosts,
	loadDashboardAccounts,
	loadUpcomingPosts
} from '#lib/server/calendar.js';
import { requireUser } from '#lib/server/require.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals.user);
	const timeZone = user.timezone || 'UTC';
	const weekOffset = parseWeekOffset(url.searchParams.get('week'));
	const rawPlatform = url.searchParams.get('platform');
	const platform = rawPlatform && isPlatformId(rawPlatform) ? rawPlatform : null;
	const week = calendarWeek(Date.now(), weekOffset, timeZone);
	const [posts, upcoming, accounts] = await Promise.all([
		loadCalendarPosts(locals.db, user.id, week.startMs, week.endMs, platform),
		loadUpcomingPosts(locals.db, user.id, 10),
		loadDashboardAccounts(locals.db, user.id)
	]);
	const buckets = bucketByDay(posts, week.days, timeZone);
	const platforms = [...new Set(accounts.map((a) => a.platform))].sort(
		(a, b) => platformRank(a) - platformRank(b)
	);
	return {
		timeZone,
		weekOffset,
		platform,
		platforms,
		label: week.label,
		days: week.days.map((day) => ({ ...day, posts: buckets.get(day.key) ?? [] })),
		total: posts.length,
		upcoming: platform ? upcoming.filter((p) => p.platforms.includes(platform)) : upcoming
	};
};
