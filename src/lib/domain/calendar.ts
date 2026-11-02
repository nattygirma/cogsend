import { draftExcerpt } from './excerpt';
import { localDayKey, localDayStartMs } from './insights';

/**
 * The calendar and the dashboard's "Coming up" show posts, not destinations: a
 * post sent to three accounts at one time is one card with three marks. The
 * rows come in per destination (publish target) and are grouped here, so the
 * rules cannot differ between the two pages.
 */

export const CALENDAR_STATUSES = [
	'scheduled',
	'pending',
	'publishing',
	'published',
	'failed'
] as const;

export type CalendarStatus = 'scheduled' | 'sending' | 'published' | 'failed' | 'partial';

export interface CalendarTargetRow {
	targetId: string;
	draftId: string;
	status: string;
	scheduledFor: Date | number | null;
	updatedAt: Date | number;
	platform: string;
	handle: string | null;
	displayName: string | null;
	title: string | null;
	baseBody: string;
}

export interface CalendarPost {
	/** Stable per card: one post at one minute. */
	key: string;
	draftId: string;
	whenMs: number;
	status: CalendarStatus;
	excerpt: string;
	platforms: string[];
	accounts: Array<{ platform: string; label: string }>;
}

export interface CalendarDay {
	key: string;
	startMs: number;
	weekday: string;
	dayOfMonth: number;
	month: string;
	isToday: boolean;
}

export interface CalendarWeek {
	days: CalendarDay[];
	startMs: number;
	endMs: number;
	/** "Nov 2 – 8, 2026" */
	label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** About ten years either way: enough paging, and a bound on silly input. */
const MAX_WEEK_OFFSET = 520;

function keyToUtc(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
}

function addDays(key: string, n: number): string {
	const d = new Date(keyToUtc(key).getTime() + n * DAY_MS);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
		d.getUTCDate()
	).padStart(2, '0')}`;
}

export function parseWeekOffset(raw: string | null | undefined): number {
	const n = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-MAX_WEEK_OFFSET, Math.min(MAX_WEEK_OFFSET, n));
}

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });

/**
 * The Monday-to-Sunday week `offset` weeks from the one holding `nowMs`, in
 * the owner's zone. Day boundaries are that zone's midnights, so a post at
 * 23:30 local lands on its own day whatever the server's zone is.
 */
export function calendarWeek(nowMs: number, offset: number, timeZone: string): CalendarWeek {
	const todayKey = localDayKey(nowMs, timeZone);
	const dow = keyToUtc(todayKey).getUTCDay();
	const mondayKey = addDays(todayKey, -((dow + 6) % 7) + offset * 7);
	const keys = Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i));
	const days = keys.map((key) => {
		const date = keyToUtc(key);
		return {
			key,
			startMs: localDayStartMs(key, timeZone),
			weekday: weekdayFmt.format(date),
			dayOfMonth: date.getUTCDate(),
			month: monthFmt.format(date),
			isToday: key === todayKey
		};
	});
	const first = keyToUtc(keys[0]);
	const last = keyToUtc(keys[6]);
	const sameMonth = first.getUTCMonth() === last.getUTCMonth();
	const label = sameMonth
		? `${monthFmt.format(first)} ${first.getUTCDate()} – ${last.getUTCDate()}, ${last.getUTCFullYear()}`
		: `${monthFmt.format(first)} ${first.getUTCDate()} – ${monthFmt.format(last)} ${last.getUTCDate()}, ${last.getUTCFullYear()}`;
	return {
		days,
		startMs: days[0].startMs,
		endMs: localDayStartMs(addDays(keys[6], 1), timeZone),
		label
	};
}

function toMs(value: Date | number | null): number | null {
	if (value === null) return null;
	return value instanceof Date ? value.getTime() : value;
}

/** When a destination shows on the calendar: its slot, or when it went out. */
export function targetWhenMs(row: Pick<CalendarTargetRow, 'scheduledFor' | 'updatedAt'>): number {
	return toMs(row.scheduledFor) ?? toMs(row.updatedAt) ?? 0;
}

function combinedStatus(statuses: string[]): CalendarStatus {
	const failed = statuses.filter((s) => s === 'failed').length;
	const published = statuses.filter((s) => s === 'published').length;
	if (failed && failed === statuses.length) return 'failed';
	if (published === statuses.length) return 'published';
	if (statuses.some((s) => s === 'pending' || s === 'publishing')) return 'sending';
	if (failed || published) return 'partial';
	return 'scheduled';
}

/** One card per post and minute, newest-destination facts merged. */
export function groupCalendarPosts(rows: CalendarTargetRow[]): CalendarPost[] {
	const groups = new Map<string, CalendarTargetRow[]>();
	for (const row of rows) {
		const minute = Math.floor(targetWhenMs(row) / 60_000);
		const key = `${row.draftId}:${minute}`;
		const list = groups.get(key) ?? [];
		list.push(row);
		groups.set(key, list);
	}
	const posts: CalendarPost[] = [];
	for (const [key, list] of groups) {
		const first = list[0];
		const platforms = [...new Set(list.map((r) => r.platform))];
		posts.push({
			key,
			draftId: first.draftId,
			whenMs: Math.min(...list.map(targetWhenMs)),
			status: combinedStatus(list.map((r) => r.status)),
			excerpt: draftExcerpt(first.title?.trim() || first.baseBody, 90),
			platforms,
			accounts: list.map((r) => ({
				platform: r.platform,
				label: r.displayName?.trim() || r.handle || r.platform
			}))
		});
	}
	return posts.sort((a, b) => a.whenMs - b.whenMs || a.key.localeCompare(b.key));
}

/** Posts by local day key, each day in time order; days with none are empty. */
export function bucketByDay(
	posts: CalendarPost[],
	days: CalendarDay[],
	timeZone: string
): Map<string, CalendarPost[]> {
	const buckets = new Map<string, CalendarPost[]>(days.map((d) => [d.key, []]));
	for (const post of posts) {
		const list = buckets.get(localDayKey(post.whenMs, timeZone));
		if (list) list.push(post);
	}
	for (const list of buckets.values()) list.sort((a, b) => a.whenMs - b.whenMs);
	return buckets;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
/** "9:30 AM" in the owner's zone. */
export function formatTime(ms: number, timeZone: string): string {
	let fmt = timeFormatters.get(timeZone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
		timeFormatters.set(timeZone, fmt);
	}
	return fmt.format(new Date(ms));
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** "Tue, Nov 3" in the owner's zone. */
export function formatDay(ms: number, timeZone: string): string {
	let fmt = dayFormatters.get(timeZone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone,
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		dayFormatters.set(timeZone, fmt);
	}
	return fmt.format(new Date(ms));
}

export const STATUS_LABEL: Record<CalendarStatus, string> = {
	scheduled: 'Scheduled',
	sending: 'Sending',
	published: 'Published',
	failed: 'Failed',
	partial: 'Partly sent'
};

export const STATUS_TONE: Record<CalendarStatus, 'accent' | 'info' | 'ok' | 'bad' | 'warn'> = {
	scheduled: 'accent',
	sending: 'info',
	published: 'ok',
	failed: 'bad',
	partial: 'warn'
};
