import { describe, expect, it } from 'vitest';
import {
	accountPreviews,
	foldText,
	instagramFormat,
	previewAccount,
	youtubeFormat
} from '#lib/domain/platform-preview.js';

const photo = (segmentIndex = 0) => ({
	mime: 'image/jpeg',
	width: 1080,
	height: 1080,
	segmentIndex
});
const video = (width: number, height: number, durationMs: number | null = 30_000) => ({
	mime: 'video/mp4',
	width,
	height,
	segmentIndex: 0,
	meta: { durationMs }
});

describe('instagramFormat', () => {
	it('posts a video as a Reel, several photos as a carousel, one photo as a post', () => {
		expect(instagramFormat([video(1080, 1920)])).toBe('reel');
		expect(instagramFormat([photo(), photo()])).toBe('carousel');
		expect(instagramFormat([photo()])).toBe('post');
		expect(instagramFormat([])).toBe('post');
	});
});

describe('youtubeFormat', () => {
	it('files a vertical or square video of up to three minutes as a Short', () => {
		expect(youtubeFormat([video(1080, 1920)])).toBe('short');
		expect(youtubeFormat([video(1080, 1080, 180_000)])).toBe('short');
		expect(youtubeFormat([video(1080, 1920, null)])).toBe('short');
	});

	it('keeps a landscape, longer or unmeasured video on the watch page', () => {
		expect(youtubeFormat([video(1920, 1080)])).toBe('video');
		expect(youtubeFormat([video(1080, 1920, 181_000)])).toBe('video');
		expect(youtubeFormat([{ mime: 'video/mp4' }])).toBe('video');
		expect(youtubeFormat([])).toBe('video');
	});
});

describe('foldText', () => {
	it('leaves a caption that fits whole', () => {
		expect(foldText('short', 10)).toEqual({ shown: 'short', folded: false });
	});

	it('cuts at the platform limit and at the fourth line', () => {
		expect(foldText('abcdefghij klm', 10)).toEqual({ shown: 'abcdefghij', folded: true });
		expect(foldText('1\n2\n3\n4\n5', 100)).toEqual({ shown: '1\n2\n3\n4', folded: true });
	});
});

describe('previewAccount', () => {
	it('drops the @ and skips platforms with no preview', () => {
		expect(
			previewAccount({ id: 'a', platform: 'x', handle: '@cv', displayName: 'C V', avatarUrl: null })
		).toEqual({ id: 'a', platform: 'x', name: 'C V', handle: 'cv', avatarUrl: null });
		expect(
			previewAccount({ id: 'b', platform: 'bluesky', handle: 'cv', displayName: null })
		).toBeNull();
	});
});

describe('accountPreviews', () => {
	const accounts = [
		{ id: 'x1', platform: 'x', handle: 'cv', displayName: 'CV' },
		{ id: 'li1', platform: 'linkedin', handle: 'cv', displayName: 'CV' }
	];

	it('threads on X and flattens with every attachment on LinkedIn', () => {
		const media = [photo(0), photo(1)];
		const [x, li] = accountPreviews({
			accounts,
			baseBody: 'one\n---\ntwo',
			overrides: {},
			media
		});
		expect(x.posts).toEqual([
			{ text: 'one', media: [media[0]] },
			{ text: 'two', media: [media[1]] }
		]);
		expect(li.posts).toHaveLength(1);
		expect(li.posts[0].media).toEqual(media);
		expect(li.posts[0].text).not.toContain('---');
	});

	it("shows a platform's own text where it has one", () => {
		const [x, li] = accountPreviews({
			accounts,
			baseBody: 'for everyone',
			overrides: { linkedin: { body: 'for LinkedIn' } },
			media: []
		});
		expect(x.posts[0].text).toBe('for everyone');
		expect(li.posts[0].text).toBe('for LinkedIn');
	});
});
