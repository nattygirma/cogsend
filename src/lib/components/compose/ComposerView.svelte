<script lang="ts">
	import { isPlatformCustomized, type PlatformId } from '#lib/domain/platform-sync.js';
	import { composeSession } from '#lib/components/compose-session.svelte.js';
	import PostStatusBanner from '../PostStatusBanner.svelte';
	import { Plus, X } from '@lucide/svelte';
	import PostEditor from './PostEditor.svelte';
	import ChecksLine from './ChecksLine.svelte';
	import PostPreview from './PostPreview.svelte';
	import PlatformPreviews from './preview/PlatformPreviews.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import AccountPicker from './AccountPicker.svelte';
	import CustomizeTabs from './CustomizeTabs.svelte';
	import ComposerFooter from './ComposerFooter.svelte';
	import PublishConfirm from './PublishConfirm.svelte';
	import SchedulePanel from './SchedulePanel.svelte';
	import type { Composer } from './hooks/composer';

	/** The composer’s two panes and footer, drawn from the composer’s state. */
	let { ed }: { ed: Composer } = $props();
</script>

<svelte:window onclick={ed.handleWindowClick} />

{#snippet preview()}
	{#if ed.accountPreviews.length}
		<PlatformPreviews
			previews={ed.accountPreviews}
			focus={ed.activeTab}
			youtube={ed.youtubePreview}
			mediaSrc={ed.mediaSrc}
			isVideoItem={ed.isVideoItem}
		/>
	{:else}
		<PostPreview
			posts={ed.segments.map((text, index) => ({ text, media: ed.cardMedia(index) }))}
			identity={ed.previewIdentity}
			mediaSrc={ed.mediaSrc}
			isVideoItem={ed.isVideoItem}
		/>
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col" data-testid="thread-preview">
	<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
		<section
			class="flex min-h-0 flex-1 flex-col lg:w-[60%] lg:flex-none lg:border-r lg:border-stone-200"
			aria-labelledby="composer-title"
		>
			<header
				class="flex h-16 shrink-0 items-center gap-3 border-b border-stone-200 bg-stone-50 px-6"
			>
				<h1 id="composer-title" class="text-lg font-semibold tracking-tight text-stone-900">
					Create Post
				</h1>
				{#if composeSession.hasContent}
					<button
						type="button"
						data-testid="write-new-post"
						class="btn btn-ghost btn-sm ml-auto"
						onclick={() => void ed.startNewPost()}
						title="Save this post to drafts and start a new one"
					>
						<Plus class="h-4 w-4" /> New post
					</button>
				{/if}
				<button
					type="button"
					class="btn btn-ghost btn-sm px-2 lg:hidden {composeSession.hasContent ? '' : 'ml-auto'}"
					aria-label="Close composer"
					onclick={ed.onClose}
				>
					<X class="h-5 w-5" />
				</button>
			</header>

			<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
				{#if ed.loadFailedId}
					<div
						role="alert"
						data-testid="draft-load-error"
						class="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
					>
						<p class="min-w-0 flex-1 text-[13px] font-medium text-amber-900">
							This draft could not be loaded. Saving is paused so an empty editor cannot overwrite
							the stored copy. Retry loads it, replacing anything typed here.
						</p>
						<button
							type="button"
							disabled={ed.loadingDraftId !== null}
							onclick={() => {
								const id = ed.loadFailedId;
								if (id) void ed.loadDraft(id);
							}}
							class="rounded-full border border-amber-300 bg-white px-4 py-1.5 text-[12px] font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
						>
							{ed.loadingDraftId !== null ? 'Loading…' : 'Retry'}
						</button>
					</div>
				{/if}
				{#if ed.publishedLock}
					<div
						role="status"
						data-testid="published-lock"
						class="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
					>
						<p class="min-w-0 flex-1 text-[13px] font-medium text-amber-900">
							This post is already published, so it can't be edited.{ed.dirty
								? " Your last changes weren't saved."
								: ''}
						</p>
						<button
							type="button"
							data-testid="duplicate-published"
							disabled={ed.duplicating}
							onclick={() => void ed.duplicatePublished()}
							class="rounded-full border border-amber-300 bg-white px-4 py-1.5 text-[12px] font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
						>
							{ed.duplicating ? 'Duplicating…' : 'Duplicate to post again'}
						</button>
					</div>
				{/if}
				{#if ed.showPostStatus}
					<PostStatusBanner
						post={ed.postState}
						now={new Date(ed.clock)}
						nameOf={ed.destinationName}
						drift={ed.drift}
						sending={ed.sendingNow}
						dirty={ed.dirty}
						unscheduling={ed.unscheduling}
						busy={ed.publishing || ed.unscheduling}
						onChangeTime={ed.showSchedule}
						onUnschedule={() => void ed.unschedulePost()}
						onApplyAccounts={ed.showSchedule}
					/>
				{/if}
				{#if !ed.editLocked && ed.checksRevealed && ed.composeCheckList.length}
					<div class="lg:hidden">
						<ChecksLine
							checks={ed.composeCheckList}
							selectedPlatforms={ed.selectedPlatforms}
							onUncheck={ed.uncheckPlatform}
						/>
					</div>
				{/if}
				{#if !ed.editLocked}
					<AccountPicker
						accounts={ed.sortedConnections}
						selected={ed.selected}
						fitErrorPlatforms={ed.fitErrorPlatforms}
						reconnecting={ed.reconnecting}
						menuOpen={ed.isAccountsPopoverOpen}
						onMenuOpenChange={(open) => (ed.isAccountsPopoverOpen = open)}
						onToggle={ed.toggleAccountSelection}
						onSelectAll={ed.selectAllAccounts}
						onClear={ed.clearSelection}
						onSelectOnly={ed.selectOnly}
						onReconnect={(id) => void ed.verifyConnection(id)}
					/>
				{/if}
				<CustomizeTabs
					activeTab={ed.activeTab}
					tabs={ed.tabs
						.filter((t): t is PlatformId => t !== 'global')
						.map((platform) => ({
							platform,
							account: ed.representativeAccount(platform),
							overLimit: ed.getPlatformStatus(platform).hasError
						}))}
					editLocked={ed.editLocked}
					canAdd={ed.canAddOverride}
					addOpen={ed.isAddOverrideOpen}
					addable={ed.selectedAccounts.filter(
						(a) => !isPlatformCustomized(ed.overrides, a.platform as PlatformId)
					)}
					onSelect={(tab) => (ed.activeTab = tab)}
					onAddOpenChange={(open) => (ed.isAddOverrideOpen = open)}
					onAdd={ed.addOverride}
					onReset={ed.resetToGlobal}
				/>
				<PostEditor ctx={ed.segmentCtx} />
				{#if !ed.editLocked && ed.hasPlatformSettings}
					<SettingsPanel
						platforms={ed.settingsPlatforms}
						required={ed.requiredSettings}
						open={ed.settingsOpen}
						onOpenChange={(open) => (ed.settingsOpen = open)}
						youtube={ed.youtubeOptions}
						youtubeText={ed.youtubeText}
						onYouTubeChange={(next) => {
							ed.youtubeOptions = next;
							ed.markDirty();
						}}
						tiktok={ed.tiktokOptions}
						tiktokConnectionIds={[...ed.selected].filter((id) => ed.platformOf(id) === 'tiktok')}
						videoDurationMs={ed.media.find(ed.isVideoItem)?.meta?.durationMs ?? null}
						onTikTokChange={(next) => {
							ed.tiktokOptions = next;
							ed.markDirty();
						}}
					/>
				{/if}
				<div class="lg:hidden">
					<button
						type="button"
						class="btn btn-secondary btn-sm w-full"
						aria-expanded={ed.previewOpen}
						onclick={() => (ed.previewOpen = !ed.previewOpen)}
					>
						{ed.previewOpen ? 'Hide preview' : 'Preview'}
					</button>
					{#if ed.previewOpen}
						<div class="mt-4">
							{@render preview()}
						</div>
					{/if}
				</div>
			</div>
		</section>

		<section class="hidden min-h-0 flex-col lg:flex lg:w-[40%]" aria-labelledby="preview-title">
			<header
				class="flex h-16 shrink-0 items-center justify-between border-b border-stone-200 bg-stone-50 px-6"
			>
				<h2 id="preview-title" class="text-lg font-semibold tracking-tight text-stone-900">
					Post Preview
				</h2>
				<button
					type="button"
					class="btn btn-ghost btn-sm px-2"
					aria-label="Close composer"
					onclick={ed.onClose}
				>
					<X class="h-5 w-5" />
				</button>
			</header>
			<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
				{#if !ed.editLocked && ed.checksRevealed && ed.composeCheckList.length}
					<ChecksLine
						checks={ed.composeCheckList}
						selectedPlatforms={ed.selectedPlatforms}
						onUncheck={ed.uncheckPlatform}
					/>
				{/if}
				{@render preview()}
			</div>
		</section>
	</div>

	{#if !ed.editLocked}
		<ComposerFooter
			saveIndicator={ed.saveIndicator}
			saving={ed.saving}
			onRetrySave={() => void ed.persistAll()}
			canShare={ed.canShare}
			draftId={ed.draftId}
			ensureSaved={ed.persistForAction}
			scheduleOpen={ed.scheduleOpen}
			scheduleLabel={ed.scheduleButtonLabel}
			busy={ed.publishing || ed.unscheduling}
			onOpenSchedule={ed.openSchedule}
			canSaveDraft={!ed.saving && (ed.draftId !== null || ed.baseBody.trim() !== '')}
			onSaveDraft={() => void ed.saveAsDraft()}
			publishBusy={ed.publishButtonBusy}
			publishLabel={ed.publishButtonLabel}
			onPublish={() => void ed.onPublish()}
		>
			{#snippet popovers()}
				{#if ed.isPostConfirmOpen && ed.pendingPublish}
					<PublishConfirm
						accounts={ed.pendingAccounts}
						replacesSchedule={ed.publishReplacesSchedule}
						unscheduledNames={ed.unscheduledByPublish.map(ed.destinationName)}
						saving={ed.pendingPublish.saving}
						ready={Boolean(ed.pendingPublish.draftId)}
						skipAsk={ed.skipAsk}
						onConfirm={ed.confirmPublish}
						onDismiss={() => ed.dismissPostConfirm()}
						onSkipAskChange={(skip) => {
							ed.skipAsk = skip;
							ed.setLocalFlag(ed.SKIP_ASK_KEY, skip);
						}}
					/>
				{/if}
				{#if ed.scheduleOpen}
					<SchedulePanel
						hasSchedule={ed.hasSchedule}
						mode={ed.scheduleMode}
						relativeValue={ed.relativeValue}
						relativeUnit={ed.relativeUnit}
						date={ed.schedDate}
						time={ed.schedTime}
						onModeChange={(mode) => (ed.scheduleMode = mode)}
						onRelativeInput={(value, unit) => {
							ed.relativeValue = value;
							ed.relativeUnit = unit;
						}}
						onDateChange={(date) => (ed.schedDate = date)}
						onTimeChange={(time) => (ed.schedTime = time)}
						minDate={ed.minSchedDate}
						tzShort={ed.tzShort}
						preview={ed.schedulePreview}
						busy={ed.publishing || ed.unscheduling}
						onTouched={() => (ed.scheduleTouched = true)}
						onRelativeChange={ed.applyRelativeFields}
						onConfirm={() => void ed.onSchedule()}
					/>
				{/if}
			{/snippet}
		</ComposerFooter>
	{/if}
</div>
