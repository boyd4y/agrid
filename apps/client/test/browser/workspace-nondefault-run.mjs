import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

let b, defaultTable, calls = 0, started, release;
const began = new Promise(resolve => { started = resolve; });
const gate = new Promise(resolve => { release = resolve; });
const modelErrors = [];
const output = 'Non-default B private completed result';
const createdName = 'Created by the accepted B run';
const f = await createBrowserFixture({ name: 'Non-default workspace native execution', modelRequest: async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    calls++;
    if (calls === 1) { assert(raw.includes(b.id), 'validated native context must identify non-default B'); started(); await gate; }
    if (calls === 2) assert.match(JSON.stringify(request.messages), /表格不存在/);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'nondefault-run', object: 'chat.completion.chunk', created: 1,
      model: 'fixture/model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (calls <= 2) {
      const name = calls === 1 ? 'get_table' : 'create_table';
      const input = calls === 1 ? { tableId: defaultTable.id } : { name: createdName };
      send({ tool_calls: [{ index: 0, id: `nondefault-${calls}`, type: 'function', function: { name, arguments: JSON.stringify(input) } }] });
      send({}, 'tool_calls');
    } else { send({ content: output }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  } catch (error) {
    modelErrors.push(String(error)); if (!res.headersSent) res.writeHead(500); res.end('Local fixture rejected the request');
  }
} });
const { page, ctx, base, frontend, api } = f;
page.setDefaultTimeout(15000);
const scoped = async (workspaceId, path, data) => {
  const response = await ctx.request.fetch(base + '/api' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: frontend, 'X-Workspace-Id': workspaceId }, ...(data === undefined ? {} : { data }) });
  assert(response.ok(), `${path}: ${response.status()} ${await response.text()}`); return response.json();
};
try {
  const a = (await api('/commands', { command: 'listWorkspaces' })).result.find(item => item.isDefault);
  b = (await api('/commands', { command: 'createWorkspace', input: { name: 'Non-default B' } })).result;
  defaultTable = await scoped(a.id, '/tables', { name: 'Default A private table' });
  await scoped(b.id, '/tables', { name: 'Initial B table' });
  const agent = (await api('/members/agents', { name: 'Non-default run agent', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model' } })).member;
  f.users.push(agent.userId);
  await page.goto(frontend + '/app?workspace=' + b.id);
  await page.getByTestId('workspace-switcher').waitFor();
  await page.getByTestId('chat-toolbar').getByText('Non-default run agent', { exact: true }).waitFor();
  const composer = page.getByRole('textbox').last();
  await composer.fill('Run in non-default B and preserve its scope'); await composer.press('Enter');
  await Promise.race([began, new Promise((_, reject) => setTimeout(() => reject(new Error('B model did not start')), 15000))]);
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: a.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === a.id);
  await page.getByTestId('workspace-switcher').waitFor(); release();
  let complete = false;
  for (let i = 0; i < 150; i++) {
    const threads = (await scoped(b.id, '/threads')).threads;
    if (threads.length === 1) {
      const runs = (await scoped(b.id, `/threads/${threads[0].id}/runs`)).runs;
      const messages = await scoped(b.id, `/threads/${threads[0].id}/messages`);
      if (runs[0]?.status === 'completed' && JSON.stringify(messages).includes(output)) { complete = true; break; }
    }
    await page.waitForTimeout(100);
  }
  assert.deepEqual(modelErrors, []);
  assert(complete, 'B private run and checkpoint must finish after leaving its document');
  assert.equal(calls, 3, 'no repeated model/tool input');
  assert.deepEqual((await scoped(a.id, '/tables')).map(table => table.id), [defaultTable.id]);
  const bTables = await scoped(b.id, '/tables');
  assert.equal(bTables.length, 2); assert(bTables.some(table => table.name === createdName));
  assert.equal((await scoped(a.id, '/threads')).threads.length, 0);
  assert.equal(await page.getByText(output, { exact: true }).count(), 0);
  assert.deepEqual(f.errors, []);
  console.log('PASS: non-default B context, A-ID denial, B-only native mutation, stable private run/checkpoint and no A stream leakage after switching to default A');
} finally { release(); await f.close(); }
