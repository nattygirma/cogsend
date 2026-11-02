<script lang="ts">
	import { Globe, Plus, X } from '@lucide/svelte';
	import AccountAvatar from '../AccountAvatar.svelte';
	import { accountLabel, platformName, type PlatformId } from '#lib/domain/platforms.js';
	import type { Connection } from './types';

	interface Props {
		/** 'global' edits the text every platform gets. */
		activeTab: 'global' | PlatformId;
		/** Platforms with their own text, and the account each tab shows. */
		tabs: Array<{ platform: PlatformId; account: Connection | undefined; overLimit: boolean }>;
		editLocked: boolean;
		canAdd: boolean;
		addOpen: boolean;
		/** Selected accounts whose platform still shares the text. */
		addable: Connection[];
		onSelect: (tab: 'global' | PlatformId) => void;
		onAddOpenChange: (open: boolean) => void;
		onAdd: (accountId: string) => void;
		onReset: (platform: PlatformId) => void;
	}

	let {
		activeTab,
		tabs,
		editLocked,
		canAdd,
		addOpen,
		addable,
		onSelect,
		onAddOpenChange,
		onAdd,
		onReset
	}: Props = $props();
</script>

<div class="override-dropdown-container flex flex-wrap items-center gap-2.5">
	<button
		type="button"
		data-testid="editor-tab-global"
		aria-pressed={activeTab === 'global'}
		aria-label="Edit the text for all platforms"
		title="All platforms"
		class="flex h-11 w-11 items-center justify-center rounded-xl border-2 transition-colors {activeTab ===
		'global'
			? 'border-accent bg-accent-soft text-accent'
			: 'border-stone-200 bg-white text-stone-500 hover:border-stone-300'}"
		onclick={() => onSelect('global')}
	>
		<Globe class="h-5 w-5" />
	</button>

	{#each tabs as tab (tab.platform)}
		{@const label = tab.account?.displayName || tab.account?.handle || platformName(tab.platform)}
		<div class="relative">
			<button
				type="button"
				data-testid="editor-tab-{tab.platform}"
				aria-pressed={activeTab === tab.platform}
				aria-label={`Edit ${platformName(tab.platform)}'s own text (${label})`}
				title={label}
				class="flex h-11 w-11 items-center justify-center rounded-xl border-2 transition-colors {activeTab ===
				tab.platform
					? 'border-accent bg-accent-soft'
					: tab.overLimit
						? 'border-rose-300 bg-white'
						: 'border-transparent bg-white hover:border-stone-200'}"
				onclick={() => onSelect(tab.platform)}
			>
				<AccountAvatar
					platform={tab.platform}
					handle={tab.account?.handle ?? null}
					displayName={tab.account?.displayName ?? null}
					avatarUrl={tab.account?.avatarUrl ?? null}
					size={32}
				/>
			</button>
			{#if tab.overLimit}
				<span
					class="absolute -top-1 -left-1 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white"
					role="img"
					aria-label={`${platformName(tab.platform)} over character limit`}
				></span>
			{:else if !editLocked}
				<button
					type="button"
					data-testid="reset-platform-tab"
					class="absolute -top-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white ring-2 ring-white hover:bg-rose-600"
					title="Stop customizing: use the text for all platforms"
					aria-label={`Stop customizing ${platformName(tab.platform)}`}
					onclick={() => onReset(tab.platform)}
				>
					<X class="h-2.5 w-2.5" strokeWidth={3} />
				</button>
			{/if}
		</div>
	{/each}

	{#if canAdd && !editLocked}
		<button
			type="button"
			data-testid="add-override-toggle"
			class="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-700"
			aria-expanded={addOpen}
			aria-label="Customize the text for one platform"
			title="Customize for one platform"
			onclick={(e) => {
				e.stopPropagation();
				onAddOpenChange(!addOpen);
			}}
		>
			<Plus class="h-4 w-4" />
		</button>
		{#if addOpen}
			<div
				data-testid="override-menu"
				class="flex flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2 py-1.5"
				role="group"
				aria-label="Customize the text for"
			>
				{#each addable as account (account.id)}
					<button
						type="button"
						class="rounded-full opacity-80 transition hover:opacity-100"
						onclick={() => onAdd(account.id)}
					>
						<AccountAvatar
							platform={account.platform}
							handle={account.handle}
							displayName={account.displayName}
							avatarUrl={account.avatarUrl}
							size={30}
							title={accountLabel(account.displayName, account.handle) || undefined}
						/>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>
