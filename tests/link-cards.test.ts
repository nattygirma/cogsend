import { describe, expect, it } from 'vitest';
import { linkedinProvider } from '#lib/server/providers/linkedin.js';
import type { FetchLike } from '#lib/server/providers/types.js';

function mockFetch(
	handlers: Record<string, (req: Request) => Promise<Response> | Response>
): FetchLike {
	return async (input, init) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		for (const [key, handler] of Object.entries(handlers)) {
			if (url.includes(key)) return handler(new Request(url, init));
		}
		return new Response(`No mock for ${url}`, { status: 404 });
	};
}

const OG_HTML = `<html><head>
<meta property="og:title" content="Example Article" />
<meta property="og:description" content="An example description" />
<meta property="og:image" content="https://example.com/og.png" />
</head></html>`;

const PNG_1x1 = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xde
]);

describe('linkedin article cards', () => {
	it('attaches article with thumbnail when no media', async () => {
		let content: Record<string, unknown> | undefined;
		const fetchImpl = mockFetch({
			'example.com/article': () =>
				new Response(OG_HTML, { headers: { 'Content-Type': 'text/html' } }),
			'example.com/og.png': () =>
				new Response(PNG_1x1 as unknown as BodyInit, {
					headers: { 'Content-Type': 'image/png' }
				}),
			'/rest/images?action=initializeUpload': () =>
				Response.json({ value: { uploadUrl: 'https://up.test/i', image: 'urn:li:image:THUMB' } }),
			'up.test/i': () => new Response('', { status: 201 }),
			'/rest/posts': async (req) => {
				const body = await req.json();
				content = body.content;
				return new Response(JSON.stringify({ id: 'urn:li:share:1' }), {
					status: 201,
					headers: { 'x-restli-id': 'urn:li:share:1', 'Content-Type': 'application/json' }
				});
			}
		});
		await linkedinProvider.publish(
			{ text: 'read https://example.com/article' },
			{ accessToken: 'tok', personUrn: 'urn:li:person:abc' },
			undefined,
			fetchImpl
		);
		const article = (content as { article: { source: string; thumbnail?: string } }).article;
		expect(article.source).toBe('https://example.com/article');
		expect(article.thumbnail).toBe('urn:li:image:THUMB');
	});

	it('does not attach article when images present', async () => {
		let content: Record<string, unknown> | undefined;
		const fetchImpl = mockFetch({
			'/rest/images?action=initializeUpload': () =>
				Response.json({ value: { uploadUrl: 'https://up.test/i', image: 'urn:li:image:IMG' } }),
			'up.test/i': () => new Response('', { status: 201 }),
			'/rest/posts': async (req) => {
				const body = await req.json();
				content = body.content;
				return new Response(JSON.stringify({ id: 'urn:li:share:2' }), {
					status: 201,
					headers: { 'x-restli-id': 'urn:li:share:2', 'Content-Type': 'application/json' }
				});
			}
		});
		await linkedinProvider.publish(
			{
				text: 'see https://example.com/article',
				media: [{ bytes: new Uint8Array([1, 2]), mime: 'image/png', size: 2 }]
			},
			{ accessToken: 'tok', personUrn: 'urn:li:person:abc' },
			undefined,
			fetchImpl
		);
		expect((content as { media?: unknown }).media).toBeTruthy();
		expect((content as { article?: unknown }).article).toBeUndefined();
	});
});

describe('X post link cards', () => {
	const POST = 'https://x.com/ada_builds/status/1974452871209381904';
	// x.com gives a server a title and an image but no text; oEmbed has the text.
	const X_PAGE = `<html><head>
<meta property="og:title" content="Ada Builds (@ada_builds) on X" />
<meta property="og:image" content="https://pbs.twimg.com/card_img/1/abc?format=png" />
</head></html>`;
	const OEMBED = {
		author_name: 'Ada Builds',
		author_url: 'https://x.com/ada_builds',
		html: '<blockquote class="twitter-tweet"><p lang="en">Moved my whole posting setup to a Worker. <a href="https://t.co/AbC123">https://t.co/AbC123</a></p>&mdash; Ada Builds (@ada_builds) <a href="https://x.com/ada_builds/status/1974452871209381904">October 4, 2026</a></blockquote>'
	};

	function linkedinFetch(oembed: () => Response, onContent: (content: unknown) => void) {
		return mockFetch({
			'publish.x.com/oembed': oembed,
			'x.com/ada_builds/status': () =>
				new Response(X_PAGE, { headers: { 'Content-Type': 'text/html' } }),
			'pbs.twimg.com/card_img': () =>
				new Response(PNG_1x1 as unknown as BodyInit, { headers: { 'Content-Type': 'image/png' } }),
			'/rest/images?action=initializeUpload': () =>
				Response.json({ value: { uploadUrl: 'https://up.test/i', image: 'urn:li:image:THUMB' } }),
			'up.test/i': () => new Response('', { status: 201 }),
			'/rest/posts': async (req) => {
				onContent((await req.json()).content);
				return new Response(JSON.stringify({ id: 'urn:li:share:9' }), {
					status: 201,
					headers: { 'x-restli-id': 'urn:li:share:9', 'Content-Type': 'application/json' }
				});
			}
		});
	}

	it("gives LinkedIn the quoted post's author and text", async () => {
		let content: unknown;
		await linkedinProvider.publish(
			{ text: `Worth reading.\n${POST}` },
			{ accessToken: 'tok', personUrn: 'urn:li:person:abc' },
			undefined,
			linkedinFetch(
				() => Response.json(OEMBED),
				(c) => (content = c)
			)
		);
		const article = (content as { article: Record<string, unknown> }).article;
		expect(article.source).toBe(POST);
		expect(article.title).toBe('Ada Builds (@ada_builds)');
		expect(article.description).toBe('Moved my whole posting setup to a Worker.');
		expect(article.thumbnail).toBe('urn:li:image:THUMB');
	});

	it("keeps the page's own card when X's oEmbed fails", async () => {
		let content: unknown;
		await linkedinProvider.publish(
			{ text: `Worth reading.\n${POST}` },
			{ accessToken: 'tok', personUrn: 'urn:li:person:abc' },
			undefined,
			linkedinFetch(
				() => new Response('{}', { status: 500 }),
				(c) => (content = c)
			)
		);
		const article = (content as { article: Record<string, unknown> }).article;
		expect(article.title).toBe('Ada Builds (@ada_builds) on X');
		expect(article.thumbnail).toBe('urn:li:image:THUMB');
	});
});
