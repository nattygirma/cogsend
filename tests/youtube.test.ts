import { describe, expect, it } from 'vitest';
import { createTestMedia } from '#lib/server/db/test.js';
import {
	YOUTUBE_PART_BYTES,
	youtubeAuthorizeUrl,
	youtubeExchangeCode,
	youtubeProvider,
	youtubeVerify
} from '#lib/server/providers/youtube.js';
import {
	ProviderError,
	PROCESSING_MARK,
	type FetchLike,
	type MediaAttachment,
	type MediaReader,
	type NormalizedPost,
	type PlatformProvider,
	type PublishCheckpoint,
	type PublishPending
} from '#lib/server/providers/types.js';

type Opts = NonNullable<Parameters<PlatformProvider['publish']>[4]>;
type Handler = (req: Request) => Response | Promise<Response>;

const SESSION = 'https://upload.example/session-1';

/** Routes by substring, first match wins; counts calls against `left`. */
function fakeNetwork(handlers: Record<string, Handler>) {
	const net = { left: Infinity, calls: [] as string[] };
	const fetchImpl: FetchLike = async (input, init) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		net.left -= 1;
		net.calls.push(`${init?.method ?? 'GET'} ${url}`);
		for (const [key, handler] of Object.entries(handlers)) {
			if (url.includes(key)) return handler(new Request(url, init));
		}
		return new Response(`unmocked ${url}`, { status: 404 });
	};
	return { net, fetchImpl, callsLeft: () => net.left };
}

function patterned(size: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) bytes[i] = i % 251;
	return bytes;
}

async function storedVideo(size: number, cover?: Uint8Array<ArrayBuffer>) {
	const store = createTestMedia();
	const bytes = patterned(size);
	await store.put('v.mp4', bytes, 'video/mp4');
	if (cover) await store.put('cover/v.mp4', cover, 'image/jpeg');
	const video: MediaAttachment = {
		storageKey: 'v.mp4',
		mime: 'video/mp4',
		size,
		width: 1920,
		height: 1080,
		video: { durationMs: 30_000, videoCodec: 'avc', fps: 30, faststart: true },
		...(cover ? { coverKey: 'cover/v.mp4' } : {})
	};
	// The in-memory store has every method a reader needs.
	return { store: store as MediaReader, bytes, video };
}

function post(
	video: MediaAttachment | null,
	youtube = {},
	text = 'My launch video\nMore below'
): NormalizedPost {
	return {
		text,
		media: video ? [video] : undefined,
		options: { youtube: { madeForKids: false, ...youtube } }
	};
}

/**
 * An upload session that keeps what it is sent, answers 308 with the Range it
 * holds, and 200 with the video once the last byte lands.
 */
function youtubeServer(opts: { status?: string; rejectionReason?: string } = {}) {
	const received: Uint8Array[] = [];
	const inits: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
	const ranges: string[] = [];
	let held = 0;
	let total = 0;
	const sessionAnswer = () =>
		held >= total && total > 0
			? Response.json({ id: 'vid123' })
			: new Response(null, {
					status: 308,
					headers: held ? { Range: `bytes=0-${held - 1}` } : {}
				});
	const handlers: Record<string, Handler> = {
		'upload/youtube/v3/videos?': async (req) => {
			total = Number(req.headers.get('X-Upload-Content-Length'));
			inits.push({ url: req.url, headers: req.headers, body: await req.json() });
			return new Response(null, { status: 200, headers: { Location: SESSION } });
		},
		[SESSION]: async (req) => {
			const range = req.headers.get('Content-Range') ?? '';
			ranges.push(range);
			if (range.startsWith('bytes */')) return sessionAnswer();
			const bytes = new Uint8Array(await req.arrayBuffer());
			received.push(bytes);
			held += bytes.length;
			return sessionAnswer();
		},
		'youtube/v3/videos?part=status': () =>
			Response.json({
				items: [
					{
						status: {
							uploadStatus: opts.status ?? 'uploaded',
							rejectionReason: opts.rejectionReason
						}
					}
				]
			}),
		'thumbnails/set': () => Response.json({})
	};
	const joined = () => {
		const out = new Uint8Array(held);
		let at = 0;
		for (const part of received) {
			out.set(part, at);
			at += part.length;
		}
		return out;
	};
	return { handlers, inits, ranges, joined };
}

/** toEqual walks a 32 MB array element by element and runs out of memory. */
function expectSameBytes(got: Uint8Array, want: Uint8Array) {
	expect(got.length).toBe(want.length);
	expect(Buffer.compare(got, want)).toBe(0);
}

async function failure(run: Promise<unknown>): Promise<ProviderError> {
	const err = await run.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ProviderError);
	return err as ProviderError;
}

function resumeFrom(err: ProviderError): Opts['resume'] {
	const pending: PublishPending = { ...err.pending!, startedAt: Date.now() };
	return { segmentIds: [], pending };
}

const creds = { accessToken: 'tok', channelId: 'UC1' };

describe('YouTube connect', () => {
	it('asks for offline access to upload, on the registered callback', () => {
		const url = new URL(youtubeAuthorizeUrl('cid', 'https://social.example/', 'st'));
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://social.example/api/connections/youtube/callback'
		);
		expect(url.searchParams.get('scope')).toContain('auth/youtube.upload');
		expect(url.searchParams.get('access_type')).toBe('offline');
		expect(url.searchParams.get('prompt')).toBe('consent');
		expect(url.searchParams.get('state')).toBe('st');
	});

	function tokenAndChannel(token: Record<string, unknown>, items: unknown[]) {
		return fakeNetwork({
			'oauth2.googleapis.com/token': () => Response.json(token),
			'channels?part=snippet&mine=true': () => Response.json({ items })
		});
	}

	it('stores the refresh token and the channel', async () => {
		const { fetchImpl } = tokenAndChannel(
			{
				access_token: 'a',
				refresh_token: 'r',
				expires_in: 3600,
				scope: 'https://www.googleapis.com/auth/youtube.upload'
			},
			[
				{
					id: 'UC1',
					snippet: {
						title: 'My Channel',
						customUrl: '@mine',
						thumbnails: { default: { url: 'https://img/a.jpg' } }
					}
				}
			]
		);
		const got = await youtubeExchangeCode(
			{ clientId: 'c', clientSecret: 's', code: 'x', appUrl: 'https://social.example' },
			fetchImpl
		);
		expect(got).toMatchObject({
			accessToken: 'a',
			refreshToken: 'r',
			channelId: 'UC1',
			displayName: 'My Channel',
			handle: '@mine',
			avatarUrl: 'https://img/a.jpg'
		});
		expect(got.expiresAt).toBeGreaterThan(Date.now());
	});

	it('says how to get a refresh token when Google holds it back', async () => {
		const { fetchImpl } = tokenAndChannel({ access_token: 'a' }, [{ id: 'UC1' }]);
		await expect(
			youtubeExchangeCode(
				{ clientId: 'c', clientSecret: 's', code: 'x', appUrl: 'https://social.example' },
				fetchImpl
			)
		).rejects.toThrow(/myaccount\.google\.com\/permissions/);
	});

	it('refuses an account without a channel', async () => {
		const { fetchImpl } = tokenAndChannel({ access_token: 'a', refresh_token: 'r' }, []);
		await expect(
			youtubeExchangeCode(
				{ clientId: 'c', clientSecret: 's', code: 'x', appUrl: 'https://social.example' },
				fetchImpl
			)
		).rejects.toThrow(/no YouTube channel/);
	});

	it('verifies against the channel', async () => {
		const { fetchImpl } = tokenAndChannel({}, [{ id: 'UC9', snippet: { title: 'Nine' } }]);
		expect(await youtubeVerify(creds, fetchImpl)).toMatchObject({
			channelId: 'UC9',
			displayName: 'Nine'
		});
	});
});

describe('YouTube token refresh', () => {
	const refreshable = {
		accessToken: 'old',
		refreshToken: 'r',
		clientId: 'c',
		clientSecret: 's',
		expiresAt: Date.now() + 60_000
	};

	it('renews a token about to expire and keeps the refresh token', async () => {
		const { fetchImpl } = fakeNetwork({
			'oauth2.googleapis.com/token': () => Response.json({ access_token: 'new', expires_in: 3599 })
		});
		const next = await youtubeProvider.refreshIfNeeded!(refreshable, fetchImpl);
		expect(next.accessToken).toBe('new');
		expect(next.refreshToken).toBe('r');
	});

	it('leaves a fresh token alone', async () => {
		const { fetchImpl, net } = fakeNetwork({});
		const fresh = { ...refreshable, expiresAt: Date.now() + 3_600_000 };
		expect(await youtubeProvider.refreshIfNeeded!(fresh, fetchImpl)).toBe(fresh);
		expect(net.calls).toEqual([]);
	});

	it('expires the connection when Google ends the grant', async () => {
		const { fetchImpl } = fakeNetwork({
			'oauth2.googleapis.com/token': () =>
				Response.json({ error: 'invalid_grant', error_description: 'expired' }, { status: 400 })
		});
		const err = await failure(youtubeProvider.refreshIfNeeded!(refreshable, fetchImpl));
		expect(err.code).toBe('auth');
		expect(err.message).toMatch(/7 days/);
	});

	it('tries the current token when Google is briefly down', async () => {
		const { fetchImpl } = fakeNetwork({
			'oauth2.googleapis.com/token': () => new Response('oops', { status: 503 })
		});
		expect(await youtubeProvider.refreshIfNeeded!(refreshable, fetchImpl)).toBe(refreshable);
	});

	it('knows when a refresh is impossible', () => {
		expect(
			youtubeProvider.refreshImpossibleReason!({ accessToken: 'a', expiresAt: Date.now() - 1 })
		).toMatch(/reconnect/);
		expect(youtubeProvider.refreshImpossibleReason!(refreshable)).toBeNull();
	});
});

describe('YouTube validation', () => {
	const video: MediaAttachment = {
		storageKey: 'v.mp4',
		mime: 'video/mp4',
		size: 1000,
		video: { durationMs: 10_000, videoCodec: 'avc', fps: 30, faststart: true }
	};

	it('accepts one video with a title and the kids answer', () => {
		expect(youtubeProvider.validate(post(video))).toEqual([]);
	});

	it('needs a video', () => {
		const messages = youtubeProvider.validate(post(null)).map((i) => i.message);
		expect(messages).toContain('YouTube needs a video');
	});

	it('needs the made-for-kids answer', () => {
		const content: NormalizedPost = { text: 'Title', media: [video], options: { youtube: {} } };
		expect(
			youtubeProvider
				.validate(content)
				.map((i) => i.message)
				.join(' ')
		).toMatch(/made for kids/);
	});

	it('takes the title from the first line, and refuses an empty one', () => {
		expect(youtubeProvider.validate(post(video, {}, '\n\nFirst real line'))).toEqual([]);
		expect(youtubeProvider.validate(post(video, {}, '   ')).map((i) => i.message)).toContain(
			'YouTube needs a title'
		);
	});

	it('counts the description in bytes', () => {
		const text = `Title\n${'é'.repeat(2600)}`;
		expect(youtubeProvider.validate(post(video, {}, text)).map((i) => i.code)).toContain(
			'max_length'
		);
	});

	it('flattens a thread into one description', () => {
		const content: NormalizedPost = {
			text: 'one',
			thread: [{ text: 'one', media: [video] }, { text: 'two' }],
			options: { youtube: { madeForKids: true } }
		};
		expect(youtubeProvider.validate(content)).toEqual([]);
	});
});

describe('YouTube upload', () => {
	it('uploads a small video in one part and records it before anything else', async () => {
		const { store, bytes, video } = await storedVideo(300_000);
		const server = youtubeServer();
		const { fetchImpl } = fakeNetwork(server.handlers);
		const checkpoints: PublishCheckpoint[] = [];
		const result = await youtubeProvider.publish(
			post(video, { privacy: 'unlisted', title: 'Chosen title' }),
			creds,
			undefined,
			fetchImpl,
			{ mediaReader: store, checkpoint: (c) => void checkpoints.push(c) }
		);
		expect(result).toEqual({
			remotePostId: 'vid123',
			remoteUrl: 'https://www.youtube.com/watch?v=vid123'
		});
		expect(checkpoints).toEqual([
			{ segmentIds: ['vid123'], remoteUrl: 'https://www.youtube.com/watch?v=vid123' }
		]);
		expectSameBytes(server.joined(), bytes);
		expect(server.ranges).toEqual(['bytes 0-299999/300000']);
		const init = server.inits[0];
		expect(init.headers.get('Authorization')).toBe('Bearer tok');
		expect(init.headers.get('X-Upload-Content-Type')).toBe('video/mp4');
		expect(init.body).toMatchObject({
			snippet: { title: 'Chosen title', description: 'My launch video\nMore below' },
			status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false }
		});
	});

	it('keeps a video private unless told otherwise', async () => {
		const { store, video } = await storedVideo(1000);
		const server = youtubeServer();
		const { fetchImpl } = fakeNetwork(server.handlers);
		await youtubeProvider.publish(post(video), creds, undefined, fetchImpl, {
			mediaReader: store
		});
		expect(server.inits[0].body).toMatchObject({
			snippet: { title: 'My launch video' },
			status: { privacyStatus: 'private' }
		});
	});

	it('parks between parts and carries on from what YouTube holds', async () => {
		const size = YOUTUBE_PART_BYTES + 1000;
		const { store, bytes, video } = await storedVideo(size);
		const server = youtubeServer();
		const first = fakeNetwork(server.handlers);
		// Room for the init and one part, then the reserve.
		first.net.left = 1 + 2 + 6;
		const err = await failure(
			youtubeProvider.publish(post(video), creds, undefined, first.fetchImpl, {
				mediaReader: store,
				callsLeft: first.callsLeft
			})
		);
		expect(err.code).toBe('processing');
		expect(err.message).toContain(PROCESSING_MARK);
		expect(err.pending?.state).toMatchObject({
			sessionUrl: SESSION,
			size,
			offset: YOUTUBE_PART_BYTES
		});

		const second = fakeNetwork(server.handlers);
		const result = await youtubeProvider.publish(post(video), creds, undefined, second.fetchImpl, {
			mediaReader: store,
			resume: resumeFrom(err)
		});
		expect(result.remotePostId).toBe('vid123');
		expect(server.inits).toHaveLength(1);
		expect(server.ranges).toEqual([
			`bytes 0-${YOUTUBE_PART_BYTES - 1}/${size}`,
			`bytes */${size}`,
			`bytes ${YOUTUBE_PART_BYTES}-${size - 1}/${size}`
		]);
		expectSameBytes(server.joined(), bytes);
	});

	it('finds the video when the answer to the last part was lost', async () => {
		const { store, video } = await storedVideo(5000);
		const server = youtubeServer();
		let dropped = false;
		const { fetchImpl } = fakeNetwork({
			...server.handlers,
			[SESSION]: async (req) => {
				const res = await server.handlers[SESSION](req);
				if (!dropped && res.ok) {
					dropped = true;
					throw new TypeError('connection reset');
				}
				return res;
			}
		});
		const err = await failure(
			youtubeProvider.publish(post(video), creds, undefined, fetchImpl, { mediaReader: store })
		);
		expect(err.code).toBe('processing');
		const result = await youtubeProvider.publish(post(video), creds, undefined, fetchImpl, {
			mediaReader: store,
			resume: resumeFrom(err)
		});
		expect(result.remotePostId).toBe('vid123');
		expect(server.inits).toHaveLength(1);
		expect(server.ranges.at(-1)).toBe('bytes */5000');
	});

	it('starts a new session when the old one expired', async () => {
		const { store, video } = await storedVideo(5000);
		const server = youtubeServer();
		const { fetchImpl } = fakeNetwork({
			...server.handlers,
			'expired-session': () => new Response('gone', { status: 404 })
		});
		const resume: Opts['resume'] = {
			segmentIds: [],
			pending: {
				segment: 0,
				storageKey: 'v.mp4',
				state: { sessionUrl: 'https://upload.example/expired-session', size: 5000, offset: 100 },
				startedAt: Date.now()
			}
		};
		const result = await youtubeProvider.publish(post(video), creds, undefined, fetchImpl, {
			mediaReader: store,
			resume
		});
		expect(result.remotePostId).toBe('vid123');
		expect(server.inits).toHaveLength(1);
		expect(server.ranges).toEqual(['bytes 0-4999/5000']);
	});

	it('parks on a server error and asks the session next time', async () => {
		const { store, video } = await storedVideo(5000);
		const server = youtubeServer();
		let failed = false;
		const { fetchImpl } = fakeNetwork({
			...server.handlers,
			[SESSION]: (req) => {
				if (!failed) {
					failed = true;
					return new Response('busy', { status: 503 });
				}
				return server.handlers[SESSION](req);
			}
		});
		const err = await failure(
			youtubeProvider.publish(post(video), creds, undefined, fetchImpl, { mediaReader: store })
		);
		expect(err.code).toBe('processing');
		const result = await youtubeProvider.publish(post(video), creds, undefined, fetchImpl, {
			mediaReader: store,
			resume: resumeFrom(err)
		});
		expect(result.remotePostId).toBe('vid123');
	});

	it('does not upload again once the video is recorded', async () => {
		const { fetchImpl, net } = fakeNetwork({});
		const result = await youtubeProvider.publish(post(null), creds, undefined, fetchImpl, {
			resume: { segmentIds: ['vid9'], remoteUrl: null }
		});
		expect(result).toEqual({
			remotePostId: 'vid9',
			remoteUrl: 'https://www.youtube.com/watch?v=vid9'
		});
		expect(net.calls).toEqual([]);
	});

	it('reports a video YouTube rejected', async () => {
		const { store, video } = await storedVideo(1000);
		const server = youtubeServer({ status: 'rejected', rejectionReason: 'duplicate' });
		const { fetchImpl } = fakeNetwork(server.handlers);
		const err = await failure(
			youtubeProvider.publish(post(video), creds, undefined, fetchImpl, { mediaReader: store })
		);
		expect(err.code).toBe('forbidden');
		expect(err.message).toMatch(/duplicate/);
	});

	it('retries later when the day’s upload quota is used up', async () => {
		const { store, video } = await storedVideo(1000);
		const { fetchImpl } = fakeNetwork({
			'upload/youtube/v3/videos?': () =>
				Response.json(
					{ error: { code: 403, errors: [{ reason: 'quotaExceeded' }], message: 'quota' } },
					{ status: 403 }
				)
		});
		const err = await failure(
			youtubeProvider.publish(post(video), creds, undefined, fetchImpl, { mediaReader: store })
		);
		expect(err.code).toBe('rate_limited');
		expect(err.retryable).toBe(true);
		expect(err.message).toMatch(/quota/);
	});

	it('expires the connection on a rejected token', async () => {
		const { store, video } = await storedVideo(1000);
		const { fetchImpl } = fakeNetwork({
			'upload/youtube/v3/videos?': () => new Response('{"error":{}}', { status: 401 })
		});
		const err = await failure(
			youtubeProvider.publish(post(video), creds, undefined, fetchImpl, { mediaReader: store })
		);
		expect(err.code).toBe('auth');
	});

	it('sets the chosen cover as the thumbnail, and ignores a refusal', async () => {
		const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
		const { store, video } = await storedVideo(1000, cover);
		const server = youtubeServer();
		let thumbnail: Uint8Array | null = null;
		const { fetchImpl } = fakeNetwork({
			...server.handlers,
			'thumbnails/set': async (req) => {
				thumbnail = new Uint8Array(await req.arrayBuffer());
				return new Response('not verified', { status: 403 });
			}
		});
		const result = await youtubeProvider.publish(post(video), creds, undefined, fetchImpl, {
			mediaReader: store
		});
		expect(result.remotePostId).toBe('vid123');
		expect(thumbnail).toEqual(cover);
	});
});
