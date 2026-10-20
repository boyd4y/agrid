import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Agent connections' });
const { page, api, ctx, frontend, errors } = f;
page.setDefaultTimeout(15000);
const clients = ['Claude Code', 'Claude 网页 / 桌面端', 'Codex', 'Cursor', 'Grok Bot'];
const ids = ['claude-code', 'claude-remote', 'codex', 'cursor', 'grok-bot'];
const placeholder = 'tab_replace_with_your_key';
const guide = page.getByTestId('agent-connection-guide');
const recipe = page.getByTestId('connection-recipe');
const panel = page.getByTestId('api-keys-settings');
const dialog = page.getByRole('dialog');
const selectClient = async name => {
  await guide.getByRole('radio', { name, exact: true }).click();
  await guide.getByRole('radio', { name, exact: true, checked: true }).waitFor();
};
try {
  const table = await api('/tables', { name: 'Connection data' });
  const workspace = (await api('/commands', { command: 'getWorkspace' })).result.workspace;
  const label = `${workspace.name} / Connection data`;
  const permissions = [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }];
  const existing = (await api('/user/api-keys', { name: 'Grok Bot', permissions })).key;
  const snapshot = (await api('/user/api-keys')).keys;
  let automaticCreates = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/user/api-keys') automaticCreates++; });
  await page.goto(frontend + '/app/settings?tab=connections');
  await guide.waitFor();
  for (let i = 0; i < clients.length; i++) {
    await selectClient(clients[i]);
    await page.waitForURL(url => (url.searchParams.get('client') ?? 'claude-code') === ids[i]);
    assert((await recipe.innerText()).includes(frontend + '/mcp'));
    assert((await recipe.innerText()).includes(placeholder));
    assert.equal(await guide.locator('input').count(), 0, 'guide accepts no secrets');
  }
  await page.reload();
  assert.equal(await guide.getByRole('radio', { name: 'Grok Bot', exact: true }).getAttribute('data-state'), 'on');
  await selectClient('Cursor');
  await page.goBack();
  assert.equal(await guide.getByRole('radio', { name: 'Grok Bot', exact: true }).getAttribute('data-state'), 'on');
  assert.equal(automaticCreates, 0);
  assert.deepEqual((await api('/user/api-keys')).keys, snapshot, 'guide navigation never modifies existing keys');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const [name, expected] of [['MCP 服务地址', frontend + '/mcp'], ['HTTP 请求头名称', 'Authorization'], ['HTTP 请求头值', 'Bearer ' + placeholder]]) {
    await guide.getByRole('button', { name: '复制' + name, exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
  }
  for (const name of ['Claude Code', 'Codex', 'Cursor']) {
    await selectClient(name);
    const expected = await recipe.locator('code').innerText();
    await recipe.getByRole('button', { name: '复制示例', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    if (name === 'Cursor') assert.equal(JSON.parse(expected).mcpServers.tabdo.headers.Authorization, 'Bearer ' + placeholder);
  }
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('fixture denied')) }));
  await recipe.getByRole('button', { name: '复制示例', exact: true }).click();
  await page.getByText('复制失败，请选中文本手动复制。', { exact: true }).waitFor();
  await page.evaluate(() => { delete navigator.clipboard.writeText; });
  // One batched visual inspection: desktop themes and narrow desktop, actual selected panels.
  for (const width of (process.env.CONNECTION_VISUAL === '0' ? [] : [1440, 1100])) {
    await page.setViewportSize({ width, height: 1100 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.waitForTimeout(250);
      for (const name of (width === 1440 ? clients : ['Cursor', 'Grok Bot'])) {
        await selectClient(name);
        assert(await guide.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: f.artifact(`connections-${width}-${theme}-${ids[clients.indexOf(name)]}.png`), fullPage: true, animations: 'disabled' });
      }
    }
  }
  await guide.getByRole('link', { name: '管理 API Key', exact: true }).click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('button', { name: /启用 Grok Bot/ }).count(), 0);
  // Editing an old brand-named key retains its identity and independent preview grant.
  await panel.getByRole('button', { name: '编辑 Grok Bot', exact: true }).click();
  assert.equal(await dialog.getByTestId(`table-access-${table.id}`).getByRole('checkbox').count(), 4);
  assert.equal(await dialog.getByRole('checkbox', { name: /允许发布/ }).count(), 0);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await api('/user/api-keys')).keys, snapshot, 'unchanged save preserves all grants');
  await panel.getByRole('button', { name: '编辑 Grok Bot', exact: true }).click();
  await dialog.getByRole('checkbox', { name: label + ' · 更新', exact: true }).check();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const edited = (await api('/user/api-keys')).keys.find(k => k.id === existing.id);
  assert.equal(edited.permissions[0].canUpdate, true);
  assert(!("blogPermissions" in edited));
  assert.equal(edited.name, 'Grok Bot');
  // Generic create / secret-once / revoke continues to work without brand shortcuts.
  await panel.getByRole('button', { name: '创建 API Key', exact: true }).click();
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('External client');
  await dialog.getByRole('checkbox', { name: label + ' · 读取', exact: true }).check();
  await dialog.getByRole('checkbox', { name: label + ' · 更新', exact: true }).check();
  await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
  const secret = await dialog.getByRole('textbox', { name: 'API Key', exact: true }).inputValue();
  assert.match(secret, /^tab_/);
  await dialog.getByRole('button', { name: '复制 Key', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), secret);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  const created = (await api('/user/api-keys')).keys.find(k => k.name === 'External client');
  assert(!("documentPermissions" in created)); assert(!("blogPermissions" in created));
  await panel.getByRole('button', { name: '编辑 External client', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'API Key', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await panel.getByRole('link', { name: '连接 Agent', exact: true }).click();
  assert(!(await guide.innerText()).includes(secret));
  assert(!(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(secret));
  assert(!page.url().includes(secret));
  await page.getByRole('tab', { name: '常规', exact: true }).click();
  await page.getByLabel('English', { exact: true }).click();
  await page.getByRole('tab', { name: 'Connect agents', exact: true }).click();
  await selectClient('Claude web / Desktop');
  await guide.getByText('This guide does not check the connection.', { exact: true }).waitFor();
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('fixture denied')) }));
  await guide.getByRole('button', { name: 'Copy MCP server URL', exact: true }).click();
  await page.getByText('Could not copy. Select the text and copy it manually.', { exact: true }).waitFor();
  const workspaceRecipe = await recipe.innerText();
  await page.goto(frontend + '/docs/mcp?client=claude-remote');
  await guide.waitFor();
  assert.equal(await recipe.innerText(), workspaceRecipe, 'public and workspace use the same recipe');
  assert.equal(await guide.getByRole('link', { name: 'Open workspace connections', exact: true }).getAttribute('href'), '/app/settings?tab=connections');
  assert(!(await guide.innerText()).includes(secret));
  await page.goto(frontend + '/app/settings?tab=api-keys');
  await panel.getByRole('button', { name: 'Delete External client', exact: true }).click();
  const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/user/api-keys/${created.id}`);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal((await deleted).status(), 200);
  await panel.getByRole('button', { name: 'Delete External client', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await api('/user/api-keys')).keys.length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS connections: five clients, URL/history/locale, exact clipboard and failure, generic create/edit/revoke/secret-once, preserved original CRUD grant and key identity, four CRUD controls, shared public recipe, no automatic key creation, desktop light/dark/narrow overflow.');
} finally { await f.close(); }
