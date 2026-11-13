import type { RequestHandler } from './$types';
import { MAX_VIDEO_BYTES } from '#lib/domain/media-limits.js';
import {
	ownDraft,
	parseSegmentIndex,
	postSizeProblem,
	rejectIfNotEditable,
	videoSlotProblem
} from '#lib/server/draft-media.js';
import { fail, handleError } from '#lib/server/http.js';
import { newVideoKey } from '#lib/server/media-uploads.js';
import { requireScope, requireUser } from '#lib/server/require.js';
import { BodyLengthError, recordStoredVideo, streamIntoParts } from '#lib/server/video-upload.js';

class NotMp4Error extends Error {}

/** An MP4 or QuickTime file has `ftyp` at byte 4. */
function looksLikeMp4(bytes: Uint8Array): boolean {
	return bytes.length >= 8 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
}

/**
 * Upload a video in one request: the body is the raw MP4, so
 *
 *   curl -T clip.mp4 -H "Authorization: Bearer $KEY" "$APP/api/drafts/ID/media/video"
 *
 * is all a script or agent needs. `segmentIndex` (the card, 0 by default) and
 * `altText` go in the query string. The body streams into storage in parts as
 * it arrives, so no more than one 10 MiB part is held in memory — unlike the
 * form route, which buffers the whole file. Content-Length is required.
 */
const upload: RequestHandler = async ({ params, request, url, locals }) => {
	try {
		const user = requireUser(locals.user);
		requireScope(locals, 'write');
		const size = Number(request.headers.get('content-length') ?? '');
		if (!Number.isInteger(size) || size <= 0) {
			return fail(
				'Send the MP4 as the request body, with a Content-Length (curl -T file.mp4)',
				411
			);
		}
		if (size > MAX_VIDEO_BYTES) {
			return fail(`Video too large (max ${MAX_VIDEO_BYTES / 1_000_000}MB)`, 413);
		}
		const type = (request.headers.get('content-type') ?? '').toLowerCase();
		if (type.startsWith('multipart/form-data')) {
			return fail(
				'This route takes the raw MP4 as the body (curl -T file.mp4), not a form; forms go to POST /api/drafts/:id/media'
			);
		}
		if (!request.body) return fail('Video body required');
		const draft = await ownDraft(locals, params.id, user.id);
		if (!draft) return fail('Not found', 404);
		const busy = await rejectIfNotEditable(locals.db, params.id);
		if (busy) return busy;
		const segmentIndex = parseSegmentIndex(url.searchParams.get('segmentIndex'));
		const problem = await videoSlotProblem(locals, draft, segmentIndex);
		if (problem) return problem;
		const tooBig = await postSizeProblem(locals.db, params.id, size);
		if (tooBig) return tooBig;
		const multipart = locals.media.multipart;
		if (!multipart) return fail('This storage cannot take uploads in parts', 501);

		const key = newVideoKey();
		const uploadId = await multipart.create(key, 'video/mp4');
		let parts;
		try {
			parts = await streamIntoParts(
				request.body,
				size,
				(n, bytes) => multipart.uploadPart(key, uploadId, n, bytes),
				(opening) => {
					if (!looksLikeMp4(opening)) throw new NotMp4Error();
				}
			);
		} catch (err) {
			await multipart.abort(key, uploadId).catch(() => {});
			if (err instanceof NotMp4Error) return fail('File does not look like an MP4 video');
			if (err instanceof BodyLengthError) return fail(err.message);
			throw err;
		}
		const stored = await multipart.complete(key, uploadId, parts);
		return await recordStoredVideo(locals, draft, {
			key,
			size: stored,
			expectedSize: size,
			segmentIndex,
			altText: url.searchParams.get('altText')
		});
	} catch (err) {
		return handleError(err);
	}
};

// PUT is what `curl -T` sends; POST is accepted for clients that only post.
export const PUT = upload;
export const POST = upload;
