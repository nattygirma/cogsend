import { describe, expect, it } from 'vitest';
import {
	normalizeProfileSettings,
	onboardingAutoOpens,
	parseOnboarding,
	parseProfileSettings
} from '#lib/domain/profile-settings.js';
import { AGENTS, KEY_PLACEHOLDER, agentSnippets, mcpUrlFor } from '#lib/domain/agent-setup.js';

describe('stored setup-guide state', () => {
	it('keeps a valid state and drops anything else', () => {
		expect(parseOnboarding({ step: 2, done: false })).toEqual({ step: 2, done: false });
		expect(parseOnboarding({ step: 1, done: false, dismissed: true })).toEqual({
			step: 1,
			done: false,
			dismissed: true
		});
		for (const bad of [null, [], { step: 4, done: false }, { step: 1 }, { step: 1, done: 'no' }])
			expect(parseOnboarding(bad)).toBeNull();
	});

	it('is absent for accounts that never saw the guide, so they are not interrupted', () => {
		const settings = parseProfileSettings(JSON.stringify({ mastoVisibility: 'unlisted' }));
		expect(settings.onboarding).toBeUndefined();
		expect(onboardingAutoOpens(settings.onboarding)).toBe(false);
	});

	it('opens by itself only while unfinished and not closed', () => {
		expect(onboardingAutoOpens({ step: 1, done: false })).toBe(true);
		expect(onboardingAutoOpens({ step: 3, done: true })).toBe(false);
		expect(onboardingAutoOpens({ step: 2, done: false, dismissed: true })).toBe(false);
	});

	it('round-trips through a settings save and refuses a malformed one', () => {
		const ok = normalizeProfileSettings({ onboarding: { step: 3, done: true } });
		expect(ok.ok && ok.settings.onboarding).toEqual({ step: 3, done: true });
		expect(JSON.parse(JSON.stringify(ok.ok && ok.settings)).onboarding).toEqual({
			step: 3,
			done: true
		});
		expect(normalizeProfileSettings({ onboarding: { step: 9 } })).toEqual({
			ok: false,
			error: 'Invalid onboarding state'
		});
	});
});

describe('agent setup snippets', () => {
	const app = 'https://social.example/';

	it('point every agent at the instance MCP endpoint', () => {
		expect(mcpUrlFor(app)).toBe('https://social.example/api/mcp');
		for (const agent of AGENTS.filter((a) => a.id !== 'rest')) {
			const text = agentSnippets(agent.id, app, 'pe_key')
				.map((s) => s.text)
				.join('\n');
			expect([agent.id, text.includes('https://social.example/api/mcp')]).toEqual([agent.id, true]);
		}
	});

	it('fill in a just-created key, and a placeholder otherwise', () => {
		const [claude] = agentSnippets('claude-code', app, 'pe_abc');
		expect(claude.text).toBe(
			'claude mcp add --transport http posteasy https://social.example/api/mcp --header "Authorization: Bearer pe_abc"'
		);
		expect(agentSnippets('claude-code', app, null)[0].text).toContain(KEY_PLACEHOLDER);
	});

	it('produce valid config files for the JSON clients', () => {
		const desktop = JSON.parse(agentSnippets('claude-desktop', app, 'k')[0].text);
		expect(desktop.mcpServers.posteasy).toEqual({
			command: 'npx',
			args: [
				'-y',
				'mcp-remote',
				'https://social.example/api/mcp',
				'--header',
				'Authorization: Bearer k'
			]
		});
		const cursor = JSON.parse(agentSnippets('cursor', app, 'k')[0].text);
		expect(cursor.mcpServers.posteasy.headers).toEqual({ Authorization: 'Bearer k' });
	});

	it('keep the Codex key out of its config file, as Settings does', () => {
		const [env, config] = agentSnippets('codex', app, 'k');
		expect(env.text).toBe('export POSTEASY_API_KEY=k');
		expect(config.text).toContain('bearer_token_env_var = "POSTEASY_API_KEY"');
		expect(config.text).not.toContain('Bearer k');
	});

	it('schedule through the documented REST routes', () => {
		const text = agentSnippets('rest', app, 'k')
			.map((s) => s.text)
			.join('\n');
		expect(text).toContain('https://social.example/api/drafts');
		expect(text).toContain('/schedule');
		expect(text).toContain('"runAt"');
	});
});
