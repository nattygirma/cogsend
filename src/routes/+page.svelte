<script lang="ts">
	import {
		CalendarClock,
		CalendarDays,
		CircleAlert,
		CircleCheck,
		Plus,
		Send,
		Users
	} from '@lucide/svelte';
	import AccountAvatar from '#lib/components/AccountAvatar.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Stat from '#lib/components/ui/Stat.svelte';
	import GetStartedCard from '#lib/components/onboarding/GetStartedCard.svelte';
	import UpcomingList from '#lib/components/ui/UpcomingList.svelte';
	import { accountLabel, platformName } from '#lib/domain/platforms.js';

	let { data } = $props();

	const firstName = $derived.by(() => {
		if (data.displayName?.trim()) return data.displayName.trim().split(/\s+/)[0];
		const local = (data.user?.email ?? '').split('@')[0] ?? '';
		if (!local) return 'there';
		return local.charAt(0).toUpperCase() + local.slice(1);
	});

	const greeting = $derived.by(() => {
		const hour = Number(
			new Intl.DateTimeFormat('en-US', {
				timeZone: data.timezone,
				hour: 'numeric',
				hourCycle: 'h23'
			}).format(new Date(data.now))
		);
		if (hour < 12) return 'Good morning';
		if (hour < 18) return 'Good afternoon';
		return 'Good evening';
	});

	const health = $derived.by(() => {
		if (data.stuckPublishing > 0) {
			const n = data.stuckPublishing;
			return { tone: 'bad' as const, label: `${n} post${n === 1 ? '' : 's'} stuck publishing` };
		}
		if (data.overdue > 0) {
			const n = data.overdue;
			return {
				tone: 'warn' as const,
				label: `${n} scheduled post${n === 1 ? '' : 's'} waiting to send`
			};
		}
		if (!data.schedulerOk) {
			// "Never ticked" is a different problem from "stopped ticking": nothing
			// has published a scheduled post yet, usually because the account had
			// no cron trigger left and nothing else calls the tick.
			return {
				tone: 'warn' as const,
				label: data.schedulerNeverTicked
					? 'Scheduled posts are not published yet'
					: 'Scheduler delayed'
			};
		}
		return { tone: 'ok' as const, label: 'All systems operational' };
	});

	const needsAttention = $derived(data.accounts.filter((a) => a.status !== 'active').length);
</script>

<PageHeader
	eyebrow="Overview"
	title="{greeting}, {firstName}"
	subtitle="Here's what's going out across your accounts."
>
	{#snippet actions()}
		<span title={data.schedulerError ?? undefined} data-testid="system-health">
			<Badge tone={health.tone} dot>{health.label}</Badge>
		</span>
		<a href="/calendar" class="btn btn-secondary"><CalendarDays class="h-4 w-4" /> Calendar</a>
		<a href="/compose" class="btn btn-primary"><Plus class="h-4 w-4" /> New post</a>
	{/snippet}
</PageHeader>

{#if data.onboarding && !data.onboarding.done}
	<GetStartedCard step={data.onboarding.step} />
{/if}

<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
	<Stat
		label="Scheduled"
		value={data.scheduledCount}
		hint="Waiting to go out"
		icon={CalendarClock}
		tone="accent"
		href="/calendar"
	/>
	<Stat
		label="Published"
		value={data.publishedThisWeek}
		hint="In the last 7 days"
		icon={Send}
		tone="ok"
		href="/posts?tab=published"
	/>
	<Stat
		label="Failed"
		value={data.failedCount}
		hint={data.failedCount ? 'Needs your attention' : 'Nothing to fix'}
		icon={data.failedCount ? CircleAlert : CircleCheck}
		tone={data.failedCount ? 'bad' : 'neutral'}
		href="/posts?tab=failed"
	/>
	<Stat
		label="Accounts"
		value={data.accounts.length}
		hint={needsAttention
			? `${needsAttention} need${needsAttention === 1 ? 's' : ''} reconnecting`
			: `${data.draftCount} draft${data.draftCount === 1 ? '' : 's'} in progress`}
		icon={Users}
		tone={needsAttention ? 'warn' : 'neutral'}
		href="/accounts"
	/>
</div>

<div class="mt-6 grid gap-6 lg:grid-cols-3">
	<Card
		title="Coming up"
		subtitle={data.upcoming.length ? 'The next posts on your schedule' : undefined}
		padded={false}
		class="min-w-0 lg:col-span-2"
	>
		{#snippet action()}
			<a href="/calendar" class="btn btn-ghost btn-sm">View calendar</a>
		{/snippet}
		{#if data.upcoming.length}
			<div class="pt-2 pb-1">
				<UpcomingList posts={data.upcoming} timeZone={data.timezone} />
			</div>
		{:else}
			<EmptyState title="Nothing scheduled yet" icon={CalendarClock}>
				Write a post and pick a time — it shows up here and on the calendar.
				{#snippet action()}
					<a href="/compose" class="btn btn-primary"><Plus class="h-4 w-4" /> Schedule a post</a>
				{/snippet}
			</EmptyState>
		{/if}
	</Card>

	<Card title="Accounts" subtitle="Where your posts go" padded={false} class="min-w-0">
		{#snippet action()}
			<a href="/accounts" class="btn btn-ghost btn-sm">Manage</a>
		{/snippet}
		{#if data.accounts.length}
			<ul class="divide-y divide-stone-100 pt-2" data-testid="dashboard-accounts">
				{#each data.accounts as account (account.id)}
					<li class="flex items-center gap-3 px-5 py-3">
						<AccountAvatar
							platform={account.platform}
							handle={account.handle}
							displayName={account.displayName}
							avatarUrl={account.avatarUrl}
							size={34}
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-stone-900">
								{accountLabel(account.displayName, account.handle)}
							</p>
							<p class="text-[12px] text-stone-500">{platformName(account.platform)}</p>
						</div>
						{#if account.status === 'active'}
							<Badge tone="ok" dot>Active</Badge>
						{:else}
							<Badge tone="warn" dot>Reconnect</Badge>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="p-4">
				<a href="/accounts" class="btn btn-secondary w-full"
					><Plus class="h-4 w-4" /> Connect account</a
				>
			</div>
		{:else}
			<EmptyState title="No accounts connected" icon={Users}>
				Connect YouTube, TikTok, Instagram, Facebook and more.
				{#snippet action()}
					<a href="/accounts" class="btn btn-primary"><Plus class="h-4 w-4" /> Connect account</a>
				{/snippet}
			</EmptyState>
		{/if}
	</Card>
</div>
