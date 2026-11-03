import { and, eq, inArray } from 'drizzle-orm';
import { runAtError } from '#lib/domain/request-limits.js';
import { ApiOperationError } from '#lib/server/api/operation-error.js';
import {
	createDraft,
	deleteDraft,
	publishDraft,
	scheduleDraft,
	setDraftVariant,
	type OperationContext
} from '#lib/server/api/operations.js';
import { countingFetch } from '#lib/server/budget.js';
import { connections } from '#lib/server/db/schema.js';
import { importVideoFromUrl } from '#lib/server/media-import.js';
import type { FetchLike } from '#lib/server/providers/types.js';

/**
 * Calls left after the import below which publishing now is not attempted: a
 * Reel or an upload needs about this many to start before it can park. With
 * fewer, the accounts are queued as due now and the next tick sends them,
 * rather than risk running out between a platform accepting the post and the
 * write that records it.
 */
export const PUBLISH_AFTER_IMPORT_CALLS = 25;

export interface PostVideoInput {
	videoUrl: string;
	text?: string;
	title?: string;
	connectionIds: string[];
	runAt?: string;
	youtube?: Record<string, unknown>;
	tiktok?: Record<string, unknown>;
}

/** What each account came to: `processing` needs nothing from the caller. */
export type PostVideoStatus = 'published' | 'processing' | 'scheduled' | 'failed';

interface AccountResult {
	connectionId: string;
	platform: string;
	handle: string | null;
	status: PostVideoStatus;
	permalink: string | null;
	error: string | null;
}

function invalid(message: string, status = 400, details?: Record<string, unknown>): never {
	throw new ApiOperationError(message, status, details);
}

function waitingResults(
	conns: Array<{ id: string; platform: string; handle: string | null }>,
	status: PostVideoStatus
): AccountResult[] {
	return conns.map((c) => ({
		connectionId: c.id,
		platform: c.platform,
		handle: c.handle,
		status,
		permalink: null,
		error: null
	}));
}

/**
 * One video to several accounts in one call: a draft with `text` as the
 * caption, the video downloaded from `videoUrl`, then published now or
 * scheduled for `runAt`. The waiting a platform needs (Instagram processing a
 * Reel, say) is the scheduler's: an account that is not done within this
 * request comes back `processing` and goes out on its own.
 */
export async function postVideo(
	ctx: OperationContext,
	userId: string,
	input: PostVideoInput,
	fetchImpl: FetchLike = (url, init) => fetch(url, init)
) {
	const ids = [...new Set(input.connectionIds)];
	if (!ids.length) invalid('connectionIds required');
	if (input.runAt) {
		const problem = runAtError(input.runAt);
		if (problem) invalid(problem);
	}
	// Checked before the download, which is the expensive part.
	const conns = await ctx.db
		.select({ id: connections.id, platform: connections.platform, handle: connections.handle })
		.from(connections)
		.where(
			and(
				eq(connections.userId, userId),
				inArray(connections.id, ids),
				eq(connections.status, 'active')
			)
		);
	if (conns.length !== ids.length) invalid('One or more connections not found');
	const ordered = ids.map((id) => conns.find((c) => c.id === id)!);
	const platforms = new Set(conns.map((c) => c.platform));

	const { draft } = await createDraft(ctx, userId, {
		title: input.title ?? null,
		baseBody: input.text ?? '',
		selectedConnectionIds: ids
	});
	let media;
	try {
		for (const platform of ['youtube', 'tiktok'] as const) {
			const options = input[platform];
			if (options && platforms.has(platform)) {
				await setDraftVariant(ctx, userId, draft.id, { platform, options });
			}
		}
		media = await importVideoFromUrl(ctx, {
			draftId: draft.id,
			userId,
			url: input.videoUrl,
			fetchImpl: ctx.budget ? countingFetch(fetchImpl, ctx.budget) : fetchImpl
		});
	} catch (error) {
		// Nothing was sent: leave no half-made draft behind.
		await deleteDraft(ctx, userId, draft.id).catch(() => {});
		throw error;
	}

	try {
		if (input.runAt) {
			const scheduled = await scheduleDraft(ctx, userId, draft.id, {
				connectionIds: ids,
				runAt: input.runAt
			});
			return {
				draftId: draft.id,
				media,
				results: waitingResults(ordered, 'scheduled'),
				scheduledFor: scheduled.scheduledFor
			};
		}
		if (ctx.budget && ctx.budget.remaining < PUBLISH_AFTER_IMPORT_CALLS) {
			await scheduleDraft(ctx, userId, draft.id, {
				connectionIds: ids,
				runAt: new Date().toISOString()
			});
			return { draftId: draft.id, media, results: waitingResults(ordered, 'processing') };
		}
		const published = await publishDraft(ctx, userId, draft.id, { connectionIds: ids });
		const results: AccountResult[] = ordered.map((c) => {
			const r = published.results.find((item) => item.connectionId === c.id);
			if (!r) {
				// Publishing stopped before this account; it is still due.
				return {
					connectionId: c.id,
					platform: c.platform,
					handle: c.handle,
					status: 'failed',
					permalink: null,
					error: `${published.stoppedError ?? 'Publishing stopped early'} — call publish_draft with this draftId to send it`
				};
			}
			let status: PostVideoStatus = 'processing';
			if (r.status === 'published') status = 'published';
			else if (r.status === 'failed') status = 'failed';
			return {
				connectionId: c.id,
				platform: c.platform,
				handle: c.handle,
				status,
				permalink: r.permalink,
				error: status === 'failed' ? r.error : null
			};
		});
		return { draftId: draft.id, media, results };
	} catch (error) {
		// The draft keeps its video: fix what the error names (set_draft_variant),
		// then publish_draft or schedule_draft with this draftId.
		if (error instanceof ApiOperationError) {
			invalid(error.message, error.status, { ...error.details, draftId: draft.id });
		}
		throw error;
	}
}
