import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture, postgres, databaseUrl, workspace } from './fixture.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
let releaseModel, modelBTable, modelCalls = 0, firstModel;
const modelStarted = new Promise(resolve => { firstModel = resolve; });
const modelGate = new Promise(resolve => { releaseModel = resolve; });
const f = await createBrowserFixture({ name: 'Enterprise workspace regression', modelRequest: async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  modelCalls++;
  const request = JSON.parse(raw);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'workspace-ui', object: 'chat.completion.chunk', created: 1, model: 'fixture/model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  if (modelCalls === 1) { firstModel(); await modelGate; }
  send({ role: 'assistant' });
  if (modelCalls <= 2) {
    if (modelCalls === 2) assert.match(JSON.stringify(request.messages), /表格不存在/);
    const name = modelCalls === 1 ? 'get_table' : 'create_table';
    const input = modelCalls === 1 ? { tableId: modelBTable } : { name: 'A background table' };
    send({ tool_calls: [{ index: 0, id: `workspace-call-${modelCalls}`, type: 'function', function: { name, arguments: JSON.stringify(input) } }] }); send({}, 'tool_calls');
  } else { send({ content: 'A secret stream result' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
} });
const { page, ctx, base, frontend, api } = f;
page.setDefaultTimeout(15000);
const scoped = async (workspace, path, data, method = data === undefined ? 'GET' : 'POST') => {
  const response = await ctx.request.fetch(base + '/api' + path, { method, headers: { Origin: frontend, 'X-Workspace-Id': workspace }, ...(data === undefined ? {} : { data }) });
  return { status: response.status(), value: await response.json() };
};
try {
  const a = (await api('/commands', { command: 'listWorkspaces' })).result[0];
  const table = (await scoped(a.id, '/tables', { name: 'A-only pinned' })).value;
  await scoped(a.id, '/tables/' + table.id, { pinned: true }, 'PATCH');
  const members = await api('/members');
  await page.goto(frontend + '/app/tables?workspace=' + a.id);
  await page.getByTestId('workspace-switcher').waitFor();
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: /创建工作区|Create workspace/ }).click();
  await page.getByLabel(/工作区名称|Workspace name/).fill('B workspace');
  await page.getByRole('button', { name: /创建并进入|Create and enter/ }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') && url.searchParams.get('workspace') !== a.id);
  const b = new URL(page.url()).searchParams.get('workspace');
  await page.getByTestId('workspace-switcher').waitFor();
  assert.match(await page.getByTestId('workspace-switcher').innerText(), /B workspace/);
  assert.equal((await scoped(b, '/tables')).value.length, 0);
  assert.equal(await page.getByText('A-only pinned', { exact: true }).count(), 0);
  assert.equal((await scoped(b, '/tables/' + table.id)).status, 404);
  const bTable = (await scoped(b, '/tables', { name: 'A-only pinned' })).value;
  assert.notEqual(bTable.id, table.id);
  assert.deepEqual((await scoped(b, '/members')).value.members.map(x => x.id).sort(), members.members.map(x => x.id).sort());
  await page.reload(); await page.getByTestId('workspace-switcher').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('workspace'), b);
  // Same cookie, independent documents and immutable request scopes.
  const other = await ctx.newPage();
  await other.route('**/api/**', async route => { const u = new URL(route.request().url()); const response = await route.fetch({ url: base + u.pathname + u.search }); await route.fulfill({ response }); });
  await other.goto(frontend + '/app/tables?workspace=' + a.id); await other.getByTestId('workspace-switcher').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('workspace'), b);
  assert.equal(new URL(other.url()).searchParams.get('workspace'), a.id);
  await page.goto(frontend + '/app/tables/' + table.id + '?workspace=' + b);
  await page.getByTestId('workspace-switcher').waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.getByText('A private row marker', { exact: true }).count(), 0);
  await page.goto(frontend + '/app/tables?workspace=' + b);
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: a.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === a.id);
  await page.getByTestId('workspace-switcher').waitFor();
  await page.goBack(); await page.getByTestId('workspace-switcher').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('workspace'), b);
  // A slow A list must never populate the next document's B cache or UI.
  await scoped(a.id, '/tables', { name: 'A race secret' });
  let listStarted, releaseList;
  const listReady = new Promise(resolve => { listStarted = resolve; });
  const listGate = new Promise(resolve => { releaseList = resolve; });
  const slowList = async route => {
    const response = await route.fetch({ url: base + '/api/tables' });
    listStarted(); await listGate;
    try { await route.fulfill({ response }); } catch { /* Old document detached after switch. */ }
  };
  await page.route('**/api/tables', slowList);
  console.log('race: loading original workspace');
  await page.goto(frontend + '/app/tables?workspace=' + a.id, { waitUntil: 'domcontentloaded' });
  await Promise.race([listReady, new Promise((_, reject) => setTimeout(() => reject(new Error('Delayed list never started')), 10000))]);
  console.log('race: original list captured');
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: 'B workspace', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === b);
  console.log('race: switched with pending list');
  releaseList(); await page.unroute('**/api/tables', slowList);
  await page.getByTestId('workspace-switcher').waitFor();
  assert.equal(await page.getByText('A race secret', { exact: true }).count(), 0);
  // Official Pi tools capture A, including after navigating away during execution.
  const agent = (await api('/members/agents', { name: 'Workspace fixture agent', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model' } })).member;
  f.users.push(agent.userId); modelBTable = bTable.id;
  await page.goto(frontend + '/app?workspace=' + a.id);
  await page.getByTestId('workspace-switcher').waitFor();
  console.log('native: submitting A task');
  const composer = page.getByRole('textbox').last();
  await composer.fill('Run the workspace isolation fixture'); await composer.press('Enter');
  await Promise.race([modelStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Native model did not start')), 15000))]);
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: 'B workspace', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === b);
  await page.getByTestId('workspace-switcher').waitFor(); releaseModel();
  let completed = false;
  for (let i = 0; i < 100; i++) {
    completed = (await scoped(a.id, '/tables')).value.some(item => item.name === 'A background table');
    if (completed && modelCalls === 3) break;
    await page.waitForTimeout(100);
  }
  assert(completed); assert.equal(modelCalls, 3);
  assert(!(await scoped(b, '/tables')).value.some(item => item.name === 'A background table'));
  assert.equal((await scoped(b, '/threads')).value.threads.length, 0);
  assert.equal(await page.getByText('A secret stream result', { exact: true }).count(), 0);
  const history = (await scoped(a.id, '/threads')).value.threads;
  assert.equal(history.length, 1);
  await assertEventually(async () => JSON.stringify((await scoped(a.id, '/threads/' + history[0].id + '/messages')).value).includes('A secret stream result'));
  // Start the real stdio MCP with a fixed B selector and a supported legacy agent credential.
  const db = postgres(databaseUrl);
  const secret = 'agt_' + crypto.randomUUID();
  try { await db`update agent_profile set api_key_hash=${createHash('sha256').update(secret).digest('hex')} where user_id=${agent.userId}`; } finally { await db.end(); }
  const requireMcp = createRequire(join(workspace, 'apps/mcp/package.json'));
  const { Client } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const mcp = new Client({ name: 'workspace-regression', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [requireMcp.resolve('tsx/cli'), join(workspace, 'apps/mcp/src/index.ts')],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([,value]) => typeof value === 'string')), TABDO_API_URL: base, TABDO_API_KEY: secret, TABDO_WORKSPACE_ID: b }, stderr: 'pipe' });
  try {
    await mcp.connect(transport);
    const result = await mcp.callTool({ name: 'get_workspace', arguments: {} });
    assert.equal(JSON.parse(result.content[0].text).workspace.id, b);
    const list = await mcp.callTool({ name: 'list_tables', arguments: {} });
    assert.deepEqual(JSON.parse(list.content[0].text).map(item => item.id), [bTable.id]);
    const denied = await mcp.callTool({ name: 'get_table', arguments: { tableId: table.id } }); assert.equal(denied.isError, true);
  } finally { await mcp.close(); await transport.close(); }
  await mkdir('.impeccable/review', { recursive: true });
  await page.screenshot({ path: '.impeccable/review/desktop.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: a.name, exact: true }).waitFor();
  await page.screenshot({ path: '.impeccable/review/mobile.png' });
  await page.keyboard.press('Escape');
  assert.deepEqual(f.errors, []);
  await other.close();
  console.log('PASS: same-enterprise create/switch/empty/name/pin/refresh/history/deep-link/multi-tab/global-members/old-request/native-stream-and-tools/fixed-MCP/desktop/mobile');
} finally { releaseModel(); await f.close(); }
async function assertEventually(check) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail('Expected native checkpoint to persist'); }
