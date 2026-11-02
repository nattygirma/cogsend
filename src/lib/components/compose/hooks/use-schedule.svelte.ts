import {
	isFutureScheduleValue,
	DEFAULT_SCHEDULE_OFFSET,
	offsetToDHM,
	scheduleFromDHM,
	schedulePreviewText,
	minScheduleDatetime,
	scheduleValueToIso
} from '#lib/domain/schedule-helpers.js';
import { localTimezoneShort } from '#lib/domain/relative-time.js';
import { showToast } from '#lib/components/toast.svelte.js';
import { mediaSizeProblem } from '#lib/domain/media-limits.js';
import { humanizeError } from '#lib/domain/human-error.js';
import type { Composer } from './composer';
import { field, provide } from './expose';

/** Choosing a time and scheduling the post. */
export interface ScheduleApi {
	readonly applyLoadedSchedule: (value: string) => void;
	readonly applyRelativeFields: () => void;
	readonly minSchedDate: string;
	readonly onSchedule: () => Promise<void>;
	readonly openSchedule: () => void;
	relativeUnit: 'hours' | 'days' | 'mins';
	relativeValue: string;
	scheduleMode: 'relative' | 'absolute';
	readonly schedulePreview: string | null;
	readonly tzShort: string;
}

export function useSchedule(ed: Composer): void {
	// Quick-set offset (days / hours / mins from now). Prefilled with a common
	// default; editing any field recomputes the date/time inputs below.
	let scheduleMode = $state<'relative' | 'absolute'>('relative');
	let relativeValue = $state('1');
	let relativeUnit = $state<'hours' | 'days' | 'mins'>('hours');

	function applyLoadedSchedule(value: string) {
		scheduleMode = 'absolute';
		ed.schedDate = value.slice(0, 10);
		ed.schedTime = value.slice(11, 16);
	}

	function openSchedule() {
		if (ed.isPostConfirmOpen) ed.dismissPostConfirm();
		if (ed.scheduleOpen) {
			ed.scheduleOpen = false;
			return;
		}
		ed.scheduleOpen = true;
		ed.checksRevealed = true;
		if (ed.scheduleTouched) {
			// Reopen on the user's own pick; a relative offset is re-based on now.
			if (scheduleMode === 'relative') applyRelativeFields();
			return;
		}
		if (ed.loadedSchedule && isFutureScheduleValue(ed.loadedSchedule, new Date())) {
			applyLoadedSchedule(ed.loadedSchedule);
			return;
		}
		scheduleMode = 'relative';

		let defaultUnit: 'hours' | 'days' | 'mins';
		let defaultValue: string;
		if (DEFAULT_SCHEDULE_OFFSET.days > 0) {
			defaultUnit = 'days';
			defaultValue = String(DEFAULT_SCHEDULE_OFFSET.days);
		} else if (DEFAULT_SCHEDULE_OFFSET.hours > 0) {
			defaultUnit = 'hours';
			defaultValue = String(DEFAULT_SCHEDULE_OFFSET.hours);
		} else {
			defaultUnit = 'mins';
			defaultValue = String(DEFAULT_SCHEDULE_OFFSET.mins || 1);
		}
		relativeUnit = defaultUnit;
		relativeValue = defaultValue;

		applyRelativeFields();
	}

	function applyRelativeFields() {
		const { days, hours, minutes } = offsetToDHM(relativeValue, relativeUnit);
		const value = scheduleFromDHM(days, hours, minutes, new Date());
		ed.schedDate = value.slice(0, 10);
		ed.schedTime = value.slice(11, 16);
	}

	// `by` keeps the read lazy: scheduleCombined is declared below.
	const schedulePreview = $derived.by(() => schedulePreviewText(scheduleCombined));

	// Computed once: the viewer's zone label (used in static headings).
	const tzShort = localTimezoneShort();

	const scheduleCombined = $derived(
		ed.schedDate && ed.schedTime ? `${ed.schedDate}T${ed.schedTime}` : ''
	);
	const minSchedDate = $derived.by(() => {
		void ed.scheduleOpen;
		return minScheduleDatetime(new Date()).slice(0, 10);
	});

	async function onSchedule() {
		if (ed.editLocked || ed.unscheduling) return;
		if (!ed.selected.size) {
			showToast('Select at least one account', 'warn');
			return;
		}
		// An account the post already went out on cannot be scheduled again
		// (the server answers 409); the rest of a partly published post can.
		const sendIds = [...ed.selected].filter((id) => !ed.postState.published.includes(id));
		if (!sendIds.length) {
			showToast(
				`Already published to ${[...ed.selected].map(ed.destinationName).join(', ')}`,
				'warn'
			);
			return;
		}
		const now = new Date();
		if (!scheduleCombined || !isFutureScheduleValue(scheduleCombined, now)) {
			showToast('Pick a time in the future', 'warn');
			return;
		}
		// Mirror the publish guards: scheduling a post that cannot publish just
		// parks a guaranteed failure in the queue.
		if (ed.threadsLinksOver) {
			showToast(`Threads allows max 5 links per post (${ed.threadsLinkCount} found)`, 'warn');
			return;
		}
		if (ed.linkedinMediaOver) {
			showToast(ed.linkedinMediaProblem ?? 'LinkedIn cannot take this media', 'warn');
			return;
		}
		if (ed.instagramMediaProblem) {
			showToast(ed.instagramMediaProblem, 'warn');
			return;
		}
		const singlePostProblem = ed.singlePostProblems.values().next().value;
		if (singlePostProblem) {
			showToast(singlePostProblem.message, 'warn');
			return;
		}
		const sizeProblem = mediaSizeProblem(ed.selectedPlatforms, ed.media);
		if (sizeProblem) {
			showToast(sizeProblem, 'warn');
			return;
		}
		if (ed.videoJobs.length) {
			showToast('Wait for the video to finish uploading', 'warn');
			return;
		}
		if (ed.videoProblem) {
			showToast(ed.videoProblem, 'warn');
			return;
		}
		if (ed.overSelectedLimit) {
			showToast('A post is over the character limit', 'warn');
			return;
		}
		const runAt = scheduleValueToIso(scheduleCombined, now);
		if (!runAt) {
			showToast('Pick a time in the future', 'warn');
			return;
		}
		if (ed.loadFailedId) {
			showToast('Could not load this draft — retry before scheduling', 'warn');
			return;
		}
		const rescheduling = ed.hasSchedule;
		ed.publishing = true;
		ed.busyAction = 'schedule';
		try {
			const id = await ed.persistForAction();
			if (!id) {
				if (!ed.publishedLock && !ed.sendInFlight) showToast('Nothing to schedule', 'warn');
				return;
			}
			const res = await fetch(`/api/drafts/${id}/schedule`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				// The selection is the whole destination list: an account taken
				// off it loses its earlier time instead of still posting then.
				body: JSON.stringify({ connectionIds: sendIds, runAt, cancelOthers: true })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Schedule failed');
			const count = sendIds.length;
			const removed: string[] = Array.isArray(data.cancelled) ? data.cancelled : [];
			const message =
				`${rescheduling ? 'Rescheduled' : 'Scheduled'} ${schedulePreview ? `for ${schedulePreview} ` : ''}to ${count} ${count === 1 ? 'destination' : 'destinations'}` +
				(removed.length ? ` · removed from ${removed.map(ed.destinationName).join(', ')}` : '');
			ed.scheduleOpen = false;
			// The draft now carries this time; reopening should show it.
			ed.loadedSchedule = scheduleCombined;
			ed.scheduleTouched = false;
			ed.finishPosted('scheduled', message, 'success');
		} catch (e) {
			showToast(humanizeError(e instanceof Error ? e.message : 'Schedule failed'), 'error');
			// A 409 means the post moved on (published, sending): show where it is.
			void ed.refreshTargets();
		} finally {
			ed.publishing = false;
			ed.busyAction = null;
			ed.stopPublishBusy();
		}
	}

	field(ed, 'minSchedDate', () => minSchedDate);
	field(
		ed,
		'relativeUnit',
		() => relativeUnit,
		(v) => (relativeUnit = v)
	);
	field(
		ed,
		'relativeValue',
		() => relativeValue,
		(v) => (relativeValue = v)
	);
	field(
		ed,
		'scheduleMode',
		() => scheduleMode,
		(v) => (scheduleMode = v)
	);
	field(ed, 'schedulePreview', () => schedulePreview);
	provide(ed, { applyLoadedSchedule, applyRelativeFields, onSchedule, openSchedule, tzShort });
}
