import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const input = JSON.parse(process.env.CALENDAR_VIEW_MCP_CASE);
const client = new Client({ name: 'calendar-view-regression', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_TEST_URL), { requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_TEST_KEY}`, ...(process.env.MCP_TEST_WORKSPACE ? { 'X-Workspace-Id': process.env.MCP_TEST_WORKSPACE } : {}) } } }));
  const catalog = await client.listTools();
  for (const name of ['create_calendar_view', 'update_calendar_view', 'query_calendar_view', 'get_document', 'get_blog_sources', 'get_calendar', 'get_calendar_subscription', 'list_calendar_subscriptions', 'list_calendar_deliveries']) assert(catalog.tools.some(tool => tool.name === name));
  const result = await client.callTool({ name: 'query_calendar_view', arguments: { viewId: input.viewId, rangeStart: '2030-03-01', rangeEnd: '2030-04-01' } });
  assert(!result.isError, JSON.stringify(result)); assert.equal(JSON.parse(result.content[0].text).items[0].rowId, input.rowId);
  for (const [name, args, check] of [
    ['get_document', { tableId: input.tableId, rowId: input.rowId }, value => value.rowId === input.rowId],
    ['get_blog_sources', { tableId: input.tableId }, value => value.items.some(item => item.rowId === input.rowId)],
    ['get_calendar', { calendarId: input.calendarId }, value => value.id === input.calendarId],
    ['get_calendar_subscription', { calendarId: input.calendarId, subscriptionId: input.subscriptionId }, value => value.id === input.subscriptionId],
    ['list_calendar_subscriptions', { calendarId: input.calendarId }, value => value.items.some(item => item.id === input.subscriptionId)],
    ['list_calendar_deliveries', { calendarId: input.calendarId, subscriptionId: input.subscriptionId }, value => value.items.length === 0],
  ]) {
    const read = await client.callTool({ name, arguments: args });
    assert(!read.isError, JSON.stringify(read)); assert(check(JSON.parse(read.content[0].text)), name); assert(!JSON.stringify(read).includes("cal_whsec_"));
  }
  const forbidden = await client.callTool({ name: 'update_calendar_view', arguments: { viewId: input.viewId, config: { startColumnId: input.startId } } });
  assert(forbidden.isError, 'read key cannot manage views');
  console.log(JSON.stringify({ mcp: 'PASS' }));
} finally { await client.close(); }
