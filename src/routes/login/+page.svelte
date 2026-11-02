<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { CircleAlert, Eye, EyeOff, Sparkles } from '@lucide/svelte';
	import AuthShell from '#lib/components/auth/AuthShell.svelte';

	let { data } = $props();

	let email = $state('');
	let password = $state('');
	let remember = $state(true);
	let showPassword = $state(false);
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function onSubmit(e: Event) {
		e.preventDefault();
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, remember })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(body.error || 'Sign-in failed');
			await invalidateAll();
			await goto('/');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Sign-in failed';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>Sign in · {data.appName}</title></svelte:head>

<AuthShell appName={data.appName}>
	<h1 class="text-2xl font-semibold tracking-tight text-stone-900">Welcome back</h1>
	<p class="mt-1.5 text-sm text-stone-500">Sign in to schedule and publish your posts.</p>

	{#if data.firstAccount}
		<div
			class="mt-6 flex gap-3 rounded-xl border border-indigo-200 bg-accent-soft p-4 text-sm text-accent-ink"
			data-testid="first-account-prompt"
		>
			<Sparkles class="mt-0.5 h-4 w-4 shrink-0" />
			<p>
				This workspace has no accounts yet.
				<a href="/signup" class="font-semibold underline">Create the first one</a> — it becomes the workspace
				owner.
			</p>
		</div>
	{/if}

	<form onsubmit={onSubmit} class="card mt-6 space-y-4 p-6" data-testid="login-form">
		{#if error}
			<div
				class="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
				role="alert"
				data-testid="login-error"
			>
				<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				{error}
			</div>
		{/if}
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
					autocomplete="current-password"
					bind:value={password}
					class="field pr-11"
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
		</div>
		<label class="flex items-center gap-2 text-sm text-stone-600">
			<input type="checkbox" bind:checked={remember} class="h-4 w-4 rounded accent-indigo-600" />
			Keep me signed in
		</label>
		<button type="submit" class="btn btn-primary w-full" disabled={loading}>
			{loading ? 'Signing in…' : 'Sign in'}
		</button>
	</form>

	<p class="mt-6 text-center text-sm text-stone-500">
		New here? <a href="/signup" class="font-semibold text-accent hover:underline"
			>Create an account</a
		>
	</p>
</AuthShell>
