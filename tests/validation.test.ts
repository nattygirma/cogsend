import { describe, expect, it } from 'vitest';
import {
	PLATFORM_LIMITS,
	isOverSelectedPlatformLimit,
	platformLimit
} from '#lib/domain/editor-limits.js';
import { platformMark } from '#lib/domain/platform-marks.js';
import { countGraphemes } from '#lib/domain/validation/text.js';
import { linkedinProvider } from '#lib/server/providers/index.js';

describe('countGraphemes', () => {
	it('counts ascii 1:1', () => {
		expect(countGraphemes('hello')).toBe(5);
	});
	it('counts emoji as single graphemes', () => {
		expect(countGraphemes('hi👍')).toBe(3);
	});
	it('empty is 0', () => {
		expect(countGraphemes('')).toBe(0);
	});
});

describe('provider validate', () => {
	it('linkedin rejects long text', () => {
		const issues = linkedinProvider.validate({ text: 'x'.repeat(PLATFORM_LIMITS.linkedin + 1) });
		expect(issues.some((i) => i.code === 'max_length')).toBe(true);
	});
	it('rejects empty segment without media', () => {
		expect(linkedinProvider.validate({ text: '   ' }).length).toBeGreaterThan(0);
	});
});

describe('publish disable gates selected platforms only', () => {
	it('allows a LinkedIn-only 600-char post when Threads is not selected', () => {
		expect(
			isOverSelectedPlatformLimit({
				selectedPlatforms: ['linkedin'],
				threadsLen: 600,
				linkedinLen: 600
			})
		).toBe(false);
	});
	it('blocks when selected Threads is over limit', () => {
		expect(
			isOverSelectedPlatformLimit({
				selectedPlatforms: ['threads'],
				threadsLen: 550,
				linkedinLen: 100
			})
		).toBe(true);
	});
	it('does not block on unused platform over limit', () => {
		expect(
			isOverSelectedPlatformLimit({
				selectedPlatforms: ['threads'],
				threadsLen: 100,
				linkedinLen: 3500
			})
		).toBe(false);
	});
	it('blocks when both selected and one is over', () => {
		expect(
			isOverSelectedPlatformLimit({
				selectedPlatforms: ['threads', 'linkedin'],
				threadsLen: 501,
				linkedinLen: 100
			})
		).toBe(true);
	});
	it('allows two under-limit Threads posts when lens is max-per-segment', () => {
		expect(
			isOverSelectedPlatformLimit({
				selectedPlatforms: ['threads'],
				threadsLen: 400,
				threadsMax: 500
			})
		).toBe(false);
	});
});

describe('platformLimit', () => {
	const x = (maxCharacters?: number) => ({
		platform: 'x',
		metaJson: maxCharacters === undefined ? null : { maxCharacters }
	});

	it('uses the limit of the accounts it is given, the strictest of several', () => {
		expect(platformLimit('x', [x(25_000)])).toBe(25_000);
		expect(platformLimit('x', [x(25_000), x(280)])).toBe(280);
	});

	it('does not let an account outside the selection cap the post', () => {
		// The bug this pins: the composer used to pass every connected account,
		// so an unselected 280-character account blocked text that only the
		// 25,000-character one would have received.
		expect(platformLimit('x', [x(25_000)])).toBe(25_000);
	});

	it('falls back to the platform default', () => {
		expect(platformLimit('x', [])).toBe(PLATFORM_LIMITS.x);
		expect(platformLimit('instagram', [])).toBe(PLATFORM_LIMITS.instagram);
		expect(platformLimit('linkedin', [x(200)])).toBe(PLATFORM_LIMITS.linkedin);
		expect(platformLimit('threads', [])).toBe(PLATFORM_LIMITS.threads);
	});
});

describe('platformMarks', () => {
	it('answers a mark for every platform the app can connect', () => {
		for (const platform of [
			'linkedin',
			'threads',
			'instagram',
			'x',
			'facebook',
			'youtube',
			'tiktok'
		]) {
			expect(platformMark(platform), platform).toMatch(/^M/);
		}
		// Case-insensitive, because platform ids arrive from D1 and from URLs.
		expect(platformMark('LinkedIn')).toBe(platformMark('linkedin'));
	});

	it('answers null for an unknown platform rather than another brand', () => {
		// The components draw a neutral glyph for null; falling back to Bluesky
		// (which one of them did) labels the wrong platform.
		expect(platformMark('myspace')).toBeNull();
		expect(platformMark('')).toBeNull();
		expect(platformMark(null)).toBeNull();
		expect(platformMark(undefined)).toBeNull();
	});
});
