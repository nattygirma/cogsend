import { and, asc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import {
	CALENDAR_STATUSES,
	groupCalendarPosts,
	type CalendarPost,
	type CalendarTargetRow
} from '#lib/domain/calendar.js';
import type { AppDb } from './db/client';
import { connections, drafts, publishTargets } from './db/schema';

// Every query checks ownership on both sides of the join: a destination is
// shown only when its account and its post are both this user's.
const targetFields = {
	targetId: publishTargets.id,
	draftId: publishTargets.draftId,
	status: publishTargets.status,
	scheduledFor: publishTargets.scheduledFor,
	updatedAt: publishTargets.updatedAt,
	platform: connections.platform,
	handle: connections.handle,
	displayName: connections.displayName,
	title: drafts.title,
	baseBody: drafts.baseBody
};

/** A "publish now" row has no slot, so it sits where it was last touched. */
const whenSql = sql`coalesce(${publishTargets.scheduledFor}, ${publishTargets.updatedAt})`;

/**
 * Every post with a destination in [startMs, endMs), optionally only those
 * going to one platform. Capped: a week with more than this many destinations
 * shows the first ones in time order.
 */
export async function loadCalendarPosts(
	db: AppDb,
	userId: string,
	startMs: number,
	endMs: number,
	platform?: string | null,
	limit = 500
): Promise<CalendarPost[]> {
	const rows = (await db
		.select(targetFields)
		.from(publishTargets)
		.innerJoin(connections, eq(connections.id, publishTargets.connectionId))
		.innerJoin(drafts, eq(drafts.id, publishTargets.draftId))
		.where(
			and(
				eq(connections.userId, userId),
				eq(drafts.userId, userId),
				inArray(publishTargets.status, [...CALENDAR_STATUSES]),
				gte(whenSql, startMs),
				lt(whenSql, endMs),
				...(platform ? [eq(connections.platform, platform)] : [])
			)
		)
		.orderBy(asc(whenSql))
		.limit(limit)) as CalendarTargetRow[];
	return groupCalendarPosts(rows);
}

/** The next posts waiting to go out, soonest first. */
export async function loadUpcomingPosts(
	db: AppDb,
	userId: string,
	limit = 8
): Promise<CalendarPost[]> {
	const rows = (await db
		.select(targetFields)
		.from(publishTargets)
		.innerJoin(connections, eq(connections.id, publishTargets.connectionId))
		.innerJoin(drafts, eq(drafts.id, publishTargets.draftId))
		.where(
			and(
				eq(connections.userId, userId),
				eq(drafts.userId, userId),
				inArray(publishTargets.status, ['scheduled', 'pending', 'publishing'])
			)
		)
		.orderBy(asc(whenSql))
		// Several destinations collapse into one card, so read ahead.
		.limit(limit * 6)) as CalendarTargetRow[];
	return groupCalendarPosts(rows).slice(0, limit);
}

export interface DashboardCounts {
	scheduled: number;
	publishedThisWeek: number;
	failed: number;
	drafts: number;
}

/** The dashboard's numbers: posts (not destinations) where a post is the unit people think in. */
export async function loadDashboardCounts(
	db: AppDb,
	userId: string,
	nowMs: number
): Promise<DashboardCounts> {
	const owned = db
		.select({ id: connections.id })
		.from(connections)
		.where(eq(connections.userId, userId));
	const count = (where: ReturnType<typeof and>) =>
		db
			.select({ n: sql<number>`count(distinct ${publishTargets.draftId})` })
			.from(publishTargets)
			.where(and(inArray(publishTargets.connectionId, owned), where));
	const [scheduled, published, failed, draftCount] = await Promise.all([
		count(inArray(publishTargets.status, ['scheduled', 'pending', 'publishing'])),
		count(
			and(
				eq(publishTargets.status, 'published'),
				gte(publishTargets.updatedAt, new Date(nowMs - 7 * 24 * 60 * 60 * 1000))
			)
		),
		count(eq(publishTargets.status, 'failed')),
		db
			.select({ n: sql<number>`count(*)` })
			.from(drafts)
			.where(and(eq(drafts.userId, userId), eq(drafts.status, 'draft')))
	]);
	return {
		scheduled: scheduled[0]?.n ?? 0,
		publishedThisWeek: published[0]?.n ?? 0,
		failed: failed[0]?.n ?? 0,
		drafts: draftCount[0]?.n ?? 0
	};
}

/** The accounts the dashboard lists: everything not disconnected, by platform. */
export async function loadDashboardAccounts(db: AppDb, userId: string) {
	return db
		.select({
			id: connections.id,
			platform: connections.platform,
			handle: connections.handle,
			displayName: connections.displayName,
			avatarUrl: connections.avatarUrl,
			status: connections.status
		})
		.from(connections)
		.where(and(eq(connections.userId, userId), ne(connections.status, 'disconnected')));
}
