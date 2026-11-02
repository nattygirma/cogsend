import { describe, expect, it } from 'vitest';
import { field, provide } from '../src/lib/components/compose/hooks/expose';
import type { Composer } from '../src/lib/components/compose/hooks/composer';

/**
 * The composer is one object that every hook adds to. A field must read the
 * hook's current value each time (a copy would go stale the moment the state
 * changes), and only writable state may be assigned through it.
 */
describe('composer fields', () => {
	it('reads the live value and writes through to the hook', () => {
		const ed = {} as Composer;
		let draftId: string | null = 'a';
		field(
			ed,
			'draftId',
			() => draftId,
			(v) => (draftId = v)
		);
		expect(ed.draftId).toBe('a');
		draftId = 'b';
		expect(ed.draftId).toBe('b');
		ed.draftId = 'c';
		expect(draftId).toBe('c');
	});

	it('refuses writes to a read-only field', () => {
		const ed = {} as Composer;
		const value = ['x'];
		field(ed, 'segments', () => value);
		expect(() => {
			(ed as { segments: string[] }).segments = [];
		}).toThrow(TypeError);
		expect(ed.segments).toBe(value);
	});

	it('provides functions as they are', () => {
		const ed = {} as Composer;
		const markDirty = () => {};
		provide(ed, { markDirty });
		expect(ed.markDirty).toBe(markDirty);
	});
});
