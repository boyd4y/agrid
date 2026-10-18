import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rm, readFile } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath, pause } from './fixture.mjs';
const directory = artifactPath('blog-files'), port = process.env.BROWSER_API_PORT ?? '3152';
const fixture = await createBrowserFixture({ name: '博客浏览器作者', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory, SITE_PUBLIC_ORIGIN: `http://localhost:${port}`, REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:16392', QUEUE_PREFIX: 'agrid-queue-test-blog-browser' } });
const { page, api, frontend, base, browser, artifact, errors } = fixture;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const request = () => crypto.randomUUID();
let png;
const text = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
let visitor;
try {
  const svg = await readFile(new URL('../../public/illustrations/notioly/painting.svg', import.meta.url));
  await page.setViewportSize({ width: 720, height: 400 });
  await page.setContent(`<body style="margin:0;background:rgb(247 246 243);display:grid;place-items:center"><img style="height:360px;width:360px" src="data:image/svg+xml;base64,${svg.toString('base64')}"></body>`);
  await page.locator('img').evaluate(el => el.decode());
  png = (await page.screenshot({ path: artifact('blog-fixture-image.png') })).toString('base64');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const table = await api('/tables', { name: '团队手记' }), title = (await api(`/tables/${table.id}`)).columns[0];
  const slug = await command('addColumn', { tableId: table.id, name: '网址', type: 'text' });
  const summary = await command('addColumn', { tableId: table.id, name: '导语', type: 'text' });
  const category = await command('addColumn', { tableId: table.id, name: '栏目', type: 'text' });
  const secret = await command('addColumn', { tableId: table.id, name: '内部备注', type: 'text' });
  const articles = [];
  const names = ['把写作放回日常工作', '从一张表到一本工作手记', '未选择的私有草稿'];
  for (let i = 0; i < 3; i++) {
    const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: names[i], [slug.id]: `note-${i}`, [summary.id]: '记录具体的观察，把有价值的经验留给下一次行动。', [category.id]: '工作与写作', [secret.id]: 'DO-NOT-PUBLISH-INTERNAL' } });
    const content = { type: 'doc', content: [text('让想法，动起来。文章和属性保存在工作空间，只有明确选择并发布的内容才会公开。'), ...Array.from({ length: 5 }, (_, j) => [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: ['从一个小问题开始', '留下具体的观察', '把材料连成文章', '与读者分享', '继续修改与更新'][j] }] }, text('写作不必离开日常工作的现场。我们在整理资料、讨论问题和完成项目时，已经积累了许多值得留下的片段。把这些片段放回同一张内容表，可以从不同的方向理解它们；打开正文，则给思考一个完整展开的空间。'), text('发布是一次明确的选择。先读一遍文章，确认标题、作者名称和准备公开的图片，再把这一个版本交给读者。后续的修改仍留在自己的工作空间，直到下一次确认发布。')]).flat()] };
    await command('createDocument', { tableId: table.id, rowId: row.id, content, idempotencyKey: request() });
    const uploaded = await command('uploadDocumentImage', { tableId: table.id, rowId: row.id, expectedVersion: 1, name: `手记插图-${i}.png`, mimeType: 'image/png', base64: png, idempotencyKey: request() });
    content.content.splice(2, 0, { type: 'image', attrs: { fileId: uploaded.fileId, alt: '已选择的手记插图' } });
    await command('replaceDocument', { tableId: table.id, rowId: row.id, expectedVersion: 1, content, idempotencyKey: request() });
    articles.push({ row, content, image: uploaded });
  }
  await page.goto(frontend + '/app/sites');
  await page.getByRole('button', { name: '创建博客', exact: true }).click();
  const create = page.getByRole('dialog'); await create.getByLabel('博客名称', { exact: true }).fill('团队手记');
  const choose = async (label, value, root = page) => { await root.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: value, exact: true }).click(); };
  await create.getByRole('button', { name: '高级：绑定已有内容表', exact: true }).click();
  await choose('内容表', '团队手记', create); await choose('标题', title.name, create); await choose('网址 slug', '网址', create);
  await create.getByRole('button', { name: '创建博客', exact: true }).click(); await page.getByTestId('blog-editor').waitFor();
  const siteId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('checkbox', { name: `选择文章：${names[0]}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `选择文章：${names[1]}`, exact: true }).check();
  await page.getByTestId(`blog-source-${articles[0].row.id}`).getByRole('checkbox').nth(1).check();
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  await page.getByLabel('博客简介', { exact: true }).fill('分享实践中的观察、方法和未完待续的想法。');
  await page.getByRole('button', { name: '高级设置', exact: true }).click();
  await choose('摘要', '导语'); await choose('分类', '栏目');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '预览文章', exact: true }).first().click();
  const frame = page.frameLocator('iframe[title="博客模板预览"]'); await frame.getByRole('heading', { name: '团队手记', exact: true }).waitFor();
  assert.equal((await fetch(base + `/s/${siteId}/`)).status, 404);
  let blog = await command('getBlog', { siteId }); const buildId = blog.revisionId;
  assert.equal(blog.manifest.articles.length, 2); assert.equal(blog.manifest.assets.length, 1);
  assert(!(await frame.locator('body').innerText()).includes('未选择的私有草稿'));
  // Real populated desktop/mobile previews in both themes; no mock publication.
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(value => { localStorage.setItem('table-theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
    await frame.getByRole('heading', { name: '团队手记', exact: true }).waitFor(); await pause(100);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: artifact(`blog-editor-${width}-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '发布博客', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  blog = await command('getBlog', { siteId }); assert.equal(blog.publishedRevisionId, buildId);
  visitor = await browser.newContext({ javaScriptEnabled: false }); const publicPage = await visitor.newPage();
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 390]) for (const theme of process.env.BROWSER_SKIP_VISUALS ? [] : ['light', 'dark']) {
    await publicPage.setViewportSize({ width, height: 1000 }); await publicPage.emulateMedia({ colorScheme: theme });
    await publicPage.goto(blog.publicUrl + 'articles/note-0.html');
    await publicPage.getByRole('heading', { name: names[0], exact: true }).waitFor();
    assert.equal(await publicPage.locator('script').count(), 0); assert((await publicPage.locator('body').innerText()).includes('继续修改与更新'));
    assert.equal(await publicPage.locator('meta[property="og:title"]').getAttribute('content'), names[0] + ' · 团队手记');
    assert.equal(await publicPage.locator('img').count(), 1); assert.equal(await publicPage.locator('meta[name="description"]').getAttribute('content'), '记录具体的观察，把有价值的经验留给下一次行动。');
    await publicPage.locator('img').scrollIntoViewIfNeeded(); await publicPage.locator('img').evaluate(el => el.decode());
    assert(await publicPage.locator('img').evaluate(el => el.complete && el.naturalWidth > 0));
    await publicPage.evaluate(() => scrollTo(0, 0)); await pause(100);
    await publicPage.screenshot({ path: artifact(`blog-article-${width}-${theme}.png`), fullPage: true });
  }
  const html = await (await fetch(blog.publicUrl + 'articles/note-0.html')).text(); assert(!html.includes('DO-NOT-PUBLISH')); assert(!html.includes('tab_')); assert(!html.includes('document-assets'));
  await command('replaceDocument', { tableId: table.id, rowId: articles[0].row.id, expectedVersion: 2, content: { type: 'doc', content: [text('更新后的正文仅在再次发布后可见。')] }, idempotencyKey: request() });
  assert(!(await (await fetch(blog.publicUrl + 'articles/note-0.html')).text()).includes('更新后的正文'));
  await page.reload(); await page.getByRole('status').filter({ hasText: '有待发布变更' }).waitFor();
  await page.getByRole('button', { name: '预览文章', exact: true }).first().click(); await page.getByRole('button', { name: '发布博客', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  blog = await command('getBlog', { siteId }); assert((await (await fetch(blog.publicUrl + 'articles/note-0.html')).text()).includes('更新后的正文'));
  const oldRevision = blog.revisionId;
  await page.getByRole('tab', { name: '文章', exact: true }).click();
  const online = page.getByRole('group').filter({ has: page.locator('legend').filter({ hasText: '当前线上文章' }) });
  await online.getByRole('button', { name: '撤回文章', exact: true }).first().click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  // Sort order is deterministic UUID order; resolve the recalled slug from the actual publication projection.
  const recalled = await command('getBlog', { siteId }), remaining = recalled.publishedArticles[0], withdrawn = blog.publishedArticles.find(a => !recalled.publishedArticles.some(b => b.rowId === a.rowId));
  assert.equal((await fetch(blog.publicUrl + `articles/${withdrawn.slug}.html`)).status, 404);
  assert.equal((await fetch(blog.publicUrl + `v/${oldRevision}/articles/${withdrawn.slug}.html`)).status, 404);
  assert.equal((await fetch(blog.publicUrl + `articles/${remaining.slug}.html`)).status, 200);
  // Exercise all five independent grant families in the integrated UI and real API clients.
  const calendar = await command('createCalendar', { name: '博客编辑日历', timeZone: 'UTC', idempotencyKey: request() });
  const plan = await command('createAutomation', { name: '博客编辑计划', source: { kind: 'schedule', cron: '0 10 * * *', timeZone: 'UTC' }, trigger: { type: 'schedule_due' }, actions: [{ type: 'command', command: 'addRow', input: { tableId: table.id } }] });
  const calendarPermissions = [{ calendarId: calendar.id, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, canTriggerAgent: true }];
  const schedulePermissions = [{ automationId: plan.id, canRead: true, canUpdate: false }];
  const rangeStart = new Date(), rangeEnd = new Date(rangeStart.getTime() + 3 * 86400000);
  const occurrenceInput = { automationIds: [plan.id], rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() };
  // MCP stdio uses the public capability API; read permission cannot publish.
  const key = await api('/user/api-keys', { name: 'Blog MCP', calendarPermissions, schedulePermissions, permissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }], documentPermissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false }], blogPermissions: [{ tableId: table.id, canRead: true, canConfigure: false, canBuild: false, canPublish: false, canRestore: false }] });
  const require = createRequire(new URL('../../../mcp/package.json', import.meta.url)), { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js')), { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
  const { createClient } = await import(new URL('../../../../packages/sdk/dist/index.js', import.meta.url));
  const sdk = createClient({ url: base, key: key.secret });
  assert.equal((await sdk.blogs.getBlog({ siteId })).id, siteId);
  const originalDocument = await command('getDocument', { tableId: table.id, rowId: remaining.rowId });
  assert.equal((await sdk.documents.getDocument({ tableId: table.id, rowId: remaining.rowId })).id, originalDocument.id);
  assert.equal((await sdk.calendar.getCalendar({ calendarId: calendar.id })).id, calendar.id);
  assert((await sdk.calendar.queryScheduledOccurrences(occurrenceInput)).items.length);
  const client = new Client({ name: 'blog-smoke', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: 'pnpm', args: ['--filter', '@tabdo/mcp', 'exec', 'tsx', 'src/index.ts'], cwd: new URL('../../../../', import.meta.url).pathname, env: { PATH: process.env.PATH, TABDO_API_URL: base, TABDO_API_KEY: key.secret } }));
    const catalog = (await client.listTools()).tools;
    for (const name of ['publish_blog', 'get_document', 'get_calendar', 'query_scheduled_occurrences', 'set_booking_reminders']) assert(catalog.some(t => t.name === name));
    for (const [name, args] of [['get_document', { tableId: table.id, rowId: remaining.rowId }], ['get_calendar', { calendarId: calendar.id }], ['query_scheduled_occurrences', occurrenceInput]]) assert(!(await client.callTool({ name, arguments: args })).isError, name);
    assert(!(await client.callTool({ name: 'get_blog', arguments: { siteId } })).isError);
    assert((await client.callTool({ name: 'unpublish_blog', arguments: { siteId, expectedVersion: recalled.version, expectedPublishedRevisionId: recalled.publishedRevisionId, idempotencyKey: request() } })).isError);
  } finally { await client.close(); }
  await page.goto(frontend + '/app/settings?tab=api-keys'); await page.getByRole('button', { name: '编辑 Blog MCP', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: '团队手记 · 构建与分享预览', exact: true }).check(); await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const edited = (await api('/user/api-keys')).keys.find(v => v.id === key.key.id); assert.deepEqual(edited.permissions, key.key.permissions); assert.deepEqual(edited.documentPermissions, key.key.documentPermissions); assert.deepEqual(edited.calendarPermissions, key.key.calendarPermissions); assert.deepEqual(edited.schedulePermissions, key.key.schedulePermissions); assert.equal(edited.blogPermissions[0].canBuild, true);
  await page.goto(frontend + `/app/sites/${siteId}`); await page.getByRole('button', { name: '撤下整站', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.equal((await fetch(blog.publicUrl)).status, 404);
  // Boundary copy must wrap in the static reader, including without JavaScript.
  await command('updateCell', { rowId: articles[1].row.id, columnId: category.id, value: 'W'.repeat(80), expectedVersion: 1 });
  let longBlog = await command('saveBlog', { name: 'W'.repeat(100), config: { tableId: table.id, authorName: 'Public author', language: 'en', description: 'Long-word responsive fixture', mapping: { title: title.id, slug: slug.id, category: category.id }, articles: [{ rowId: articles[1].row.id, imageIds: [] }] }, idempotencyKey: request() });
  longBlog = await command('buildBlog', { siteId: longBlog.id, expectedVersion: longBlog.version, idempotencyKey: request() });
  const intent = { siteId: longBlog.id, expectedVersion: longBlog.version, expectedPublishedRevisionId: null, buildId: longBlog.revisionId };
  const permit = await command('authorizeBlogPublication', { ...intent, action: 'publishBlog', idempotencyKey: request() });
  await command('publishBlog', { ...intent, authorizationToken: permit.authorizationToken, idempotencyKey: request() });
  for (const theme of process.env.BROWSER_SKIP_VISUALS ? [] : ['light', 'dark']) {
    await publicPage.setViewportSize({ width: 390, height: 1000 }); await publicPage.emulateMedia({ colorScheme: theme });
    await publicPage.goto(longBlog.publicUrl);
    assert(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await publicPage.screenshot({ path: artifact(`blog-longword-390-${theme}.png`), fullPage: true });
  }
  // The workspace slot reuses the editor without a second title or refresh bar.
  await page.goto(frontend + '/app');
  await page.getByTestId('workspace-home-split').waitFor();
  const openPreview = payload => page.evaluate(detail => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail })), payload);
  await openPreview({ kind: 'site', siteId });
  const slot = page.getByTestId('workspace-preview-slot'), slotHeader = slot.getByTestId('preview-slot-header');
  await slotHeader.getByRole('tab', { name: '站点 · 团队手记', exact: true }).waitFor();
  assert.equal(await slot.locator('header').count(), 1);
  assert.equal(await slot.getByRole('button', { name: /刷新/ }).count(), 1);
  assert.equal(await slot.getByRole('heading', { name: '团队手记', exact: true }).count(), 0);
  await slot.getByRole('tab', { name: '配置', exact: true }).click();
  await slot.getByLabel('博客简介', { exact: true }).fill('切换后保留的博客配置草稿');
  assert(await slotHeader.getByRole('button', { name: '刷新工作面板', exact: true }).isDisabled());
  await slotHeader.getByRole('button', { name: '关闭站点 · 团队手记 Tab', exact: true }).click();
  await page.getByRole('dialog').getByRole('heading', { name: '仍有内容未保存', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '继续编辑', exact: true }).first().click();
  assert.equal(await slot.getByLabel('博客简介', { exact: true }).inputValue(), '切换后保留的博客配置草稿');
  await openPreview({ kind: 'table', tableId: table.id });
  await slotHeader.getByRole('tab', { name: '站点 · 团队手记', exact: true }).click();
  assert.equal(await slot.getByLabel('博客简介', { exact: true }).inputValue(), '切换后保留的博客配置草稿');
  await slotHeader.getByRole('button', { name: '关闭站点 · 团队手记 Tab', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保留草稿并离开', exact: true }).click();
  await slot.getByTestId('blog-editor').waitFor({ state: 'hidden' });
  await openPreview({ kind: 'site', siteId });
  await slot.getByRole('tab', { name: '配置', exact: true }).click();
  assert.equal(await slot.getByLabel('博客简介', { exact: true }).inputValue(), '切换后保留的博客配置草稿');
  await slot.getByRole('button', { name: '保存配置', exact: true }).click();
  await slot.getByRole('status').filter({ hasText: /有待发布变更|线上为当前已发布副本/ }).waitFor();
  const blogRefresh = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/commands') && request.postDataJSON()?.command === 'getBlog');
  await slotHeader.getByRole('button', { name: '刷新工作面板', exact: true }).click(); await blogRefresh;
  await page.goto(frontend + `/app/sites/${siteId}`);
  await page.getByTestId('blog-editor').getByRole('heading', { name: '团队手记', exact: true }).waitFor();
  await page.evaluate(() => localStorage.setItem('tabdo.locale', 'en')); await page.setViewportSize({ width: 390, height: 1000 }); await page.reload();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Preview');
  await page.keyboard.press('ArrowLeft');
  await page.getByLabel('Default public author name', { exact: true }).waitFor();
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('blog-settings-390-en-dark.png'), fullPage: true });
  assert.deepEqual(errors, []); console.log('PASS blogs: UI template/mapping/explicit selection/preview/publish/update/recall; anonymous no-JS HTML; 1440/390 light/dark; MCP/SDK calendar+documents+blogs and five-family key preservation');
} catch (error) { await page.screenshot({ path: artifact('blogs-failure.png'), fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'no page')); throw error; }
finally { await visitor?.close(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
