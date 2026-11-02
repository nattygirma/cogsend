import type { PlatformOverrideMap } from '#lib/domain/platform-sync.js';
import type { Connection, MediaItem } from '../types';
import { earliestFutureScheduleValue } from '#lib/domain/schedule-helpers.js';
import { isFullyPublished } from '#lib/domain/published-lock.js';
import { type TargetSnapshot, summarizePost, selectionDrift } from '#lib/domain/post-state.js';
import type { ActiveTab } from '../types';
import type { PlatformId } from '#lib/domain/platforms.js';
import type { PlatformOverride } from '#lib/domain/platform-sync.js';
import type { PostState } from '#lib/domain/post-state.js';
import type { Composer } from './composer';
import { field } from './expose';

/** The composer’s core state, shared by every other hook. */
export interface ComposerStateApi {
	activeTab: ActiveTab;
	baseBody: string;
	clock: number;
	connections: Connection[];
	draftId: string | null;
	readonly drift: { added: string[]; removed: string[] };
	readonly editLocked: boolean;
	readonly hasSchedule: boolean;
	loadedSchedule: string | null;
	media: MediaItem[];
	overrides: Partial<Record<PlatformId, PlatformOverride>>;
	readonly postState: PostState;
	publishedLock: boolean;
	publishing: boolean;
	returnToPosts: boolean;
	saving: boolean;
	schedDate: string;
	schedTime: string;
	scheduleOpen: boolean;
	scheduleTouched: boolean;
	selected: Set<string>;
	sendBlocked: boolean;
	readonly sendInFlight: boolean;
	readonly sendingNow: boolean;
	targets: TargetSnapshot[];
}

export function useComposerState(ed: Composer): void {
	// svelte-ignore state_referenced_locally
	let draftId = $state<string | null>(ed.composeUrl.searchParams.get('id'));
	let baseBody = $state(ed.seededBody);
	let activeTab = $state<ActiveTab>('global');
	let overrides = $state<PlatformOverrideMap>(ed.seededOverrides);
	// Snapshot on purpose: the server-rendered list paints first; the client
	// refresh replaces it via loadConnections().
	// svelte-ignore state_referenced_locally
	let connections = $state<Connection[]>(ed.initialConnections);
	let selected = $state<Set<string>>(new Set());
	let media = $state<MediaItem[]>(ed.seededMedia);
	let saving = $state(false);
	let publishing = $state(false);
	let scheduleOpen = $state(false);
	let schedDate = $state('');
	let schedTime = $state('');
	// The loaded draft's existing schedule (datetime-local, earliest future
	// target time) or null. openSchedule() starts from it instead of the
	// fresh-post default while it is still in the future.
	let loadedSchedule = $state<string | null>(
		earliestFutureScheduleValue(ed.seededDraft?.targets, new Date())
	);
	// Set when the user changes a schedule control. Kept apart from `dirty`
	// (body/selection autosave) so a draft response landing mid-edit cannot
	// replace a schedule the user already picked.
	let scheduleTouched = $state(false);
	// The open post went out everywhere: the editor turns read-only and saves
	// nothing, since the server refuses edits to it (PUBLISHED_EDIT_ERROR).
	let publishedLock = $state(isFullyPublished(ed.seededDraft?.targets ?? []));
	// The open post's publish targets: where it is scheduled, published, failed
	// or being sent right now. Refreshed while a send is near (see watchDelay).
	let targets = $state<TargetSnapshot[]>(ed.seededDraft?.targets ?? []);
	// A save was refused because a destination is being sent: the targets
	// will show it on the next refresh, but editing pauses from now.
	let sendBlocked = $state(false);
	// Re-renders relative times and moves the watch window; ticks only while
	// something is still to go out.
	let clock = $state(Date.now());
	const postState = $derived(summarizePost(targets, new Date(clock)));
	const drift = $derived(selectionDrift(postState, selected));
	// Still waiting to go out somewhere: Publish and Schedule now change an
	// existing schedule, and the wording says so.
	const hasSchedule = $derived(postState.waiting.length > 0);
	const sendInFlight = $derived(postState.sending.length > 0 || sendBlocked);
	// This editor's own publish or schedule marks its targets as sending too;
	// that one already owns the dock and its progress, so it does not pause.
	const sendingNow = $derived(!publishing && sendInFlight);
	// Nothing in the editor may change: the post went out everywhere, or a
	// destination is being sent and the server refuses edits until it settles.
	const editLocked = $derived(publishedLock || sendingNow);
	// Opened from Posts (Edit Post, Duplicate, Quote on X): a successful
	// schedule or publish goes back there instead of clearing the composer.
	let returnToPosts = false;

	field(
		ed,
		'activeTab',
		() => activeTab,
		(v) => (activeTab = v)
	);
	field(
		ed,
		'baseBody',
		() => baseBody,
		(v) => (baseBody = v)
	);
	field(
		ed,
		'clock',
		() => clock,
		(v) => (clock = v)
	);
	field(
		ed,
		'connections',
		() => connections,
		(v) => (connections = v)
	);
	field(
		ed,
		'draftId',
		() => draftId,
		(v) => (draftId = v)
	);
	field(ed, 'drift', () => drift);
	field(ed, 'editLocked', () => editLocked);
	field(ed, 'hasSchedule', () => hasSchedule);
	field(
		ed,
		'loadedSchedule',
		() => loadedSchedule,
		(v) => (loadedSchedule = v)
	);
	field(
		ed,
		'media',
		() => media,
		(v) => (media = v)
	);
	field(
		ed,
		'overrides',
		() => overrides,
		(v) => (overrides = v)
	);
	field(ed, 'postState', () => postState);
	field(
		ed,
		'publishedLock',
		() => publishedLock,
		(v) => (publishedLock = v)
	);
	field(
		ed,
		'publishing',
		() => publishing,
		(v) => (publishing = v)
	);
	field(
		ed,
		'returnToPosts',
		() => returnToPosts,
		(v) => (returnToPosts = v)
	);
	field(
		ed,
		'saving',
		() => saving,
		(v) => (saving = v)
	);
	field(
		ed,
		'schedDate',
		() => schedDate,
		(v) => (schedDate = v)
	);
	field(
		ed,
		'schedTime',
		() => schedTime,
		(v) => (schedTime = v)
	);
	field(
		ed,
		'scheduleOpen',
		() => scheduleOpen,
		(v) => (scheduleOpen = v)
	);
	field(
		ed,
		'scheduleTouched',
		() => scheduleTouched,
		(v) => (scheduleTouched = v)
	);
	field(
		ed,
		'selected',
		() => selected,
		(v) => (selected = v)
	);
	field(
		ed,
		'sendBlocked',
		() => sendBlocked,
		(v) => (sendBlocked = v)
	);
	field(ed, 'sendInFlight', () => sendInFlight);
	field(ed, 'sendingNow', () => sendingNow);
	field(
		ed,
		'targets',
		() => targets,
		(v) => (targets = v)
	);
}
