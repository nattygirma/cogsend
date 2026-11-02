import { describe, expect, it } from 'vitest';
import {
	composeChecks,
	requiredSettingsCount,
	type ChecksInput
} from '../src/lib/components/compose/checks';
import {
	optionsNeedVariant,
	variantOptionsFor,
	type SaveSnapshot
} from '../src/lib/components/compose/save';

const base: ChecksInput = {
	connectionCount: 2,
	selectedCount: 2,
	selectedPlatforms: new Set(['x', 'youtube']),
	singlePostProblems: new Map(),
	fitProblems: [],
	overLimit: [],
	threadsLinks: 0
};

describe('composeChecks', () => {
	it('is empty when the post can go everywhere it is aimed', () => {
		expect(composeChecks(base)).toEqual([]);
	});

	it('asks for an account before anything else', () => {
		expect(composeChecks({ ...base, connectionCount: 0, selectedCount: 0 })).toEqual([
			expect.objectContaining({
				platform: null,
				message: 'Connect an account to start posting',
				href: '/accounts'
			})
		]);
		expect(composeChecks({ ...base, selectedCount: 0 })[0].message).toBe(
			'Choose at least one account to post to'
		);
	});

	it('lists each platform problem once, worst sources first', () => {
		const checks = composeChecks({
			...base,
			singlePostProblems: new Map([['youtube', { message: 'YouTube needs a video' }]]),
			fitProblems: [
				{ platform: 'youtube', message: 'YouTube needs a video', level: 'error' },
				{ platform: 'x', message: 'An image is over X’s 5MB limit', level: 'error' }
			],
			overLimit: [{ platform: 'x', max: 280 }]
		});
		expect(checks.map((c) => c.message)).toEqual([
			'YouTube needs a video',
			'An image is over X’s 5MB limit',
			'X: the text is over its 280-character limit'
		]);
	});

	it('only counts rules for platforms the post goes to', () => {
		expect(composeChecks({ ...base, threadsLinks: 7 })).toEqual([]);
		expect(
			composeChecks({ ...base, threadsLinks: 7, selectedPlatforms: new Set(['threads']) })[0]
				.message
		).toBe('Threads allows up to 5 links per post (7 found)');
	});
});

describe('requiredSettingsCount', () => {
	it('counts YouTube and TikTok choices still to make, only when selected', () => {
		const selectedPlatforms = new Set(['youtube', 'tiktok']);
		expect(
			requiredSettingsCount({ selectedPlatforms, youtube: {}, youtubeText: 'Title', tiktok: {} })
		).toBe(2);
		expect(
			requiredSettingsCount({
				selectedPlatforms,
				youtube: { madeForKids: false },
				youtubeText: 'Title',
				tiktok: { privacyLevel: 'SELF_ONLY' }
			})
		).toBe(0);
		expect(
			requiredSettingsCount({
				selectedPlatforms: new Set(['x']),
				youtube: {},
				youtubeText: '',
				tiktok: {}
			})
		).toBe(0);
	});
});

describe('variant options', () => {
	const snap: SaveSnapshot = {
		baseBody: 'Hello',
		overrides: {},
		youtubeOptions: {},
		tiktokOptions: {},
		selectedConnectionIds: []
	};

	it('stores YouTube and TikTok settings once one choice is made', () => {
		expect(optionsNeedVariant('youtube', snap)).toBe(false);
		expect(optionsNeedVariant('youtube', { ...snap, youtubeOptions: { madeForKids: false } })).toBe(
			true
		);
		expect(
			variantOptionsFor('tiktok', { ...snap, tiktokOptions: { privacyLevel: 'SELF_ONLY' } })
		).toEqual({ privacyLevel: 'SELF_ONLY' });
		expect(optionsNeedVariant('x', snap)).toBe(false);
		expect(variantOptionsFor('x', snap)).toEqual({});
	});
});
