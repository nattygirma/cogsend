import { describe, expect, it } from 'vitest';
import { FACEBOOK_MAX_IMAGES } from '#lib/domain/media-limits.js';
import {
	facebookAuthorizeUrl,
	facebookExchangeCode,
	facebookProvider,
	facebookUpstreamError,
	facebookVerify,
	NO_PAGES_MESSAGE
} from '#lib/server/providers/facebook.js';
import {
	PROCESSING_MARK,
	ProviderError,
	UNCONFIRMED_POST_MARK,
	type FetchLike,
	type MediaAttachment,
	type NormalizedPost,
	type PlatformProvider,
	type PublishPending
} from '#lib/server/providers/types.js';

type Opts = NonNullable<Parameters<PlatformProvider['publish']>[4]>;
type Handler = (req: Request) => Response | Promise<Response>;

/** Routes by substring, first match wins, and keeps every request. */
function fakeMeta(handlers: Record<string, Handler>) {
	const seen: Request[] = [];
	const fetchImpl: FetchLike = async (input, init) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const req = new Request(url, init);
		seen.push(req.clone());
		for (const [key, handler] of Object.entries(handlers)) {
			if (url.includes(key)) return handler(req);
		}
		return new Response(`unmocked ${url}`, { status: 404 });
	};
	return { seen, fetchImpl };
}

const form = async (req: Request) => new URLSearchParams(await req.text());
const json = (body: unknown, status = 200) => Response.json(body, { status });
const metaError = (code: number, status = 400, message = 'nope') =>
	json({ error: { code, message } }, status);

const photo = (n: number, extra: Partial<MediaAttachment> = {}): MediaAttachment => ({
	storageKey: `p${n}.jpg`,
	mime: 'image/jpeg',
	size: 1000,
	...extra
});

const clip: MediaAttachment = {
	storageKey: 'v.mp4',
	mime: 'video/mp4',
	size: 5_000_000,
	width: 1920,
	height: 1080,
	video: { durationMs: 20_000, videoCodec: 'avc', fps: 30, faststart: true }
};

const creds = { accessToken: 'page-tok', pageId: '555' };
const opts = (extra: Partial<Opts> = {}): Opts => ({
	mediaUrlFor: (key, variant) => `https://cdn.test/${variant ? `${variant}/` : ''}${key}`,
	timeLeft: () => 0,
	...extra
});
const post = (text: string, media?: MediaAttachment[]): NormalizedPost => ({ text, media });

describe('Facebook validation', () => {
	const validate = (content: NormalizedPost) =>
		facebookProvider.validate(content).map((i) => i.message);

	it('takes text, photos or one video, and nothing empty', () => {
		expect(validate(post('Hello'))).toEqual([]);
		expect(validate(post('', [photo(1)]))).toEqual([]);
		expect(validate(post('', [clip]))).toEqual([]);
		expect(validate(post('  '))).toEqual(['Facebook needs text, a photo or a video']);
	});

	it('refuses a video beside photos, too many photos, and oversize or WebP images', () => {
		expect(validate(post('x', [clip, photo(1)]))).toEqual(['Facebook posts a video on its own']);
		const many = Array.from({ length: FACEBOOK_MAX_IMAGES + 1 }, (_, i) => photo(i));
		expect(validate(post('x', many))).toEqual([
			`Facebook takes up to ${FACEBOOK_MAX_IMAGES} photos (${many.length} attached)`
		]);
		expect(validate(post('x', [photo(1, { size: 11_000_000 })]))).toEqual([
			"An image is over Facebook's 10MB limit"
		]);
		expect(validate(post('x', [photo(1, { mime: 'image/webp' })]))[0]).toContain('WebP');
		expect(validate(post('x', [photo(1, { mime: 'image/webp', hasJpegCopy: true })]))).toEqual([]);
	});

	it('caps the post at 63,206 characters and flattens a thread into one post', () => {
		expect(validate(post('a'.repeat(63_206)))).toEqual([]);
		expect(validate(post('a'.repeat(63_207)))[0]).toContain('63,206');
		const thread: NormalizedPost = {
			text: 'one',
			thread: [
				{ text: 'one', media: [photo(1)] },
				{ text: 'two', media: [clip] }
			]
		};
		expect(validate(thread)).toEqual(['Facebook posts a video on its own']);
	});
});

describe('Facebook errors', () => {
	it('expires the account only for a dead token, never for a permission refusal', () => {
		const dead = facebookUpstreamError('Facebook post', 400, '{"error":{"code":190}}');
		expect(dead.code).toBe('auth');
		expect(dead.status).toBe(401);
		expect(facebookUpstreamError('x', 400, '{"error":{"code":200}}').code).toBe('forbidden');
		expect(facebookUpstreamError('x', 403, '{"error":{"code":10}}').code).toBe('forbidden');
	});

	it('retries throttling and Meta-side failures', () => {
		for (const code of [4, 17, 32, 613, 80001]) {
			expect(facebookUpstreamError('x', 400, JSON.stringify({ error: { code } })).retryable).toBe(
				true
			);
		}
		expect(facebookUpstreamError('x', 500, '{"error":{"code":2}}').code).toBe('upstream');
		expect(facebookUpstreamError('x', 400, '{"error":{"code":100}}').retryable).toBe(false);
	});
});

describe('Facebook publish', () => {
	it('posts text to the Page feed with the Page token, and links the post', async () => {
		const { seen, fetchImpl } = fakeMeta({
			'/555/feed': () => json({ id: '555_1' }),
			'fields=permalink_url': () => json({ permalink_url: 'https://www.facebook.com/555/posts/1' })
		});
		const result = await facebookProvider.publish(post('Hello'), creds, {}, fetchImpl, opts());
		expect(result).toEqual({
			remotePostId: '555_1',
			remoteUrl: 'https://www.facebook.com/555/posts/1'
		});
		const body = await form(seen[0]);
		expect(seen[0].url).toBe('https://graph.facebook.com/v26.0/555/feed');
		expect(body.get('message')).toBe('Hello');
		expect(body.get('access_token')).toBe('page-tok');
	});

	it('posts one photo by URL with its caption and alt text, linking the post not the photo', async () => {
		const { seen, fetchImpl } = fakeMeta({
			'/555/photos': () => json({ id: 'photo1', post_id: '555_2' }),
			'fields=permalink_url': () => json({ permalink_url: 'https://www.facebook.com/x' })
		});
		const result = await facebookProvider.publish(
			post('Look', [photo(1, { alt: 'A cat' })]),
			creds,
			{},
			fetchImpl,
			opts()
		);
		expect(result.remotePostId).toBe('555_2');
		const body = await form(seen[0]);
		expect(body.get('url')).toBe('https://cdn.test/p1.jpg');
		expect(body.get('caption')).toBe('Look');
		expect(body.get('alt_text_custom')).toBe('A cat');
		expect(seen[1].url).toContain('/555_2?fields=permalink_url');
	});

	it('sends a WebP as its JPEG copy', async () => {
		const { seen, fetchImpl } = fakeMeta({ '/555/photos': () => json({ id: 'p' }) });
		await facebookProvider.publish(
			post('', [photo(1, { storageKey: 'p1.webp', mime: 'image/webp', hasJpegCopy: true })]),
			creds,
			{},
			fetchImpl,
			opts()
		);
		expect((await form(seen[0])).get('url')).toBe('https://cdn.test/jpeg/p1.webp');
	});

	it('uploads several photos unpublished, then attaches them to one feed post', async () => {
		let n = 0;
		const { seen, fetchImpl } = fakeMeta({
			'/555/photos': () => json({ id: `ph${++n}` }),
			'/555/feed': () => json({ id: '555_3' }),
			'fields=permalink_url': () => new Response('gone', { status: 500 })
		});
		const result = await facebookProvider.publish(
			post('Album', [photo(1), photo(2)]),
			creds,
			{},
			fetchImpl,
			opts()
		);
		expect(result).toEqual({ remotePostId: '555_3', remoteUrl: undefined });
		const uploads = await Promise.all(seen.slice(0, 2).map(form));
		expect(uploads.map((b) => b.get('published'))).toEqual(['false', 'false']);
		const feed = await form(seen[2]);
		expect(feed.get('message')).toBe('Album');
		expect(JSON.parse(feed.get('attached_media[0]')!)).toEqual({ media_fbid: 'ph1' });
		expect(JSON.parse(feed.get('attached_media[1]')!)).toEqual({ media_fbid: 'ph2' });
	});

	it('says a post may be live when the create gets no answer', async () => {
		const fetchImpl: FetchLike = async () => {
			throw new TypeError('network down');
		};
		const err = await facebookProvider
			.publish(post('Hi'), creds, {}, fetchImpl, opts())
			.catch((e) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(err.code).toBe('unconfirmed');
		expect(err.message).toContain(UNCONFIRMED_POST_MARK);
	});

	it('expires the account on a dead token instead of calling it unconfirmed', async () => {
		const { fetchImpl } = fakeMeta({ '/555/feed': () => metaError(190) });
		const err = await facebookProvider
			.publish(post('Hi'), creds, {}, fetchImpl, opts())
			.catch((e) => e);
		expect(err.code).toBe('auth');
	});

	it('never posts twice when a run resumes after the post went out', async () => {
		const { seen, fetchImpl } = fakeMeta({});
		const result = await facebookProvider.publish(
			post('Hi'),
			creds,
			{},
			fetchImpl,
			opts({ resume: { segmentIds: ['555_9'], remoteUrl: 'https://www.facebook.com/p' } })
		);
		expect(result.remotePostId).toBe('555_9');
		expect(seen).toHaveLength(0);
	});
});

describe('Facebook video', () => {
	const statusOf = (video_status: string, extra: Record<string, unknown> = {}) =>
		json({ id: 'vid1', status: { video_status, ...extra } });

	it('creates the video from its URL and returns once Facebook says it is ready', async () => {
		const checkpoints: string[][] = [];
		const { seen, fetchImpl } = fakeMeta({
			'/555/videos': () => json({ id: 'vid1' }),
			'/vid1?fields=status': () => statusOf('ready')
		});
		const result = await facebookProvider.publish(
			post('Watch', [clip]),
			creds,
			{},
			fetchImpl,
			opts({ checkpoint: (s) => void checkpoints.push(s.segmentIds) })
		);
		expect(result).toEqual({
			remotePostId: 'vid1',
			remoteUrl: 'https://www.facebook.com/555/videos/vid1'
		});
		const body = await form(seen[0]);
		expect(body.get('file_url')).toBe('https://cdn.test/v.mp4');
		expect(body.get('description')).toBe('Watch');
		expect(checkpoints).toEqual([['vid1']]);
	});

	it('parks a video still processing and resumes by polling, without creating it again', async () => {
		const first = fakeMeta({
			'/555/videos': () => json({ id: 'vid1' }),
			'/vid1?fields=status': () =>
				statusOf('processing', { processing_phase: { status: 'in_progress' } })
		});
		const parked = await facebookProvider
			.publish(post('Watch', [clip]), creds, {}, first.fetchImpl, opts())
			.catch((e) => e);
		expect(parked.code).toBe('processing');
		expect(parked.message).toContain(PROCESSING_MARK);
		expect(parked.pending).toEqual({ segment: 0, storageKey: 'v.mp4', state: { videoId: 'vid1' } });

		const pending: PublishPending = { ...parked.pending, startedAt: Date.now() };
		const second = fakeMeta({ '/vid1?fields=status': () => statusOf('ready') });
		const result = await facebookProvider.publish(
			post('Watch', [clip]),
			creds,
			{},
			second.fetchImpl,
			opts({ resume: { segmentIds: ['vid1'], pending } })
		);
		expect(result.remotePostId).toBe('vid1');
		expect(second.seen.some((r) => r.url.includes('/555/videos'))).toBe(false);
	});

	it('reports why Facebook could not process the video, without retrying it', async () => {
		const { fetchImpl } = fakeMeta({
			'/555/videos': () => json({ id: 'vid1' }),
			'/vid1?fields=status': () =>
				statusOf('error', {
					processing_phase: { status: 'error', error: { message: 'Unsupported codec' } }
				})
		});
		const err = await facebookProvider
			.publish(post('', [clip]), creds, {}, fetchImpl, opts())
			.catch((e) => e);
		expect(err.code).toBe('forbidden');
		expect(err.message).toContain('Unsupported codec');
	});
});

describe('Facebook connect', () => {
	it('asks for the Page permissions, or names a Login for Business configuration', () => {
		const plain = new URL(facebookAuthorizeUrl('app1', 'https://social.example/', 'st'));
		expect(plain.origin + plain.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
		expect(plain.searchParams.get('redirect_uri')).toBe(
			'https://social.example/api/connections/facebook/callback'
		);
		expect(plain.searchParams.get('scope')).toBe(
			'pages_show_list,pages_read_engagement,pages_manage_posts'
		);
		const business = new URL(facebookAuthorizeUrl('app1', 'https://social.example', 'st', 'cfg9'));
		expect(business.searchParams.get('config_id')).toBe('cfg9');
		expect(business.searchParams.has('scope')).toBe(false);
	});

	const exchangeFetch = (pages: unknown[][]) => {
		let call = 0;
		return fakeMeta({
			'grant_type=fb_exchange_token': () => json({ access_token: 'long-user' }),
			'/oauth/access_token?': () => json({ access_token: 'short-user' }),
			'/me/accounts': () => {
				const data = pages[call] ?? [];
				const next = call + 1 < pages.length;
				call++;
				return json({
					data,
					...(next
						? { paging: { next: 'https://graph.facebook.com/v26.0/me/accounts?after=x' } }
						: {})
				});
			}
		});
	};

	it('trades the code for a long-lived token and keeps every Page it can post to', async () => {
		const { seen, fetchImpl } = exchangeFetch([
			[
				{
					id: '1',
					name: 'Bakery',
					username: 'bakery',
					access_token: 'pt1',
					picture: { data: { url: 'https://img/1' } },
					tasks: ['CREATE_CONTENT', 'MODERATE']
				},
				{ id: '2', name: 'Read only', access_token: 'pt2', tasks: ['ANALYZE'] }
			],
			[{ id: '3', name: 'Second batch', access_token: 'pt3' }]
		]);
		const pages = await facebookExchangeCode(
			{ appId: 'app1', appSecret: 'sec', code: 'CODE', appUrl: 'https://social.example' },
			fetchImpl
		);
		expect(pages).toEqual([
			{
				pageId: '1',
				accessToken: 'pt1',
				name: 'Bakery',
				username: 'bakery',
				avatarUrl: 'https://img/1'
			},
			{
				pageId: '3',
				accessToken: 'pt3',
				name: 'Second batch',
				username: undefined,
				avatarUrl: undefined
			}
		]);
		const exchange = new URL(seen[0].url);
		expect(exchange.searchParams.get('redirect_uri')).toBe(
			'https://social.example/api/connections/facebook/callback'
		);
		expect(new URL(seen[2].url).searchParams.get('access_token')).toBe('long-user');
	});

	it('says what to do when no Page was granted', async () => {
		const { fetchImpl } = exchangeFetch([[]]);
		await expect(
			facebookExchangeCode(
				{ appId: 'a', appSecret: 's', code: 'c', appUrl: 'https://social.example' },
				fetchImpl
			)
		).rejects.toThrow(NO_PAGES_MESSAGE);
	});

	it('reads the Page back on verify', async () => {
		const { fetchImpl } = fakeMeta({
			'/555?fields=': () =>
				json({ id: '555', name: 'Bakery', picture: { data: { url: 'https://img/a' } } })
		});
		expect(await facebookVerify(creds, fetchImpl)).toEqual({
			displayName: 'Bakery',
			avatarUrl: 'https://img/a',
			handle: 'Bakery',
			pageId: '555'
		});
		const dead = fakeMeta({ '/555?fields=': () => metaError(190) });
		await expect(facebookVerify(creds, dead.fetchImpl)).rejects.toMatchObject({ code: 'auth' });
	});
});
