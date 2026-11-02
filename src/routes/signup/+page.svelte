<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { CircleAlert, Eye, EyeOff } from '@lucide/svelte';
	import AuthShell from '#lib/components/auth/AuthShell.svelte';
	import { PASSWORD_MIN } from '#lib/domain/credentials.js';

	let { data } = $props();

	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function onSubmit(e: Event) {
		e.preventDefault();
		error = null;
		if (password.length < PASSWORD_MIN) {
			error = `Password must be at least ${PASSWORD_MIN} characters`;
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName, email, password })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(body.error || 'Could not create the account');
			await invalidateAll();
			await goto('/accounts');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create the account';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>Create your account · {data.appName}</title></svelte:head>

<AuthShell appName={data.appName}>
	<h1 class="text-2xl font-semibold tracking-tight text-stone-900">Create your account</h1>
	<p class="mt-1.5 text-sm text-stone-500">
		{data.firstAccount
			? 'You are the first one here, so this account will own the workspace.'
			: 'Connect your social accounts and start scheduling in minutes.'}
	</p>

	<form onsubmit={onSubmit} class="card mt-6 space-y-4 p-6" data-testid="signup-form">
		{#if error}
			<div
				class="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
				role="alert"
				data-testid="signup-error"
			>
				<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				{error}
			</div>
		{/if}
		<div>
			<label for="name" class="field-label">Name</label>
			<input
				id="name"
				type="text"
				autocomplete="name"
				placeholder="Ada Lovelace"
				bind:value={displayName}
				class="field"
				maxlength="80"
			/>
		</div>
		<div>
			<label for="email" class="field-label">Email</label>
			<input
				id="email"
				type="email"
				autocomplete="email"
				placeholder="you@example.com"
				bind:value={email}
				class="field"
				required
			/>
		</div>
		<div>
			<label for="password" class="field-label">Password</label>
			<div class="relative">
				<input
					id="password"
					type={showPassword ? 'text' : 'password'}
					autocomplete="new-password"
					bind:value={password}
					class="field pr-11"
					minlength={PASSWORD_MIN}
					required
				/>
				<button
					type="button"
					class="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-stone-400 hover:text-stone-700"
					aria-label={showPassword ? 'Hide password' : 'Show password'}
					onclick={() => (showPassword = !showPassword)}
				>
					{#if showPassword}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
				</button>
			</div>
			<p class="mt-1.5 text-xs text-stone-500">At least {PASSWORD_MIN} characters.</p>
		</div>
		<button type="submit" class="btn btn-primary w-full" disabled={loading}>
			{loading ? 'Creating account…' : 'Create account'}
		</button>
	</form>

	<p class="mt-6 text-center text-sm text-stone-500">
		Already have an account? <a href="/login" class="font-semibold text-accent hover:underline"
			>Sign in</a
		>
	</p>
</AuthShell>
