import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { apiKeyPlaceholder, connectionClient, connectionClients, connectionRecipe } from '../src/components/connections/connection-guide.ts';

test('all client examples use deployment origin and a public placeholder', () => {
  for (const client of connectionClients) {
    const { code, fields } = connectionRecipe(client, 'https://deploy.example.test:8443/nested?ignored=1');
    const example = code ?? fields.map(field => field.value).join('\n');
    assert(example.includes('https://deploy.example.test:8443/mcp'));
    assert(example.includes(apiKeyPlaceholder));
    assert(!example.includes('nested'));
    assert(!example.includes('stdio'));
  }
  const cursor = JSON.parse(connectionRecipe('cursor', 'https://example.test').code);
  assert.deepEqual(cursor, { mcpServers: { tabdo: { url: 'https://example.test/mcp', headers: { Authorization: `Bearer ${apiKeyPlaceholder}` } } } });
});

test('commands quote URL and Authorization as individual shell arguments', () => {
  // Parse through a real POSIX shell with inert function stubs; no CLI config is written.
  const origin = "https://o'neil.example.test:8443";
  const claude = connectionRecipe('claude-code', origin).code;
  const parsed = execFileSync('/bin/sh', ['-c', 'claude() { printf "%s\\n" "$@"; }; ' + claude], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(parsed, ['mcp', 'add', '--transport', 'http', 'tabdo', `${origin}/mcp`, '--header', `Authorization: Bearer ${apiKeyPlaceholder}`]);
  const codex = connectionRecipe('codex', origin).code;
  const args = execFileSync('/bin/sh', ['-c', 'codex() { printf "%s\\n" "$TABDO_MCP_KEY" "$@"; }; ' + codex], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(args, [apiKeyPlaceholder, 'mcp', 'add', 'tabdo', '--url', `${origin}/mcp`, '--bearer-token-env-var', 'TABDO_MCP_KEY']);
});

test('unknown client values use a known recipe without incorporating query content', () => {
  for (const value of [null, '', 'tab_secret', '<script>']) assert.equal(connectionClient(value), 'claude-code');
  for (const client of connectionClients) assert.equal(connectionClient(client), client);
});
