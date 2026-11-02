import { describe, expect, it } from 'vitest';
import {
	bucketByDay,
	calendarWeek,
	groupCalendarPosts,
	parseWeekOffset,
	type CalendarTargetRow
} from '#lib/domain/calendar.js';

// Wednesday 4 Nov 2026, 10:00 UTC.
const NOW = Date.UTC(2026, 10, 4, 10, 0);

function row(over: Partial<CalendarTargetRow>): CalendarTargetRow {
	return {
		targetId: 't',
		draftId: 'd1',
		status: 'scheduled',
		scheduledFor: new Date(NOW),
		updatedAt: new Date(NOW),
		platform: 'youtube',
		handle: '@me',
		displayName: null,
		title: null,
		baseBody: 'Hello world',
		...over
	};
}

describe('calendar week', () => {
	it('runs Monday to Sunday around today, in the owner zone', () => {
		const week = calendarWeek(NOW, 0, 'UTC');
		expect(week.days.map((d) => d.key)).toEqual([
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
			'2026-11-05',
			'2026-11-06',
			'2026-11-07',
			'2026-11-08'
		]);
		expect(week.days.map((d) => d.weekday)).toEqual([
			'Mon',
			'Tue',
			'Wed',
			'Thu',
			'Fri',
			'Sat',
			'Sun'
		]);
		expect(week.days.find((d) => d.isToday)?.key).toBe('2026-11-04');
		expect(week.startMs).toBe(Date.UTC(2026, 10, 2));
		expect(week.endMs).toBe(Date.UTC(2026, 10, 9));
		expect(week.label).toBe('Nov 2 – 8, 2026');
	});

	it('pages by whole weeks and names a week across two months', () => {
		const next = calendarWeek(NOW, 4, 'UTC');
		expect(next.days[0].key).toBe('2026-11-30');
		expect(next.label).toBe('Nov 30 – Dec 6, 2026');
		expect(next.days.some((d) => d.isToday)).toBe(false);
	});

	it('starts each day at the zone’s own midnight', () => {
		// 01:00 UTC on Thursday is still Wednesday evening in New York.
		const late = Date.UTC(2026, 10, 5, 1, 0);
		const week = calendarWeek(late, 0, 'America/New_York');
		expect(week.days.find((d) => d.isToday)?.key).toBe('2026-11-04');
		// EST is UTC-5 after the November change.
		expect(week.startMs).toBe(Date.UTC(2026, 10, 2, 5));
	});

	it('reads ?week= as a bounded whole number', () => {
		expect(parseWeekOffset('3')).toBe(3);
		expect(parseWeekOffset('-2')).toBe(-2);
		expect(parseWeekOffset('x')).toBe(0);
		expect(parseWeekOffset(null)).toBe(0);
		expect(parseWeekOffset('99999')).toBe(520);
	});
});

describe('calendar posts', () => {
	it('shows a post sent to several accounts at once as one card', () => {
		const posts = groupCalendarPosts([
			row({ targetId: 'a', platform: 'youtube' }),
			row({ targetId: 'b', platform: 'tiktok' }),
			row({ targetId: 'c', platform: 'tiktok', handle: '@other' })
		]);
		expect(posts).toHaveLength(1);
		expect(posts[0].platforms).toEqual(['youtube', 'tiktok']);
		expect(posts[0].accounts).toHaveLength(3);
		expect(posts[0].status).toBe('scheduled');
		expect(posts[0].excerpt).toBe('Hello world');
	});

	it('keeps the same post at two times as two cards', () => {
		const posts = groupCalendarPosts([
			row({ targetId: 'a' }),
			row({ targetId: 'b', scheduledFor: new Date(NOW + 3_600_000) })
		]);
		expect(posts).toHaveLength(2);
		expect(posts[0].whenMs).toBeLessThan(posts[1].whenMs);
	});

	it('sums up the destinations into one status', () => {
		const status = (...statuses: string[]) =>
			groupCalendarPosts(statuses.map((s, i) => row({ targetId: String(i), status: s })))[0].status;
		expect(status('published', 'published')).toBe('published');
		expect(status('failed', 'failed')).toBe('failed');
		expect(status('published', 'failed')).toBe('partial');
		expect(status('scheduled', 'publishing')).toBe('sending');
		expect(status('scheduled')).toBe('scheduled');
	});

	it('places a "publish now" post where it was last touched', () => {
		const touched = NOW - 86_400_000;
		const [post] = groupCalendarPosts([
			row({ status: 'published', scheduledFor: null, updatedAt: new Date(touched) })
		]);
		expect(post.whenMs).toBe(touched);
	});

	it('buckets posts into their local day, in time order', () => {
		const week = calendarWeek(NOW, 0, 'America/New_York');
		const posts = groupCalendarPosts([
			row({ draftId: 'late', scheduledFor: new Date(Date.UTC(2026, 10, 5, 1, 0)) }),
			row({ draftId: 'early', scheduledFor: new Date(Date.UTC(2026, 10, 4, 14, 0)) }),
			row({ draftId: 'outside', scheduledFor: new Date(Date.UTC(2026, 11, 1)) })
		]);
		const buckets = bucketByDay(posts, week.days, 'America/New_York');
		expect(buckets.get('2026-11-04')?.map((p) => p.draftId)).toEqual(['early', 'late']);
		expect([...buckets.values()].flat()).toHaveLength(2);
		expect(buckets.get('2026-11-05')).toEqual([]);
	});
});
