import { callbackUri } from '#lib/domain/platform-setup.js';
import { postMediaProblems } from '#lib/domain/media-limits.js';
import { TIKTOK_PRIVACY_LABELS, tiktokOptionProblems } from '#lib/domain/platform-options.js';
import { singlePost } from './flatten';
import { processingError, ProviderError, resumedVideoState } from './types';
import {
	isVideoAttachment,
	MISSING_VIDEO_MESSAGE,
	PART_UPLOAD_MS,
	fixedLengthBody,
	pollVideo,
	requireMediaReader,
	storedVideoSize,
	videoValidation
} from './video';
import type {
	ConnectionCredentials,
	FetchLike,
	MediaAttachment,
	MediaReader,
	PlatformProvider,
	PublishResult,
	ValidationIssue
} from './types';
import { providerFetch } from './timed-fetch';

const API = 'https://open.tiktokapis.com/v2';
const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'];
/** The caption limit, in UTF-16 code units as TikTok counts them. */
export const TIKTOK_MAX_CAPTION = 2200;

// Access tokens last a day, so refresh well before a long upload can outlive one.
const REFRESH_SKEW_MS = 10 * 60 * 1000;
// Chunks run 5–64 MB and the last may carry the remainder up to 128 MB; a
// file under the minimum goes up whole. Decimal megabytes keep under the
// limit whichever unit TikTok means.
const MIN_CHUNK_BYTES = 5_000_000;
const MAX_CHUNK_BYTES = 64_000_000;
// upload_url dies an hour after init; a resume that late starts over instead of
// sending chunks TikTok will refuse half-way.
const UPLOAD_URL_TTL_MS = 55 * 60 * 1000;
// Calls kept back for the status read and publish.ts's own writes.
const RESERVE_CALLS = 6;
const STATUS_POLLS = 4;
const STATUS_POLL_MS = 3000;
const DAILY_CAP_RETRY_MS = 60 * 60_000;

type TikTokEnvelope<T> = {
	data?: T;
	error?: { code?: string; message?: string; log_id?: string };
};

type TokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	open_id?: string;
	scope?: string;
	token_type?: string;
	error?: string;
	error_description?: string;
};

export interface TikTokCreatorInfo {
	nickname: string;
	username: string;
	avatarUrl: string | null;
	privacyLevels: string[];
	commentDisabled: boolean;
	duetDisabled: boolean;
	stitchDisabled: boolean;
	maxDurationSec: number | null;
}

interface TikTokVideoState {
	publishId: string;
	uploadUrl?: string;
	size?: number;
	chunkSize?: number;
	total?: number;
	/** The next chunk to send. */
	next?: number;
	initAt?: number;
	/** Every chunk is in: only the status read is left. */
	uploaded?: boolean;
}

/**
 * Map a TikTok failure onto the codes publish.ts acts on. TikTok answers most
 * refusals with a 4xx and an `error.code`, and the code is what says whether
 * waiting helps.
 */
export function tiktokError(prefix: string, status: number, body: string): ProviderError {
	let code = '';
	let message = '';
	try {
		const parsed = JSON.parse(body) as TikTokEnvelope<unknown>;
		code = parsed.error?.code ?? '';
		message = parsed.error?.message ?? '';
	} catch {
		// Not JSON: the status decides.
	}
	const detail = body.slice(0, 300);
	const said = message || code || detail;
	if (code === 'unaudited_client_can_only_post_to_private_accounts') {
		return new ProviderError(
			'TikTok only lets an app it has not audited post to private accounts — make the TikTok account private, or have TikTok audit the app to post publicly',
			{ status, code: 'forbidden', detail }
		);
	}
	if (code === 'access_token_invalid' || status === 401) {
		return new ProviderError(`${prefix} failed: TikTok rejected the token — reconnect`, {
			status: 401,
			code: 'auth',
			detail
		});
	}
	if (code === 'scope_not_authorized') {
		return new ProviderError(
			`${prefix} failed: the connection lacks the video.publish permission — reconnect and allow posting`,
			{ status, code: 'forbidden', detail }
		);
	}
	if (code === 'rate_limit_exceeded' || status === 429) {
		return new ProviderError(`${prefix} failed: TikTok is rate limiting — ${said}`, {
			status,
			code: 'rate_limited',
			detail
		});
	}
	if (code === 'reached_active_user_cap' || code.startsWith('spam_risk_too_many')) {
		return new ProviderError(
			`${prefix} failed: TikTok's daily posting limit was reached (${code}) — it tries again later`,
			{ status, code: 'rate_limited', detail, retryAfterMs: DAILY_CAP_RETRY_MS }
		);
	}
	if (code.startsWith('spam_risk')) {
		return new ProviderError(`${prefix} failed: TikTok refused the post (${code})`, {
			status,
			code: 'forbidden',
			detail
		});
	}
	if (status >= 500 || code === 'internal_error') {
		return new ProviderError(`${prefix} failed (${status}): ${said}`, {
			status,
			code: 'upstream',
			detail
		});
	}
	if (status === 403) {
		return new ProviderError(`${prefix} failed (${status}): ${said}`, {
			status,
			code: 'forbidden',
			detail
		});
	}
	return new ProviderError(`${prefix} failed (${status}): ${said}`, { status, detail });
}

async function call<T>(
	prefix: string,
	url: string,
	init: RequestInit,
	fetchImpl: FetchLike
): Promise<T> {
	let res: Response;
	try {
		res = await fetchImpl(url, init);
	} catch (err) {
		throw new ProviderError(
			`${prefix} failed: ${err instanceof Error ? err.message : String(err)}`,
			{ code: 'network' }
		);
	}
	const text = await res.text();
	let parsed: TikTokEnvelope<T> = {};
	try {
		parsed = JSON.parse(text) as TikTokEnvelope<T>;
	} catch {
		// Leave it to the status.
	}
	const code = parsed.error?.code;
	// A 200 can still carry an error code; `ok` is the only success.
	if (!res.ok || (code && code !== 'ok')) throw tiktokError(prefix, res.status, text);
	return (parsed.data ?? {}) as T;
}

function jsonInit(token: string, body: unknown): RequestInit {
	return {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json; charset=UTF-8'
		},
		body: JSON.stringify(body)
	};
}

// --- OAuth ---

export function tiktokCallbackUrl(appUrl: string): string {
	return callbackUri('tiktok', appUrl);
}

export function tiktokAuthorizeUrl(clientKey: string, appUrl: string, state: string): string {
	const params = new URLSearchParams({
		client_key: clientKey,
		scope: TIKTOK_SCOPES.join(','),
		response_type: 'code',
		redirect_uri: tiktokCallbackUrl(appUrl),
		state
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function requestToken(body: URLSearchParams, fetchImpl: FetchLike): Promise<TokenResponse> {
	const res = await fetchImpl(`${API}/oauth/token/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});
	const text = await res.text();
	let tok: TokenResponse = {};
	try {
		tok = JSON.parse(text) as TokenResponse;
	} catch {
		// Fall through to the status check.
	}
	// The token endpoint reports failures in `error` beside a 200 as often as
	// with a 4xx.
	if (!res.ok || tok.error) {
		throw Object.assign(
			new Error(
				`TikTok token request failed (${res.status}): ${tok.error_description || tok.error || text.slice(0, 300)}`
			),
			{ status: res.ok ? 400 : res.status }
		);
	}
	return tok;
}

type UserInfo = { open_id?: string; avatar_url?: string; display_name?: string };

async function fetchUser(token: string, fetchImpl: FetchLike): Promise<UserInfo> {
	const data = await call<{ user?: UserInfo }>(
		'TikTok profile lookup',
		`${API}/user/info/?fields=open_id,avatar_url,display_name`,
		{ headers: { Authorization: `Bearer ${token}` } },
		fetchImpl
	);
	return data.user ?? {};
}

type CreatorInfoData = {
	creator_avatar_url?: string;
	creator_username?: string;
	creator_nickname?: string;
	privacy_level_options?: unknown;
	comment_disabled?: boolean;
	duet_disabled?: boolean;
	stitch_disabled?: boolean;
	max_video_post_duration_sec?: number;
};

/**
 * Who is posting and what TikTok lets them do right now. The guidelines ask
 * for it fresh whenever the post settings are shown, and the answer changes
 * (a creator who hit a limit, an account made private), so it is never stored.
 */
export async function tiktokCreatorInfo(
	creds: ConnectionCredentials,
	fetchImpl: FetchLike = providerFetch
): Promise<TikTokCreatorInfo> {
	if (!creds.accessToken)
		throw new ProviderError('TikTok credentials require accessToken (reconnect)', {
			code: 'auth'
		});
	const data = await call<CreatorInfoData>(
		'TikTok creator info',
		`${API}/post/publish/creator_info/query/`,
		jsonInit(creds.accessToken, {}),
		fetchImpl
	);
	return {
		nickname: data.creator_nickname ?? '',
		username: data.creator_username ?? '',
		avatarUrl: data.creator_avatar_url ?? null,
		privacyLevels: Array.isArray(data.privacy_level_options)
			? data.privacy_level_options.filter((v): v is string => typeof v === 'string')
			: [],
		commentDisabled: data.comment_disabled === true,
		duetDisabled: data.duet_disabled === true,
		stitchDisabled: data.stitch_disabled === true,
		maxDurationSec:
			typeof data.max_video_post_duration_sec === 'number' && data.max_video_post_duration_sec > 0
				? data.max_video_post_duration_sec
				: null
	};
}

export async function tiktokExchangeCode(
	args: { clientKey: string; clientSecret: string; code: string; appUrl: string },
	fetchImpl: FetchLike = providerFetch
): Promise<{
	credentials: ConnectionCredentials;
	displayName: string;
	handle?: string;
	avatarUrl?: string;
	openId: string;
}> {
	const tok = await requestToken(
		new URLSearchParams({
			client_key: args.clientKey,
			client_secret: args.clientSecret,
			code: args.code,
			grant_type: 'authorization_code',
			redirect_uri: tiktokCallbackUrl(args.appUrl)
		}),
		fetchImpl
	);
	if (!tok.access_token) throw new Error('TikTok token exchange returned no access token');
	if (!tok.refresh_token) throw new Error('TikTok issued no refresh token — reconnect');
	const scopes = tok.scope ? tok.scope.split(',').map((s) => s.trim()) : [...TIKTOK_SCOPES];
	if (!scopes.includes('video.publish')) {
		throw new Error('TikTok did not grant video.publish — connect again and allow posting');
	}
	const user = await fetchUser(tok.access_token, fetchImpl);
	const openId = tok.open_id || user.open_id;
	if (!openId) throw new Error('TikTok returned no account id');
	// The username is only on creator_info; without it the account still
	// connects, shown by its display name.
	const username = await tiktokCreatorInfo({ accessToken: tok.access_token }, fetchImpl).then(
		(info) => info.username,
		() => ''
	);
	const handle = username ? `@${username}` : undefined;
	return {
		credentials: {
			accessToken: tok.access_token,
			refreshToken: tok.refresh_token,
			expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
			tokenType: tok.token_type || 'Bearer',
			scopes,
			clientId: args.clientKey,
			clientSecret: args.clientSecret,
			tiktokOpenId: openId,
			...(handle ? { handle } : {})
		},
		displayName: user.display_name || handle || 'TikTok',
		handle,
		avatarUrl: user.avatar_url,
		openId
	};
}

export async function tiktokVerify(
	creds: ConnectionCredentials,
	fetchImpl: FetchLike = providerFetch
): Promise<{ displayName?: string; avatarUrl?: string; handle?: string; openId?: string }> {
	if (!creds.accessToken) throw new Error('Missing accessToken');
	const user = await fetchUser(creds.accessToken, fetchImpl);
	let handle = creds.handle;
	try {
		const username = (await tiktokCreatorInfo(creds, fetchImpl)).username;
		if (username) handle = `@${username}`;
	} catch {
		// The profile proved the token works; the username is a nicety.
	}
	return {
		displayName: user.display_name || handle,
		avatarUrl: user.avatar_url,
		handle,
		openId: user.open_id
	};
}

// --- Video upload ---

/** TikTok's chunk plan for a file of `size` bytes. */
export function tiktokChunkPlan(size: number): { chunkSize: number; total: number } {
	if (size < MIN_CHUNK_BYTES) return { chunkSize: size, total: 1 };
	const chunkSize = Math.min(MAX_CHUNK_BYTES, size);
	return { chunkSize, total: Math.max(1, Math.floor(size / chunkSize)) };
}

function chunkRange(state: Required<TikTokVideoState>, index: number): [number, number] {
	const start = index * state.chunkSize;
	// The last chunk takes the remainder TikTok's floor() leaves over.
	const end = index === state.total - 1 ? state.size - 1 : start + state.chunkSize - 1;
	return [start, end];
}

/** The next chunk after the bytes TikTok says it holds, or null when they do not line up. */
function chunkAfter(header: string | null, state: Required<TikTokVideoState>): number | null {
	const match = header?.match(/(?:bytes[ =])?\d+-(\d+)/);
	if (!match) return null;
	const received = Number(match[1]) + 1;
	if (received >= state.size) return state.total;
	return received % state.chunkSize === 0 ? received / state.chunkSize : null;
}

function videoState(value: Record<string, unknown> | null): TikTokVideoState | null {
	if (!value || typeof value.publishId !== 'string') return null;
	if (value.uploaded === true) return { publishId: value.publishId, uploaded: true };
	const numbers = ['size', 'chunkSize', 'total', 'next', 'initAt'];
	if (typeof value.uploadUrl !== 'string' || numbers.some((k) => typeof value[k] !== 'number'))
		return null;
	return value as unknown as TikTokVideoState;
}

async function sendChunk(
	reader: MediaReader,
	storageKey: string,
	state: Required<TikTokVideoState>,
	index: number,
	fetchImpl: FetchLike
): Promise<Response> {
	const [start, end] = chunkRange(state, index);
	const stored = await reader.open(storageKey, { start, end });
	if (!stored) throw new Error(MISSING_VIDEO_MESSAGE);
	const length = end - start + 1;
	try {
		return await fetchImpl(state.uploadUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': 'video/mp4',
				'Content-Length': String(length),
				'Content-Range': `bytes ${start}-${end}/${state.size}`
			},
			body: fixedLengthBody(stored.body, length),
			duplex: 'half'
		} as RequestInit);
	} catch (err) {
		throw new ProviderError(
			`TikTok video upload failed: ${err instanceof Error ? err.message : String(err)}`,
			{ code: 'network' }
		);
	}
}

type StatusData = {
	status?: string;
	fail_reason?: string;
	// TikTok's own spelling.
	publicaly_available_post_id?: unknown[];
};

function postUrl(username: string | undefined, postId: string | undefined): string | undefined {
	if (!username || !postId) return undefined;
	return `https://www.tiktok.com/@${username.replace(/^@/, '')}/video/${postId}`;
}

function failedPost(reason: string): ProviderError {
	if (reason === 'auth_removed')
		return new ProviderError('TikTok access was removed — reconnect', { code: 'auth' });
	if (reason === 'internal')
		return new ProviderError('TikTok failed to publish the video (internal) — it tries again', {
			code: 'upstream'
		});
	return new ProviderError(`TikTok refused the video${reason ? `: ${reason}` : ''}`, {
		code: 'forbidden'
	});
}

// --- Provider ---

export const tiktokProvider: PlatformProvider = {
	id: 'tiktok',
	capabilities: {
		maxImages: 0,
		maxImageBytes: 0,
		supportsThreads: false
	},

	validate(content, meta): ValidationIssue[] {
		const { text, media } = singlePost(content);
		const issues: ValidationIssue[] = [];
		for (const message of postMediaProblems('tiktok', media))
			issues.push({ field: 'media', message, code: 'media' });
		for (const message of tiktokOptionProblems(content.options?.tiktok ?? {}))
			issues.push({ field: 'options.tiktok', message, code: 'options' });
		if (text.length > TIKTOK_MAX_CAPTION)
			issues.push({
				field: 'text',
				message: `TikTok captions are up to ${TIKTOK_MAX_CAPTION} characters`,
				code: 'max_length'
			});
		issues.push(...videoValidation('tiktok', media, meta, 'media'));
		return issues;
	},

	async publish(content, creds, meta, fetchImpl = providerFetch, opts): Promise<PublishResult> {
		if (!creds.accessToken)
			throw new ProviderError('TikTok credentials require accessToken (reconnect)', {
				code: 'auth'
			});
		const token = creds.accessToken;
		const { text, media } = singlePost(content);
		const options = content.options?.tiktok ?? {};
		const problem =
			postMediaProblems('tiktok', media)[0] ??
			tiktokOptionProblems(options)[0] ??
			(text.length > TIKTOK_MAX_CAPTION
				? `TikTok captions are up to ${TIKTOK_MAX_CAPTION} characters`
				: undefined);
		if (problem) throw new ProviderError(problem, { code: 'forbidden' });
		const video = media.find(isVideoAttachment) as MediaAttachment;
		if (!video.storageKey) throw new Error('TikTok video is missing its storage key');
		const storageKey = video.storageKey;
		const callsLeft = opts?.callsLeft ?? (() => Infinity);
		const timeLeft = opts?.timeLeft ?? (() => Infinity);
		const park = (current: TikTokVideoState, retryAfterMs: number): never => {
			throw processingError(
				'TikTok',
				{ segment: 0, storageKey, state: current as unknown as Record<string, unknown> },
				retryAfterMs
			);
		};
		let username = (creds.handle ?? meta?.handle ?? '').replace(/^@/, '') || undefined;
		let state = videoState(resumedVideoState(opts?.resume, 0, storageKey));
		if (
			state &&
			!state.uploaded &&
			(!state.initAt || Date.now() - state.initAt > UPLOAD_URL_TTL_MS)
		) {
			state = null;
		}

		const init = async (): Promise<Required<TikTokVideoState>> => {
			const creator = await tiktokCreatorInfo(creds, fetchImpl);
			if (creator.username) username = creator.username;
			if (!creator.privacyLevels.includes(options.privacyLevel!)) {
				const label = TIKTOK_PRIVACY_LABELS[options.privacyLevel!] ?? options.privacyLevel;
				throw new ProviderError(
					`TikTok no longer offers “${label}” for this account — choose who can watch again`,
					{ code: 'forbidden' }
				);
			}
			const durationMs = video.video?.durationMs;
			if (
				creator.maxDurationSec &&
				durationMs &&
				durationMs > creator.maxDurationSec * 1000 + 500
			) {
				throw new ProviderError(
					`This TikTok account can post videos up to ${creator.maxDurationSec} seconds`,
					{ code: 'forbidden' }
				);
			}
			const size = await storedVideoSize(requireMediaReader(opts?.mediaReader), storageKey);
			const plan = tiktokChunkPlan(size);
			const data = await call<{ publish_id?: string; upload_url?: string }>(
				'TikTok video init',
				`${API}/post/publish/video/init/`,
				jsonInit(token, {
					post_info: {
						title: text,
						privacy_level: options.privacyLevel,
						// The guidelines have every interaction off unless the person
						// turned it on, and off whenever the creator turned it off.
						disable_comment: !options.allowComment || creator.commentDisabled,
						disable_duet: !options.allowDuet || creator.duetDisabled,
						disable_stitch: !options.allowStitch || creator.stitchDisabled,
						brand_content_toggle: options.brandedContent === true,
						brand_organic_toggle: options.brandOrganic === true,
						is_aigc: options.aiGenerated === true
					},
					source_info: {
						source: 'FILE_UPLOAD',
						video_size: size,
						chunk_size: plan.chunkSize,
						total_chunk_count: plan.total
					}
				}),
				fetchImpl
			);
			if (!data.publish_id || !data.upload_url)
				throw new ProviderError('TikTok video init returned no upload address', {
					code: 'upstream'
				});
			return {
				publishId: data.publish_id,
				uploadUrl: data.upload_url,
				size,
				chunkSize: plan.chunkSize,
				total: plan.total,
				next: 0,
				initAt: Date.now(),
				uploaded: false
			};
		};

		let publishId = state?.publishId ?? '';
		if (!state?.uploaded) {
			const reader = requireMediaReader(opts?.mediaReader);
			let upload = state ? (state as Required<TikTokVideoState>) : await init();
			// One fresh start per run: a second refusal is not an expired address.
			let restarted = false;
			while (upload.next < upload.total) {
				// A chunk is a storage read and a PUT.
				if (callsLeft() < RESERVE_CALLS + 2 || timeLeft() < PART_UPLOAD_MS) park(upload, 5_000);
				const res = await sendChunk(reader, storageKey, upload, upload.next, fetchImpl);
				if (res.status === 201 || res.status === 200) {
					await res.body?.cancel().catch(() => {});
					upload = { ...upload, next: upload.total };
				} else if (res.status === 206) {
					await res.body?.cancel().catch(() => {});
					upload = { ...upload, next: upload.next + 1 };
				} else if (res.status === 416) {
					const header = res.headers.get('Content-Range') ?? res.headers.get('Range');
					await res.body?.cancel().catch(() => {});
					const next = chunkAfter(header, upload);
					if (next === null) {
						if (restarted)
							throw new ProviderError('TikTok refused the upload range twice', {
								code: 'upstream'
							});
						upload = await init();
						restarted = true;
					} else {
						upload = { ...upload, next };
					}
				} else if (res.status === 403 && !restarted) {
					// The upload address expired; a new init gets a new one.
					await res.body?.cancel().catch(() => {});
					upload = await init();
					restarted = true;
				} else {
					throw tiktokError('TikTok video upload', res.status, await res.text());
				}
			}
			publishId = upload.publishId;
		}

		const status = await pollVideo(
			{
				polls: STATUS_POLLS,
				delayMs: STATUS_POLL_MS,
				reserve: RESERVE_CALLS,
				callsLeft,
				timeLeft
			},
			async () => {
				const data = await call<StatusData>(
					'TikTok publish status',
					`${API}/post/publish/status/fetch/`,
					jsonInit(token, { publish_id: publishId }),
					fetchImpl
				);
				if (data.status === 'FAILED') throw failedPost(data.fail_reason ?? '');
				if (data.status === 'PUBLISH_COMPLETE' || data.status === 'SEND_TO_USER_INBOX') return data;
				return null;
			}
		);
		if (!status) park({ publishId, uploaded: true }, 15_000);
		const ids = (status!.publicaly_available_post_id ?? []).map(String).filter(Boolean);
		return {
			remotePostId: ids[0] ?? publishId,
			remoteUrl: postUrl(username, ids[0])
		};
	},

	refreshImpossibleReason(creds): string | null {
		if (creds.refreshToken && creds.clientId && creds.clientSecret) return null;
		if (!creds.expiresAt || creds.expiresAt > Date.now()) return null;
		return 'TikTok token expired and cannot be refreshed (incomplete credentials) — reconnect';
	},

	async refreshIfNeeded(creds, fetchImpl = providerFetch): Promise<ConnectionCredentials> {
		if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) return creds;
		if (creds.expiresAt && creds.expiresAt - Date.now() > REFRESH_SKEW_MS) return creds;
		let tok: TokenResponse;
		try {
			tok = await requestToken(
				new URLSearchParams({
					client_key: creds.clientId,
					client_secret: creds.clientSecret,
					grant_type: 'refresh_token',
					refresh_token: creds.refreshToken
				}),
				fetchImpl
			);
		} catch (err) {
			const status = (err as { status?: number } | null)?.status;
			if (status === 400 || status === 401 || status === 403) {
				throw new ProviderError(`TikTok token refresh rejected (${status}) — reconnect`, {
					status: 401,
					code: 'auth'
				});
			}
			return creds;
		}
		if (!tok.access_token) {
			throw new ProviderError('TikTok token refresh returned no token — reconnect', {
				status: 401,
				code: 'auth'
			});
		}
		// The refresh token rotates: the one just used may stop working, so the
		// new one has to be what is stored.
		return {
			...creds,
			accessToken: tok.access_token,
			refreshToken: tok.refresh_token || creds.refreshToken,
			expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : creds.expiresAt,
			scopes: tok.scope ? tok.scope.split(',').map((s) => s.trim()) : creds.scopes
		};
	}
};
