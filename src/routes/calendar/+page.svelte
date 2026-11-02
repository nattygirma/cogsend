<script lang="ts">
	import { CalendarClock, ChevronLeft, ChevronRight, Plus } from '@lucide/svelte';
	import SocialIcon from '#lib/components/SocialIcon.svelte';
	import { platformColorClass } from '#lib/components/platform-color.js';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PlatformStack from '#lib/components/ui/PlatformStack.svelte';
	import UpcomingList from '#lib/components/ui/UpcomingList.svelte';
	import { STATUS_LABEL, formatTime, type CalendarStatus } from '#lib/domain/calendar.js';
	import { platformName } from '#lib/domain/platforms.js';

	let { data } = $props();

	function href(patch: { week?: number; platform?: string | null }): string {
		const week = patch.week ?? data.weekOffset;
		const platform = patch.platform === undefined ? data.platform : patch.platform;
		const params = new URLSearchParams();
		if (week) params.set('week', String(week));
		if (platform) params.set('platform', platform);
		const query = params.toString();
		return query ? `/calendar?${query}` : '/calendar';
	}

	const cardTone: Record<CalendarStatus, string> = {
		scheduled: 'border-l-indigo-500 bg-white',
		sending: 'border-l-sky-500 bg-sky-50/50',
		published: 'border-l-emerald-500 bg-white',
		failed: 'border-l-rose-500 bg-rose-50/60',
		partial: 'border-l-amber-500 bg-amber-50/50'
	};
	const dotTone: Record<CalendarStatus, string> = {
		scheduled: 'bg-indigo-500',
		sending: 'bg-sky-500',
		published: 'bg-emerald-500',
		failed: 'bg-rose-500',
		partial: 'bg-amber-500'
	};
</script>

<PageHeader
	eyebrow="Schedule"
	title="Calendar"
	subtitle="Every post across your accounts, by day. Times are in {data.timeZone}."
>
	{#snippet actions()}
		<a href="/compose" class="btn btn-primary"><Plus class="h-4 w-4" /> New post</a>
	{/snippet}
</PageHeader>

<div class="mb-5 flex flex-wrap items-center gap-3">
	<div class="flex items-center gap-1">
		<a
			href={href({ week: data.weekOffset - 1 })}
			class="btn btn-secondary btn-sm px-2"
			aria-label="Previous week"><ChevronLeft class="h-4 w-4" /></a
		>
		<a
			href={href({ week: 0 })}
			class="btn btn-secondary btn-sm"
			aria-current={data.weekOffset === 0 ? 'date' : undefined}>Today</a
		>
		<a
			href={href({ week: data.weekOffset + 1 })}
			class="btn btn-secondary btn-sm px-2"
			aria-label="Next week"><ChevronRight class="h-4 w-4" /></a
		>
	</div>
	<h2 class="text-[15px] font-semibold text-stone-900" data-testid="calendar-range">
		{data.label}
	</h2>

	{#if data.platforms.length > 1}
		<div
			class="flex flex-wrap items-center gap-1.5 sm:ml-auto"
			role="group"
			aria-label="Filter by platform"
		>
			<a
				href={href({ platform: null })}
				class="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors {data.platform
					? 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
					: 'border-indigo-200 bg-accent-soft text-accent-ink'}">All</a
			>
			{#each data.platforms as platform (platform)}
				{@const on = data.platform === platform}
				<a
					href={href({ platform: on ? null : platform })}
					aria-current={on ? 'true' : undefined}
					class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors {on
						? 'border-indigo-200 bg-accent-soft text-accent-ink'
						: 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'}"
				>
					<span class={platformColorClass(platform)}
						><SocialIcon {platform} className="h-3 w-3" /></span
					>
					{platformName(platform)}
				</a>
			{/each}
		</div>
	{/if}
</div>

<div class="card overflow-hidden" data-testid="calendar-week">
	<div class="grid grid-cols-1 divide-y divide-stone-100 md:grid-cols-7 md:divide-x md:divide-y-0">
		{#each data.days as day (day.key)}
			<div class="flex min-w-0 flex-col md:min-h-[26rem]" data-testid="calendar-day">
				<div
					class="flex items-baseline gap-2 border-stone-100 px-3 py-2.5 md:block md:border-b {day.isToday
						? 'bg-accent-soft/60'
						: ''}"
				>
					<p
						class="text-[11px] font-semibold tracking-wider uppercase {day.isToday
							? 'text-accent'
							: 'text-stone-500'}"
					>
						{day.weekday}
					</p>
					<p class="text-lg font-semibold {day.isToday ? 'text-accent-ink' : 'text-stone-900'}">
						{day.dayOfMonth}
						{#if day.dayOfMonth === 1 || day === data.days[0]}<span
								class="text-[12px] font-medium text-stone-400">{day.month}</span
							>{/if}
					</p>
				</div>
				<div class="flex flex-1 flex-col gap-2 p-2">
					{#each day.posts as post (post.key)}
						<a
							href="/compose?id={encodeURIComponent(post.draftId)}"
							class="block rounded-lg border border-l-[3px] border-stone-200 px-2.5 py-2 transition-shadow hover:shadow-md {cardTone[
								post.status
							]}"
							title="{STATUS_LABEL[post.status]} · {post.accounts.map((a) => a.label).join(', ')}"
							data-testid="calendar-post"
						>
							<div class="mb-1 flex items-center justify-between gap-2">
								<span
									class="flex items-center gap-1.5 text-[11px] font-semibold text-stone-700 tabular-nums"
								>
									<span class="h-1.5 w-1.5 rounded-full {dotTone[post.status]}" aria-hidden="true"
									></span>
									{formatTime(post.whenMs, data.timeZone)}
								</span>
								<PlatformStack platforms={post.platforms} size={18} />
							</div>
							<p class="line-clamp-3 text-[12px] leading-snug text-stone-600">{post.excerpt}</p>
							<span class="sr-only">{STATUS_LABEL[post.status]}</span>
						</a>
					{:else}
						<p class="px-1 pb-1 text-[12px] text-stone-400 md:hidden">No posts</p>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

{#if data.total === 0}
	<div class="card mt-4">
		<EmptyState title="Nothing on the calendar this week" icon={CalendarClock}>
			{data.platform
				? `No ${platformName(data.platform)} posts this week.`
				: 'Write a post and schedule it to see it here.'}
			{#snippet action()}
				<a href="/compose" class="btn btn-primary"><Plus class="h-4 w-4" /> New post</a>
			{/snippet}
		</EmptyState>
	</div>
{/if}

<div class="mt-6">
	<Card title="Coming up" subtitle="The next posts waiting to go out, any week" padded={false}>
		{#if data.upcoming.length}
			<div class="pt-2 pb-1"><UpcomingList posts={data.upcoming} timeZone={data.timeZone} /></div>
		{:else}
			<p class="px-5 pt-3 pb-5 text-sm text-stone-500">Nothing is waiting to go out.</p>
		{/if}
	</Card>
</div>
