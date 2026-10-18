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
  await page.goto(frontend + '/app/sites'); await page.getByRole('button', { name: '创建博客', exact: true }).click();
  const create = page.getByRole('dialog'); await create.getByLabel('博客名称', { exact: true }).fill('共享完整工具栏'); await create.getByRole('button', { name: '创建博客', exact: true }).click(); await page.getByTestId('blog-editor').waitFor();
  const siteId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: '新建文章', exact: true }).click();
  const writer = page.getByTestId('record-page'), body = writer.getByRole('textbox', { name: '正文内容', exact: true }), toolbar = writer.getByTestId('editor-toolbar');
  await body.waitFor(); await writer.getByRole('textbox', { name: '标题', exact: true }).fill('完整排版博客文章');
  await body.fill('/heading 2'); await page.getByRole('dialog', { name: '块命令', exact: true }).waitFor(); await body.press('Enter'); await page.keyboard.insertText('可发布的排版');
  assert.equal(await body.locator('h2').innerText(), '可发布的排版');
  await body.press('Meta+a'); await toolbar.getByRole('button', { name: '下划线', exact: true }).click();
  await toolbar.getByRole('button', { name: '文字颜色与高亮', exact: true }).click(); await page.getByRole('menuitem', { name: '蓝色', exact: true }).first().click();
  await toolbar.getByRole('button', { name: '对齐', exact: true }).click(); await page.getByRole('menuitem', { name: '居中对齐', exact: true }).click();
  await body.press('ArrowRight');
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await writer.evaluate(el => el.scrollWidth > el.clientWidth + 1), false); await assertToolbarFits(toolbar); await assertOrdinaryEditorActions(writer); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '返回文章', exact: true }).click(); await writer.waitFor({ state: 'hidden' });
  let blog = await command('getBlog', { siteId }), sources = await command('getBlogSources', { tableId: blog.config.tableId }); const article = sources.items[0], identity = { tableId: blog.config.tableId, rowId: article.rowId };
  const content = (await command('getDocument', identity)).content; assert(JSON.stringify(content).includes('underline')); assert(JSON.stringify(content).includes('#337ea9')); assert(JSON.stringify(content).includes('center'));
  assert.equal(blog.publishedRevisionId, null, 'writing and saving do not publish');
  await page.getByRole('checkbox', { name: '选择文章：完整排版博客文章', exact: true }).check(); await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '预览文章', exact: true }).first().click(); await page.frameLocator('iframe').getByRole('heading', { name: '完整排版博客文章', exact: true }).waitFor();
  blog = await command('getBlog', { siteId }); const preview = await command('createBlogPreview', { siteId, buildId: blog.revisionId, idempotencyKey: crypto.randomUUID() });
  const slug = article.cells[blog.config.mapping.slug], previewHtml = await (await fetch(new URL(`articles/${slug}.html`, preview.url))).text(); assert.match(previewHtml, /<u>(?:<[^>]+>)*可发布的排版(?:<\/[^>]+>)*<\/u>/); assert(previewHtml.includes('text-align:center')); assert(previewHtml.includes('color:#337ea9')); assert.equal(blog.publishedRevisionId, null);
  await page.getByRole('button', { name: '发布博客', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  blog = await command('getBlog', { siteId }); assert(blog.publishedRevisionId); const publicHtml = await (await fetch(`${blog.publicUrl}articles/${slug}.html`)).text(); assert.match(publicHtml, /<u>(?:<[^>]+>)*可发布的排版(?:<\/[^>]+>)*<\/u>/); assert(publicHtml.includes('text-align:center')); assert(publicHtml.includes('color:#337ea9'));
  await page.reload(); await page.getByTestId(`blog-source-${article.rowId}`).getByRole('button', { name: '写作', exact: true }).click(); await body.locator('h2 u').waitFor();
  assert.deepEqual((await command('getDocument', identity)).content, content);
  assert.deepEqual(f.errors, []); console.log('PASS reference blog: actual shared toolbar and slash, safe formatting, immediate-return flush, preview HTML, explicit publish, immutable persisted formats after reload; 1440/390 no overflow.');
} catch (error) { console.error(f.errors); await page.screenshot({ path: artifact('reference-blog-failure.png') }).catch(() => {}); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
