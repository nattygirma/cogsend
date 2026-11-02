import { callbackUri } from '#lib/domain/platform-setup.js';
import { postMediaProblems } from '#lib/domain/media-limits.js';
import {
	youtubeOptionProblems,
	youtubeTitle,
	type YouTubeOptions
} from '#lib/domain/platform-options.js';
import { singlePost } from './flatten';
import type {
	ConnectionCredentials,
	ConnectionMeta,
	FetchLike,
	MediaAttachment,
	NormalizedPost,
	PlatformProvider,
	PublishResult,
	ValidationIssue
} from './types';
import { processingError, ProviderError, providerErrorForStatus, resumedVideoState } from './types';
import {
	fixedLengthBody,
	isVideoAttachment,
	MISSING_VIDEO_MESSAGE,
	PART_UPLOAD_MS,
	requireMediaReader,
	storedVideoSize,
	videoValidation
} from './video';
import { providerFetch } from './timed-fetch';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const SCOPES = [
	'https://www.googleapis.com/auth/youtube.upload',
	'https://www.googleapis.com/auth/youtube.readonly'
];
const REFRESH_SKEW_MS = 5 * 60 * 1000;
export const YOUTUBE_MAX_DESCRIPTION_BYTES = 5000;
// Every part but the last must be a multiple of 256 KiB. 32 MiB keeps a
// 300 MB video to ten parts, each one streamed from storage and never held in
// isolate memory.
export const YOUTUBE_PART_BYTES = 32 * 1024 * 1024;
// Calls kept back for the status read and publish.ts's own writes.
const RESERVE_CALLS = 6;
// The "People & Blogs" category: YouTube requires one, and this is the one its
// own upload page starts from.
const DEFAULT_CATEGORY = '22';

function bearer(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

/** Google's error body: `{ error: { errors: [{ reason }], message } }`. */
function googleReasons(body: string): string[] {
	try {
		const parsed = JSON.parse(body) as {
			error?: { errors?: Array<{ reason?: unknown }> } | string;
		};
		if (typeof parsed.error === 'string') return [parsed.error];
		return (parsed.error?.errors ?? [])
			.map((e) => e.reason)
			.filter((r): r is string => typeof r === 'string');
	} catch {
		return [];
	}
}

/**
 * The quota errors arrive as 403s, which would otherwise read as "refused
 * for good"; they clear when Google's day turns over (midnight Pacific), so
 * they retry instead.
 */
function youtubeError(prefix: string, status: number, body: string): ProviderError {
	const reasons = googleReasons(body);
	if (reasons.some((r) => r === 'quotaExceeded' || r === 'uploadLimitExceeded')) {
		return new ProviderError(
			`${prefix}: the YouTube upload quota is used up for today (a Google project gets 100 uploads a day by default)`,
			{ status, code: 'rate_limited', detail: body.slice(0, 1000), retryAfterMs: 60 * 60_000 }
		);
	}
	return providerErrorForStatus(prefix, status, body);
}

export function youtubeVideoUrl(videoId: string): string {
	return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function descriptionIssues(text: string): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (new TextEncoder().encode(text).length > YOUTUBE_MAX_DESCRIPTION_BYTES) {
		issues.push({
			field: 'text',
			message: `YouTube descriptions are up to ${YOUTUBE_MAX_DESCRIPTION_BYTES} bytes`,
			code: 'max_length'
		});
	}
	if (/[<>]/.test(text)) {
		issues.push({
			field: 'text',
			message: 'YouTube descriptions cannot contain < or >',
			code: 'invalid_chars'
		});
	}
	return issues;
}

interface UploadState {
	sessionUrl: string;
	size: number;
	/** The first byte YouTube does not have yet. */
	offset: number;
}

function uploadState(value: Record<string, unknown> | null): UploadState | null {
	if (
		!value ||
		typeof value.sessionUrl !== 'string' ||
		typeof value.size !== 'number' ||
		typeof value.offset !== 'number'
	)
		return null;
	return value as unknown as UploadState;
}

/** `Range: bytes=0-N` on a 308 means YouTube holds bytes up to N; none means nothing yet. */
function offsetAfter(res: Response): number {
	const match = /bytes=0-(\d+)/.exec(res.headers.get('Range') ?? '');
	return match ? Number(match[1]) + 1 : 0;
}

async function videoIdFrom(res: Response): Promise<string> {
	const data = (await res.json().catch(() => ({}))) as { id?: unknown };
	if (typeof data.id !== 'string' || !data.id)
		throw new Error('YouTube upload returned no video id');
	return data.id;
}

type PublishOpts = Parameters<PlatformProvider['publish']>[4];

async function startSession(
	token: string,
	size: number,
	text: string,
	options: YouTubeOptions,
	fetchImpl: FetchLike
): Promise<string> {
	const params = new URLSearchParams({
		uploadType: 'resumable',
		part: 'snippet,status',
		notifySubscribers: String(options.notifySubscribers ?? true)
	});
	const res = await fetchImpl(`${UPLOAD_API}/videos?${params.toString()}`, {
		method: 'POST',
		headers: {
			...bearer(token),
			'Content-Type': 'application/json; charset=UTF-8',
			'X-Upload-Content-Length': String(size),
			'X-Upload-Content-Type': 'video/mp4'
		},
		body: JSON.stringify({
			snippet: {
				title: youtubeTitle(options, text),
				description: text,
				categoryId: DEFAULT_CATEGORY
			},
			status: {
				// Private unless chosen: a video can be made public later, but
				// one published by mistake has already notified subscribers.
				privacyStatus: options.privacy ?? 'private',
				selfDeclaredMadeForKids: options.madeForKids ?? false,
				embeddable: true
			}
		})
	});
	if (!res.ok) throw youtubeError('YouTube upload start', res.status, await res.text());
	const sessionUrl = res.headers.get('Location');
	if (!sessionUrl) throw new Error('YouTube upload start returned no session URL');
	return sessionUrl;
}

/**
 * Where an earlier run's session got to. YouTube creates the video only when
 * the last byte lands, so a run cut off after that answers here with the
 * video rather than an offset, and nothing is uploaded twice.
 */
async function probeSession(
	state: UploadState,
	fetchImpl: FetchLike
): Promise<{ videoId: string } | { offset: number } | 'expired'> {
	const res = await fetchImpl(state.sessionUrl, {
		method: 'PUT',
		headers: { 'Content-Length': '0', 'Content-Range': `bytes */${state.size}` }
	});
	if (res.status === 308) return { offset: offsetAfter(res) };
	if (res.ok) return { videoId: await videoIdFrom(res) };
	if (res.status === 404 || res.status === 410) return 'expired';
	throw youtubeError('YouTube upload status', res.status, await res.text());
}

async function uploadVideo(
	token: string,
	video: MediaAttachment,
	text: string,
	options: YouTubeOptions,
	fetchImpl: FetchLike,
	opts: PublishOpts
): Promise<string> {
	if (!video.storageKey) throw new Error('YouTube video is missing its storage key');
	const storageKey = video.storageKey;
	const reader = requireMediaReader(opts?.mediaReader);
	const callsLeft = opts?.callsLeft ?? (() => Infinity);
	const timeLeft = opts?.timeLeft ?? (() => Infinity);
	const park = (current: UploadState | null, retryAfterMs = 15_000): never => {
		// An empty state starts a new session on the next run.
		throw processingError(
			'YouTube',
			{ segment: 0, storageKey, state: (current ?? {}) as unknown as Record<string, unknown> },
			retryAfterMs
		);
	};

	let state = uploadState(resumedVideoState(opts?.resume, 0, storageKey));
	if (state) {
		if (callsLeft() < RESERVE_CALLS + 1) park(state);
		let probe: Awaited<ReturnType<typeof probeSession>>;
		try {
			probe = await probeSession(state, fetchImpl);
		} catch (err) {
			// A dropped connection or a 5xx says nothing about the session.
			if (err instanceof ProviderError && (err.status ?? 0) < 500) throw err;
			return park(state);
		}
		if (probe === 'expired') state = null;
		else if ('videoId' in probe) return probe.videoId;
		else state = { ...state, offset: probe.offset };
	}
	if (!state) {
		const size = await storedVideoSize(reader, storageKey);
		const sessionUrl = await startSession(token, size, text, options, fetchImpl);
		state = { sessionUrl, size, offset: 0 };
	}

	while (state.offset < state.size) {
		// A part is a storage read and a PUT.
		if (callsLeft() < RESERVE_CALLS + 2 || timeLeft() < PART_UPLOAD_MS) park(state);
		const start = state.offset;
		const end = Math.min(state.size, start + YOUTUBE_PART_BYTES) - 1;
		const length = end - start + 1;
		const stored = await reader.open(storageKey, { start, end });
		if (!stored) throw new Error(MISSING_VIDEO_MESSAGE);
		let res: Response;
		try {
			res = await fetchImpl(state.sessionUrl, {
				method: 'PUT',
				headers: {
					'Content-Type': 'video/mp4',
					'Content-Length': String(length),
					'Content-Range': `bytes ${start}-${end}/${state.size}`
				},
				body: fixedLengthBody(stored.body, length),
				duplex: 'half'
			} as RequestInit);
		} catch {
			// The part may have landed in full, in part or not at all: the next
			// run asks the session before sending anything.
			return park(state);
		}
		if (res.ok) return videoIdFrom(res);
		if (res.status === 308) {
			const offset = offsetAfter(res);
			// No progress means YouTube kept none of the part; asking again from
			// a fresh run is better than sending it in a loop.
			if (offset <= start) return park(state);
			state = { ...state, offset };
			continue;
		}
		if (res.status === 404 || res.status === 410) return park(null);
		if (res.status >= 500) return park(state);
		throw youtubeError('YouTube upload', res.status, await res.text());
	}
	// Every byte was acknowledged but the response that names the video was
	// not seen: the next run's probe returns it.
	return park(state, 5_000);
}

/**
 * A rejected upload (duplicate, too long for an unverified channel, a policy
 * hit) is only known after the bytes land. Anything else — still processing,
 * or the status read failing — counts as published: YouTube finishes on its own.
 */
async function checkUploadStatus(
	token: string,
	videoId: string,
	fetchImpl: FetchLike
): Promise<void> {
	let res: Response;
	try {
		res = await fetchImpl(`${API}/videos?part=status&id=${encodeURIComponent(videoId)}`, {
			headers: bearer(token)
		});
	} catch {
		return;
	}
	if (!res.ok) return;
	const data = (await res.json().catch(() => ({}))) as {
		items?: Array<{
			status?: { uploadStatus?: string; rejectionReason?: string; failureReason?: string };
		}>;
	};
	const status = data.items?.[0]?.status;
	if (status?.uploadStatus === 'rejected' || status?.uploadStatus === 'failed') {
		const reason = status.rejectionReason ?? status.failureReason ?? status.uploadStatus;
		throw new ProviderError(`YouTube ${status.uploadStatus} the video (${reason})`, {
			code: 'forbidden'
		});
	}
}

/** Needs a verified channel, so a refusal here leaves the video as it is. */
async function setThumbnail(
	token: string,
	videoId: string,
	video: MediaAttachment,
	fetchImpl: FetchLike,
	opts: PublishOpts
): Promise<void> {
	const reader = opts?.mediaReader;
	if (!video.coverKey || !reader) return;
	if ((opts?.callsLeft?.() ?? Infinity) < RESERVE_CALLS + 2) return;
	try {
		const cover = await reader.open(video.coverKey);
		if (!cover) return;
		await fetchImpl(
			`${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
			{
				method: 'POST',
				headers: {
					...bearer(token),
					'Content-Type': 'image/jpeg',
					'Content-Length': String(cover.size)
				},
				body: fixedLengthBody(cover.body, cover.size),
				duplex: 'half'
			} as RequestInit
		);
	} catch {
		// Best effort, as above.
	}
}

export const youtubeProvider: PlatformProvider = {
	id: 'youtube',
	capabilities: {
		maxImages: 0,
		maxImageBytes: 0,
		supportsThreads: false
	},

	validate(content: NormalizedPost, meta?: ConnectionMeta): ValidationIssue[] {
		const { text, media } = singlePost(content);
		const issues: ValidationIssue[] = postMediaProblems('youtube', media).map((message) => ({
			field: 'media',
			message,
			code: 'media'
		}));
		for (const message of youtubeOptionProblems(content.options?.youtube ?? {}, text)) {
			issues.push({ field: 'options.youtube', message, code: 'options' });
		}
		issues.push(...descriptionIssues(text));
		if (media.length === 1 && isVideoAttachment(media[0])) {
			issues.push(...videoValidation('youtube', media, meta, 'media'));
		}
		return issues;
	},

	async publish(content, creds, meta, fetchImpl = providerFetch, opts): Promise<PublishResult> {
		// A checkpoint means the video exists; only recording it failed.
		const resumed = opts?.resume?.segmentIds;
		if (resumed?.length && resumed[0]) {
			return {
				remotePostId: resumed[0],
				remoteUrl: opts?.resume?.remoteUrl || youtubeVideoUrl(resumed[0])
			};
		}
		if (!creds.accessToken)
			throw new ProviderError('YouTube credentials require accessToken (reconnect)', {
				code: 'auth'
			});
		const issues = youtubeProvider.validate(content, meta);
		if (issues.length) throw new ProviderError(issues[0].message, { code: 'forbidden' });
		const { text, media } = singlePost(content);
		const options = content.options?.youtube ?? {};
		const token = creds.accessToken;
		const videoId = await uploadVideo(token, media[0], text, options, fetchImpl, opts);
		const remoteUrl = youtubeVideoUrl(videoId);
		// Recorded before anything else can fail: the video exists now, and a
		// retry must not upload it again.
		await opts?.checkpoint?.({ segmentIds: [videoId], remoteUrl });
		await checkUploadStatus(token, videoId, fetchImpl);
		await setThumbnail(token, videoId, media[0], fetchImpl, opts);
		return { remotePostId: videoId, remoteUrl };
	},

	refreshImpossibleReason(creds): string | null {
		if (creds.refreshToken && creds.clientId && creds.clientSecret) return null;
		if (!creds.expiresAt || creds.expiresAt > Date.now()) return null;
		return 'YouTube access expired and cannot be renewed — reconnect';
	},

	async refreshIfNeeded(creds, fetchImpl = providerFetch): Promise<ConnectionCredentials> {
		if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) return creds;
		if (creds.expiresAt && creds.expiresAt - Date.now() > REFRESH_SKEW_MS) return creds;
		const res = await fetchImpl(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: creds.refreshToken,
				client_id: creds.clientId,
				client_secret: creds.clientSecret
			})
		});
		if (!res.ok) {
			const body = await res.text();
			if (googleReasons(body).includes('invalid_grant') || res.status === 401) {
				// Google ends a refresh token after 7 days while the consent
				// screen is in Testing, and whenever access is revoked.
				throw new ProviderError(
					'Google ended the YouTube connection — reconnect. A Google app whose consent screen is still in Testing loses access after 7 days.',
					{ status: 401, code: 'auth', detail: body.slice(0, 1000) }
				);
			}
			// Transient: try the publish with the token there is.
			return creds;
		}
		const data = (await res.json()) as { access_token?: string; expires_in?: number };
		if (!data.access_token) {
			throw new ProviderError('YouTube token refresh returned no token — reconnect', {
				status: 401,
				code: 'auth'
			});
		}
		return {
			...creds,
			accessToken: data.access_token,
			expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : creds.expiresAt
		};
	}
};

export function youtubeAuthorizeUrl(clientId: string, appUrl: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callbackUri('youtube', appUrl),
		response_type: 'code',
		scope: SCOPES.join(' '),
		// Offline access and a forced consent screen are what get a refresh
		// token: Google issues one only on the first consent otherwise.
		access_type: 'offline',
		prompt: 'consent',
		include_granted_scopes: 'true',
		state
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface Channel {
	id: string;
	title?: string;
	customUrl?: string;
	thumbnail?: string;
}

async function fetchChannel(token: string, fetchImpl: FetchLike): Promise<Channel> {
	const res = await fetchImpl(`${API}/channels?part=snippet&mine=true`, { headers: bearer(token) });
	if (!res.ok) throw youtubeError('YouTube channel lookup', res.status, await res.text());
	const data = (await res.json()) as {
		items?: Array<{
			id?: string;
			snippet?: {
				title?: string;
				customUrl?: string;
				thumbnails?: Record<string, { url?: string } | undefined>;
			};
		}>;
	};
	const item = data.items?.[0];
	if (!item?.id) {
		throw new Error(
			'This Google account has no YouTube channel — create one on youtube.com, then connect again'
		);
	}
	const thumbs = item.snippet?.thumbnails ?? {};
	return {
		id: item.id,
		title: item.snippet?.title,
		customUrl: item.snippet?.customUrl,
		thumbnail: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url
	};
}

function channelFacts(channel: Channel) {
	return {
		displayName: channel.title || channel.customUrl || 'YouTube',
		handle: channel.customUrl || channel.title || channel.id,
		avatarUrl: channel.thumbnail,
		channelId: channel.id
	};
}

export async function youtubeExchangeCode(
	args: { clientId: string; clientSecret: string; code: string; appUrl: string },
	fetchImpl: FetchLike = providerFetch
): Promise<{
	accessToken: string;
	refreshToken: string;
	expiresAt?: number;
	scopes?: string[];
	channelId: string;
	displayName: string;
	handle: string;
	avatarUrl?: string;
}> {
	const res = await fetchImpl(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: args.code,
			client_id: args.clientId,
			client_secret: args.clientSecret,
			redirect_uri: callbackUri('youtube', args.appUrl)
		})
	});
	if (!res.ok) throw youtubeError('YouTube token exchange', res.status, await res.text());
	const tok = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		scope?: string;
	};
	if (!tok.access_token) throw new Error('YouTube token exchange returned no access token');
	if (!tok.refresh_token) {
		throw new Error(
			'Google returned no refresh token. Remove PostEasy from myaccount.google.com/permissions, then connect again'
		);
	}
	const scopes = tok.scope ? tok.scope.split(' ') : undefined;
	if (scopes && !scopes.includes(SCOPES[0])) {
		throw new Error(
			'Allow PostEasy to manage your YouTube videos when Google asks, then try again'
		);
	}
	const channel = channelFacts(await fetchChannel(tok.access_token, fetchImpl));
	return {
		accessToken: tok.access_token,
		refreshToken: tok.refresh_token,
		expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
		scopes,
		...channel
	};
}

export async function youtubeVerify(
	creds: ConnectionCredentials,
	fetchImpl: FetchLike = providerFetch
): Promise<{ displayName?: string; avatarUrl?: string; handle?: string; channelId?: string }> {
	if (!creds.accessToken) throw new Error('Missing accessToken');
	return channelFacts(await fetchChannel(creds.accessToken, fetchImpl));
}
