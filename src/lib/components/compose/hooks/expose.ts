import type { Composer } from './composer';

/**
 * Publishes one piece of a hook's state on the composer. Reads go through
 * `get`, so they stay reactive; writable state also takes a `set`.
 */
export function field<K extends keyof Composer>(
	ed: Composer,
	key: K,
	get: () => Composer[K],
	set?: (value: Composer[K]) => void
): void {
	Object.defineProperty(ed, key, { get, set, enumerable: true, configurable: true });
}

/** Publishes a hook's functions and fixed values on the composer. */
export function provide(ed: Composer, values: Partial<Composer>): void {
	Object.assign(ed, values);
}
