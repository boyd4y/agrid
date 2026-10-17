import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const input = JSON.parse(process.env.CALENDAR_VIEW_MCP_CASE);
const client = new Client({ name: 'calendar-view-regression', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.CALENDAR_VIEW_MCP_TSX, fileURLToPath(new URL('../src/index.ts', import.meta.url))], env: { ...process.env } }));
  const catalog = await client.listTools();
  for (const name of ['create_calendar_view', 'update_calendar_view', 'query_calendar_view']) assert(catalog.tools.some(tool => tool.name === name));
  const result = await client.callTool({ name: 'query_calendar_view', arguments: { viewId: input.viewId, rangeStart: '2030-03-01', rangeEnd: '2030-04-01' } });
  assert(!result.isError, JSON.stringify(result)); assert.equal(JSON.parse(result.content[0].text).items[0].rowId, input.rowId);
  const forbidden = await client.callTool({ name: 'update_calendar_view', arguments: { viewId: input.viewId, config: { startColumnId: input.startId } } });
  assert(forbidden.isError, 'read key cannot manage views');
  console.log(JSON.stringify({ mcp: 'PASS' }));
} finally { await client.close(); }
