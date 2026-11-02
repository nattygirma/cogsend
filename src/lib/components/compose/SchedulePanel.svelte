<script lang="ts">
	import { Calendar } from '@lucide/svelte';
	import { fly } from 'svelte/transition';

	let {
		hasSchedule,
		mode,
		relativeValue,
		relativeUnit,
		date,
		time,
		onModeChange,
		onRelativeInput,
		onDateChange,
		onTimeChange,
		minDate,
		tzShort,
		preview,
		busy,
		onTouched,
		onRelativeChange,
		onConfirm
	}: {
		hasSchedule: boolean;
		mode: 'relative' | 'absolute';
		relativeValue: string;
		relativeUnit: 'hours' | 'days' | 'mins';
		date: string;
		time: string;
		onModeChange: (mode: 'relative' | 'absolute') => void;
		onRelativeInput: (value: string, unit: 'hours' | 'days' | 'mins') => void;
		onDateChange: (date: string) => void;
		onTimeChange: (time: string) => void;
		minDate: string;
		tzShort: string;
		preview: string | null;
		busy: boolean;
		/** The person picked a time themselves, so a reopen keeps it. */
		onTouched: () => void;
		/** Re-derive the date and time from "publish in N units". */
		onRelativeChange: () => void;
		onConfirm: () => void;
	} = $props();

	const input =
		'rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[13px] font-bold text-stone-900 transition-colors focus:border-stone-400 focus:bg-white focus:outline-none pointer-coarse:text-base';
</script>

<div
	data-testid="schedule-panel"
	class="absolute right-0 bottom-full z-40 mb-3 w-72 origin-bottom-right rounded-xl border border-stone-200 bg-white p-3 text-stone-900 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.2)]"
	transition:fly={{ y: 10, duration: 250, opacity: 0 }}
	role="dialog"
	aria-label="Schedule post"
>
	<div class="flex items-center gap-2 px-2 pt-2 pb-3">
		<Calendar class="h-4 w-4 text-stone-900" />
		<h4 class="text-[14px] font-extrabold text-stone-900">
			{hasSchedule ? 'Reschedule' : 'Schedule Post'}
		</h4>
	</div>

	<div class="mx-1 mb-4 flex rounded-lg bg-stone-100 p-1">
		<button
			type="button"
			class="flex-1 rounded-md py-1.5 text-[12px] font-bold transition-colors {mode === 'relative'
				? 'bg-white text-stone-900 shadow-sm'
				: 'text-stone-500 hover:text-stone-900'}"
			onclick={() => {
				onModeChange('relative');
				onTouched();
				onRelativeChange();
			}}
		>
			Relative
		</button>
		<button
			type="button"
			class="flex-1 rounded-md py-1.5 text-[12px] font-bold transition-colors {mode === 'absolute'
				? 'bg-white text-stone-900 shadow-sm'
				: 'text-stone-500 hover:text-stone-900'}"
			onclick={() => onModeChange('absolute')}
		>
			Specific Date
		</button>
	</div>

	{#if mode === 'relative'}
		<div class="mb-4 flex flex-col gap-2 px-1" data-testid="schedule-offsets">
			<span class="text-[10px] font-bold tracking-widest text-stone-500 uppercase">Publish in</span>
			<label class="flex items-center gap-2">
				<input
					type="number"
					min="1"
					data-testid="schedule-offset-value"
					aria-label="Publish in amount"
					value={relativeValue}
					oninput={(e) => {
						onRelativeInput(e.currentTarget.value, relativeUnit);
						onTouched();
						onRelativeChange();
					}}
					class="w-20 text-center {input}"
				/>
				<select
					data-testid="schedule-offset-unit"
					aria-label="Publish in unit"
					value={relativeUnit}
					onchange={(e) => {
						onRelativeInput(relativeValue, e.currentTarget.value as 'hours' | 'days' | 'mins');
						onTouched();
						onRelativeChange();
					}}
					class="flex-1 appearance-none {input}"
				>
					<option value="mins">Minutes</option>
					<option value="hours">Hours</option>
					<option value="days">Days</option>
				</select>
			</label>
		</div>
	{:else}
		<div class="mb-4 flex flex-col gap-2 px-1">
			<span class="text-[10px] font-bold tracking-widest text-stone-500 uppercase"
				>Publish at ({tzShort})</span
			>
			<!-- At the 16px a touch screen needs, the two pickers no longer fit
			     side by side in the popover. -->
			<div class="flex gap-2 pointer-coarse:flex-col">
				<div class="flex-1">
					<input
						type="date"
						data-testid="schedule-date"
						value={date}
						oninput={(e) => {
							onDateChange(e.currentTarget.value);
							onTouched();
						}}
						min={minDate}
						aria-label="Schedule date"
						class="w-full {input}"
					/>
				</div>
				<div class="flex-1">
					<input
						type="time"
						data-testid="schedule-time"
						value={time}
						oninput={(e) => {
							onTimeChange(e.currentTarget.value);
							onTouched();
						}}
						aria-label="Schedule time"
						class="w-full {input}"
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if preview}
		<p
			data-testid="schedule-preview"
			class="mb-3 px-2 text-center text-[12px] font-bold text-stone-500"
		>
			Will publish {preview}
		</p>
	{/if}

	<button
		type="button"
		data-testid="schedule-confirm"
		class="btn btn-primary w-full"
		disabled={busy}
		onclick={onConfirm}
	>
		{hasSchedule ? 'Update schedule' : 'Confirm Schedule'}
	</button>
</div>
