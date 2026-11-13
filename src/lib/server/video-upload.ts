import { and, eq } from 'drizzle-orm';
import { newId } from '#lib/server/db/client.js';
import { draftMedia } from '#lib/server/db/schema.js';
import { cleanAltText, postSizeProblem, videoSlotProblem } from '#lib/server/draft-media.js';
import { fail, ok } from '#lib/server/http.js';
import {
	deleteMediaObjects,
	probeStoredVideo,
	requirePlayableVideo,
	videoMetaFrom
} from '#lib/server/media.js';
import { UPLOAD_PART_BYTES } from '#lib/server/media-uploads.js';
import { serializeMedia } from '#lib/server/serialize.js';

type Part = { partNumber: number; etag: string };

async function keyInUse(db: App.Locals['db'], key: string): Promise<boolean> {
	const rows = await db
		.select({ id: draftMedia.id })
		.from(draftMedia)
		.where(eq(draftMedia.storageKey, key))
		.limit(1);
	return rows.length > 0;
}

/**
 * Decide on a video that is already in storage: it must be the size the checks
 * ran against and a video the server can read, and the card must still have
 * room. Answers 201 with the new media row, or the refusal; anything refused is
 * deleted, so a failed upload leaves nothing behind.
 */
export async function recordStoredVideo(
	locals: App.Locals,
	draft: { id: string; baseBody: string | null; userId: string },
	input: { key: string; size: number; expectedSize: number; segmentIndex: number; altText: unknown }
): Promise<Response> {
	let stored = false;
	try {
		if (input.size !== input.expectedSize) return fail('The upload is not the size it started as');
		const facts = requirePlayableVideo(await probeStoredVideo(locals.media, input.key, input.size));
		const problem = await videoSlotProblem(locals, draft, input.segmentIndex);
		if (problem) return problem;
		// Again: another upload may have landed since this one started.
		const tooBig = await postSizeProblem(locals.db, draft.id, input.size);
		if (tooBig) return tooBig;
		const siblings = await locals.db
			.select({ id: draftMedia.id })
			.from(draftMedia)
			.where(
				and(eq(draftMedia.draftId, draft.id), eq(draftMedia.segmentIndex, input.segmentIndex))
			);
		const [media] = await locals.db
			.insert(draftMedia)
			.values({
				id: newId(),
				draftId: draft.id,
				storageKey: input.key,
				mime: 'video/mp4',
				size: input.size,
				width: facts.width,
				height: facts.height,
				metaJson: JSON.stringify(videoMetaFrom(facts)),
				altText: cleanAltText(input.altText),
				sortOrder: siblings.length,
				segmentIndex: input.segmentIndex,
				createdAt: new Date()
			})
			.returning();
		stored = true;
		return ok({ media: serializeMedia(media) }, 201);
	} finally {
		// A replayed `complete` for an upload that already landed is refused
		// as a second video; the object it names belongs to the first row.
		if (!stored && !(await keyInUse(locals.db, input.key))) {
			await deleteMediaObjects(locals.media, [input.key]).catch(() => {});
		}
	}
}

export class BodyLengthError extends Error {}

/**
 * Cut a request body of exactly `size` bytes into storage parts as it arrives,
 * so at most one part is held in memory whatever the file's size. Every part
 * but the last is UPLOAD_PART_BYTES, as R2 requires. `first` sees the opening
 * part before it is sent, to refuse a file that is not a video early.
 */
export async function streamIntoParts(
	body: ReadableStream<Uint8Array>,
	size: number,
	send: (partNumber: number, bytes: Uint8Array) => Promise<Part>,
	first?: (bytes: Uint8Array) => void
): Promise<Part[]> {
	const reader = body.getReader();
	const parts: Part[] = [];
	let flushed = 0;
	let buf = new Uint8Array(Math.min(UPLOAD_PART_BYTES, size));
	let fill = 0;
	const flush = async () => {
		if (parts.length === 0) first?.(buf);
		parts.push(await send(parts.length + 1, buf));
		flushed += buf.length;
		buf = new Uint8Array(Math.min(UPLOAD_PART_BYTES, size - flushed));
		fill = 0;
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			for (let at = 0; at < value.length;) {
				if (buf.length === 0) throw new BodyLengthError('The body is longer than Content-Length');
				const take = Math.min(buf.length - fill, value.length - at);
				buf.set(value.subarray(at, at + take), fill);
				fill += take;
				at += take;
				if (fill === buf.length) await flush();
			}
		}
	} catch (err) {
		await reader.cancel().catch(() => {});
		throw err;
	}
	if (flushed !== size) throw new BodyLengthError('The body is shorter than Content-Length');
	return parts;
}
