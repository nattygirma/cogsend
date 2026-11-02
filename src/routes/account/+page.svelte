<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Crown, Laptop, ShieldAlert, UserRound } from '@lucide/svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { PASSWORD_MIN } from '#lib/domain/credentials.js';
	import { isValidProfilePictureUrl } from '#lib/domain/profile-settings.js';

	let { data } = $props();

	type Note = { tone: 'ok' | 'bad'; text: string } | null;

	// svelte-ignore state_referenced_locally
	let displayName = $state(data.displayName ?? '');
	// svelte-ignore state_referenced_locally
	let pictureUrl = $state(data.profilePictureUrl ?? '');
	// svelte-ignore state_referenced_locally
	let timezone = $state(data.timezone);
	let zones = $state<string[]>([]);
	let profileBusy = $state(false);
	let profileNote = $state<Note>(null);
	let pictureBroken = $state(false);

	// svelte-ignore state_referenced_locally
	let email = $state(data.email);
	let emailPassword = $state('');
	let emailBusy = $state(false);
	let emailNote = $state<Note>(null);

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordBusy = $state(false);
	let passwordNote = $state<Note>(null);

	let sessionsBusy = $state(false);
	let sessionsNote = $state<Note>(null);

	let deleteOpen = $state(false);
	let deletePassword = $state('');
	let deleteBusy = $state(false);
	let deleteNote = $state<Note>(null);

	const initials = $derived(
		(displayName.trim() || data.email)
			.split(/[\s@.]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part: string) => part[0]!.toUpperCase())
			.join('')
	);
	const ownerLocked = $derived(data.owner && data.otherAccounts > 0);

	onMount(() => {
		try {
			zones = Intl.supportedValuesOf('timeZone');
		} catch {
			zones = [data.timezone];
		}
		if (!zones.includes(data.timezone)) zones = [data.timezone, ...zones];
	});

	async function send(url: string, method: string, body: unknown) {
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		if (!res.ok) throw new Error(String(payload.error || 'Something went wrong'));
		return payload;
	}

	async function saveProfile(e: Event) {
		e.preventDefault();
		profileNote = null;
		const url = pictureUrl.trim();
		if (url && !isValidProfilePictureUrl(url)) {
			profileNote = { tone: 'bad', text: 'The picture must be an https:// image URL' };
			return;
		}
		profileBusy = true;
		try {
			await send('/api/settings', 'PATCH', {
				displayName,
				profilePictureUrl: url,
				timezone
			});
			profileNote = { tone: 'ok', text: 'Profile saved' };
			await invalidateAll();
		} catch (err) {
			profileNote = { tone: 'bad', text: (err as Error).message };
		} finally {
			profileBusy = false;
		}
	}

	async function saveEmail(e: Event) {
		e.preventDefault();
		emailNote = null;
		emailBusy = true;
		try {
			await send('/api/account', 'PATCH', { currentPassword: emailPassword, email });
			emailPassword = '';
			emailNote = { tone: 'ok', text: 'Email updated' };
			await invalidateAll();
		} catch (err) {
			emailNote = { tone: 'bad', text: (err as Error).message };
		} finally {
			emailBusy = false;
		}
	}

	async function savePassword(e: Event) {
		e.preventDefault();
		passwordNote = null;
		if (newPassword !== confirmPassword) {
			passwordNote = { tone: 'bad', text: 'The new passwords do not match' };
			return;
		}
		passwordBusy = true;
		try {
			await send('/api/account', 'PATCH', { currentPassword, newPassword });
			// A new password signs every session out, this one included.
			await invalidateAll();
			await goto('/login');
		} catch (err) {
			passwordNote = { tone: 'bad', text: (err as Error).message };
		} finally {
			passwordBusy = false;
		}
	}

	async function signOutOthers() {
		sessionsNote = null;
		sessionsBusy = true;
		try {
			const res = await fetch('/api/account/sessions', { method: 'DELETE' });
			const payload = (await res.json().catch(() => ({}))) as {
				signedOut?: number;
				error?: string;
			};
			if (!res.ok) throw new Error(payload.error || 'Could not sign out other devices');
			const n = payload.signedOut ?? 0;
			sessionsNote = {
				tone: 'ok',
				text: n
					? `Signed out ${n} other session${n === 1 ? '' : 's'}`
					: 'No other devices were signed in'
			};
		} catch (err) {
			sessionsNote = { tone: 'bad', text: (err as Error).message };
		} finally {
			sessionsBusy = false;
		}
	}

	async function deleteAccount() {
		deleteNote = null;
		deleteBusy = true;
		try {
			const payload = await send('/api/auth/me', 'DELETE', { password: deletePassword });
			if (payload.ok === false) {
				deleteNote = {
					tone: 'bad',
					text: String(payload.message ?? 'Still deleting — confirm again')
				};
				return;
			}
			deleteOpen = false;
			await invalidateAll();
			await goto('/signup');
		} catch (err) {
			deleteNote = { tone: 'bad', text: (err as Error).message };
		} finally {
			deleteBusy = false;
		}
	}
</script>

<svelte:head><title>Account · {data.appName}</title></svelte:head>

{#snippet note(n: Note)}
	{#if n}
		<span
			class="text-[13px] font-medium {n.tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}"
			role={n.tone === 'ok' ? 'status' : 'alert'}>{n.text}</span
		>
	{/if}
{/snippet}

<PageHeader
	eyebrow="Your account"
	title="Account"
	subtitle="Your profile, how you sign in, and the devices that are signed in."
>
	{#snippet actions()}
		{#if data.owner}
			<Badge tone="accent"><Crown class="h-3 w-3" /> Workspace owner</Badge>
		{:else}
			<Badge>Member</Badge>
		{/if}
	{/snippet}
</PageHeader>

<div class="grid max-w-3xl gap-6">
	<Card title="Profile" subtitle="How you appear in this workspace.">
		<form class="space-y-5" onsubmit={saveProfile} data-testid="account-profile">
			<div class="flex items-center gap-4">
				<span
					class="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-lg font-semibold text-accent-ink"
				>
					{#if initials}{initials}{:else}<UserRound class="h-6 w-6" />{/if}
					{#if pictureUrl.trim() && !pictureBroken}
						<img
							src={pictureUrl.trim()}
							alt=""
							referrerpolicy="no-referrer"
							class="absolute inset-0 h-full w-full object-cover"
							onerror={() => (pictureBroken = true)}
						/>
					{/if}
				</span>
				<div class="min-w-0 flex-1">
					<label for="picture" class="field-label">Profile picture URL</label>
					<input
						id="picture"
						type="url"
						class="field"
						placeholder="https://example.com/me.jpg"
						bind:value={pictureUrl}
						oninput={() => (pictureBroken = false)}
					/>
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="display-name" class="field-label">Display name</label>
					<input
						id="display-name"
						type="text"
						class="field"
						maxlength="80"
						autocomplete="name"
						placeholder="Your name"
						bind:value={displayName}
					/>
				</div>
				<div>
					<label for="timezone" class="field-label">Time zone</label>
					<select id="timezone" class="field" bind:value={timezone}>
						{#each zones.length ? zones : [timezone] as zone (zone)}
							<option value={zone}>{zone.replaceAll('_', ' ')}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
				<button type="submit" class="btn btn-primary" disabled={profileBusy}>
					{profileBusy ? 'Saving…' : 'Save profile'}
				</button>
				{@render note(profileNote)}
			</div>
		</form>
	</Card>

	{#if data.appkeep}
		<Card
			title="Sign-in and security"
			subtitle="Your email, password and devices are managed by appkeep."
		>
			<p class="text-sm text-stone-600" data-testid="appkeep-managed">
				You sign in to PostEasy with your appkeep account. Change your email or password, sign out
				of other devices, or delete your account from your appkeep dashboard.
			</p>
		</Card>
	{:else}
		<Card title="Email" subtitle="The address you sign in with.">
			<form class="space-y-4" onsubmit={saveEmail} data-testid="account-email">
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="email" class="field-label">Email</label>
						<input
							id="email"
							type="email"
							class="field"
							autocomplete="username"
							bind:value={email}
							required
						/>
					</div>
					<div>
						<label for="email-password" class="field-label">Current password</label>
						<input
							id="email-password"
							type="password"
							class="field"
							autocomplete="current-password"
							bind:value={emailPassword}
							required
						/>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<button
						type="submit"
						class="btn btn-secondary"
						disabled={emailBusy || email.trim().toLowerCase() === data.email}
					>
						{emailBusy ? 'Saving…' : 'Change email'}
					</button>
					{@render note(emailNote)}
				</div>
			</form>
		</Card>

		<Card title="Password" subtitle="Changing it signs you out everywhere, including here.">
			<form class="space-y-4" onsubmit={savePassword} data-testid="account-password">
				<div>
					<label for="current-password" class="field-label">Current password</label>
					<input
						id="current-password"
						type="password"
						class="field sm:max-w-sm"
						autocomplete="current-password"
						bind:value={currentPassword}
						required
					/>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="new-password" class="field-label">New password</label>
						<input
							id="new-password"
							type="password"
							class="field"
							autocomplete="new-password"
							minlength={PASSWORD_MIN}
							bind:value={newPassword}
							required
						/>
					</div>
					<div>
						<label for="confirm-password" class="field-label">Confirm new password</label>
						<input
							id="confirm-password"
							type="password"
							class="field"
							autocomplete="new-password"
							minlength={PASSWORD_MIN}
							bind:value={confirmPassword}
							required
						/>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<button type="submit" class="btn btn-secondary" disabled={passwordBusy}>
						{passwordBusy ? 'Saving…' : 'Change password'}
					</button>
					{@render note(passwordNote)}
				</div>
			</form>
		</Card>

		<Card title="Sessions" subtitle="Browsers and devices signed in to your account.">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<div class="flex items-center gap-3 text-sm text-stone-600">
					<span
						class="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-500"
					>
						<Laptop class="h-4 w-4" />
					</span>
					This device stays signed in. Everywhere else is signed out.
				</div>
				<button
					type="button"
					class="btn btn-secondary"
					onclick={signOutOthers}
					disabled={sessionsBusy}
					data-testid="sign-out-others"
				>
					{sessionsBusy ? 'Signing out…' : 'Sign out other devices'}
				</button>
			</div>
			{#if sessionsNote}<div class="mt-3">{@render note(sessionsNote)}</div>{/if}
		</Card>

		<section class="card border-rose-200 p-5" data-testid="danger-zone">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex gap-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"
					>
						<ShieldAlert class="h-4 w-4" />
					</span>
					<div>
						<h2 class="text-[15px] font-semibold text-stone-900">Delete account</h2>
						<p class="mt-0.5 max-w-md text-xs text-stone-500">
							{#if ownerLocked}
								You own this workspace and {data.otherAccounts} other
								{data.otherAccounts === 1 ? 'person has' : 'people have'} accounts here. The owner holds
								the platform apps and updates everyone relies on, so this account can be deleted only
								once they have deleted theirs.
							{:else}
								Permanently deletes your posts, connected accounts, media and API keys. This cannot
								be undone.
							{/if}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="btn btn-danger"
					disabled={ownerLocked}
					onclick={() => {
						deletePassword = '';
						deleteNote = null;
						deleteOpen = true;
					}}
				>
					Delete account
				</button>
			</div>
		</section>
	{/if}
</div>

<ConfirmDialog
	open={deleteOpen}
	idPrefix="delete-account-dialog"
	title="Delete your account?"
	body="Everything in it is deleted permanently. Enter your password to confirm."
	confirmLabel="Delete account"
	cancelLabel="Keep account"
	tone="danger"
	busy={deleteBusy}
	onConfirm={() => void deleteAccount()}
	onCancel={() => (deleteOpen = false)}
>
	{#snippet details()}
		<div class="space-y-2">
			<input
				type="password"
				class="field"
				autocomplete="current-password"
				placeholder="Password"
				aria-label="Password"
				bind:value={deletePassword}
			/>
			{#if deleteNote}<p class="text-[12px] font-medium text-rose-600" role="alert">
					{deleteNote.text}
				</p>{/if}
		</div>
	{/snippet}
</ConfirmDialog>
