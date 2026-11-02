<script lang="ts">
	import { CalendarDays } from '@lucide/svelte';

	interface Props {
		/** The scheduled or picked time, or null when none is set yet. */
		label: string | null;
		open: boolean;
		disabled: boolean;
		onClick: () => void;
	}

	let { label, open, disabled, onClick }: Props = $props();
</script>

<button
	type="button"
	data-testid="schedule-toggle"
	class="btn btn-secondary h-11 px-4 tabular-nums"
	aria-expanded={open}
	{disabled}
	onclick={onClick}
	title={label ? 'Change the time' : 'Pick a time'}
>
	<CalendarDays class="h-4 w-4 text-stone-500" />
	<span class="hidden sm:inline">{label ?? 'Pick a time'}</span>
	<span class="sr-only sm:hidden">{label ?? 'Pick a time'}</span>
</button>
