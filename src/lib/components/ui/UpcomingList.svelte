<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import {
		STATUS_LABEL,
		STATUS_TONE,
		formatDay,
		formatTime,
		type CalendarPost
	} from '#lib/domain/calendar.js';
	import Badge from './Badge.svelte';
	import PlatformStack from './PlatformStack.svelte';

	let { posts, timeZone }: { posts: CalendarPost[]; timeZone: string } = $props();
</script>

<ul class="divide-y divide-stone-100" data-testid="upcoming-list">
	{#each posts as post (post.key)}
		<li>
			<a
				href="/compose?id={encodeURIComponent(post.draftId)}"
				class="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-stone-50"
			>
				<div class="w-20 shrink-0">
					<p class="text-[13px] font-semibold text-stone-900 tabular-nums">
						{formatTime(post.whenMs, timeZone)}
					</p>
					<p class="text-[12px] text-stone-500">{formatDay(post.whenMs, timeZone)}</p>
				</div>
				<p class="min-w-0 flex-1 truncate text-sm text-stone-700">{post.excerpt}</p>
				<PlatformStack platforms={post.platforms} />
				<span class="hidden sm:block">
					<Badge tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Badge>
				</span>
				<ChevronRight class="h-4 w-4 shrink-0 text-stone-300 group-hover:text-stone-500" />
			</a>
		</li>
	{/each}
</ul>
