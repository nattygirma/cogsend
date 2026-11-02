<script lang="ts">
	import {
		TIKTOK_PRIVACY_LABELS,
		tiktokDisclosureLabel,
		type TikTokOptions
	} from '#lib/domain/platform-options.js';
	import { formatDuration } from '#lib/domain/video-rules.js';

	type CreatorInfo = {
		nickname?: string;
		username?: string;
		privacyLevels: string[];
		commentDisabled?: boolean;
		duetDisabled?: boolean;
		stitchDisabled?: boolean;
		maxDurationSec?: number;
	};

	let {
		options,
		connectionIds,
		videoDurationMs = null,
		onchange
	}: {
		options: TikTokOptions;
		/** The TikTok accounts the post goes to. */
		connectionIds: string[];
		videoDurationMs?: number | null;
		onchange: (next: TikTokOptions) => void;
	} = $props();

	let creators = $state<Record<string, CreatorInfo | { error: string }>>({});
	let loading = $state(false);

	// TikTok's guidelines: the creator's details are read again every time
	// the settings are shown, never from a cache, and posting is blocked when
	// they say the account cannot post right now.
	async function loadCreators() {
		loading = true;
		const next: typeof creators = {};
		await Promise.all(
			connectionIds.map(async (id) => {
				try {
					const res = await fetch(`/api/connections/${id}/tiktok-creator`);
					const body = await res.json().catch(() => ({}));
					next[id] = res.ok ? (body as CreatorInfo) : { error: body.error || 'Unavailable' };
				} catch {
					next[id] = { error: 'Could not reach TikTok' };
				}
			})
		);
		creators = next;
		loading = false;
	}

	// Shown with the composer, and again whenever the TikTok accounts change.
	$effect(() => {
		void connectionIds.join(',');
		void loadCreators();
	});

	const infos = $derived(
		connectionIds
			.map((id) => creators[id])
			.filter((info): info is CreatorInfo => Boolean(info) && !('error' in info))
	);
	const failures = $derived(
		connectionIds
			.map((id) => creators[id])
			.filter((info): info is { error: string } => Boolean(info) && 'error' in info)
	);
	// Every selected account must offer the level, so the post can go to all.
	const privacyLevels = $derived(
		infos.length
			? infos
					.map((info) => info.privacyLevels)
					.reduce((shared, levels) => shared.filter((level) => levels.includes(level)))
			: []
	);
	const commentLocked = $derived(infos.some((info) => info.commentDisabled));
	const duetLocked = $derived(infos.some((info) => info.duetDisabled));
	const stitchLocked = $derived(infos.some((info) => info.stitchDisabled));
	const maxDurationSec = $derived(
		infos
			.map((info) => info.maxDurationSec)
			.filter((n): n is number => typeof n === 'number' && n > 0)
			.reduce<number | null>((min, n) => (min === null ? n : Math.min(min, n)), null)
	);
	const tooLong = $derived(
		maxDurationSec !== null && videoDurationMs !== null && videoDurationMs > maxDurationSec * 1000
	);
	const label = $derived(tiktokDisclosureLabel(options));

	function update(patch: Partial<TikTokOptions>) {
		onchange({ ...options, ...patch });
	}
</script>

<div data-testid="tiktok-options">
	<div class="flex flex-col gap-4 text-sm">
		{#if loading && !infos.length}
			<p class="text-stone-500">Checking with TikTok…</p>
		{/if}
		{#each infos as info, i (i)}
			<p class="text-stone-800" data-testid="tiktok-creator">
				Posting as <strong>{info.nickname || info.username}</strong>
			</p>
		{/each}
		{#each failures as failure, i (i)}
			<p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-700">
				This account cannot post to TikTok right now: {failure.error}
			</p>
		{/each}

		<div class="grid gap-4 sm:grid-cols-2">
			<label>
				<span class="field-label">Who can watch this video</span>
				<select
					class="field"
					data-testid="tiktok-privacy"
					value={options.privacyLevel ?? ''}
					onchange={(e) => update({ privacyLevel: e.currentTarget.value || undefined })}
				>
					<option value="" disabled>Choose…</option>
					{#each privacyLevels as level (level)}
						<option
							value={level}
							disabled={level === 'SELF_ONLY' && Boolean(options.brandedContent)}
							>{TIKTOK_PRIVACY_LABELS[level] ?? level}</option
						>
					{/each}
				</select>
				{#if options.brandedContent}
					<span class="mt-1.5 block text-xs text-stone-500">Branded content can't be private.</span>
				{/if}
			</label>

			<fieldset>
				<legend class="field-label">Allow users to</legend>
				<div class="flex flex-wrap gap-x-4 gap-y-2 pt-1">
					<label
						class="flex items-center gap-2 {commentLocked ? 'text-stone-400' : 'text-stone-800'}"
					>
						<input
							type="checkbox"
							data-testid="tiktok-comment"
							disabled={commentLocked}
							checked={!commentLocked && options.allowComment === true}
							onchange={(e) => update({ allowComment: e.currentTarget.checked })}
						/>
						Comment
					</label>
					<label class="flex items-center gap-2 {duetLocked ? 'text-stone-400' : 'text-stone-800'}">
						<input
							type="checkbox"
							data-testid="tiktok-duet"
							disabled={duetLocked}
							checked={!duetLocked && options.allowDuet === true}
							onchange={(e) => update({ allowDuet: e.currentTarget.checked })}
						/>
						Duet
					</label>
					<label
						class="flex items-center gap-2 {stitchLocked ? 'text-stone-400' : 'text-stone-800'}"
					>
						<input
							type="checkbox"
							data-testid="tiktok-stitch"
							disabled={stitchLocked}
							checked={!stitchLocked && options.allowStitch === true}
							onchange={(e) => update({ allowStitch: e.currentTarget.checked })}
						/>
						Stitch
					</label>
				</div>
			</fieldset>
		</div>

		<fieldset class="rounded-lg border border-stone-200 p-3">
			<label class="flex items-center gap-2 font-semibold text-stone-900">
				<input
					type="checkbox"
					data-testid="tiktok-disclose"
					checked={options.discloseCommercial === true}
					onchange={(e) =>
						update(
							e.currentTarget.checked
								? { discloseCommercial: true }
								: { discloseCommercial: false, brandOrganic: false, brandedContent: false }
						)}
				/>
				Disclose commercial content
			</label>
			{#if options.discloseCommercial}
				<div class="mt-2 ml-6 flex flex-col gap-2">
					<label class="flex items-center gap-2 text-stone-800">
						<input
							type="checkbox"
							data-testid="tiktok-brand-organic"
							checked={options.brandOrganic === true}
							onchange={(e) => update({ brandOrganic: e.currentTarget.checked })}
						/>
						Your brand
					</label>
					<label class="flex items-center gap-2 text-stone-800">
						<input
							type="checkbox"
							data-testid="tiktok-branded"
							checked={options.brandedContent === true}
							onchange={(e) =>
								update(
									e.currentTarget.checked && options.privacyLevel === 'SELF_ONLY'
										? { brandedContent: true, privacyLevel: undefined }
										: { brandedContent: e.currentTarget.checked }
								)}
						/>
						Branded content
					</label>
					{#if label}
						<span class="text-xs text-stone-500">Your video will be labeled "{label}".</span>
					{:else}
						<span class="text-xs font-medium text-rose-600"
							>Choose at least one to post with the disclosure on.</span
						>
					{/if}
				</div>
			{/if}
		</fieldset>

		<label class="flex items-center gap-2 text-stone-800">
			<input
				type="checkbox"
				data-testid="tiktok-aigc"
				checked={options.aiGenerated === true}
				onchange={(e) => update({ aiGenerated: e.currentTarget.checked })}
			/>
			AI-generated content
		</label>

		{#if tooLong && maxDurationSec !== null}
			<p class="font-medium text-rose-600">
				This account can post videos up to {formatDuration(maxDurationSec * 1000)}.
			</p>
		{/if}

		<p class="text-xs text-stone-500" data-testid="tiktok-consent">
			By posting, you agree to TikTok's
			{#if options.brandedContent}
				<a
					class="underline"
					href="https://www.tiktok.com/legal/page/global/bc-policy/en"
					target="_blank"
					rel="noopener noreferrer">Branded Content Policy</a
				> and
			{/if}
			<a
				class="underline"
				href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
				target="_blank"
				rel="noopener noreferrer">Music Usage Confirmation</a
			>. After you publish, it may take a few minutes for the video to appear on TikTok.
		</p>
	</div>
</div>
