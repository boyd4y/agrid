import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Blog refresh controls' });
const { page, api, frontend } = fixture;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const actions = page.getByTestId('blog-editor-actions');
const refresh = actions.getByRole('button', { name: '重新读取', exact: true });
const enabled = () => page.waitForFunction(() => document.querySelector('[data-testid=blog-editor-actions] button[aria-label="重新读取"]')?.disabled === false);
try {
  const blog = await command('createBlog', { name: 'Refresh regression', idempotencyKey: crypto.randomUUID() });
  await page.goto(frontend + `/app/sites/${blog.id}`); await refresh.waitFor(); await enabled();
  const commands = []; let release;
  const hold = async route => {
    const name = route.request().postDataJSON()?.command; commands.push(name);
    if (name === 'getBlog') await new Promise(resolve => { release = resolve; });
    await route.fallback();
  };
  await page.route('**/api/commands', hold);
  await refresh.click();
  await page.waitForFunction(() => document.querySelector('[data-testid=blog-editor-actions] button[aria-label="重新读取"]')?.disabled === true);
  assert(release); assert.deepEqual(commands, ['getBlog'], 'refresh calls only its original read action');
  await refresh.evaluate(button => button.click()); assert.deepEqual(commands, ['getBlog'], 'busy refresh cannot run twice');
  release(); await enabled(); await page.unroute('**/api/commands', hold);
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  const description = page.getByLabel('博客简介', { exact: true });
  const original = await description.inputValue(); await description.fill('Unsaved configuration');
  assert(await refresh.isDisabled(), 'configuration drafts prevent reload');
  await description.fill(original); await enabled();
  await page.getByRole('tab', { name: '文章', exact: true }).click();
  await page.getByRole('button', { name: '新建文章', exact: true }).click();
  const writer = page.getByTestId('record-page');
  const body = writer.getByRole('textbox', { name: '正文内容', exact: true }); await body.waitFor();
  await enabled();
  let bodyStarted;
  const saving = new Promise(resolve => { bodyStarted = resolve; });
  let saveRelease;
  const holdSave = async route => {
    if (['createDocument', 'replaceDocument'].includes(route.request().postDataJSON()?.command)) {
      bodyStarted(); await new Promise(resolve => { saveRelease = resolve; });
    }
    await route.fallback();
  };
  await page.route('**/api/commands', holdSave);
  await body.fill('Article draft prevents reload');
  assert(await refresh.isDisabled(), 'dirty article prevents reload');
  await saving; assert(await refresh.isDisabled(), 'saving article prevents reload');
  saveRelease(); await writer.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
  await page.unroute('**/api/commands', holdSave); await enabled();
  await page.getByRole('button', { name: '返回文章', exact: true }).click(); await writer.waitFor({ state: 'hidden' });
  await page.goto(frontend + '/app'); await page.getByTestId('workspace-home-split').waitFor();
  await page.evaluate(siteId => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail: { kind: 'site', siteId } })), blog.id);
  await page.getByTestId('blog-editor').waitFor(); await actions.waitFor();
  assert.equal(await refresh.count(), 0, 'preview mode continues to own its refresh header');
  assert.deepEqual(fixture.errors, []);
  console.log('PASS BlogEditor original read only, busy/dirty config/dirty article/saving article protections, preview header ownership; no model calls');
} finally { await fixture.close(); }
