import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Agent connections' });
const { page, api, ctx, frontend, errors } = f;
page.setDefaultTimeout(15000);
const clients = ['Claude Code', 'Codex', 'Cursor', 'Claude 网页 / 桌面端', 'Grok Bot'];
const ids = ['claude-code', 'codex', 'cursor', 'claude-remote', 'grok-bot'];
const placeholder = 'tab_replace_with_your_key';
const guide = page.getByTestId('agent-connection-guide');
const recipe = page.getByTestId('connection-recipe');
const panel = page.getByTestId('api-keys-settings');
const dialog = page.getByRole('dialog');
const selectClient = async name => {
  await guide.getByRole('tab', { name, exact: true }).click();
  await guide.getByRole('tab', { name, exact: true, selected: true }).waitFor();
};
const template = async () => {
  await recipe.getByRole('button', { name: '复制模板', exact: true }).waitFor();
  assert((await recipe.innerText()).includes(placeholder));
};
let createdSecret;
try {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const table = await api('/tables', { name: 'Connection data' });
  const workspace = (await api('/commands', { command: 'getWorkspace' })).result.workspace;
  const label = `${workspace.name} / Connection data`;
  const permissions = [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }];
  await api('/user/api-keys', { name: 'Existing client', permissions });
  let creates = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/user/api-keys') creates++; });
  await page.goto(frontend + '/app/settings?tab=connections&section=guide');
  await panel.getByRole('button', { name: '编辑 Existing client', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '接入指南', exact: true }).count(), 0);
  for (let i = 0; i < clients.length; i++) {
    await selectClient(clients[i]);
    await page.waitForURL(url => (url.searchParams.get('client') ?? 'claude-code') === ids[i]);
    await template();
    assert((await recipe.innerText()).includes(frontend + '/mcp'));
    await recipe.getByRole('button', { name: '复制模板', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes(placeholder));
    if (ids[i] === 'cursor') assert.equal(JSON.parse(copied).mcpServers.tabdo.headers.Authorization, 'Bearer ' + placeholder);
  }
  assert.equal(creates, 0, 'client switching never creates a key');
  await guide.getByRole('tab', { name: 'Grok Bot', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Claude Code');
  await page.keyboard.press('Enter');
  await guide.getByRole('tab', { name: 'Claude Code', exact: true, selected: true }).waitFor();
  await guide.getByRole('button', { name: '创建接入配置', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '名称', exact: true }).inputValue(), 'Claude Code');
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('New configuration');
  await dialog.getByRole('checkbox', { name: label + ' · 读取', exact: true }).check();
  const failedCreate = route => route.fulfill({ status: 503, json: { message: 'Fixture creation failure' } });
  await page.route('**/api/user/api-keys', failedCreate);
  await dialog.getByRole('button', { name: '生成接入配置', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert(await dialog.getByRole('checkbox', { name: label + ' · 读取', exact: true }).isChecked());
  await page.unroute('**/api/user/api-keys', failedCreate);
  const createdResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/user/api-keys' && r.ok());
  await dialog.getByRole('button', { name: '生成接入配置', exact: true }).click();
  const saved = await (await createdResponse).json();
  createdSecret = saved.secret;
  await dialog.waitFor({ state: 'hidden' });
  assert.match(createdSecret, /^tab_[A-Za-z0-9_-]{43}$/);
  assert.equal(await page.getByRole('dialog').count(), 0, 'no success dialog');
  for (const name of clients) {
    await selectClient(name);
    assert((await recipe.innerText()).includes(createdSecret));
    await recipe.getByRole('button', { name: '复制完整配置', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes(createdSecret));
    if (name === 'Cursor') assert.equal(JSON.parse(copied).mcpServers.tabdo.headers.Authorization, 'Bearer ' + createdSecret);
    else if (['Claude Code', 'Codex'].includes(name)) assert.equal(copied, await recipe.locator('code').innerText());
    else assert(copied.includes('Authorization') && copied.includes(frontend + '/mcp'));
  }
  assert.equal(creates, 2, 'one failed and one successful creation; switching reuses the credential');
  assert(!(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(createdSecret));
  assert(!page.url().includes(createdSecret));
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('fixture denied')) }));
  await recipe.getByRole('button', { name: '复制完整配置', exact: true }).click();
  await page.getByText('复制失败，请选中文本手动复制。', { exact: true }).waitFor();
  await page.evaluate(() => { delete navigator.clipboard.writeText; });
  // Failed deletion keeps the currently useful configuration; successful deletion clears it.
  await panel.getByRole('button', { name: 'New configuration 的更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除 New configuration', exact: true }).click();
  const failDelete = route => route.fulfill({ status: 503, json: { message: 'Fixture deletion failure' } });
  await page.route('**/api/user/api-keys/*', failDelete);
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('alert').waitFor();
  assert((await recipe.innerText()).includes(createdSecret));
  await page.unroute('**/api/user/api-keys/*', failDelete);
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
  await template();
  assert(!(await page.locator('body').innerText()).includes(createdSecret));
  // A response completing after pagehide must not restore a secret in the old document.
  let releaseCreate, createStarted;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const createReady = new Promise(resolve => { createStarted = resolve; });
  const delayedCreate = async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: f.base + u.pathname + u.search });
    createStarted(); await createGate; await route.fulfill({ response });
  };
  await page.route('**/api/user/api-keys', delayedCreate);
  await guide.getByRole('button', { name: '创建接入配置', exact: true }).click();
  await dialog.getByRole('checkbox', { name: label + ' · 读取', exact: true }).check();
  await dialog.getByRole('button', { name: '生成接入配置', exact: true }).click();
  await createReady;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  releaseCreate(); await dialog.waitFor({ state: 'hidden' }); await template();
  await page.unroute('**/api/user/api-keys', delayedCreate);
  // New secret is cleared on settings-tab leave, document leave and organization change.
  const newConfiguration = async () => {
    await guide.getByRole('button', { name: '创建接入配置', exact: true }).click();
    await dialog.getByRole('checkbox', { name: label + ' · 读取', exact: true }).check();
    await dialog.getByRole('button', { name: '生成接入配置', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await recipe.getByRole('button', { name: '复制完整配置', exact: true }).waitFor();
  };
  await newConfiguration();
  await page.getByRole('tab', { name: '常规', exact: true }).click();
  await page.getByRole('tab', { name: '连接 Agent', exact: true }).click();
  await template();
  await newConfiguration();
  await page.reload(); await template();
  await newConfiguration();
  const other = await api('/auth/organization/create', { name: 'Other organization', slug: 'other-' + crypto.randomUUID() });
  f.organizations.push(other.id);
  await api('/auth/organization/set-active', { organizationId: other.id });
  await page.goto(frontend + '/app/settings?tab=connections'); await template();
  assert.equal(await panel.getByRole('button', { name: '编辑 Existing client', exact: true }).count(), 0);
  await api('/auth/organization/set-active', { organizationId: f.organizations[0] });
  await page.goto(frontend + '/app/settings?tab=connections'); await template();
  // List loading, failure and retry use the same CRUD loader.
  const failList = route => route.fulfill({ status: 503, json: { message: 'Fixture list failure' } });
  await page.route('**/api/user/api-keys', failList);
  await page.reload(); await panel.getByRole('alert').waitFor();
  await page.unroute('**/api/user/api-keys', failList);
  await panel.getByRole('button', { name: '重新加载', exact: true }).click();
  await panel.getByRole('button', { name: '编辑 Existing client', exact: true }).waitFor();
  for (let i = 0; i < 21; i++) await api('/user/api-keys', { name: `Paged ${i}`, permissions });
  await page.reload();
  await panel.getByRole('button', { name: '下一页', exact: true }).click();
  assert((await panel.locator('tbody tr').count()) > 0 && (await panel.locator('tbody tr').count()) < 20);
  await panel.getByRole('button', { name: '上一页', exact: true }).click();
  assert.equal(await panel.locator('tbody tr').count(), 20);
  // Existing-key template captures only: no newly generated credential is in the DOM.
  for (const key of (await api('/user/api-keys')).keys) if (key.name !== 'Existing client') await api('/user/api-keys/' + key.id, undefined, 'DELETE');
  await page.reload(); await template();
  await selectClient('Claude Code');
  await guide.getByRole('heading', { name: '在 Claude Code 中添加 tabdo', exact: true }).click();
  for (const width of (process.env.CONNECTION_VISUAL === '0' ? [] : [1440, 1100])) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      await page.waitForTimeout(250);
      assert(!(await recipe.innerText()).includes(createdSecret));
      assert(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: f.artifact(`connections-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  if (process.env.CONNECTION_VISUAL !== '0') {
    // The response substitution is deliberately invalid and exists only for visual evidence.
    const synthetic = async route => { const u = new URL(route.request().url()); const r = await route.fetch({ url: f.base + u.pathname + u.search }); const data = await r.json(); data.secret = 'tab_invalid_visual_fixture_0109'; await route.fulfill({ response: r, json: data }); };
    await page.route('**/api/user/api-keys', async route => { if (route.request().method() === 'POST') await synthetic(route); else await route.fallback(); });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await newConfiguration();
    assert((await recipe.innerText()).includes('tab_invalid_visual_fixture_0109'));
    assert((await recipe.getByRole('button', { name: '复制完整配置', exact: true }).getAttribute('class')).includes('bg-primary'));
    assert((await guide.getByRole('button', { name: '创建另一份', exact: true }).getAttribute('class')).includes('border'));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      await page.waitForTimeout(250);
      await page.screenshot({ path: f.artifact(`connections-generated-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.unroute('**/api/user/api-keys');
  }
  // Human without management privileges and agent both get a usable template only.
  const memberOnly = async route => { const u = new URL(route.request().url()); const r = await route.fetch({ url: f.base + u.pathname + u.search }); const data = await r.json(); data.actor.role = 'member'; await route.fulfill({ response: r, json: data }); };
  await page.route('**/api/members*', memberOnly);
  await page.reload();
  await panel.getByText('请联系企业所有者或管理员管理 API Key。', { exact: true }).waitFor();
  assert.equal(await guide.getByRole('button', { name: '创建接入配置', exact: true }).count(), 0);
  await template();
  await page.unroute('**/api/members*', memberOnly);
  const agentSession = async route => { const u = new URL(route.request().url()); const r = await route.fetch({ url: f.base + u.pathname + u.search }); const data = await r.json(); if (data?.user) data.user.kind = 'agent'; await route.fulfill({ response: r, json: data }); };
  await page.route('**/api/auth/get-session*', agentSession);
  await page.reload(); await template();
  assert.equal(await guide.getByRole('button', { name: '创建接入配置', exact: true }).count(), 0);
  await page.unroute('**/api/auth/get-session*', agentSession);
  for (const url of ['?tab=api-keys&client=codex', '?tab=site-api&client=cursor', '?tab=connections&section=api-keys&client=grok-bot']) {
    await page.goto(frontend + '/app/settings' + url); await template();
    await page.waitForURL(u => u.searchParams.get('tab') === 'connections');
  }
  await page.getByRole('tab', { name: '常规', exact: true }).click();
  await page.getByLabel('English', { exact: true }).click();
  await page.getByRole('tab', { name: 'Connect agents', exact: true }).click();
  await guide.getByRole('tab', { name: 'Cursor', exact: true }).click();
  await recipe.getByRole('button', { name: 'Copy template', exact: true }).click();
  assert.equal(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).mcpServers.tabdo.headers.Authorization, 'Bearer ' + placeholder);
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await page.getByLabel('中文', { exact: true }).click();
  await page.goto(frontend + '/docs/mcp?client=cursor'); await template();
  assert.equal(await guide.getByRole('link', { name: '前往工作台连接 Agent', exact: true }).getAttribute('href'), '/app/settings?tab=connections');
  assert(!(await guide.innerText()).includes(createdSecret));
  // Sign-out removes the authenticated page containing the transient credential.
  await page.goto(frontend + '/app/settings?tab=connections');
  await newConfiguration();
  await api('/auth/sign-out', {});
  await page.reload(); await page.waitForURL(url => !url.pathname.includes('/app/settings'));
  assert.equal(await page.getByTestId('connection-recipe').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS connections: single-page create/copy/switch, clipboard failure, delete failure/retry, secret lifecycle, legacy URLs/public docs, pagination/error retry/member/agent/keyboard, desktop themes.');
} finally { await f.close(); }
