/**
 * What the setup guide tells each agent to run or paste. Pure, so the guide
 * and its tests build exactly the same text. The key goes in only when the
 * person has just created one; otherwise the placeholder stays, because a
 * stored key can never be shown again.
 */

export type AgentId = 'claude-desktop' | 'claude-code' | 'cursor' | 'codex' | 'mcp' | 'rest';

export interface AgentSnippet {
	/** Where it goes, in the agent's own words. */
	where: string;
	/** Code-block language hint for the reader. */
	language: 'sh' | 'json' | 'toml' | 'text';
	text: string;
}

export interface AgentInfo {
	id: AgentId;
	label: string;
}

export const AGENTS: AgentInfo[] = [
	{ id: 'claude-desktop', label: 'Claude Desktop' },
	{ id: 'claude-code', label: 'Claude Code' },
	{ id: 'cursor', label: 'Cursor' },
	{ id: 'codex', label: 'Codex' },
	{ id: 'mcp', label: 'Other MCP clients' },
	{ id: 'rest', label: 'REST API' }
];

export const KEY_PLACEHOLDER = '<YOUR_API_KEY>';

export function mcpUrlFor(appUrl: string): string {
	return `${appUrl.replace(/\/+$/, '')}/api/mcp`;
}

export function agentSnippets(agent: AgentId, appUrl: string, key: string | null): AgentSnippet[] {
	const base = appUrl.replace(/\/+$/, '');
	const url = mcpUrlFor(base);
	const token = key || KEY_PLACEHOLDER;
	const bearer = `Authorization: Bearer ${token}`;
	switch (agent) {
		case 'claude-code':
			return [
				{
					where: 'Run in your terminal',
					language: 'sh',
					text: `claude mcp add --transport http posteasy ${url} --header "${bearer}"`
				}
			];
		case 'claude-desktop':
			return [
				{
					where: 'Add to claude_desktop_config.json (Settings → Developer → Edit Config)',
					language: 'json',
					text: JSON.stringify(
						{
							mcpServers: {
								posteasy: {
									command: 'npx',
									args: ['-y', 'mcp-remote', url, '--header', bearer]
								}
							}
						},
						null,
						2
					)
				}
			];
		case 'cursor':
			return [
				{
					where: 'Add to ~/.cursor/mcp.json',
					language: 'json',
					text: JSON.stringify(
						{ mcpServers: { posteasy: { url, headers: { Authorization: `Bearer ${token}` } } } },
						null,
						2
					)
				}
			];
		case 'codex':
			// The same config Settings → API access shows: Codex reads the bearer
			// value from an environment variable rather than the file.
			return [
				{
					where: 'Set the key in your shell profile',
					language: 'sh',
					text: `export POSTEASY_API_KEY=${token}`
				},
				{
					where: 'Add to ~/.codex/config.toml',
					language: 'toml',
					text: [
						'[mcp_servers.posteasy]',
						`url = "${url}"`,
						'bearer_token_env_var = "POSTEASY_API_KEY"',
						'default_tools_approval_mode = "prompt"'
					].join('\n')
				}
			];
		case 'mcp':
			return [
				{ where: 'Server URL (Streamable HTTP)', language: 'text', text: url },
				{ where: 'Request header', language: 'text', text: bearer }
			];
		case 'rest':
			// From docs/api.md: create a draft, then schedule it to one account.
			return [
				{
					where: 'Create a draft',
					language: 'sh',
					text: [
						`curl -s -X POST "${base}/api/drafts" \\`,
						`  -H "${bearer}" \\`,
						'  -H "Content-Type: application/json" \\',
						`  -d '{"title":"Hello","baseBody":"from a script"}'`
					].join('\n')
				},
				{
					where: 'Schedule it (ids from the draft and GET /api/connections)',
					language: 'sh',
					text: [
						`curl -s -X POST "${base}/api/drafts/DRAFT_ID/schedule" \\`,
						`  -H "${bearer}" \\`,
						'  -H "Content-Type: application/json" \\',
						`  -d '{"connectionIds":["CONN_ID"],"runAt":"2030-01-01T09:00:00Z"}'`
					].join('\n')
				}
			];
	}
}
