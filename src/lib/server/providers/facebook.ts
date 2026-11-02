import { PLATFORM_LIMITS } from '#lib/domain/editor-limits.js';
import {
	FACEBOOK_MAX_IMAGE_BYTES,
	FACEBOOK_MAX_IMAGES,
	postMediaProblems
} from '#lib/domain/media-limits.js';
import { callbackUri } from '#lib/domain/platform-setup.js';
import { formatThreadsMetaMarker } from '#lib/domain/threads-error.js';
import { countGraphemes } from '#lib/domain/validation/text.js';
import { singlePost } from './flatten';
import { parseMetaError } from './meta-graph';
import { providerFetch } from './timed-fetch';
import {
	mediaByteLength,
	processingError,
	ProviderError,
	resumedVideoState,
	unconfirmedPostError
} from './types';
import type {
	ConnectionCredentials,
	FetchLike,
	MediaAttachment,
	PlatformProvider,
	PublishResult,
	ValidationIssue
} from './types';
import { isVideoAttachment, pollVideo, videoValidation } from './video';

export const FACEBOOK_API_VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;
export const FACEBOOK_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const FACEBOOK_MAX_CHARS = PLATFORM_LIMITS.facebook;
// Facebook's own alt-text field; longer text is cut, not refused.
const MAX_ALT_TEXT = 1000;
// Pages beyond this many are unlikely, and each page of results is a call.
const MAX_ACCOUNT_PAGES = 5;

// A Page video usually processes within a minute; longer ones park.
const VIDEO_POLLS = 10;
const VIDEO_POLL_MS = 3000;
// Calls a waiting video must leave for the permalink and publish.ts's writes.
const POLL_RESERVE = 4;

const AUTH_CODES = new Set([102, 190]);
// 80001 is the Pages rate limit, 32 the per-Page one, the rest app throttling.
const RATE_CODES = new Set([4, 17, 32, 613, 80001]);
const TRANSIENT_CODES = new Set([1, 2]);

/**
 * Classify a Graph API failure by Meta's code. 10 and 200 are permission
 * refusals (a Page the person cannot post to, a permission not granted): the
 * token still works, so the account must not be expired for them.
 */
export function facebookUpstreamError(prefix: string, status: number, body: string): ProviderError {
	const { code, subcode, message: metaMessage } = parseMetaError(body);
	const marker = code !== undefined ? formatThreadsMetaMarker(code, subcode) : '';
	const said = metaMessage || body.slice(0, 300);
	const detail = body ? body.slice(0, 2000) : undefined;
	const message = `${prefix} failed (${status}): ${said}${marker}`;
	if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
		// A dead Page token arrives as a 400 with code 190; callers expire an
		// account on the 401.
		return new ProviderError(`${message} — reconnect`, { status: 401, code: 'auth', detail });
	}
	if (status === 429 || (code !== undefined && RATE_CODES.has(code))) {
		return new ProviderError(message, { status, code: 'rate_limited', detail });
	}
	if (status >= 500 || (code !== undefined && TRANSIENT_CODES.has(code))) {
		return new ProviderError(message, { status, code: 'upstream', detail });
	}
	return new ProviderError(message, { status, code: 'forbidden', detail });
}

function isWebp(m: MediaAttachment): boolean {
	return (m.mime || '').toLowerCase() === 'image/webp';
}

function imageProblems(media: MediaAttachment[]): string[] {
	const problems: string[] = [];
	for (const m of media) {
		if (isVideoAttachment(m)) continue;
		// Facebook takes JPEG, PNG, GIF, BMP and TIFF; a WebP goes as its JPEG copy.
		if (isWebp(m) && !m.hasJpegCopy) {
			problems.push('Facebook does not take WebP — attach this image again, or as a JPEG or PNG');
		} else if (mediaByteLength(m) > FACEBOOK_MAX_IMAGE_BYTES) {
			problems.push("An image is over Facebook's 10MB limit");
		}
	}
	return problems;
}

type VideoState = { state: 'ready' } | { state: 'working' } | { state: 'failed'; reason: string };

type PhaseStatus = { status?: unknown; error?: { message?: unknown } };

/** Read off `fields=status`: video_status, with each phase's own verdict. */
function videoState(body: unknown): VideoState | null {
	const status = (body as { status?: Record<string, unknown> } | null)?.status;
	if (!status || typeof status !== 'object') return null;
	const phases = ['uploading_phase', 'processing_phase', 'publishing_phase'].map(
		(key) => status[key] as PhaseStatus | undefined
	);
	const failed = phases.find((phase) => phase?.status === 'error');
	if (status.video_status === 'error' || failed) {
		const reason = failed?.error?.message;
		return {
			state: 'failed',
			reason: typeof reason === 'string' && reason ? reason : 'processing failed'
		};
	}
	if (status.video_status === 'ready' || phases[2]?.status === 'complete')
		return { state: 'ready' };
	return { state: 'working' };
}

export const facebookProvider: PlatformProvider = {
	id: 'facebook',
	// Meta pulls every photo and video from a public URL.
	mediaByUrl: true,
	capabilities: {
		maxImages: FACEBOOK_MAX_IMAGES,
		maxImageBytes: FACEBOOK_MAX_IMAGE_BYTES,
		supportsThreads: false
	},

	validate(content, meta): ValidationIssue[] {
		const { text, media } = singlePost(content);
		const issues: ValidationIssue[] = [];
		if (!text.trim() && media.length === 0) {
			issues.push({
				field: 'text',
				message: 'Facebook needs text, a photo or a video',
				code: 'empty'
			});
		}
		const length = countGraphemes(text);
		if (length > FACEBOOK_MAX_CHARS) {
			issues.push({
				field: 'text',
				message: `Facebook posts are up to ${FACEBOOK_MAX_CHARS.toLocaleString('en-US')} characters (${length})`,
				code: 'max_length'
			});
		}
		const problems = postMediaProblems('facebook', media);
		for (const message of problems)
			issues.push({ field: 'media', message, code: 'facebook_media' });
		if (problems.length) return issues;
		for (const message of imageProblems(media)) issues.push({ field: 'media', message });
		issues.push(...videoValidation('facebook', media, meta, 'media'));
		return issues;
	},

	async publish(content, creds, _meta, fetchImpl = providerFetch, opts): Promise<PublishResult> {
		const token = creds.accessToken;
		const pageId = creds.pageId;
		if (!token || !pageId) {
			throw new ProviderError('Facebook credentials are missing the Page token (reconnect)', {
				code: 'auth'
			});
		}
		const mediaUrlFor = opts?.mediaUrlFor;
		const { text, media } = singlePost(content);
		const video = media.find(isVideoAttachment);
		const page = encodeURIComponent(pageId);

		// A parked video is past its create: only its processing is left.
		const parked = video?.storageKey ? resumedVideoState(opts?.resume, 0, video.storageKey) : null;
		const parkedId = typeof parked?.videoId === 'string' ? parked.videoId : '';
		// A run that posted and then lost its answer resumes here: never twice.
		const done = opts?.resume?.segmentIds?.[0];
		if (done && !parkedId) {
			return { remotePostId: done, remoteUrl: opts?.resume?.remoteUrl ?? undefined };
		}

		async function graphPost(path: string, params: Record<string, string>, label: string) {
			const res = await fetchImpl(`${GRAPH}/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ ...params, access_token: token! })
			});
			if (!res.ok) throw facebookUpstreamError(label, res.status, await res.text());
			return (await res.json().catch(() => ({}))) as { id?: unknown; post_id?: unknown };
		}

		/**
		 * The request that makes the post live. Facebook takes no idempotency
		 * key, so a lost answer or a server error may have posted it: retrying
		 * on its own could post twice.
		 */
		async function createPost(path: string, params: Record<string, string>, label: string) {
			try {
				return await graphPost(path, params, label);
			} catch (err) {
				if (err instanceof ProviderError && err.code !== 'upstream') throw err;
				throw unconfirmedPostError('Facebook', err);
			}
		}

		async function photoUrl(m: MediaAttachment): Promise<string> {
			if (!m.storageKey) throw new Error('Facebook photo is missing its storage key');
			if (!mediaUrlFor) throw new Error('Facebook posts need a media signer');
			return mediaUrlFor(m.storageKey, isWebp(m) ? 'jpeg' : undefined);
		}

		function photoParams(m: MediaAttachment, url: string): Record<string, string> {
			const params: Record<string, string> = { url };
			const alt = m.alt?.trim();
			if (alt) params.alt_text_custom = alt.slice(0, MAX_ALT_TEXT);
			return params;
		}

		const idOf = (value: unknown) =>
			typeof value === 'string' || typeof value === 'number' ? String(value) : '';

		if (video) {
			if (!video.storageKey) throw new Error('Facebook video is missing its storage key');
			let videoId = parkedId;
			if (!videoId) {
				if (!mediaUrlFor) throw new Error('Facebook posts need a media signer');
				const params: Record<string, string> = { file_url: await mediaUrlFor(video.storageKey) };
				if (text) params.description = text;
				videoId = idOf((await createPost(`${page}/videos`, params, 'Facebook video')).id);
				if (!videoId) {
					throw new ProviderError('Facebook returned no video id', { code: 'unconfirmed' });
				}
				// The video is a post from here on: a run cut off while it
				// processes must not create it again.
				await opts?.checkpoint?.({ segmentIds: [videoId] });
			}
			const remoteUrl = `https://www.facebook.com/${page}/videos/${encodeURIComponent(videoId)}`;
			const ready = await pollVideo(
				{
					polls: VIDEO_POLLS,
					delayMs: VIDEO_POLL_MS,
					reserve: POLL_RESERVE,
					callsLeft: opts?.callsLeft,
					timeLeft: opts?.timeLeft
				},
				async () => {
					let res: Response;
					try {
						res = await fetchImpl(
							`${GRAPH}/${encodeURIComponent(videoId)}?fields=status&access_token=${encodeURIComponent(token)}`
						);
					} catch {
						return null;
					}
					if (!res.ok) {
						// A dead token never recovers; anything else is read again later.
						const err = facebookUpstreamError(
							'Facebook video status',
							res.status,
							await res.text()
						);
						if (err.code === 'auth') throw err;
						return null;
					}
					const state = videoState(await res.json().catch(() => null));
					if (state?.state === 'failed') {
						throw new ProviderError(`Facebook could not take the video: ${state.reason}`, {
							code: 'forbidden',
							detail: state.reason
						});
					}
					return state?.state === 'ready' ? true : null;
				}
			);
			if (!ready) {
				throw processingError('Facebook', {
					segment: 0,
					storageKey: video.storageKey,
					state: { videoId }
				});
			}
			return { remotePostId: videoId, remoteUrl };
		}

		let postId: string;
		if (media.length === 0) {
			postId = idOf((await createPost(`${page}/feed`, { message: text }, 'Facebook post')).id);
		} else if (media.length === 1) {
			const params = photoParams(media[0], await photoUrl(media[0]));
			if (text) params.caption = text;
			const data = await createPost(`${page}/photos`, params, 'Facebook photo');
			// The photo's own id is not the post's; the permalink needs the post.
			postId = idOf(data.post_id) || idOf(data.id);
		} else {
			// Unpublished uploads make nothing visible, so a failure here is safe
			// to retry: the next attempt uploads them again.
			const attached: string[] = [];
			for (const m of media) {
				const data = await graphPost(
					`${page}/photos`,
					{ ...photoParams(m, await photoUrl(m)), published: 'false' },
					'Facebook photo upload'
				);
				const id = idOf(data.id);
				if (!id) throw new ProviderError('Facebook returned no photo id', { code: 'upstream' });
				attached.push(id);
			}
			const params: Record<string, string> = {};
			if (text) params.message = text;
			attached.forEach((id, i) => {
				params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
			});
			postId = idOf((await createPost(`${page}/feed`, params, 'Facebook post')).id);
		}
		// Before the permalink: a run cut off during that read must resume knowing
		// the post is live. Only the link is lost if it does.
		await opts?.checkpoint?.({ segmentIds: postId ? [postId] : [] });
		const remoteUrl = postId ? await permalink(postId, token, fetchImpl) : null;
		return { remotePostId: postId || undefined, remoteUrl: remoteUrl ?? undefined };
	}
};

/** The post's link, or null: the post is live either way, so a failure here is swallowed. */
async function permalink(id: string, token: string, fetchImpl: FetchLike): Promise<string | null> {
	try {
		const res = await fetchImpl(
			`${GRAPH}/${encodeURIComponent(id)}?fields=permalink_url&access_token=${encodeURIComponent(token)}`
		);
		if (!res.ok) return null;
		const data = (await res.json()) as { permalink_url?: unknown };
		return typeof data.permalink_url === 'string' &&
			/^https:\/\/(www\.)?facebook\.com\//.test(data.permalink_url)
			? data.permalink_url
			: null;
	} catch {
		return null;
	}
}

export function facebookAuthorizeUrl(
	appId: string,
	appUrl: string,
	state: string,
	configId?: string
): string {
	const params = new URLSearchParams({
		client_id: appId,
		redirect_uri: callbackUri('facebook', appUrl),
		response_type: 'code',
		state
	});
	// Facebook Login for Business names its permissions in the configuration.
	if (configId) params.set('config_id', configId);
	else params.set('scope', FACEBOOK_SCOPES.join(','));
	return `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export interface FacebookPage {
	pageId: string;
	/** The Page's own token; from a long-lived user token it does not expire. */
	accessToken: string;
	name: string;
	username?: string;
	avatarUrl?: string;
}

type AccountsPage = {
	data?: Array<{
		id?: unknown;
		name?: unknown;
		username?: unknown;
		access_token?: unknown;
		picture?: { data?: { url?: unknown } };
		tasks?: unknown;
	}>;
	paging?: { next?: unknown };
};

async function exchangeFailure(label: string, res: Response): Promise<Error> {
	const body = await res.text();
	const { message } = parseMetaError(body);
	return Object.assign(
		new Error(`${label} failed (${res.status}): ${(message || body).slice(0, 300)}`),
		{ status: res.status }
	);
}

export const NO_PAGES_MESSAGE =
	'No Facebook Pages to post to — connect again and grant at least one Page you can create content on';

/**
 * Code → short-lived user token → long-lived user token → the Pages it can
 * post to. Page tokens taken from a long-lived user token never expire, so
 * nothing about the user token is kept.
 */
export async function facebookExchangeCode(
	args: { appId: string; appSecret: string; code: string; appUrl: string },
	fetchImpl: FetchLike = providerFetch
): Promise<FacebookPage[]> {
	const shortParams = new URLSearchParams({
		client_id: args.appId,
		client_secret: args.appSecret,
		redirect_uri: callbackUri('facebook', args.appUrl),
		code: args.code
	});
	const shortRes = await fetchImpl(`${GRAPH}/oauth/access_token?${shortParams.toString()}`);
	if (!shortRes.ok) throw await exchangeFailure('Facebook token exchange', shortRes);
	const short = (await shortRes.json()) as { access_token?: string };
	if (!short.access_token) throw new Error('Facebook exchange returned no access_token');

	const longParams = new URLSearchParams({
		grant_type: 'fb_exchange_token',
		client_id: args.appId,
		client_secret: args.appSecret,
		fb_exchange_token: short.access_token
	});
	const longRes = await fetchImpl(`${GRAPH}/oauth/access_token?${longParams.toString()}`);
	if (!longRes.ok) throw await exchangeFailure('Facebook long-lived exchange', longRes);
	const long = (await longRes.json()) as { access_token?: string };
	if (!long.access_token) throw new Error('Facebook exchange returned no long-lived token');

	const pages: FacebookPage[] = [];
	let next: string | null =
		`${GRAPH}/me/accounts?fields=id,name,username,access_token,picture{url},tasks&limit=100&access_token=${encodeURIComponent(long.access_token)}`;
	for (let i = 0; next && i < MAX_ACCOUNT_PAGES; i++) {
		const res = await fetchImpl(next);
		if (!res.ok) throw await exchangeFailure('Facebook Pages lookup', res);
		const body = (await res.json()) as AccountsPage;
		for (const entry of body.data ?? []) {
			const pageId = typeof entry.id === 'string' ? entry.id : '';
			const accessToken = typeof entry.access_token === 'string' ? entry.access_token : '';
			if (!pageId || !accessToken) continue;
			// Someone who can only moderate or read a Page could connect it and
			// then fail every post.
			if (Array.isArray(entry.tasks) && !entry.tasks.includes('CREATE_CONTENT')) continue;
			const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : pageId;
			const username = typeof entry.username === 'string' ? entry.username : undefined;
			const avatar = entry.picture?.data?.url;
			pages.push({
				pageId,
				accessToken,
				name,
				username: username || undefined,
				avatarUrl: typeof avatar === 'string' ? avatar : undefined
			});
		}
		next =
			typeof body.paging?.next === 'string' && body.paging.next.startsWith(`${GRAPH}/`)
				? body.paging.next
				: null;
	}
	if (!pages.length) throw new Error(NO_PAGES_MESSAGE);
	return pages;
}

export async function facebookVerify(
	creds: ConnectionCredentials,
	fetchImpl: FetchLike = providerFetch
): Promise<{ displayName?: string; avatarUrl?: string; handle?: string; pageId?: string }> {
	if (!creds.accessToken || !creds.pageId) throw new Error('Missing Page token');
	const res = await fetchImpl(
		`${GRAPH}/${encodeURIComponent(creds.pageId)}?fields=id,name,username,picture{url}&access_token=${encodeURIComponent(creds.accessToken)}`
	);
	if (!res.ok) throw facebookUpstreamError('Facebook Page', res.status, await res.text());
	const data = (await res.json()) as {
		id?: unknown;
		name?: unknown;
		username?: unknown;
		picture?: { data?: { url?: unknown } };
	};
	const name = typeof data.name === 'string' ? data.name : undefined;
	const username = typeof data.username === 'string' ? data.username : undefined;
	const avatar = data.picture?.data?.url;
	return {
		displayName: name,
		avatarUrl: typeof avatar === 'string' ? avatar : undefined,
		handle: username || name,
		pageId: typeof data.id === 'string' ? data.id : creds.pageId
	};
}
