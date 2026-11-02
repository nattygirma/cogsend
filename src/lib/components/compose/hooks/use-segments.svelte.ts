import {
	type PlatformId,
	platformsFromConnections,
	isPlatformCustomized,
	effectivePlatformBody
} from '#lib/domain/platform-sync.js';
import type { Connection } from '../types';
import { platformLimit, PLATFORM_LIMITS } from '#lib/domain/editor-limits.js';
import { platformRank, PLATFORM_ORDER, supportsThreads } from '#lib/domain/platforms.js';
import { xWeightedLength, countGraphemes } from '#lib/domain/validation/text.js';
import { flattenThreadBody, splitThreadSegments } from '#lib/domain/thread-segments.js';
import { type XQuote, trailingXQuote } from '#lib/domain/x-quote.js';
import type { ActiveTab } from '../types';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Accounts in play, tabs, limits and the thread being written. */
export interface SegmentsApi {
	readonly accountsFor: (platform: PlatformId) => Connection[];
	readonly avatarSrc: string | null;
	readonly canAddOverride: boolean;
	readonly cardQuote: (i: number) => XQuote | null;
	readonly countForPlatform: (text: string, platform: string) => number;
	readonly globalLimit: { platform: string; max: number };
	readonly hiddenQuote: (i: number) => XQuote | null;
	readonly maxChars: number;
	readonly platformMax: (platform: PlatformId, list: Connection[]) => number;
	readonly quoteLinkPlatforms: PlatformId[];
	quotePickerFor: number | null;
	quotePicks: { url: string; text: string; when: string }[] | null;
	quotePicksFailed: boolean;
	readonly representativeAccount: (platform: PlatformId) => Connection | undefined;
	revealTrailing: number | null;
	readonly segments: string[];
	readonly selectedAccounts: Connection[];
	readonly selectedPlatforms: Set<string>;
	readonly sortedConnections: Connection[];
	readonly tabs: ActiveTab[];
	readonly tabSupportsThreads: boolean;
	readonly xQuoteActive: boolean;
	readonly xWithheldFrom: PlatformId[];
}

export function useSegments(ed: Composer): void {
	/**
	 * The strictest limit among the accounts a post can actually reach. Callers
	 * pass the *selected* accounts: using everything connected let an unselected
	 * 280-character X account cap a post bound for a 25,000-character one,
	 * which blocked text the target would have accepted.
	 */
	function platformMax(platform: PlatformId, list: Connection[]): number {
		return platformLimit(platform, list);
	}

	/** Selected accounts on one platform — what a tab or the global composer can
	 *  reach. Falls back to every connected account when nothing is selected, so
	 *  the limit is never accidentally the most permissive one. */
	function accountsFor(platform: PlatformId): Connection[] {
		const selected = selectedAccounts.filter((c) => c.platform === platform);
		return selected.length ? selected : ed.connections.filter((c) => c.platform === platform);
	}

	const connectedPlatforms = $derived(platformsFromConnections(ed.connections));
	const sortedConnections = $derived(
		[...ed.connections].sort((a, b) => {
			const pa = platformRank(a.platform);
			const pb = platformRank(b.platform);
			if (pa !== pb) return pa - pb;
			const na = (a.displayName || a.handle || '').toLowerCase();
			const nb = (b.displayName || b.handle || '').toLowerCase();
			if (na !== nb) return na < nb ? -1 : 1;
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		})
	);
	const selectedAccounts = $derived(sortedConnections.filter((c) => ed.selected.has(c.id)));
	// An override only makes sense with more than one selected account: the
	// Global body already is that platform's body when it is the only pick.
	const canAddOverride = $derived(
		selectedAccounts.length > 1 &&
			selectedAccounts.some((a) => !isPlatformCustomized(ed.overrides, a.platform as PlatformId))
	);
	// Tabs: Global plus one pill per customized platform.
	const tabs = $derived<ActiveTab[]>([
		'global',
		...connectedPlatforms.filter((p) => isPlatformCustomized(ed.overrides, p))
	]);

	function representativeAccount(platform: PlatformId): Connection | undefined {
		return (
			selectedAccounts.find((c) => c.platform === platform) ??
			sortedConnections.find((c) => c.platform === platform)
		);
	}

	// Without a picture the preview shows initials (drawn here, never fetched).
	const avatarSrc = $derived.by((): string | null => {
		const globalAvatar = ed.initialSettings?.profilePictureUrl || null;
		if (ed.activeTab === 'global') return globalAvatar;
		const platformAvatar = selectedAccounts.find((c) => c.platform === ed.activeTab)?.avatarUrl;
		return platformAvatar || globalAvatar;
	});

	const selectedPlatforms = $derived(
		new Set(ed.connections.filter((c) => ed.selected.has(c.id)).map((c) => c.platform))
	);

	// Global is held to the strictest limit among the selected accounts, and is
	// counted the way that platform counts: a gauge in graphemes next to X's
	// weighted limit could read green while publishing was blocked.
	const globalLimit = $derived.by((): { platform: string; max: number } => {
		let strictest: { platform: string; max: number } | null = null;
		for (const platform of PLATFORM_ORDER) {
			if (!selectedPlatforms.has(platform)) continue;
			const max = platformMax(platform, accountsFor(platform));
			if (!strictest || max < strictest.max) strictest = { platform, max };
		}
		return strictest ?? { platform: 'generic', max: PLATFORM_LIMITS.x };
	});

	const maxChars = $derived(
		ed.activeTab === 'global'
			? globalLimit.max
			: platformMax(ed.activeTab, accountsFor(ed.activeTab))
	);

	// On Global the thread affordance follows the destinations: with only
	// single-post platforms selected (LinkedIn), a thread has nowhere to go.
	const tabSupportsThreads = $derived(
		ed.activeTab === 'global'
			? [...selectedPlatforms].some((p) => supportsThreads(p))
			: supportsThreads(ed.activeTab)
	);

	function countForPlatform(text: string, platform: string): number {
		if (platform === 'x') return xWeightedLength(text);
		return countGraphemes(text);
	}

	const activeContent = $derived.by(() => {
		if (ed.activeTab === 'global') return ed.baseBody;
		const body = effectivePlatformBody(ed.baseBody, ed.overrides, ed.activeTab);
		// Single-post platforms (LinkedIn) always show the flattened result:
		// that is exactly what publish will send, customized or not.
		if (!supportsThreads(ed.activeTab)) return flattenThreadBody(body);
		return body;
	});

	const segments = $derived(splitThreadSegments(activeContent));

	// X shows a post whose text ends with a link to another X post as a quote of
	// it, so on a card that is X's text the trailing link is drawn as a quote
	// card and kept out of the text box. The stored text still ends with it.
	const xQuoteActive = $derived(
		ed.activeTab === 'x' ||
			(ed.activeTab === 'global' &&
				selectedPlatforms.has('x') &&
				!isPlatformCustomized(ed.overrides, 'x'))
	);
	// On Global the other selected platforms get the same text, link and all.
	const quoteLinkPlatforms = $derived(
		ed.activeTab === 'global'
			? PLATFORM_ORDER.filter(
					(p) => p !== 'x' && selectedPlatforms.has(p) && !isPlatformCustomized(ed.overrides, p)
				)
			: []
	);
	// On X's own tab, the platforms that follow Global and so get X's text
	// without whatever X alone quotes.
	const xWithheldFrom = $derived(
		ed.activeTab === 'x' && isPlatformCustomized(ed.overrides, 'x')
			? PLATFORM_ORDER.filter(
					(p) => p !== 'x' && selectedPlatforms.has(p) && !isPlatformCustomized(ed.overrides, p)
				)
			: []
	);
	// A link typed by hand stays in the text box until the box loses focus, so
	// it never vanishes halfway through being typed.
	let revealTrailing = $state<number | null>(null);
	let quotePickerFor = $state<number | null>(null);
	let quotePicks = $state<Array<{ url: string; text: string; when: string }> | null>(null);
	let quotePicksFailed = $state(false);

	/** The quote the card shows. */
	function cardQuote(i: number): XQuote | null {
		return xQuoteActive ? trailingXQuote(segments[i] ?? '') : null;
	}

	/** The quote whose link the text box leaves out. */
	function hiddenQuote(i: number): XQuote | null {
		return revealTrailing === i ? null : cardQuote(i);
	}

	field(ed, 'avatarSrc', () => avatarSrc);
	field(ed, 'canAddOverride', () => canAddOverride);
	field(ed, 'globalLimit', () => globalLimit);
	field(ed, 'maxChars', () => maxChars);
	field(ed, 'quoteLinkPlatforms', () => quoteLinkPlatforms);
	field(
		ed,
		'quotePickerFor',
		() => quotePickerFor,
		(v) => (quotePickerFor = v)
	);
	field(
		ed,
		'quotePicks',
		() => quotePicks,
		(v) => (quotePicks = v)
	);
	field(
		ed,
		'quotePicksFailed',
		() => quotePicksFailed,
		(v) => (quotePicksFailed = v)
	);
	field(
		ed,
		'revealTrailing',
		() => revealTrailing,
		(v) => (revealTrailing = v)
	);
	field(ed, 'segments', () => segments);
	field(ed, 'selectedAccounts', () => selectedAccounts);
	field(ed, 'selectedPlatforms', () => selectedPlatforms);
	field(ed, 'sortedConnections', () => sortedConnections);
	field(ed, 'tabs', () => tabs);
	field(ed, 'tabSupportsThreads', () => tabSupportsThreads);
	field(ed, 'xQuoteActive', () => xQuoteActive);
	field(ed, 'xWithheldFrom', () => xWithheldFrom);
	provide(ed, {
		accountsFor,
		cardQuote,
		countForPlatform,
		hiddenQuote,
		platformMax,
		representativeAccount
	});
}
