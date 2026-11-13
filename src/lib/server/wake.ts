import { and, eq, inArray, isNotNull, isNull, min, ne, or, sql } from 'drizzle-orm';
import { STALE_CLAIM_MS } from '#lib/domain/due-jobs.js';
import { first, type AppDb } from './db/client';
import { connections, publishTargets } from './db/schema';

/**
 * When this copy next has publishing to do, in milliseconds since the epoch, or
 * null when nothing is waiting. It mirrors what `claimDueTargets` will pick up:
 * scheduled and retrying posts at their time, "publish now" rows at once, and a
 * publish a dead isolate left behind once its claim goes stale. Posts on a
 * disconnected account are never claimed, so they never wake anything.
 */
export async function nextWakeAt(db: AppDb, now = new Date()): Promise<number | null> {
	const live = inArray(
		publishTargets.connectionId,
		db
			.select({ id: connections.id })
			.from(connections)
			.where(ne(connections.status, 'disconnected'))
	);
	const row = await first(
		db
			.select({
				// Only rows waiting their turn: a running publish has a time too.
				scheduled: min(
					sql<Date>`CASE WHEN ${publishTargets.status} IN ('scheduled', 'pending') THEN ${publishTargets.scheduledFor} END`
				),
				// "Publish now" rows carry no time: they are due immediately.
				now: sql<number>`max(CASE WHEN ${publishTargets.scheduledFor} IS NULL AND ${publishTargets.status} = 'pending' THEN 1 ELSE 0 END)`,
				claimed: min(
					sql<Date>`CASE WHEN ${publishTargets.status} = 'publishing' THEN ${publishTargets.updatedAt} END`
				)
			})
			.from(publishTargets)
			.where(
				and(
					isNull(publishTargets.remotePostId),
					live,
					or(
						and(
							isNotNull(publishTargets.scheduledFor),
							inArray(publishTargets.status, ['scheduled', 'pending'])
						),
						and(isNull(publishTargets.scheduledFor), eq(publishTargets.status, 'pending')),
						eq(publishTargets.status, 'publishing')
					)
				)
			)
	);
	if (!row) return null;
	const times: number[] = [];
	if (Number(row.now) === 1) times.push(now.getTime());
	const scheduled = asTime(row.scheduled);
	if (scheduled != null) times.push(scheduled);
	const claimed = asTime(row.claimed);
	if (claimed != null) times.push(claimed + STALE_CLAIM_MS);
	return times.length ? Math.min(...times) : null;
}

// Both columns are timestamp_ms; an aggregate can come back as a Date or as the raw number.
function asTime(value: unknown): number | null {
	if (value == null) return null;
	const n = value instanceof Date ? value.getTime() : Number(value);
	return Number.isFinite(n) ? n : null;
}

type WakeBinding = { wakeAt?: (when: number | null) => Promise<unknown> };

/**
 * On appkeep, tells the platform when to wake this copy next, so a copy with
 * nothing scheduled isn't started every minute. appkeep still wakes it every
 * few hours, which runs the hourly janitors. Anywhere else this does nothing.
 */
export async function reportNextWake(
	bindings: unknown,
	db: AppDb,
	now = new Date()
): Promise<void> {
	const binding = (bindings as { ALTSTACK?: WakeBinding } | undefined)?.ALTSTACK;
	if (typeof binding?.wakeAt !== 'function') return;
	try {
		// Sent every time, not only when it changes: the same copy can run in
		// more than one isolate, and each only knows what it last sent.
		await binding.wakeAt(await nextWakeAt(db, now));
	} catch (err) {
		// The platform keeps the last answer, and its sweep every few hours
		// catches anything that answer missed.
		console.error('[scheduler] could not report the next wake-up', err);
	}
}
