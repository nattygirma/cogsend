import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AppDb } from '#lib/server/db/client.js';
import { connections, drafts, publishTargets, users } from '#lib/server/db/schema.js';
import { createTestDb } from '#lib/server/db/test.js';
import { loadCalendarPosts, loadDashboardCounts, loadUpcomingPosts } from '#lib/server/calendar.js';

const NOW = Date.UTC(2026, 10, 4, 10, 0);
const HOUR = 3_600_000;

describe('calendar queries', () => {
	let db: AppDb;
	let close: () => void;
	const me = newId();
	const other = newId();

	async function seedUser(id: string, platforms: string[]) {
		const now = new Date(NOW);
		await db.insert(users).values({
			id,
			email: `${id}@localhost`,
			passwordHash: 'x',
			timezone: 'UTC',
			createdAt: now,
			updatedAt: now
		});
		const ids: Record<string, string> = {};
		for (const platform of platforms) {
			ids[platform] = newId();
			await db.insert(connections).values({
				id: ids[platform],
				userId: id,
				platform,
				handle: `${platform}-${id.slice(0, 4)}`,
				credentialsEncrypted: 'enc',
				status: 'active',
				createdAt: now,
				updatedAt: now
			});
		}
		return ids;
	}

	async function seedPost(
		userId: string,
		body: string,
		targets: Array<{ connectionId: string; status: string; at: number | null; updated?: number }>
	) {
		const draftId = newId();
		const now = new Date(NOW);
		await db.insert(drafts).values({
			id: draftId,
			userId,
			baseBody: body,
			status: 'scheduled',
			createdAt: now,
			updatedAt: now
		});
		for (const t of targets) {
			await db.insert(publishTargets).values({
				id: newId(),
				draftId,
				connectionId: t.connectionId,
				status: t.status,
				scheduledFor: t.at === null ? null : new Date(t.at),
				createdAt: now,
				updatedAt: new Date(t.updated ?? NOW)
			});
		}
		return draftId;
	}

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const mine = await seedUser(me, ['youtube', 'tiktok']);
		const theirs = await seedUser(other, ['youtube']);
		await seedPost(me, 'both platforms', [
			{ connectionId: mine.youtube, status: 'scheduled', at: NOW + 2 * HOUR },
			{ connectionId: mine.tiktok, status: 'scheduled', at: NOW + 2 * HOUR }
		]);
		await seedPost(me, 'went out', [
			{ connectionId: mine.tiktok, status: 'published', at: null, updated: NOW - 24 * HOUR }
		]);
		await seedPost(me, 'broke', [{ connectionId: mine.youtube, status: 'failed', at: NOW - HOUR }]);
		await seedPost(me, 'next month', [
			{ connectionId: mine.youtube, status: 'scheduled', at: NOW + 30 * 24 * HOUR }
		]);
		await seedPost(other, 'not mine', [
			{ connectionId: theirs.youtube, status: 'scheduled', at: NOW + HOUR }
		]);
	});

	afterAll(() => close());

	it('returns only this user’s posts inside the window', async () => {
		const posts = await loadCalendarPosts(db, me, NOW - 2 * 24 * HOUR, NOW + 2 * 24 * HOUR);
		expect(posts.map((p) => p.excerpt)).toEqual(['went out', 'broke', 'both platforms']);
		expect(posts[2].platforms.sort()).toEqual(['tiktok', 'youtube']);
	});

	it('filters by platform', async () => {
		const posts = await loadCalendarPosts(
			db,
			me,
			NOW - 2 * 24 * HOUR,
			NOW + 2 * 24 * HOUR,
			'tiktok'
		);
		expect(posts.map((p) => p.excerpt)).toEqual(['went out', 'both platforms']);
	});

	it('lists what is waiting, soonest first, whatever the week', async () => {
		const posts = await loadUpcomingPosts(db, me, 8);
		expect(posts.map((p) => p.excerpt)).toEqual(['both platforms', 'next month']);
	});

	it('counts posts rather than destinations', async () => {
		expect(await loadDashboardCounts(db, me, NOW)).toEqual({
			scheduled: 2,
			publishedThisWeek: 1,
			failed: 1,
			drafts: 0
		});
	});
});
