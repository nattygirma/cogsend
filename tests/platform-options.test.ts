import { describe, expect, it } from 'vitest';
import {
	hasOptions,
	parseTikTokOptions,
	parseYouTubeOptions,
	tiktokDisclosureLabel,
	tiktokOptionProblems,
	videoOptionsFromVariants,
	youtubeOptionProblems,
	youtubeTitle
} from '#lib/domain/platform-options.js';
import { postMediaProblems } from '#lib/domain/media-limits.js';

const video = { mime: 'video/mp4' };
const photo = { mime: 'image/jpeg' };

describe('YouTube settings', () => {
	it('keeps only the fields YouTube takes, with their own types', () => {
		expect(
			parseYouTubeOptions({
				title: 'Launch',
				privacy: 'unlisted',
				madeForKids: false,
				notifySubscribers: 'yes',
				visibility: 'public'
			})
		).toEqual({ title: 'Launch', privacy: 'unlisted', madeForKids: false });
		expect(parseYouTubeOptions({ privacy: 'everyone' })).toEqual({});
		expect(parseYouTubeOptions(null)).toEqual({});
	});

	it('titles the video with the first line when none is chosen', () => {
		expect(youtubeTitle({}, '\n  First line \nrest')).toBe('First line');
		expect(youtubeTitle({ title: ' Chosen ' }, 'First line')).toBe('Chosen');
	});

	it('blocks a video YouTube would refuse or that lacks the kids answer', () => {
		expect(youtubeOptionProblems({ madeForKids: false }, 'A title')).toEqual([]);
		expect(youtubeOptionProblems({}, 'A title')).toEqual([
			'Say whether the video is made for kids in the YouTube settings'
		]);
		expect(youtubeOptionProblems({ madeForKids: true }, '')[0]).toBe('YouTube needs a title');
		expect(youtubeOptionProblems({ madeForKids: true, title: 'x'.repeat(101) }, '')[0]).toMatch(
			/up to 100/
		);
		expect(youtubeOptionProblems({ madeForKids: true, title: 'a <b>' }, '')[0]).toMatch(/< or >/);
	});
});

describe('TikTok settings', () => {
	it('never invents a privacy level', () => {
		expect(parseTikTokOptions({})).toEqual({});
		expect(tiktokOptionProblems({})).toEqual([
			'Choose who can watch the video in the TikTok settings'
		]);
		expect(parseTikTokOptions({ privacyLevel: 'everyone; drop' })).toEqual({});
		expect(tiktokOptionProblems({ privacyLevel: 'PUBLIC_TO_EVERYONE' })).toEqual([]);
	});

	it('needs a kind once commercial content is disclosed, and keeps branded content public', () => {
		expect(
			tiktokOptionProblems({ privacyLevel: 'PUBLIC_TO_EVERYONE', discloseCommercial: true })
		).toEqual(['Say what the commercial content is in the TikTok settings']);
		expect(
			tiktokOptionProblems({
				privacyLevel: 'SELF_ONLY',
				discloseCommercial: true,
				brandedContent: true
			})
		).toEqual(['Branded content on TikTok cannot be private']);
		expect(tiktokDisclosureLabel({ brandOrganic: true })).toBe('Promotional content');
		expect(tiktokDisclosureLabel({ brandOrganic: true, brandedContent: true })).toBe(
			'Paid partnership'
		);
		expect(tiktokDisclosureLabel({})).toBeNull();
	});
});

describe('stored settings', () => {
	it('reads each platform from its own variant', () => {
		expect(
			videoOptionsFromVariants([
				{ platform: 'mastodon', optionsJson: { visibility: 'public' } },
				{ platform: 'youtube', optionsJson: { title: 'T', madeForKids: false } },
				{ platform: 'tiktok', optionsJson: { privacyLevel: 'SELF_ONLY' } }
			])
		).toEqual({
			youtube: { title: 'T', madeForKids: false },
			tiktok: { privacyLevel: 'SELF_ONLY' }
		});
		expect(videoOptionsFromVariants(undefined)).toEqual({ youtube: {}, tiktok: {} });
		expect(hasOptions({})).toBe(false);
		expect(hasOptions({ privacy: undefined })).toBe(false);
		expect(hasOptions({ madeForKids: false })).toBe(true);
	});
});

describe('single-post media', () => {
	it('takes exactly one video on YouTube and TikTok', () => {
		expect(postMediaProblems('youtube', [video])).toEqual([]);
		expect(postMediaProblems('youtube', [])).toEqual(['YouTube needs a video']);
		expect(postMediaProblems('tiktok', [photo])).toEqual(['TikTok needs a video']);
		expect(postMediaProblems('tiktok', [video, photo])).toEqual([
			'TikTok posts one video on its own'
		]);
	});

	it('takes text, photos or one video on Facebook', () => {
		expect(postMediaProblems('facebook', [])).toEqual([]);
		expect(postMediaProblems('facebook', [photo, photo])).toEqual([]);
		expect(postMediaProblems('facebook', [video, photo])).toEqual([
			'Facebook posts a video on its own'
		]);
		expect(postMediaProblems('facebook', Array(11).fill(photo))[0]).toMatch(/up to 10/);
		expect(postMediaProblems('linkedin', [video, video])).toEqual([]);
	});
});
