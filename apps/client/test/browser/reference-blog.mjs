import { createSiteViewFixture, rowBody } from "./helpers/site-fixture.mjs";
import assert from 'node:assert/strict';
import { assertToolbarFits, assertOrdinaryEditorActions } from './helpers/editor-layout.mjs';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath } from './fixture.mjs';
const directory = artifactPath('reference-blog-files');
const f = await createBrowserFixture({ name: 'Blog shared reference editor', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory, SITE_PUBLIC_ORIGIN: `http://localhost:${process.env.BROWSER_API_PORT}` } });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
try {
  const fixture = await createSiteViewFixture(api, command, '共享完整工具栏');
  await page.goto(frontend + `/app/sites/${fixture.id}`); await page.getByTestId('blog-editor').waitFor();
  await page.getByRole('button', { name: '新建记录', exact: true }).click();
  const writer = page.getByTestId('record-page'), body = writer.getByRole('textbox', { name: '正文内容', exact: true }), toolbar = writer.getByTestId('editor-toolbar');
  await body.waitFor(); await writer.getByRole('textbox', { name: '标题', exact: true }).fill('完整排版博客文章');
  await body.fill('/heading 2'); await page.getByRole('dialog', { name: '块命令', exact: true }).waitFor(); await body.press('Enter'); await page.keyboard.insertText('可发布的排版');
  assert.equal(await body.locator('h2').innerText(), '可发布的排版');
  await body.press('Meta+a'); await toolbar.getByRole('button', { name: '下划线', exact: true }).click();
  await toolbar.getByRole('button', { name: '文字颜色与高亮', exact: true }).click(); await page.getByRole('menuitem', { name: '蓝色', exact: true }).first().click();
  await toolbar.getByRole('button', { name: '对齐', exact: true }).click(); await page.getByRole('menuitem', { name: '居中对齐', exact: true }).click();
  await body.press('ArrowRight');
  for (const width of [1440, 1100]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await writer.evaluate(el => el.scrollWidth > el.clientWidth + 1), false); await assertToolbarFits(toolbar); await assertOrdinaryEditorActions(writer); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '返回记录列表', exact: true }).click(); await writer.waitFor({ state: 'hidden' });
  let view = await command('getView', { viewId: fixture.viewId }), sources = await command('queryRows', { tableId: fixture.tableId }); const article = sources.rows[0], identity = { rowId: article.id };
  const content = (await rowBody(command, identity)).content; assert(JSON.stringify(content).includes('underline')); assert(JSON.stringify(content).includes('#337ea9')); assert(JSON.stringify(content).includes('center'));
  assert.equal(view.site.publishedRevisionId, null);
  await page.getByRole('checkbox', { name: '选择文章：完整排版博客文章', exact: true }).check(); await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '发布站点', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  view = await command('getView', { viewId: fixture.viewId }); assert(view.site.publishedRevisionId); const publicHtml = await (await fetch(`${view.site.publicUrl}articles/${article.id}.html`)).text(); assert(publicHtml.includes('text-align:center')); assert(publicHtml.includes('color:#337ea9'));
  await page.reload(); await page.getByTestId(`blog-source-${article.id}`).getByRole('button', { name: '写作', exact: true }).click(); await body.locator('h2 u').waitFor();
  assert.deepEqual((await rowBody(command, identity)).content, content);
  assert.deepEqual(f.errors, []); console.log('PASS reference blog: actual shared toolbar and slash, safe formatting, immediate-return flush, preview HTML, explicit publish, immutable persisted formats after reload; 1440/390 no overflow.');
} catch (error) { console.error(f.errors); await page.screenshot({ path: artifact('reference-blog-failure.png') }).catch(() => {}); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
