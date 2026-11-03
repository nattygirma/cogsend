import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestAdmin, createTestDb, TEST_ENV } from '#lib/server/db/test.js';
import { newId } from '#lib/server/db/client.js';
import {
	connections,
	draftMedia,
	draftVariants,
	drafts,
	publishTargets
} from '#lib/server/db/schema.js';
import { memoryMediaStore } from '#lib/server/media.js';
import { UPLOAD_PART_BYTES } from '#lib/server/media-uploads.js';
import { SubrequestBudget } from '#lib/server/budget.js';
import { postVideo, PUBLISH_AFTER_IMPORT_CALLS } from '#lib/server/api/post-video.js';
import { ApiOperationError } from '#lib/server/api/operation-error.js';
import * as publish from '#lib/server/publish.js';
import type { FetchLike } from '#lib/server/providers/types.js';
import { buildMp4 } from './mp4-fixture';

let db: Awaited<ReturnType<typeof createTestDb>>['db'];
let closeDb: (() => void) | undefined;
let userId: string;
let objects: Map<string, { bytes: Uint8Array; mime: string }>;

beforeEach(async () => {
	const testDb = await createTestDb();
	db = testDb.db;
	closeDb = testDb.close;
	userId = (await createTestAdmin(db)).id;
	objects = new Map();
});

afterEach(() => {
	closeDb?.();
	closeDb = undefined;
	vi.restoreAllMocks();
});

function ctx(extra: Record<string, unknown> = {}) {
	return { db, env: TEST_ENV, media: memoryMediaStore(objects), ...extra } as never;
}

async function seedConnection(platform = 'mastodon', ownerId = userId) {
	const id = newId();
	const now = new Date();
	await db.insert(connections).values({
		id,
		userId: ownerId,
		platform,
		handle: `${platform}-${id.slice(0, 4)}`,
		instanceUrl: platform === 'mastodon' ? 'https://mastodon.example' : null,
		credentialsEncrypted: '{}',
		metaJson: '{}',
		status: 'active',
		createdAt: now,
		updatedAt: now
	});
	return id;
}

/** A fetch that serves `bytes` in chunks of `chunk`, the way a network body arrives. */
function serving(
	bytes: Uint8Array,
	{ chunk = 64 * 1024, headers = { 'content-type': 'video/mp4' } as Record<string, string> } = {}
) {
	return vi.fn<FetchLike>(async () => {
		let at = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (at >= bytes.length) return controller.close();
				controller.enqueue(bytes.slice(at, at + chunk));
				at += chunk;
			}
		});
		return new Response(body, { status: 200, headers });
	});
}

const VIDEO_URL = 'https://cdn.example/clip.mp4';

async function draftCount() {
	return (await db.select().from(drafts)).length;
}

describe('post_video', () => {
	it('downloads the video into a new draft and publishes it to every account', async () => {
		const a = await seedConnection();
		const b = await seedConnection();
		const publishTarget = vi
			.spyOn(publish, 'publishTarget')
			.mockResolvedValue({ status: 'published' } as never);
		const video = buildMp4();
		const fetchImpl = serving(video);

		const result = await postVideo(
			ctx(),
			userId,
			{ videoUrl: VIDEO_URL, text: 'New drop', connectionIds: [a, b] },
			fetchImpl
		);

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(publishTarget).toHaveBeenCalledTimes(2);
		expect(result.results.map((r) => [r.connectionId, r.status])).toEqual([
			[a, 'published'],
			[b, 'published']
		]);
		const draft = (await db.select().from(drafts).where(eq(drafts.id, result.draftId)))[0];
		expect(draft.baseBody).toBe('New drop');
		const [media] = await db.select().from(draftMedia).where(eq(draftMedia.draftId, draft.id));
		expect(media).toMatchObject({ mime: 'video/mp4', size: video.length, segmentIndex: 0 });
		expect(media.width).toBe(1280);
		expect(objects.get(media.storageKey)?.bytes).toEqual(video);
	});

	it('streams a video larger than one part into parts of the exact size', async () => {
		const a = await seedConnection();
		vi.spyOn(publish, 'publishTarget').mockResolvedValue({ status: 'published' } as never);
		const video = buildMp4({ mdatBytes: UPLOAD_PART_BYTES + 3_000_001 });
		const media = memoryMediaStore(objects);
		const uploadPart = vi.spyOn(media.multipart!, 'uploadPart');

		const result = await postVideo(
			ctx({ media }),
			userId,
			{ videoUrl: VIDEO_URL, connectionIds: [a] },
			// An odd chunk size, so parts are cut across chunk boundaries.
			serving(video, { chunk: 777_777 })
		);

		expect(uploadPart.mock.calls.map((call) => (call[3] as Uint8Array).length)).toEqual([
			UPLOAD_PART_BYTES,
			video.length - UPLOAD_PART_BYTES
		]);
		// Buffer.equals: a deep toEqual over 13 MB takes minutes.
		const stored = objects.get(result.media.storageKey)!.bytes;
		expect(Buffer.from(stored).equals(Buffer.from(video))).toBe(true);
	});

	it('reports accounts the platform is still preparing as processing', async () => {
		const a = await seedConnection();
		const b = await seedConnection();
		vi.spyOn(publish, 'publishTarget')
			.mockResolvedValueOnce({ status: 'published' } as never)
			.mockResolvedValueOnce({ status: 'pending', deferred: true } as never);

		const result = await postVideo(
			ctx(),
			userId,
			{ videoUrl: VIDEO_URL, connectionIds: [a, b] },
			serving(buildMp4())
		);

		// Targets are sent in the order publishDraft picks, so compare as a set.
		expect(result.results.map((r) => r.status).sort()).toEqual(['processing', 'published']);
	});

	it('schedules instead of publishing when runAt is given', async () => {
		const a = await seedConnection();
		const publishTarget = vi.spyOn(publish, 'publishTarget');
		const runAt = new Date(Date.now() + 3_600_000).toISOString();

		const result = await postVideo(
			ctx(),
			userId,
			{ videoUrl: VIDEO_URL, connectionIds: [a], runAt },
			serving(buildMp4())
		);

		expect(publishTarget).not.toHaveBeenCalled();
		expect(result.results).toMatchObject([{ connectionId: a, status: 'scheduled' }]);
		expect(result.scheduledFor).toBe(runAt);
		const [target] = await db.select().from(publishTargets);
		expect(target.status).toBe('scheduled');
	});

	it('queues the accounts for the next tick when the download used up the call budget', async () => {
		const a = await seedConnection();
		const publishTarget = vi.spyOn(publish, 'publishTarget');
		// The test database is not counted, so spend what the download would have.
		const budget = new SubrequestBudget(100);
		budget.count(100 - PUBLISH_AFTER_IMPORT_CALLS);

		const result = await postVideo(
			ctx({ budget }),
			userId,
			{ videoUrl: VIDEO_URL, connectionIds: [a] },
			serving(buildMp4())
		);

		expect(publishTarget).not.toHaveBeenCalled();
		expect(result.results).toMatchObject([{ connectionId: a, status: 'processing' }]);
		const [target] = await db.select().from(publishTargets);
		expect(target.status).toBe('scheduled');
		expect(target.scheduledFor!.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it('saves the YouTube and TikTok settings only for platforms it posts to', async () => {
		const yt = await seedConnection('youtube');
		vi.spyOn(publish, 'publishTarget').mockResolvedValue({ status: 'published' } as never);

		const result = await postVideo(
			ctx(),
			userId,
			{
				videoUrl: VIDEO_URL,
				text: 'Launch day',
				connectionIds: [yt],
				youtube: { title: 'Launch', madeForKids: false, privacy: 'public' },
				tiktok: { privacyLevel: 'SELF_ONLY' }
			},
			serving(buildMp4())
		);

		const variants = await db
			.select()
			.from(draftVariants)
			.where(eq(draftVariants.draftId, result.draftId));
		expect(variants.map((v) => [v.platform, JSON.parse(v.optionsJson)])).toEqual([
			['youtube', { title: 'Launch', madeForKids: false, privacy: 'public' }]
		]);
	});

	it('keeps the draft and names it when a platform refuses the post', async () => {
		const tiktok = await seedConnection('tiktok');
		const publishTarget = vi.spyOn(publish, 'publishTarget');

		const error = await postVideo(
			ctx(),
			userId,
			{ videoUrl: VIDEO_URL, connectionIds: [tiktok] },
			serving(buildMp4())
		).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(ApiOperationError);
		const details = (error as ApiOperationError).details!;
		expect((error as ApiOperationError).status).toBe(400);
		expect(details.platform).toBe('tiktok');
		expect(typeof details.draftId).toBe('string');
		expect(publishTarget).not.toHaveBeenCalled();
		const media = await db
			.select()
			.from(draftMedia)
			.where(eq(draftMedia.draftId, details.draftId as string));
		expect(media).toHaveLength(1);
	});

	it('follows redirects to a public host', async () => {
		const a = await seedConnection();
		vi.spyOn(publish, 'publishTarget').mockResolvedValue({ status: 'published' } as never);
		const file = serving(buildMp4());
		const fetchImpl = vi.fn<FetchLike>(async (url, init) =>
			String(url) === VIDEO_URL
				? new Response(null, { status: 302, headers: { location: '/real/clip.mp4' } })
				: file(url, init)
		);

		await postVideo(ctx(), userId, { videoUrl: VIDEO_URL, connectionIds: [a] }, fetchImpl);

		expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
			VIDEO_URL,
			'https://cdn.example/real/clip.mp4'
		]);
	});

	describe('refuses, and keeps nothing', () => {
		async function expectRefused(
			input: { videoUrl?: string; connectionIds?: string[] },
			fetchImpl: FetchLike,
			message: RegExp,
			status = 400
		) {
			const a = await seedConnection();
			const publishTarget = vi.spyOn(publish, 'publishTarget');
			const error = await postVideo(
				ctx(),
				userId,
				{ videoUrl: VIDEO_URL, connectionIds: [a], ...input },
				fetchImpl
			).catch((err: unknown) => err as Error & { status?: number });
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(message);
			expect((error as { status?: number }).status).toBe(status);
			expect(publishTarget).not.toHaveBeenCalled();
			expect(await draftCount()).toBe(0);
			expect(await db.select().from(draftMedia)).toHaveLength(0);
			expect(objects.size).toBe(0);
		}

		it('a web page instead of a file', () =>
			expectRefused(
				{},
				serving(new TextEncoder().encode('<html></html>'), {
					headers: { 'content-type': 'text/html; charset=utf-8' }
				}),
				/web page/
			));

		it('a file that is not an MP4', () =>
			expectRefused(
				{},
				serving(new Uint8Array(UPLOAD_PART_BYTES * 2).fill(1), {
					headers: { 'content-type': 'application/octet-stream' }
				}),
				/not an MP4/
			));

		it('an MP4 the probe cannot play', () =>
			expectRefused({}, serving(buildMp4({ video: null })), /Could not read this video/));

		it('a declared size over the limit, before reading it', () =>
			expectRefused(
				{},
				serving(buildMp4(), {
					headers: { 'content-type': 'video/mp4', 'content-length': String(400_000_000) }
				}),
				/too large/,
				413
			));

		it('a failed download', () =>
			expectRefused(
				{},
				vi.fn<FetchLike>(async () => new Response('gone', { status: 404 })),
				/Could not download the video \(404\)/
			));

		it('a private host, without fetching it', async () => {
			const fetchImpl = vi.fn<FetchLike>();
			await expectRefused({ videoUrl: 'http://127.0.0.1/clip.mp4' }, fetchImpl, /not allowed/);
			expect(fetchImpl).not.toHaveBeenCalled();
		});

		it('an account that is not the caller’s, without fetching anything', async () => {
			const other = await createTestAdmin(db, { email: 'other@example.com' });
			const theirs = await seedConnection('mastodon', other.id);
			const fetchImpl = vi.fn<FetchLike>();
			await expectRefused({ connectionIds: [theirs] }, fetchImpl, /connections not found/);
			expect(fetchImpl).not.toHaveBeenCalled();
		});
	});
});
