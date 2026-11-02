<script lang="ts">
	import { Bot, Info } from '@lucide/svelte';
	import { AGENTS, agentSnippets, mcpUrlFor } from '#lib/domain/agent-setup.js';
	import ApiKeyCard from './ApiKeyCard.svelte';
	import SnippetBlock from './SnippetBlock.svelte';
	import type { Onboarding } from './use-onboarding.svelte.js';

	interface Props {
		guide: Onboarding;
	}

	let { guide }: Props = $props();

	const current = $derived(AGENTS.find((a) => a.id === guide.agent) ?? AGENTS[0]);
	const snippets = $derived(agentSnippets(guide.agent, guide.appUrl, guide.newKey));
</script>

<div class="mx-auto max-w-3xl">
	<div class="mb-6 text-center">
		<h2 class="text-2xl font-semibold tracking-tight text-stone-900">Connect your AI agent</h2>
		<p class="mt-2 text-sm text-stone-500">
			Pick the agent you use and let it create and schedule posts for you
		</p>
	</div>

	<div
		class="-mx-1 mb-5 flex [scrollbar-width:none] gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:justify-center"
		role="tablist"
		aria-label="Agents"
	>
		{#each AGENTS as agent (agent.id)}
			{@const on = agent.id === guide.agent}
			<button
				type="button"
				role="tab"
				aria-selected={on}
				class="shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors {on
					? 'border-accent bg-accent text-white'
					: 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900'}"
				onclick={() => (guide.agent = agent.id)}
			>
				{agent.label}
			</button>
		{/each}
	</div>

	<div class="space-y-4">
		<ApiKeyCard
			activeKey={guide.activeKey}
			newKey={guide.newKey}
			busy={guide.creatingKey}
			onCreate={() => void guide.createKey()}
		/>

		<section class="card p-5" data-testid="onboarding-agent-card">
			<div class="mb-4 flex items-start gap-3">
				<span
					class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"
				>
					<Bot class="h-4 w-4" />
				</span>
				<div>
					<h3 class="text-[15px] font-semibold text-stone-900">
						2. Add PostEasy to {current.label}
					</h3>
					<p class="mt-0.5 text-[13px] text-stone-500">
						{#if guide.agent === 'rest'}
							Call the API from any script. The full reference is on the <a
								href="/api"
								class="font-semibold text-accent underline">API page</a
							>.
						{:else}
							PostEasy is an MCP server: your agent gets tools to draft, schedule and publish.
						{/if}
					</p>
				</div>
			</div>
			<div class="space-y-3">
				{#if guide.agent !== 'rest' && guide.agent !== 'mcp'}
					<SnippetBlock
						label="MCP server URL"
						text={mcpUrlFor(guide.appUrl)}
						copyLabel="Copy the MCP server URL"
						testId="onboarding-mcp-url"
					/>
				{/if}
				{#each snippets as snippet, i (i)}
					<SnippetBlock
						label={snippet.where}
						text={snippet.text}
						copyLabel="Copy: {snippet.where}"
						testId="onboarding-snippet-{i}"
					/>
				{/each}
			</div>
		</section>

		<p class="flex items-start justify-center gap-2 text-center text-[12.5px] text-stone-500">
			<Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
			One-click connectors for Claude.ai and ChatGPT need OAuth, which isn't available yet.
		</p>
	</div>
</div>
