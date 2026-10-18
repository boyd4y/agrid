import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath, pause } from './fixture.mjs';
const directory = artifactPath('unified-writing-files');
const f = await createBrowserFixture({ name: '统一写作验收', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory, SITE_PUBLIC_ORIGIN: `http://localhost:${process.env.BROWSER_API_PORT}`, REDIS_URL: process.env.REDIS_URL, QUEUE_PREFIX: process.env.HERDR_TEAM_REDIS_PREFIX } });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const nativeDialogs = []; page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });
const command = async (command, input) => (await api('/commands', { command, input })).result;
const saved = root => root.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
const body = root => root.getByRole('textbox', { name: '正文内容', exact: true });
try {
  const table = await api('/tables', { name: '记录本身就是页面' }), title = (await api(`/tables/${table.id}`)).columns[0];
  const content = await command('addColumn', { tableId: table.id, name: '内容', type: 'text' });
  const first = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '原始标题', [content.id]: '自建内容列保留' } });
  const second = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '另一条记录' } });
  const identity = { tableId: table.id, rowId: first.id };
  await page.goto(frontend + `/app/tables/${table.id}`);
  await page.getByTestId(`open-grid-record-${first.id}`).click();
  const panel = page.getByTestId('related-record-panel'); await body(panel).waitFor();
  assert.equal(await panel.locator('[data-rich-text-editor]').count(), 1);
  assert.equal(await panel.getByRole('button', { name: '启用正文', exact: true }).count(), 0);
  assert.equal(await panel.getByRole('button', { name: '正文', exact: true }).count(), 0);
  assert.equal(await command('getDocument', identity), null, 'opening does not create a document');
  assert.equal(await panel.getByRole('textbox', { name: title.name, exact: true }).count(), 1);
  // No debounce wait: normal close must flush both independent saves without a decision dialog.
  await panel.getByRole('textbox', { name: title.name, exact: true }).fill('立即关闭也保存标题');
  await body(panel).fill('输入后立即关闭：同一记录的正文。');
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('heading', { name: '仍有内容未保存' }).count(), 0);
  assert.equal((await command('getRow', { rowId: first.id })).cells[title.id], '立即关闭也保存标题');
  assert(JSON.stringify((await command('getDocument', identity)).content).includes('输入后立即关闭'));
  await page.getByTestId(`open-grid-record-${first.id}`).click(); await body(panel).waitFor();
  assert((await body(panel).innerText()).includes('输入后立即关闭')); assert.equal((await command('getRow', { rowId: first.id })).cells[content.id], '自建内容列保留');
  // Saving one part does not claim the whole page is saved when the body fails.
  let failBody = true;
  const reject = async route => { const request = route.request(); if (failBody && request.method() === 'POST' && request.postDataJSON().command === 'replaceDocument') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'REQUEST_FAILED' }) }); else await route.fallback(); };
  await page.route('**/api/commands', reject);
  await panel.getByRole('textbox', { name: title.name, exact: true }).fill('标题已保存正文失败'); await body(panel).fill('网络失败仍保留的正文草稿');
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click();
  const leave = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '仍有内容未保存', exact: true }) }); await leave.waitFor();
  assert.equal((await command('getRow', { rowId: first.id })).cells[title.id], '标题已保存正文失败');
  await leave.getByRole('button', { name: '保留草稿并离开', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  await page.getByTestId(`open-grid-record-${second.id}`).click(); await body(panel).waitFor(); assert.equal((await body(panel).innerText()).trim(), '');
  assert.equal(await command('getDocument', { tableId: table.id, rowId: second.id }), null);
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  failBody = false; await page.unroute('**/api/commands', reject);
  await page.getByTestId(`open-grid-record-${first.id}`).click(); await saved(panel);
  assert((await body(panel).innerText()).includes('网络失败仍保留'));
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 }); await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme); await pause(150);
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: artifact(`unified-record-${width}-${theme}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  await page.goto(frontend + '/app/sites'); await page.getByRole('button', { name: '创建博客', exact: true }).click();
  const create = page.getByRole('dialog'); await create.getByLabel('博客名称', { exact: true }).fill('中文直接写作');
  assert.equal(await create.getByRole('combobox').count(), 0, 'field mapping is optional');
  await create.getByRole('button', { name: '创建博客', exact: true }).click(); await page.getByTestId('blog-editor').waitFor();
  const siteId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: '新建文章', exact: true }).click();
  const writer = page.getByTestId('record-page'); await body(writer).waitFor();
  assert.equal(await page.getByTestId('related-record-panel').count(), 0, 'blog writing stays in the blog surface');
  await writer.getByRole('textbox', { name: '标题', exact: true }).fill('不需要英文标题的文章'); await body(writer).fill('博客中直接写，表格里也是同一篇正文。');
  // Immediate return flushes, so the article can be selected and published without reopening a table.
  await page.getByRole('button', { name: '返回文章', exact: true }).click(); await writer.waitFor({ state: 'hidden' });
  let blog = await command('getBlog', { siteId }), sources = await command('getBlogSources', { tableId: blog.config.tableId });
  assert.equal(sources.items.length, 1); const article = sources.items[0]; assert.equal(article.cells[blog.config.mapping.title], '不需要英文标题的文章'); assert.equal(article.documentVersion, 1);
  const slug = article.cells[blog.config.mapping.slug]; assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.deepEqual(blog.config.articles, []); assert.equal(blog.publishedRevisionId, null);
  await page.getByTestId(`blog-source-${article.rowId}`).getByRole('button', { name: '写作', exact: true }).click(); await body(writer).waitFor();
  assert((await body(writer).innerText()).includes('表格里也是同一篇'));
  assert.equal(await writer.locator('[data-rich-text-editor]').count(), 1);
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 }); await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme); await pause(150);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await writer.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: artifact(`unified-blog-${width}-${theme}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('button', { name: '返回文章', exact: true }).click(); await writer.waitFor({ state: 'hidden' });
  await page.getByRole('checkbox', { name: '选择文章：不需要英文标题的文章', exact: true }).check(); await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '预览文章', exact: true }).first().click();
  await page.frameLocator('iframe').getByRole('heading', { name: '不需要英文标题的文章', exact: true }).waitFor();
  blog = await command('getBlog', { siteId }); assert.equal(blog.publishedRevisionId, null);
  await page.getByRole('button', { name: '发布博客', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  blog = await command('getBlog', { siteId }); assert(blog.publishedRevisionId);
  assert((await (await fetch(`${blog.publicUrl}articles/${slug}.html`)).text()).includes('博客中直接写'));
  await page.reload(); await page.getByTestId(`blog-source-${article.rowId}`).getByRole('button', { name: '写作', exact: true }).click(); await body(writer).waitFor();
  assert((await body(writer).innerText()).includes('博客中直接写')); await page.getByRole('button', { name: '返回文章', exact: true }).click();
  assert.equal((await command('getRow', { rowId: article.rowId })).cells[blog.config.mapping.slug], slug);
  await page.goto(frontend + `/app/tables/${blog.config.tableId}`); await page.getByTestId(`open-grid-record-${article.rowId}`).click(); await body(panel).waitFor();
  assert((await body(panel).innerText()).includes('博客中直接写')); assert.equal(await panel.getByRole('textbox', { name: '标题', exact: true }).inputValue(), '不需要英文标题的文章');
  // Workspace changes flush in the old scope; a failure uses the same dialog and preserves its draft.
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  const originalWorkspace = (await command('getWorkspace', {})).workspace;
  const otherWorkspace = await command('createWorkspace', { name: '独立写作工作区' });
  await page.reload();
  const switchTo = async name => { await page.getByTestId('workspace-switcher').click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
  await page.goto(frontend + `/app/sites/${siteId}?workspace=${originalWorkspace.id}`); await page.getByTestId(`blog-source-${article.rowId}`).getByRole('button', { name: '写作', exact: true }).click(); await body(writer).waitFor();
  await body(writer).fill('切换工作区前立即保存');
  await switchTo(otherWorkspace.name); await page.waitForURL(url => url.searchParams.get('workspace') === otherWorkspace.id); await page.locator(`[data-testid="workspace-switcher"][title="${otherWorkspace.name}"]`).waitFor();
  assert(JSON.stringify((await command('getDocument', { tableId: blog.config.tableId, rowId: article.rowId })).content).includes('切换工作区前立即保存'));
  await switchTo(originalWorkspace.name); await page.waitForURL(url => url.searchParams.get('workspace') === originalWorkspace.id); await page.locator(`[data-testid="workspace-switcher"][title="${originalWorkspace.name}"]`).waitFor();
  await page.goto(frontend + `/app/sites/${siteId}?workspace=${originalWorkspace.id}`); await page.getByTestId(`blog-source-${article.rowId}`).getByRole('button', { name: '写作', exact: true }).click(); await body(writer).waitFor();
  failBody = true; await page.route('**/api/commands', reject); await body(writer).fill('切换失败后保留在原工作区的草稿');
  await switchTo(otherWorkspace.name); await page.getByRole('heading', { name: '仍有内容未保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).last().click();
  assert.equal(new URL(page.url()).searchParams.get('workspace'), originalWorkspace.id);
  await switchTo(otherWorkspace.name); await page.getByRole('heading', { name: '仍有内容未保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click(); await page.waitForURL(url => url.searchParams.get('workspace') === otherWorkspace.id); await page.locator(`[data-testid="workspace-switcher"][title="${otherWorkspace.name}"]`).waitFor();
  failBody = false; await page.unroute('**/api/commands', reject);
  await switchTo(originalWorkspace.name); await page.waitForURL(url => url.searchParams.get('workspace') === originalWorkspace.id); await page.locator(`[data-testid="workspace-switcher"][title="${originalWorkspace.name}"]`).waitFor();
  await page.goto(frontend + `/app/sites/${siteId}?workspace=${originalWorkspace.id}`); await page.getByTestId(`blog-source-${article.rowId}`).getByRole('button', { name: '写作', exact: true }).click(); await saved(writer);
  assert((await body(writer).innerText()).includes('切换失败后保留在原工作区'));
  assert.deepEqual(nativeDialogs, []); assert.deepEqual(f.errors, []);
  console.log('PASS unified writing: lazy open, inline title/properties/body, immediate close flush, partial save failure/dialog/retry, per-record drafts, default blog, Chinese/stable slug, immediate return/select/preview/publish, refresh, table reuse and workspace flush/cancel/draft recovery; 1440/390/320 light+dark.');
} catch (error) { await page.screenshot({ path: artifact('unified-writing-failure.png'), fullPage: false }).catch(() => {}); console.error(f.errors); console.error(await page.locator('body').innerText().catch(() => 'no page')); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
