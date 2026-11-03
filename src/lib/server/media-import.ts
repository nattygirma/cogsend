/**
 * A video fetched from a link into a draft, for API clients (agents) that hold
 * a URL to a file rather than the file itself.
 *
 * The body streams into storage in parts the size the parts route uses, so a
 * 300 MB video never sits in isolate memory: one part (10 MiB) at a time. The
 * stored object then goes through the same checks as an upload in parts: its
 * size, and a probe of its index for a playable MP4. Anything refused is
 * deleted, so a failed import leaves nothing behind.
 *
 * Security: every hop is checked with `assertPublicHttpUrl` (http(s) only, no
 * localhost, private or metadata hosts), redirects are followed by hand up to
 * three times, and the whole download has a time limit.
 */

import { MAX_VIDEO_BYTES, validateVideoUpload } from '#lib/domain/media-limits.js';
import { newId } from './db/client';
import { draftMedia } from './db/schema';
import { MAX_FILES_PER_USER, overUserFileCap } from './draft-media';
import { deleteMediaObjects, probeStoredVideo, requirePlayableVideo, videoMetaFrom } from './media';
import { newVideoKey, UPLOAD_PART_BYTES } from './media-uploads';
import { assertPublicHttpUrl } from './opengraph';
import type { FetchLike, MediaStore } from './providers/types';
import { serializeMedia } from './serialize';

const IMPORT_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 3;

function refused(message: string, status = 400): never {
	throw Object.assign(new Error(message), { status });
}

async function openSource(url: string, fetchImpl: FetchLike, signal: AbortSignal) {
	let current = url;
	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		assertPublicHttpUrl(current);
		const res = await fetchImpl(current, {
			headers: { 'User-Agent': 'posteasy/1.0 (+video-import)', Accept: 'video/mp4,*/*' },
			redirect: 'manual',
			signal
		} as RequestInit);
		if ([301, 302, 303, 307, 308].includes(res.status)) {
			await res.body?.cancel().catch(() => {});
			const location = res.headers.get('location');
			if (!location) refused('The video link redirected without a location', 502);
			try {
				current = new URL(location, current).toString();
			} catch {
				refused('The video link redirected to an invalid URL', 502);
			}
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			refused(`Could not download the video (${res.status})`, res.status >= 500 ? 502 : 400);
		}
		return res;
	}
	refused('The video link redirected too many times');
}

/**
 * Cut the body into parts of exactly UPLOAD_PART_BYTES (the last may be
 * shorter), as R2 requires, and upload each as it fills. Returns the parts and
 * the byte count.
 */
async function streamIntoParts(
	multipart: NonNullable<MediaStore['multipart']>,
	key: string,
	uploadId: string,
	body: ReadableStream<Uint8Array>
) {
	const reader = body.getReader();
	const parts: { partNumber: number; etag: string }[] = [];
	let buffer = new Uint8Array(UPLOAD_PART_BYTES);
	let filled = 0;
	let total = 0;
	let sniffed = false;
	const flush = async (bytes: Uint8Array) => {
		parts.push(await multipart.uploadPart(key, uploadId, parts.length + 1, bytes));
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_VIDEO_BYTES) refused('Video too large (max 300MB)', 413);
			let at = 0;
			while (at < value.byteLength) {
				const n = Math.min(value.byteLength - at, UPLOAD_PART_BYTES - filled);
				buffer.set(value.subarray(at, at + n), filled);
				filled += n;
				at += n;
				// Refuse anything that is not an MP4 before a second part moves.
				if (!sniffed && filled >= 12) {
					const check = validateVideoUpload({
						mime: 'video/mp4',
						size: filled,
						bytes: buffer.subarray(0, 12)
					});
					if (!check.ok) refused('The link is not an MP4 video file');
					sniffed = true;
				}
				if (filled === UPLOAD_PART_BYTES) {
					await flush(buffer);
					buffer = new Uint8Array(UPLOAD_PART_BYTES);
					filled = 0;
				}
			}
		}
	} finally {
		// Stop a host that keeps sending after we have given up.
		await reader.cancel().catch(() => {});
	}
	if (total === 0) refused('The video link returned an empty file');
	if (!sniffed) refused('The link is not an MP4 video file');
	if (filled > 0) await flush(buffer.subarray(0, filled));
	return { parts, total };
}

/**
 * Download the MP4 at `url` and attach it to the first card of a draft the
 * caller owns and has already checked can take a video. Throws 4xx errors
 * with a message the caller can show; 502/504 when the source host fails.
 */
export async function importVideoFromUrl(
	ctx: { db: App.Locals['db']; media: MediaStore },
	input: { draftId: string; userId: string; url: string; fetchImpl: FetchLike }
) {
	const multipart = ctx.media.multipart;
	if (!multipart) refused('This storage cannot take uploads in parts', 501);
	if (await overUserFileCap(ctx.db, input.userId, 1)) {
		refused(`Max ${MAX_FILES_PER_USER} files per account`, 413);
	}
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), IMPORT_TIMEOUT_MS);
	const key = newVideoKey();
	let uploadId: string | null = null;
	let completed = false;
	let stored = false;
	try {
		const res = await openSource(input.url, input.fetchImpl, ctrl.signal);
		const type = (res.headers.get('content-type') || '').toLowerCase();
		if (type.startsWith('text/')) {
			await res.body?.cancel().catch(() => {});
			refused('The link is a web page, not a video file. Send a direct link to the MP4');
		}
		const declared = Number(res.headers.get('content-length') ?? '');
		if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
			await res.body?.cancel().catch(() => {});
			refused('Video too large (max 300MB)', 413);
		}
		if (!res.body) refused('The video link returned an empty file');
		uploadId = await multipart.create(key, 'video/mp4');
		const { parts, total } = await streamIntoParts(multipart, key, uploadId, res.body);
		const size = await multipart.complete(key, uploadId, parts);
		completed = true;
		if (size !== total) refused('The stored video is not the size that was downloaded', 502);
		const facts = requirePlayableVideo(await probeStoredVideo(ctx.media, key, size));
		const [media] = await ctx.db
			.insert(draftMedia)
			.values({
				id: newId(),
				draftId: input.draftId,
				storageKey: key,
				mime: 'video/mp4',
				size,
				width: facts.width,
				height: facts.height,
				metaJson: JSON.stringify(videoMetaFrom(facts)),
				altText: null,
				sortOrder: 0,
				segmentIndex: 0,
				createdAt: new Date()
			})
			.returning();
		stored = true;
		return serializeMedia(media);
	} catch (err) {
		const name = (err as Error)?.name;
		if (name === 'AbortError' || name === 'TimeoutError') {
			refused('Downloading the video took too long', 504);
		}
		throw err;
	} finally {
		clearTimeout(timer);
		if (!stored && uploadId) {
			if (completed) await deleteMediaObjects(ctx.media, [key]).catch(() => {});
			else await multipart.abort(key, uploadId).catch(() => {});
		}
	}
}
