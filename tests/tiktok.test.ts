import { describe, expect, it } from 'vitest';
import {
	tiktokAuthorizeUrl,
	tiktokChunkPlan,
	tiktokExchangeCode,
	tiktokProvider
} from '#lib/server/providers/tiktok.js';
import {
	ProviderError,
	PROCESSING_MARK,
	type FetchLike,
	type MediaAttachment,
	type MediaReader,
	type NormalizedPost,
	type PlatformProvider,
	type PublishPending
} from '#lib/server/providers/types.js';
import type { TikTokOptions } from '#lib/domain/platform-options.js';

type Opts = NonNullable<Parameters<PlatformProvider['publish']>[4]>;
type Handler = (req: Request) => Response | Promise<Response>;

const API = 'https://open.tiktokapis.com/v2';
const UPLOAD = 'https://open-upload.tiktokapis.com/video/?upload_id=1';

function fakeNetwork(handlers: Record<string, Handler>) {
	const net = { left: Infinity, calls: [] as Array<{ method: string; url: string }> };
	const fetchImpl: FetchLike = async (input, init) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		net.left -= 1;
		net.calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url });
		for (const [key, handler] of Object.entries(handlers)) {
			if (url.includes(key)) return handler(new Request(url, init));
		}
		return new Response(`unmocked ${url}`, { status: 404 });
	};
	return { net, fetchImpl, callsLeft: () => net.left };
}

const byte = (i: number) => i % 251;

/**
 * A stored video whose bytes are made on demand, so a file large enough to
 * need several 64 MB chunks never sits in the test's memory.
 */
function generatedVideo(size: number): MediaReader {
	const range = (start: number, end: number) => {
		const out = new Uint8Array(end - start + 1);
		for (let i = 0; i < out.length; i++) out[i] = byte(start + i);
		return out;
	};
	return {
		async size() {
			return size;
		},
		async getRange(_key, start, end) {
			return range(start, end);
		},
		async open(_key, r) {
			const start = r?.start ?? 0;
			const end = r?.end ?? size - 1;
			let at = start;
			const body = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (at > end) return controller.close();
					const stop = Math.min(end, at + 1_000_000 - 1);
					controller.enqueue(range(at, stop));
					at = stop + 1;
				}
			});
			return { body, size };
		}
	};
}

/** Reads an upload without keeping it, checking every byte is where it belongs. */
async function receive(req: Request, start: number): Promise<{ length: number; intact: boolean }> {
	const reader = req.body!.getReader();
	let length = 0;
	let intact = true;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		for (let i = 0; i < value.length; i++) {
			if (value[i] !== byte(start + length + i)) intact = false;
		}
		length += value.length;
	}
	return { length, intact };
}

const ok = (data: unknown) =>
	Response.json({ data, error: { code: 'ok', message: '', log_id: 'l' } });
const refused = (code: string, status = 400) =>
	Response.json({ data: {}, error: { code, message: code, log_id: 'l' } }, { status });

const creator = (overrides: Record<string, unknown> = {}) =>
	ok({
		creator_username: 'maker',
		creator_nickname: 'Maker',
		creator_avatar_url: 'https://p.tiktokcdn.com/a.jpg',
		privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
		comment_disabled: false,
		duet_disabled: false,
		stitch_disabled: true,
		max_video_post_duration_sec: 600,
		...overrides
	});

function videoPost(
	size: number,
	options: TikTokOptions,
	text = 'New drop #launch'
): NormalizedPost {
	const video: MediaAttachment = {
		storageKey: 'v.mp4',
		mime: 'video/mp4',
		size,
		width: 1080,
		height: 1920,
		video: { durationMs: 20_000, videoCodec: 'avc', fps: 30, faststart: true }
	};
	return { text, media: [video], options: { tiktok: options } };
}

const creds = {
	accessToken: 'act',
	refreshToken: 'rft',
	expiresAt: Date.now() + 3_600_000,
	clientId: 'key',
	clientSecret: 'secret',
	tiktokOpenId: 'open-1',
	handle: '@maker'
};

async function parked(run: Promise<unknown>): Promise<ProviderError> {
	const err = await run.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ProviderError);
	const provider = err as ProviderError;
	expect(provider.code).toBe('processing');
	expect(provider.message).toContain(PROCESSING_MARK);
	return provider;
}

const resumeFrom = (err: ProviderError): Opts['resume'] => {
	const pending: PublishPending = { ...err.pending!, startedAt: Date.now() };
	return { segmentIds: [], pending };
};

describe('TikTok connect', () => {
	it('asks for posting rights at the deployment’s own callback', () => {
		const url = new URL(tiktokAuthorizeUrl('key', 'https://social.example/', 'st'));
		expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
		expect(url.searchParams.get('client_key')).toBe('key');
		expect(url.searchParams.get('scope')).toBe('user.info.basic,video.publish');
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://social.example/api/connections/tiktok/callback'
		);
		expect(url.searchParams.get('state')).toBe('st');
	});

	it('keeps the refresh material and names the account by its username', async () => {
		let tokenForm = new URLSearchParams();
		const { fetchImpl } = fakeNetwork({
			'/oauth/token/': async (req) => {
				tokenForm = new URLSearchParams(await req.text());
				return Response.json({
					access_token: 'act',
					refresh_token: 'rft',
					expires_in: 86400,
					open_id: 'open-1',
					scope: 'user.info.basic,video.publish',
					token_type: 'Bearer'
				});
			},
			'/user/info/': () =>
				ok({ user: { open_id: 'open-1', display_name: 'Maker', avatar_url: 'https://a/b.jpg' } }),
			'/creator_info/': () => creator()
		});
		const out = await tiktokExchangeCode(
			{ clientKey: 'key', clientSecret: 'secret', code: 'c', appUrl: 'https://social.example' },
			fetchImpl
		);
		expect(tokenForm.get('grant_type')).toBe('authorization_code');
		expect(tokenForm.get('redirect_uri')).toBe(
			'https://social.example/api/connections/tiktok/callback'
		);
		expect(out.handle).toBe('@maker');
		expect(out.displayName).toBe('Maker');
		expect(out.openId).toBe('open-1');
		expect(out.credentials).toMatchObject({
			accessToken: 'act',
			refreshToken: 'rft',
			clientId: 'key',
			clientSecret: 'secret',
			tiktokOpenId: 'open-1'
		});
	});

	it('refuses a connection that cannot post', async () => {
		const { fetchImpl } = fakeNetwork({
			'/oauth/token/': () =>
				Response.json({
					access_token: 'act',
					refresh_token: 'rft',
					open_id: 'o',
					scope: 'user.info.basic'
				})
		});
		await expect(
			tiktokExchangeCode(
				{ clientKey: 'k', clientSecret: 's', code: 'c', appUrl: 'https://a.b' },
				fetchImpl
			)
		).rejects.toThrow(/video\.publish/);
	});

	it('stores the rotated refresh token, and expires the row when refresh is refused', async () => {
		const due = { ...creds, expiresAt: Date.now() + 1000 };
		const good = fakeNetwork({
			'/oauth/token/': () =>
				Response.json({ access_token: 'act2', refresh_token: 'rft2', expires_in: 86400 })
		});
		const fresh = await tiktokProvider.refreshIfNeeded!(due, good.fetchImpl);
		expect(fresh.accessToken).toBe('act2');
		expect(fresh.refreshToken).toBe('rft2');

		const bad = fakeNetwork({
			'/oauth/token/': () =>
				Response.json({ error: 'invalid_grant', error_description: 'Refresh token is invalid' })
		});
		const err = await tiktokProvider.refreshIfNeeded!(due, bad.fetchImpl).catch((e) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as ProviderError).code).toBe('auth');
	});
});

describe('TikTok validation', () => {
	it('requires one video and an explicit privacy choice', () => {
		const messages = (post: NormalizedPost) =>
			tiktokProvider.validate(post).map((issue) => issue.message);
		expect(messages({ text: 'hi' })).toEqual(
			expect.arrayContaining(['TikTok needs a video', expect.stringMatching(/who can watch/)])
		);
		expect(messages(videoPost(1000, { privacyLevel: 'SELF_ONLY' }))).toEqual([]);
		expect(
			messages(videoPost(1000, { privacyLevel: 'PUBLIC_TO_EVERYONE' }, 'x'.repeat(2201)))
		).toEqual([expect.stringMatching(/2200/)]);
	});
});

describe('TikTok publish', () => {
	it('posts a small video in one chunk with every interaction off unless allowed', async () => {
		let init: { post_info?: unknown; source_info?: unknown } = {};
		let put = { range: '', length: 0, intact: false };
		const { fetchImpl, net } = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': async (req) => {
				init = await req.json();
				return ok({ publish_id: 'p1', upload_url: UPLOAD });
			},
			'open-upload.tiktokapis.com': async (req) => {
				put = { range: req.headers.get('Content-Range') ?? '', ...(await receive(req, 0)) };
				return new Response(null, { status: 201 });
			},
			'/status/fetch/': () =>
				ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7311] })
		});
		const result = await tiktokProvider.publish(
			videoPost(3_000_000, {
				privacyLevel: 'PUBLIC_TO_EVERYONE',
				allowComment: true,
				allowStitch: true,
				brandOrganic: true
			}),
			creds,
			undefined,
			fetchImpl,
			{ mediaReader: generatedVideo(3_000_000) }
		);
		expect(init.post_info).toEqual({
			title: 'New drop #launch',
			privacy_level: 'PUBLIC_TO_EVERYONE',
			disable_comment: false,
			disable_duet: true,
			// Allowed by the person, but the creator turned Stitch off.
			disable_stitch: true,
			brand_content_toggle: false,
			brand_organic_toggle: true,
			is_aigc: false
		});
		expect(init.source_info).toEqual({
			source: 'FILE_UPLOAD',
			video_size: 3_000_000,
			chunk_size: 3_000_000,
			total_chunk_count: 1
		});
		expect(put).toEqual({ range: 'bytes 0-2999999/3000000', length: 3_000_000, intact: true });
		expect(result).toEqual({
			remotePostId: '7311',
			remoteUrl: 'https://www.tiktok.com/@maker/video/7311'
		});
		expect(net.calls.map((c) => c.method)).toEqual(['POST', 'POST', 'PUT', 'POST']);
	});

	it('plans 64 MB chunks with the remainder on the last one', () => {
		expect(tiktokChunkPlan(4_000_000)).toEqual({ chunkSize: 4_000_000, total: 1 });
		expect(tiktokChunkPlan(40_000_000)).toEqual({ chunkSize: 40_000_000, total: 1 });
		expect(tiktokChunkPlan(150_000_000)).toEqual({ chunkSize: 64_000_000, total: 2 });
	});

	it('sends a large video chunk by chunk, parking when the run runs low and resuming after', async () => {
		const size = 150_000_000;
		const puts: Array<{ range: string; length: number; intact: boolean }> = [];
		let inits = 0;
		const network = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => {
				inits += 1;
				return ok({ publish_id: 'p2', upload_url: UPLOAD });
			},
			'open-upload.tiktokapis.com': async (req) => {
				const range = req.headers.get('Content-Range') ?? '';
				const start = Number(range.match(/bytes (\d+)-/)![1]);
				puts.push({ range, ...(await receive(req, start)) });
				return new Response(null, { status: puts.length === 2 ? 201 : 206 });
			},
			'/status/fetch/': () => ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] })
		});
		const reader = generatedVideo(size);
		const post = videoPost(size, { privacyLevel: 'SELF_ONLY' });
		// Room for the creator check, the init and one chunk, then too little.
		network.net.left = 10;
		const err = await parked(
			tiktokProvider.publish(post, creds, undefined, network.fetchImpl, {
				mediaReader: reader,
				callsLeft: network.callsLeft
			})
		);
		expect(puts).toHaveLength(1);
		expect(err.pending?.state).toMatchObject({ publishId: 'p2', next: 1, total: 2 });

		network.net.left = Infinity;
		const result = await tiktokProvider.publish(post, creds, undefined, network.fetchImpl, {
			mediaReader: reader,
			callsLeft: network.callsLeft,
			resume: resumeFrom(err)
		});
		expect(inits).toBe(1);
		expect(puts).toEqual([
			{ range: 'bytes 0-63999999/150000000', length: 64_000_000, intact: true },
			{ range: 'bytes 64000000-149999999/150000000', length: 86_000_000, intact: true }
		]);
		// A private post has no public id: the publish id stands in.
		expect(result.remotePostId).toBe('p2');
		expect(result.remoteUrl).toBeUndefined();
	});

	it('starts over with a new upload address when the old one has expired', async () => {
		let inits = 0;
		let puts = 0;
		const { fetchImpl } = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => {
				inits += 1;
				return ok({ publish_id: `p${inits}`, upload_url: `${UPLOAD}&n=${inits}` });
			},
			'open-upload.tiktokapis.com': async (req) => {
				puts += 1;
				await req.body?.cancel();
				return new Response(null, { status: req.url.endsWith('n=1') ? 403 : 201 });
			},
			'/status/fetch/': () => ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] })
		});
		const result = await tiktokProvider.publish(
			videoPost(1000, { privacyLevel: 'SELF_ONLY' }),
			creds,
			undefined,
			fetchImpl,
			{ mediaReader: generatedVideo(1000) }
		);
		expect(inits).toBe(2);
		expect(puts).toBe(2);
		expect(result.remotePostId).toBe('p2');
	});

	it('does not reuse an upload parked longer than the address lives', async () => {
		let inits = 0;
		const { fetchImpl } = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => {
				inits += 1;
				return ok({ publish_id: 'fresh', upload_url: UPLOAD });
			},
			'open-upload.tiktokapis.com': async (req) => {
				await req.body?.cancel();
				return new Response(null, { status: 201 });
			},
			'/status/fetch/': () => ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] })
		});
		const stale: PublishPending = {
			segment: 0,
			storageKey: 'v.mp4',
			startedAt: Date.now(),
			state: {
				publishId: 'old',
				uploadUrl: UPLOAD,
				size: 1000,
				chunkSize: 1000,
				total: 1,
				next: 0,
				initAt: Date.now() - 60 * 60_000
			}
		};
		const result = await tiktokProvider.publish(
			videoPost(1000, { privacyLevel: 'SELF_ONLY' }),
			creds,
			undefined,
			fetchImpl,
			{ mediaReader: generatedVideo(1000), resume: { segmentIds: [], pending: stale } }
		);
		expect(inits).toBe(1);
		expect(result.remotePostId).toBe('fresh');
	});

	it('parks while TikTok processes, then picks up at the status check', async () => {
		let status = 'PROCESSING_UPLOAD';
		let uploaded = false;
		const network = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => ok({ publish_id: 'p3', upload_url: UPLOAD }),
			'open-upload.tiktokapis.com': async (req) => {
				await req.body?.cancel();
				uploaded = true;
				return new Response(null, { status: 201 });
			},
			'/status/fetch/': () =>
				ok({ status, publicaly_available_post_id: status === 'PUBLISH_COMPLETE' ? [9] : [] })
		});
		const post = videoPost(1000, { privacyLevel: 'SELF_ONLY' });
		const reader = generatedVideo(1000);
		const err = await parked(
			tiktokProvider.publish(post, creds, undefined, network.fetchImpl, {
				mediaReader: reader,
				// Time for the upload, none left to wait on processing.
				timeLeft: () => (uploaded ? 0 : Infinity)
			})
		);
		expect(err.pending?.state).toEqual({ publishId: 'p3', uploaded: true });

		status = 'PUBLISH_COMPLETE';
		const before = network.net.calls.length;
		const result = await tiktokProvider.publish(post, creds, undefined, network.fetchImpl, {
			mediaReader: reader,
			resume: resumeFrom(err)
		});
		expect(network.net.calls.slice(before).map((c) => c.url)).toEqual([
			`${API}/post/publish/status/fetch/`
		]);
		expect(result.remoteUrl).toBe('https://www.tiktok.com/@maker/video/9');
	});

	it('stops before uploading when the chosen audience is no longer offered', async () => {
		const { fetchImpl, net } = fakeNetwork({
			'/creator_info/': () => creator({ privacy_level_options: ['SELF_ONLY'] })
		});
		const err = await tiktokProvider
			.publish(
				videoPost(1000, { privacyLevel: 'PUBLIC_TO_EVERYONE' }),
				creds,
				undefined,
				fetchImpl,
				{ mediaReader: generatedVideo(1000) }
			)
			.catch((e) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as ProviderError).code).toBe('forbidden');
		expect((err as Error).message).toMatch(/Everyone/);
		expect(net.calls).toHaveLength(1);
	});

	it('explains the audit when TikTok refuses an unaudited app', async () => {
		const { fetchImpl } = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => refused('unaudited_client_can_only_post_to_private_accounts', 403)
		});
		const err = await tiktokProvider
			.publish(videoPost(1000, { privacyLevel: 'SELF_ONLY' }), creds, undefined, fetchImpl, {
				mediaReader: generatedVideo(1000)
			})
			.catch((e) => e);
		expect((err as ProviderError).code).toBe('forbidden');
		expect((err as Error).message).toMatch(/audit/);
	});

	it('reports why TikTok refused a processed video, and waits out its daily cap', async () => {
		const failing = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => ok({ publish_id: 'p4', upload_url: UPLOAD }),
			'open-upload.tiktokapis.com': async (req) => {
				await req.body?.cancel();
				return new Response(null, { status: 201 });
			},
			'/status/fetch/': () => ok({ status: 'FAILED', fail_reason: 'duration_check_failed' })
		});
		const err = await tiktokProvider
			.publish(
				videoPost(1000, { privacyLevel: 'SELF_ONLY' }),
				creds,
				undefined,
				failing.fetchImpl,
				{ mediaReader: generatedVideo(1000) }
			)
			.catch((e) => e);
		expect((err as ProviderError).code).toBe('forbidden');
		expect((err as Error).message).toMatch(/duration_check_failed/);

		const capped = fakeNetwork({
			'/creator_info/': () => creator(),
			'/video/init/': () => refused('spam_risk_too_many_posts', 403)
		});
		const cap = (await tiktokProvider
			.publish(videoPost(1000, { privacyLevel: 'SELF_ONLY' }), creds, undefined, capped.fetchImpl, {
				mediaReader: generatedVideo(1000)
			})
			.catch((e) => e)) as ProviderError;
		expect(cap.code).toBe('rate_limited');
		expect(cap.retryable).toBe(true);
		expect(cap.retryAfterMs).toBe(60 * 60_000);
	});
});
