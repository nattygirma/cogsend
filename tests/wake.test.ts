import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { newId, type AppDb } from '#lib/server/db/client.js';
import { connections, drafts, publishTargets, users } from '#lib/server/db/schema.js';
import { createTestDb } from '#lib/server/db/test.js';
import { STALE_CLAIM_MS } from '#lib/domain/due-jobs.js';
import { HEARTBEAT_STALE_MS, schedulerHealth, writeHeartbeat } from '#lib/server/scheduler.js';
import { nextWakeAt, reportNextWake } from '#lib/server/wake.js';

/**
 * On appkeep a copy is started only when it says it has work. A wrong answer
 * that is too late means a post goes out hours late, so each kind of pending
 * work is checked here.
 */
describe('next wake-up', () => {
	let db: AppDb;
	let close: () => void;
	let userId: string;
	let connId: string;
	const now = new Date('2026-11-10T12:00:00Z');
	const at = (ms: number) => new Date(now.getTime() + ms);

	// One post per draft and account, so each gets its own draft.
	const target = async (
		values: Partial<typeof publishTargets.$inferInsert>,
		connectionId = connId
	) => {
		const ownDraft = newId();
		await db.insert(drafts).values({
			id: ownDraft,
			userId,
			baseBody: 'wake',
			status: 'scheduled',
			createdAt: now,
			updatedAt: now
		});
		await db.insert(publishTargets).values({
			id: newId(),
			draftId: ownDraft,
			connectionId,
			status: 'scheduled',
			attemptCount: 0,
			createdAt: now,
			updatedAt: now,
			...values
		});
	};

	const connection = async (status: string) => {
		const id = newId();
		await db.insert(connections).values({
			id,
			userId,
			platform: 'linkedin',
			handle: `h-${id}`,
			credentialsEncrypted: 'x',
			metaJson: '{}',
			status,
			createdAt: now,
			updatedAt: now
		});
		return id;
	};

	beforeEach(async () => {
		({ db, close } = await createTestDb());
		userId = newId();
		await db.insert(users).values({
			id: userId,
			email: 'wake@localhost',
			passwordHash: 'x',
			timezone: 'UTC',
			createdAt: now,
			updatedAt: now
		});
		connId = await connection('active');
	});
	afterEach(() => close());

	it('is null with nothing waiting', async () => {
		expect(await nextWakeAt(db, now)).toBe(null);
	});

	it('is the earliest scheduled or retrying post', async () => {
		await target({ scheduledFor: at(3 * 3600_000) });
		await target({ status: 'pending', scheduledFor: at(20 * 60_000) });
		expect(await nextWakeAt(db, now)).toBe(at(20 * 60_000).getTime());
	});

	it('is now for a "publish now" row whose inline attempt never ran', async () => {
		await target({ scheduledFor: at(3600_000) });
		await target({ status: 'pending', scheduledFor: null });
		expect(await nextWakeAt(db, now)).toBe(now.getTime());
	});

	it('keeps an overdue post in the past, so it runs on the next tick', async () => {
		await target({ scheduledFor: at(-5 * 60_000) });
		expect(await nextWakeAt(db, now)).toBe(at(-5 * 60_000).getTime());
	});

	it('is when a publish a dead isolate left behind can be taken over', async () => {
		await target({ status: 'publishing', scheduledFor: at(-60_000), updatedAt: at(-60_000) });
		await target({ scheduledFor: at(3600_000) });
		expect(await nextWakeAt(db, now)).toBe(at(-60_000 + STALE_CLAIM_MS).getTime());
	});

	it('ignores posts already out, finished ones, and ones on disconnected accounts', async () => {
		await target({ scheduledFor: at(60_000), remotePostId: 'already-out' });
		await target({ status: 'published', scheduledFor: at(60_000) });
		await target({ status: 'failed', scheduledFor: at(60_000) });
		await target({ status: 'draft', scheduledFor: at(60_000) });
		await target({ scheduledFor: at(60_000) }, await connection('disconnected'));
		expect(await nextWakeAt(db, now)).toBe(null);
	});

	it('is sent to appkeep when the binding offers it, and does nothing elsewhere', async () => {
		await target({ scheduledFor: at(3600_000) });
		const sent: Array<number | null> = [];
		await reportNextWake(
			{ ALTSTACK: { wakeAt: async (when: number | null) => void sent.push(when) } },
			db,
			now
		);
		expect(sent).toEqual([at(3600_000).getTime()]);
		await expect(reportNextWake({}, db, now)).resolves.toBeUndefined();
		await expect(reportNextWake(undefined, db, now)).resolves.toBeUndefined();
	});

	it('never fails the request that triggered it', async () => {
		await expect(
			reportNextWake(
				{
					ALTSTACK: {
						wakeAt: async () => {
							throw new Error('platform down');
						}
					}
				},
				db,
				now
			)
		).resolves.toBeUndefined();
	});

	it('lets a quiet appkeep copy look healthy with an old heartbeat, but not one with work waiting', async () => {
		await writeHeartbeat(db, new Date(now.getTime() - HEARTBEAT_STALE_MS - 3600_000));
		expect((await schedulerHealth(db, now)).ok).toBe(false);
		expect((await schedulerHealth(db, now, { wakesOnDemand: true })).ok).toBe(true);
		await target({ scheduledFor: at(-60_000) });
		expect((await schedulerHealth(db, now, { wakesOnDemand: true })).ok).toBe(false);
	});
});
