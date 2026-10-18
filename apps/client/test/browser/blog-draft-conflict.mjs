import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: '博客配置草稿冲突恢复' });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const open = siteId => page.evaluate(siteId => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail: { kind: 'site', siteId } })), siteId);
const editor = page.getByTestId('blog-editor');
const saveResponse = () => page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'saveBlog');
const labels = {
  'zh-CN': { settings: '配置', description: '博客简介', save: '保存配置', back: '返回站点', leave: '保留草稿并离开', reload: '读取最新配置', title: '丢弃配置草稿？', cancel: '取消', copy: '复制配置草稿', discard: '丢弃并重新读取', conflict: /博客版本或线上版本已变化/ },
  en: { settings: 'Settings', description: 'Blog description', save: 'Save configuration', back: 'Back to sites', leave: 'Keep draft and leave', reload: 'Load latest configuration', title: 'Discard configuration draft?', cancel: 'Cancel', copy: 'Copy configuration draft', discard: 'Discard and reload', conflict: /draft or published version changed/ },
};
try {
  for (const [mode, language] of [['embedded', 'zh-CN'], ['standalone', 'en']]) {
    const l = labels[language], blog = await command('createBlog', { name: `冲突恢复 ${mode}`, idempotencyKey: crypto.randomUUID() });
    await page.goto(frontend + '/app'); await page.getByTestId('workspace-home-split').waitFor();
    await page.evaluate(language => localStorage.setItem('tabdo.locale', language), language);
    if (mode === 'standalone') await page.goto(frontend + `/app/sites/${blog.id}`);
    else { await page.reload(); await page.getByTestId('workspace-home-split').waitFor(); await open(blog.id); }
    await editor.getByRole('tab', { name: l.settings, exact: true }).click();
    const draftText = `${mode} version 1 configuration draft`, serverText = `${mode} saved server version 2`;
    await editor.getByLabel(l.description, { exact: true }).fill(draftText);
    if (mode === 'embedded') await page.getByTestId('preview-slot-header').getByRole('button', { name: `关闭站点 · ${blog.name} Tab`, exact: true }).click();
    else await editor.getByRole('link', { name: l.back, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: l.leave, exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const latest = await command('getBlog', { siteId: blog.id });
    assert.equal(latest.version, 1);
    await command('saveBlog', { siteId: blog.id, expectedVersion: latest.version, name: latest.name, config: { ...latest.config, description: serverText }, idempotencyKey: crypto.randomUUID() });
    if (mode === 'embedded') await open(blog.id);
    else await page.goto(frontend + `/app/sites/${blog.id}`);
    await editor.getByRole('tab', { name: l.settings, exact: true }).click();
    assert.equal(await editor.getByLabel(l.description, { exact: true }).inputValue(), draftText);
    const draft = await page.evaluate(siteId => {
      const key = Object.keys(sessionStorage).find(key => key.startsWith('tabdo.blog-draft:') && key.endsWith(':' + siteId));
      return { key, value: sessionStorage.getItem(key) };
    }, blog.id);
    await page.evaluate(() => {
      sessionStorage.setItem('tabdo.blog-draft:other-workspace:other-site', 'untouched');
      navigator.clipboard.writeText = async value => { window.copiedConfigurationDraft = value; };
    });
    const conflict = saveResponse(); await editor.getByRole('button', { name: l.save, exact: true }).click();
    const rejected = await conflict;
    assert.equal(rejected.status(), 409);
    assert.equal(rejected.request().postDataJSON().input.expectedVersion, 1, 'restored drafts keep their original CAS version');
    await editor.getByRole('alert').filter({ hasText: l.conflict }).waitFor();
    assert.equal((await command('getBlog', { siteId: blog.id })).config.description, serverText);
    await editor.getByRole('button', { name: l.reload, exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: l.title, exact: true }) });
    await dialog.getByRole('button', { name: l.copy, exact: true }).click();
    const copied = await page.evaluate(() => JSON.parse(window.copiedConfigurationDraft));
    assert.equal(copied.config.description, draftText); assert.equal(copied.version, 1);
    await dialog.getByRole('button', { name: l.cancel, exact: true }).first().click();
    assert.equal(await editor.getByLabel(l.description, { exact: true }).inputValue(), draftText);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draft.key), draft.value);
    await editor.getByRole('button', { name: l.reload, exact: true }).click();
    const failRead = async route => route.request().postDataJSON()?.command === 'getBlog'
      ? route.fulfill({ status: 503, json: { code: 'REQUEST_FAILED' } }) : route.fallback();
    await page.route('**/api/commands', failRead);
    const failedRead = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'getBlog');
    await dialog.getByRole('button', { name: l.discard, exact: true }).click();
    assert.equal((await failedRead).status(), 503);
    await dialog.getByRole('alert').waitFor();
    assert.equal(await editor.getByLabel(l.description, { exact: true }).inputValue(), draftText);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draft.key), draft.value, 'failed reads keep the recoverable draft');
    await page.unroute('**/api/commands', failRead);
    await dialog.getByRole('button', { name: l.discard, exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await editor.getByLabel(l.description, { exact: true }).inputValue(), serverText);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draft.key), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tabdo.blog-draft:other-workspace:other-site')), 'untouched');
    assert.equal((await command('getBlog', { siteId: blog.id })).version, 2, 'discard and reload never writes to the server');
    const continued = `${mode} continued after explicit recovery`;
    await editor.getByLabel(l.description, { exact: true }).fill(continued);
    const saved = saveResponse(); await editor.getByRole('button', { name: l.save, exact: true }).click();
    const accepted = await saved; assert.equal(accepted.status(), 200); assert.equal(accepted.request().postDataJSON().input.expectedVersion, 2);
    assert.equal((await command('getBlog', { siteId: blog.id })).config.description, continued);
    console.log(`PASS ${mode}/${language}: real v1→v2 conflict, expectedVersion=1 rejected; copy/cancel/failing read preserve draft; explicit discard reads v2, only this key cleared; next save expectedVersion=2 succeeds.`);
    if (!process.env.BROWSER_SKIP_VISUALS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await editor.getByLabel(l.description, { exact: true }).fill('Pending configuration for recovery confirmation');
      const pending = saveResponse();
      const server = await command('getBlog', { siteId: blog.id });
      await command('saveBlog', { siteId: blog.id, expectedVersion: server.version, name: server.name, config: { ...server.config, description: 'New saved configuration' }, idempotencyKey: crypto.randomUUID() });
      await editor.getByRole('button', { name: l.save, exact: true }).click(); await pending;
      await editor.getByRole('button', { name: l.reload, exact: true }).click();
      for (const [width, theme] of [[390, 'light'], [320, 'dark']]) {
        await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: artifact(`blog-conflict-${mode}-${language}-${width}-${theme}.png`), animations: 'disabled' });
      }
      await dialog.getByRole('button', { name: l.discard, exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    }
  }
  assert.deepEqual(f.errors, []);
} finally { await f.close(); }
