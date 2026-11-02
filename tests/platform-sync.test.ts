import { describe, expect, it } from 'vitest';
import {
	customizePlatformBody,
	customizedBodiesForSave,
	effectivePlatformBody,
	isPlatformCustomized,
	overridesFromVariants,
	platformsFromConnections,
	resetPlatformToFollow,
	resolveRestoredSelection,
	resolveSavedSelection
} from '#lib/domain/platform-sync.js';

describe('platform follow / customize / reset', () => {
	it('follows main until customized', () => {
		const main = 'Hello world';
		let overrides = {};
		expect(isPlatformCustomized(overrides, 'threads')).toBe(false);
		expect(effectivePlatformBody(main, overrides, 'threads')).toBe('Hello world');

		overrides = customizePlatformBody(overrides, 'threads', 'Hello threads');
		expect(isPlatformCustomized(overrides, 'threads')).toBe(true);
		expect(effectivePlatformBody(main, overrides, 'threads')).toBe('Hello threads');
		expect(effectivePlatformBody('Changed main', overrides, 'threads')).toBe('Hello threads');
		expect(effectivePlatformBody('Changed main', overrides, 'linkedin')).toBe('Changed main');
	});

	it('reset restores following main', () => {
		let overrides = customizePlatformBody({}, 'linkedin', 'custom linkedin');
		overrides = resetPlatformToFollow(overrides, 'linkedin');
		expect(isPlatformCustomized(overrides, 'linkedin')).toBe(false);
		expect(effectivePlatformBody('Main again', overrides, 'linkedin')).toBe('Main again');
	});

	it('empty string is still customized', () => {
		const overrides = customizePlatformBody({}, 'threads', '');
		expect(isPlatformCustomized(overrides, 'threads')).toBe(true);
		expect(effectivePlatformBody('main', overrides, 'threads')).toBe('');
	});

	it('customizedBodiesForSave only includes customized platforms', () => {
		const overrides = customizePlatformBody({}, 'threads', 'm only');
		const saved = customizedBodiesForSave('main', overrides, ['threads', 'linkedin']);
		expect(saved).toEqual({ threads: 'm only' });
		expect(saved.linkedin).toBeUndefined();
	});

	it('overridesFromVariants treats equal-to-main as following', () => {
		const map = overridesFromVariants(
			[
				{ platform: 'threads', body: 'same' },
				{ platform: 'linkedin', body: 'different' }
			],
			'same'
		);
		expect(isPlatformCustomized(map, 'threads')).toBe(false);
		expect(isPlatformCustomized(map, 'linkedin')).toBe(true);
	});

	it('platformsFromConnections unique', () => {
		expect(
			platformsFromConnections([
				{ platform: 'threads' },
				{ platform: 'threads' },
				{ platform: 'linkedin' }
			])
		).toEqual(['threads', 'linkedin']);
	});
});

describe('resolveRestoredSelection', () => {
	it('returns null when the draft has no targets', () => {
		expect(resolveRestoredSelection([], [{ id: 'a' }])).toBeNull();
		expect(resolveRestoredSelection([null, undefined], [{ id: 'a' }])).toBeNull();
	});

	it('restores target ids that still exist, dropping deleted ones', () => {
		expect(resolveRestoredSelection(['a', 'gone', 'b'], [{ id: 'a' }, { id: 'b' }])).toEqual([
			'a',
			'b'
		]);
	});

	it('can restore an explicitly empty selection', () => {
		expect(resolveRestoredSelection(['gone'], [{ id: 'a' }])).toEqual([]);
	});
});

describe('resolveSavedSelection', () => {
	it('returns null when the draft never stored a selection', () => {
		expect(resolveSavedSelection(null, [{ id: 'a' }])).toBeNull();
		expect(resolveSavedSelection(undefined, [{ id: 'a' }])).toBeNull();
		expect(resolveSavedSelection('nope', [{ id: 'a' }])).toBeNull();
	});

	it('keeps existing ids and drops unknown ones', () => {
		expect(resolveSavedSelection(['a', 'gone', 'b'], [{ id: 'a' }, { id: 'b' }])).toEqual([
			'a',
			'b'
		]);
	});

	it('preserves an explicitly empty selection', () => {
		expect(resolveSavedSelection([], [{ id: 'a' }])).toEqual([]);
		expect(resolveSavedSelection(['gone'], [{ id: 'a' }])).toEqual([]);
	});
});
