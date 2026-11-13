import type { RequestHandler } from './$types';
import { ownDraft, rejectIfNotEditable } from '#lib/server/draft-media.js';
import { fail, handleError } from '#lib/server/http.js';
import { partCount, readClaim, verifyUploadClaim } from '#lib/server/media-uploads.js';
import { requireScope, requireUser } from '#lib/server/require.js';
import { recordStoredVideo } from '#lib/server/video-upload.js';

function readParts(value: unknown, count: number): { partNumber: number; etag: string }[] | null {
	if (!Array.isArray(value) || value.length !== count) return null;
	const parts: { partNumber: number; etag: string }[] = [];
	for (let i = 0; i < value.length; i++) {
		const part = value[i] as { partNumber?: unknown; etag?: unknown } | null;
		if (part?.partNumber !== i + 1 || typeof part.etag !== 'string' || !part.etag) return null;
		parts.push({ partNumber: i + 1, etag: part.etag });
	}
	return parts;
}

/**
 * Join the parts, then decide on what was actually stored: the size must be
 * the one the checks ran against, and the file must be a video the server can
 * read. Anything refused here is deleted, so a failed upload leaves nothing.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const user = requireUser(locals.user);
		requireScope(locals, 'write');
		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return fail('Invalid JSON');
		}
		const claim = body && typeof body === 'object' ? readClaim(params.id, body) : null;
		if (!claim) return fail('Upload details required');
		if (!(await verifyUploadClaim(locals.env.APP_ENCRYPTION_KEY, claim, String(body.token)))) {
			return fail('Bad upload token', 403);
		}
		const parts = readParts(body.parts, partCount(claim.size));
		if (!parts) return fail('parts must list every part in order');
		const draft = await ownDraft(locals, params.id, user.id);
		if (!draft) return fail('Not found', 404);
		const busy = await rejectIfNotEditable(locals.db, params.id);
		if (busy) return busy;
		if (!locals.media.multipart) return fail('This storage cannot take uploads in parts', 501);

		const size = await locals.media.multipart.complete(claim.key, claim.uploadId, parts);
		return await recordStoredVideo(locals, draft, {
			key: claim.key,
			size,
			expectedSize: claim.size,
			segmentIndex: claim.segmentIndex,
			altText: body.altText
		});
	} catch (err) {
		return handleError(err);
	}
};
