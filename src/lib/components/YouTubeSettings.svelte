<script lang="ts">
	import {
		YOUTUBE_MAX_TITLE,
		youtubeTitle,
		type YouTubeOptions,
		type YouTubePrivacy
	} from '#lib/domain/platform-options.js';

	let {
		options,
		text,
		onchange
	}: {
		options: YouTubeOptions;
		/** The post's YouTube text, whose first line stands in for an empty title. */
		text: string;
		onchange: (next: YouTubeOptions) => void;
	} = $props();

	const fallbackTitle = $derived(youtubeTitle({}, text));

	function update(patch: Partial<YouTubeOptions>) {
		onchange({ ...options, ...patch });
	}
</script>

<div data-testid="youtube-options">
	<div class="grid gap-4 sm:grid-cols-2">
		<label class="sm:col-span-2">
			<span class="field-label">Title</span>
			<input
				type="text"
				class="field"
				data-testid="youtube-title"
				value={options.title ?? ''}
				maxlength={YOUTUBE_MAX_TITLE}
				placeholder={fallbackTitle || 'Required'}
				oninput={(e) => update({ title: e.currentTarget.value || undefined })}
			/>
			<span class="mt-1.5 block text-xs text-stone-500"
				>Left empty, the post's first line is the title. The post becomes the description.</span
			>
		</label>
		<label>
			<span class="field-label">Visibility</span>
			<select
				class="field"
				data-testid="youtube-privacy"
				value={options.privacy ?? 'private'}
				onchange={(e) => update({ privacy: e.currentTarget.value as YouTubePrivacy })}
			>
				<option value="private">Private</option>
				<option value="unlisted">Unlisted</option>
				<option value="public">Public</option>
			</select>
		</label>
		<fieldset>
			<legend class="field-label">Made for kids?</legend>
			<div class="flex flex-col gap-2 pt-1 text-sm text-stone-800">
				<label class="flex items-center gap-2">
					<input
						type="radio"
						name="youtube-kids"
						data-testid="youtube-kids-no"
						checked={options.madeForKids === false}
						onchange={() => update({ madeForKids: false })}
					/>
					No, it's not made for kids
				</label>
				<label class="flex items-center gap-2">
					<input
						type="radio"
						name="youtube-kids"
						data-testid="youtube-kids-yes"
						checked={options.madeForKids === true}
						onchange={() => update({ madeForKids: true })}
					/>
					Yes, it's made for kids
				</label>
			</div>
		</fieldset>
		<label class="flex items-center gap-2 text-sm text-stone-800 sm:col-span-2">
			<input
				type="checkbox"
				data-testid="youtube-notify"
				checked={options.notifySubscribers !== false}
				onchange={(e) => update({ notifySubscribers: e.currentTarget.checked })}
			/>
			Notify subscribers
		</label>
	</div>
</div>
