import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const input = JSON.parse(process.env.CALENDAR_MCP_CASE);
const client = new Client({ name: 'calendar-regression', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.CALENDAR_MCP_TSX, fileURLToPath(new URL('../src/index.ts', import.meta.url))], env: { ...process.env } });
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  for (const name of ['list_calendar_members', 'query_availability', 'create_booking', 'reschedule_booking', 'cancel_booking', 'batch_bookings', 'set_working_hours']) assert(catalog.tools.some(tool => tool.name === name));
  if (input.calls) {
    for (const item of input.calls) {
      const result = await client.callTool({ name: item.name, arguments: item.input });
      assert(!result.isError, JSON.stringify(result));
      const value = JSON.parse(result.content[0].text);
      for (const hidden of item.absent ?? []) assert(!JSON.stringify(value).includes(hidden), item.name + ' exposed private content');
      for (const visible of item.includes ?? []) assert(JSON.stringify(value).includes(visible), item.name + ' missing owned content');
      for (const [field, expected] of Object.entries(item.expect ?? {})) {
        const actual = field.split('.').reduce((current, key) => current[key], value);
        assert.deepEqual(actual, expected, item.name + '.' + field);
      }
    }
    console.log(JSON.stringify({ mcp: 'PASS', operations: input.calls.length }));
  } else {
  const result = await client.callTool({ name: 'query_availability', arguments: input.availability });
  assert(!result.isError, JSON.stringify(result));
  const availability = JSON.parse(result.content[0].text);
  assert(availability.complete && availability.slots.length);
  const created = await client.callTool({ name: 'create_booking', arguments: { ...input.booking, time: { ...availability.slots[0], timeZone: 'UTC' } } });
  assert(!created.isError, JSON.stringify(created));
  const booking = JSON.parse(created.content[0].text);
  const conflict = await client.callTool({ name: 'create_booking', arguments: { ...input.booking, idempotencyKey: crypto.randomUUID(), time: { ...availability.slots[0], timeZone: 'UTC' } } });
  assert(conflict.isError);
  assert.equal(JSON.parse(conflict.content[0].text).error.code, 'RESOURCE_CONFLICT');
  const cancelled = await client.callTool({ name: 'cancel_booking', arguments: { calendarId: input.booking.calendarId, bookingId: booking.id, expectedVersion: booking.version, idempotencyKey: crypto.randomUUID() } });
  assert.equal(JSON.parse(cancelled.content[0].text).status, 'cancelled');
  console.log(JSON.stringify({ mcp: 'PASS', tools: catalog.tools.length, bookingId: booking.id }));
  }
} finally { await client.close(); }
