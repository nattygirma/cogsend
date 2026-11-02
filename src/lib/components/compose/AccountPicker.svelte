<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import AccountAvatar from '../AccountAvatar.svelte';
	import SocialIcon from '../SocialIcon.svelte';
	import { platformColorClass } from '../platform-color';
	import { accountLabel, displayHandle, platformName } from '#lib/domain/platforms.js';
	import type { Connection } from './types';

	interface Props {
		/** Every connected account, in display order. */
		accounts: Connection[];
		selected: Set<string>;
		/** Platforms some attachment would be refused by. */
		fitErrorPlatforms: Set<string>;
		/** The account being checked again, if any. */
		reconnecting: string | null;
		/** The selection menu: select all, clear, only, reconnect. */
		menuOpen: boolean;
		onMenuOpenChange: (open: boolean) => void;
		onToggle: (id: string) => void;
		onSelectAll: () => void;
		onClear: () => void;
		onSelectOnly: (id: string) => void;
		onReconnect: (id: string) => void;
	}

	let {
		accounts,
		selected,
		fitErrorPlatforms,
		reconnecting,
		menuOpen,
		onMenuOpenChange,
		onToggle,
		onSelectAll,
		onClear,
		onSelectOnly,
		onReconnect
	}: Props = $props();

	const selectedCount = $derived(accounts.filter((a) => selected.has(a.id)).length);
	const activeIds = $derived(
		accounts.filter((a) => !a.status || a.status === 'active').map((a) => a.id)
	);
	const needsReconnect = (a: Connection) => Boolean(a.status && a.status !== 'active');
</script>

<div class="flex items-start gap-3">
	<div class="flex flex-1 flex-wrap items-center gap-3" role="group" aria-label="Destinations">
		{#each accounts as account (account.id)}
			{@const isSelected = selected.has(account.id)}
			<button
				type="button"
				class="relative rounded-full transition {isSelected
					? 'ring-2 ring-accent ring-offset-2'
					: 'opacity-50 grayscale hover:opacity-90 hover:grayscale-0'}"
				onclick={() => onToggle(account.id)}
				aria-pressed={isSelected}
				title={`${platformName(account.platform)}: ${account.displayName || account.handle || ''}`}
			>
				<AccountAvatar
					platform={account.platform}
					handle={account.handle}
					displayName={account.displayName}
					avatarUrl={account.avatarUrl}
					size={48}
					title={accountLabel(account.displayName, account.handle) || undefined}
				/>
				{#if isSelected && fitErrorPlatforms.has(account.platform)}
					<span
						class="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white"
						data-fit="error"
						aria-hidden="true"
					></span>
					<span class="sr-only">(can't take this media)</span>
				{/if}
				{#if needsReconnect(account)}
					<span
						class="absolute -top-0.5 -left-0.5 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white"
						aria-hidden="true"
					></span>
					<span class="sr-only">(needs reconnect)</span>
				{/if}
			</button>
		{:else}
			<p class="py-3 text-sm text-stone-500">
				No accounts yet.
				<a href="/accounts" class="font-semibold text-accent hover:underline">Connect one</a> to start
				posting.
			</p>
		{/each}
	</div>

	{#if accounts.length}
		<div class="accounts-popover-container relative shrink-0">
			<button
				type="button"
				data-testid="destinations-toggle"
				class="flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
				onclick={() => onMenuOpenChange(!menuOpen)}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
			>
				<span>{selectedCount} selected</span>
				{#if fitErrorPlatforms.size}
					<span
						class="h-2 w-2 rounded-full bg-rose-500"
						data-testid="destinations-fit-dot"
						aria-hidden="true"
					></span>
					<span class="sr-only">— an account can't take this media</span>
				{/if}
				<ChevronDown class="h-3.5 w-3.5" />
			</button>
			{#if menuOpen}
				<div
					class="absolute top-full right-0 z-40 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgb(28_25_23/0.2)]"
					transition:slide={{ duration: 150 }}
				>
					<p class="px-2 py-1.5 text-xs text-stone-500">
						{selectedCount} of {accounts.length} accounts
					</p>
					<div class="grid grid-cols-2 gap-1 px-1 pb-1">
						<button
							type="button"
							onclick={onSelectAll}
							disabled={activeIds.every((id) => selected.has(id))}
							class="btn btn-secondary btn-sm">Select all</button
						>
						<button
							type="button"
							onclick={onClear}
							disabled={selectedCount === 0}
							class="btn btn-secondary btn-sm">Clear all</button
						>
					</div>
					{#each accounts as account (account.id)}
						{#if needsReconnect(account) || accounts.length > 1}
							<div
								class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] hover:bg-stone-50"
							>
								<SocialIcon
									platform={account.platform}
									className={`h-4 w-4 shrink-0 ${platformColorClass(account.platform)}`}
								/>
								<span class="min-w-0 flex-1 truncate text-stone-700"
									>{account.displayName ||
										displayHandle(account.handle) ||
										platformName(account.platform)}</span
								>
								{#if needsReconnect(account)}
									<button
										type="button"
										onclick={() => onReconnect(account.id)}
										disabled={reconnecting === account.id}
										class="font-semibold text-accent hover:underline"
									>
										{reconnecting === account.id ? 'Checking…' : 'Reconnect'}
									</button>
								{:else}
									<button
										type="button"
										onclick={() => onSelectOnly(account.id)}
										aria-label={`Select only ${account.displayName || account.handle || platformName(account.platform)}`}
										class="font-semibold text-stone-500 hover:text-stone-900">Only</button
									>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
