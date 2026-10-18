import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, pause, artifact as artifactPath } from './fixture.mjs';
const imageDirectory = artifactPath('document-files');
const fixture = await createBrowserFixture({ name: 'Document browser', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: imageDirectory, REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:16387', QUEUE_PREFIX: process.env.QUEUE_PREFIX ?? 'agrid-queue-test-document-browser' } });
const { page, api, frontend, errors, artifact } = fixture;
page.setDefaultTimeout(12000);
page.on("dialog", dialog => dialog.accept());
const command = async (command, input) => (await api('/commands', { command, input })).result;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQIHWP4DwABAQEAG7buVgAAAABJRU5ErkJggg==', 'base64');
try {
  const table = await api('/tables', { name: '文章' }), title = (await api(`/tables/${table.id}`)).columns[0];
  const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '中文长文编辑验证' } });
  const identity = { tableId: table.id, rowId: row.id };
  await page.goto(frontend + `/app/tables/${table.id}`);
  await page.getByTestId('global-ai-toggle').waitFor();
  const open = async (target = page) => {
    await target.getByTestId("global-ai-toggle").waitFor();
    await target.getByTestId(`open-grid-record-${row.id}`).click();
    await target.getByTestId('document-editor').waitFor();
  };
  console.log("stage open"); await open();
  const modal = page.getByTestId('related-record-panel'), body = modal.getByRole('textbox', { name: '正文内容' });
  await body.fill('中文正文：让想法动起来。');
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert(JSON.stringify((await command('getDocument', identity)).content).includes('中文正文'));
  console.log("stage saved initial");
  // Chromium's real composition path: no autosave while the composition is open.
  await body.locator('p').last().click(); await page.keyboard.press('Meta+ArrowDown');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '中文输入法', selectionStart: 5, selectionEnd: 5 });
  const before = (await command('getDocument', identity)).version; await pause(1100);
  assert.equal((await command('getDocument', identity)).version, before);
  await cdp.send('Input.insertText', { text: '中文输入法' });
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert(JSON.stringify((await command('getDocument', identity)).content).includes('中文输入法'));
  console.log("stage IME committed");
  await page.keyboard.press('Enter'); await modal.getByTestId('editor-toolbar').getByRole('button', { name: '正文', exact: true }).click(); await page.getByRole('menuitem', { name: '标题 2', exact: true }).click(); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '正文内容'); await page.keyboard.insertText('可视化标题');
  await page.keyboard.press('Enter'); await page.keyboard.type('正文段落');
  await page.keyboard.press('Enter'); await modal.getByTestId('editor-toolbar').getByRole('button', { name: '无序列表', exact: true }).click(); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '正文内容'); await page.keyboard.insertText('列表一');
  await page.keyboard.press('Enter'); await page.keyboard.insertText('列表二'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.evaluate(() => { window.__documentXss = false; });
  await body.evaluate(element => {
    const data = new DataTransfer(); data.setData('text/html', '<p><strong>粘贴加粗</strong> <a href="javascript:window.__documentXss=true">危险链接</a><img src="x" onerror="window.__documentXss=true"></p><script>window.__documentXss=true</script>'); data.setData('text/plain', '粘贴加粗 危险链接');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await page.evaluate(() => window.__documentXss), false);
  const formatted = (await command('getDocument', identity)).content;
  assert(formatted.content.some(n => n.type === 'heading')); assert(formatted.content.some(n => n.type === 'bulletList' && JSON.stringify(n).includes('列表一'))); assert(!JSON.stringify(formatted).includes('javascript:'));
  console.log("stage formatting");
  // Upload uses the actual local storage adapter and a stable private asset reference.
  await modal.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await modal.locator('figure img').waitFor(); await page.waitForFunction(() => document.querySelector('[data-testid="document-editor"] figure img')?.naturalWidth > 0);
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  const withImage = await command('getDocument', identity); assert(JSON.stringify(withImage.content).includes('fileId')); assert(!JSON.stringify(withImage.content).includes('blob:'));
  const pageRows = await command('queryRows', { tableId: table.id }); assert(!JSON.stringify(pageRows).includes('粘贴加粗')); assert(!JSON.stringify(pageRows).includes('fileId'));
  console.log("stage image");
  let rejectSave = true;
  const failSave = async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().command === 'replaceDocument' && rejectSave) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture failure', code: 'REQUEST_FAILED' }) });
    else await route.fallback();
  };
  await page.route('**/api/commands', failSave);
  await body.locator('p').last().click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.type(' Network draft');
  await modal.getByRole('status').filter({ hasText: '保存失败' }).waitFor(); assert((await body.innerText()).includes('Network draft'));
  await modal.getByRole('button', { name: '关闭记录', exact: true }).click(); await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  rejectSave = false; await page.unroute('**/api/commands', failSave); await open();
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor(); assert(JSON.stringify((await command('getDocument', identity)).content).includes('Network draft')); assert(JSON.stringify((await command('getDocument', identity)).content).includes('fileId'));
  // A later save response must not replace text typed after that request started.
  let release, started; const hold = new Promise(resolve => { release = resolve; }), saving = new Promise(resolve => { started = resolve; });
  let held = false;
  const slow = async route => { const request = route.request(); if (!held && request.method() === 'POST' && request.postDataJSON().command === 'replaceDocument') { held = true; const response = await route.fetch({ url: fixture.base + "/api/commands" }); started(); await hold; await route.fulfill({ response }); } else await route.fallback(); };
  await page.route('**/api/commands', slow);
  await body.locator('p').last().click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.type(' first'); await saving;
  await page.keyboard.type(' newer'); release();
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await page.unroute('**/api/commands', slow);
  assert(JSON.stringify((await command('getDocument', identity)).content).includes('first newer'));
  await page.reload(); await open(); assert((await body.innerText()).includes('first newer')); await page.waitForFunction(() => document.querySelector('[data-testid="document-editor"] figure img')?.naturalWidth > 0);
  console.log("stage old save response");
  // Real second client loads a version, first client changes it, second keeps its local draft.
  const second = await page.context().newPage(); second.setDefaultTimeout(12000); second.on("dialog", dialog => dialog.accept());
  await second.route('**/api/**', async route => { const url = new URL(route.request().url()); const response = await route.fetch({ url: fixture.base + url.pathname + url.search }); await route.fulfill({ response }); });
  await second.goto(frontend + `/app/tables/${table.id}`); await second.getByTestId('global-ai-toggle').waitFor(); await open(second);
  const secondModal = second.getByTestId('related-record-panel'), secondBody = secondModal.getByRole('textbox', { name: '正文内容' }); await secondBody.waitFor();
  await body.locator('p').last().click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.type(' Server change'); await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await secondBody.locator('p').last().click(); await second.keyboard.press('Meta+ArrowDown'); await second.keyboard.type(' Local conflict draft');
  await secondModal.getByRole('status').filter({ hasText: '部分内容保存失败' }).waitFor(); assert((await secondBody.innerText()).includes('Local conflict draft'));
  await second.reload(); await open(second); await secondModal.getByRole('status').filter({ hasText: '部分内容保存失败' }).waitFor(); assert((await secondBody.innerText()).includes('Local conflict draft'));
  await secondModal.getByRole('button', { name: '查看服务器内容' }).click(); await secondModal.getByText('当前服务器内容', { exact: true }).waitFor(); assert(!(await secondBody.innerText()).includes('Local conflict draft'));
  await secondModal.getByRole('button', { name: '返回当前草稿' }).click(); assert((await secondBody.innerText()).includes('Local conflict draft')); await second.close();
  for (const name of ['阅读', '编辑', '历史']) assert.equal(await modal.getByRole('button', { name, exact: true }).count(), 0);
  await modal.getByRole('button', { name: '正文更多操作', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: '历史', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  // Seed realistic content through the same public command for the visual matrix.
  const doc = await command('getDocument', identity); await command('replaceDocument', { ...identity, expectedVersion: doc.version, content: withImage.content, idempotencyKey: crypto.randomUUID() });
  await page.reload(); await open(); await body.waitFor(); await page.waitForFunction(() => document.querySelector('[data-testid="document-editor"] figure img')?.naturalWidth > 0);
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme); await pause(300);
    const overflow = await modal.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); assert(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
    await page.screenshot({ path: artifact(`documents-${width}-${theme}.png`), fullPage: true });
  }
  // A real MCP stdio client talks to this isolated API and executes shared commands.
  const require = createRequire(new URL('../../../mcp/package.json', import.meta.url));
  const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
  const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
  const calendar = await command('createCalendar', { name: '正文 Key 兼容日历', timeZone: 'UTC', idempotencyKey: crypto.randomUUID() });
  const agent = (await api('/members/agents', { name: '正文 Key 兼容助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; fixture.users.push(agent.userId);
  const plan = await command('createAutomation', { name: '正文 Key 兼容计划', source: { kind: 'schedule', cron: '0 10 * * *', timeZone: 'UTC' }, trigger: { type: 'schedule_due' }, actions: [{ type: 'run_agent', agentUserId: agent.userId, prompt: 'Read only' }] });
  const scheduleGrants = [{ automationId: plan.id, canRead: true, canUpdate: false }];
  const oldTableGrants = [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }];
  const oldCalendarGrants = [{ calendarId: calendar.id, canRead: true, canReadAvailability: true, canCreate: false, canUpdate: false, canCancel: false, canManage: false, canTriggerAgent: false, canSubscribe: false, canReadDeliveries: false, canManageSubscriptions: false }];
  const key = await api('/user/api-keys', { name: 'Document MCP', schedulePermissions: scheduleGrants, permissions: oldTableGrants, calendarPermissions: oldCalendarGrants, documentPermissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: true, canReadHistory: false, canRestore: false, canUpload: false }] });
  const transport = new StdioClientTransport({ command: 'pnpm', args: ['--filter', '@tabdo/mcp', 'exec', 'tsx', 'src/index.ts'], cwd: new URL('../../../../', import.meta.url).pathname, env: { PATH: process.env.PATH, TABDO_API_URL: fixture.base, TABDO_API_KEY: key.secret } });
  const client = new Client({ name: 'document-browser-smoke', version: '1.0.0' });
  try {
    console.log('stage MCP connect'); await client.connect(transport); console.log('stage MCP list tools'); const tools = await client.listTools(); assert(tools.tools.some(t => t.name === 'replace_document')); assert(tools.tools.some(t => t.name === 'create_blog')); assert(tools.tools.some(t => t.name === 'start_blog_article')); assert(tools.tools.some(t => t.name === 'list_booking_reminders'));
    console.log('stage MCP read calendar'); const calendarRead = await client.callTool({ name: 'get_calendar', arguments: { calendarId: calendar.id } }); assert(!calendarRead.isError); assert.equal(JSON.parse(calendarRead.content[0].text).id, calendar.id);
    console.log('stage MCP read plan');
    const rangeStart = new Date().toISOString(), rangeEnd = new Date(Date.now() + 86400000).toISOString();
    const projected = await client.callTool({ name: 'query_scheduled_occurrences', arguments: { automationIds: [plan.id], rangeStart, rangeEnd } }); assert(!projected.isError); assert.equal(JSON.parse(projected.content[0].text).items.length, 1);
    console.log('stage MCP read document'); const read = await client.callTool({ name: 'get_document', arguments: identity }); assert(!read.isError); const value = JSON.parse(read.content[0].text);
    console.log('stage MCP replace document'); const replaced = await client.callTool({ name: 'replace_document', arguments: { ...identity, expectedVersion: value.version, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MCP stdio persisted' }] }] }, idempotencyKey: crypto.randomUUID() } }); assert(!replaced.isError); assert(JSON.stringify((await command('getDocument', identity)).content).includes('MCP stdio persisted'));
    for (const name of ['list_document_revisions', 'get_document_revision', 'restore_document_revision']) assert(!tools.tools.some(tool => tool.name === name));
  } finally { await client.close(); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(frontend + '/app/settings?tab=api-keys');
  await page.getByRole('button', { name: '编辑 Document MCP', exact: true }).click();
  const keyDialog = page.getByRole('dialog');
  assert(await keyDialog.getByRole('checkbox', { name: '文章 · 读取正文与图片', exact: true }).isChecked());
  assert.equal(await keyDialog.getByRole('checkbox', { name: '文章 · 读取历史', exact: true }).count(), 0);
  assert.equal(await keyDialog.getByRole('checkbox', { name: '文章 · 恢复历史', exact: true }).count(), 0);
  await keyDialog.getByRole('checkbox', { name: '文章 · 上传图片', exact: true }).check();
  await keyDialog.getByRole('button', { name: '保存', exact: true }).click(); await keyDialog.waitFor({ state: 'hidden' });
  const updatedKey = (await api('/user/api-keys')).keys.find(k => k.id === key.key.id);
  assert.equal(updatedKey.documentPermissions[0].canUpload, true);
  assert.deepEqual(updatedKey.permissions, oldTableGrants);
  assert.deepEqual(updatedKey.calendarPermissions, oldCalendarGrants);
  assert.deepEqual(updatedKey.schedulePermissions, scheduleGrants);
  await page.reload(); await page.getByRole('button', { name: '编辑 Document MCP', exact: true }).click();
  assert(await page.getByRole('dialog').getByRole('checkbox', { name: '文章 · 上传图片', exact: true }).isChecked());
  await page.getByRole('dialog').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).waitFor();
  await page.screenshot({ path: artifact('key-capabilities-bottom.png'), fullPage: false, animations: 'disabled' });
  assert.deepEqual(errors, []); console.log('PASS documents: Chinese composition, formatting/paste, private images, autosave, refresh, old response, second-client conflict draft/current-server comparison, retired history catalog, light/dark/mobile and real MCP stdio');
} catch (error) { await page.screenshot({ path: artifact("documents-failure.png"), fullPage: true }).catch(() => {}); console.error(await page.locator("[data-document-file], [data-private-source]").evaluateAll(elements => elements.map(el => ({ html: el.outerHTML, natural: el.naturalWidth }))).catch(() => [])); console.error(await page.locator("body").innerText().catch(() => "no page")); throw error; } finally { await fixture.close(); await rm(imageDirectory, { recursive: true, force: true }); }
