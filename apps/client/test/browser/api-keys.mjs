import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Personal Key Browser' });
const { page, ctx, api, errors, frontend, base } = fixture;
try {
  await page.goto(frontend + '/app/settings');
  await page.getByText('当前工作区还没有 API Key。', { exact: true }).waitFor();
  let attempts = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/user/api-keys', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    if (attempts === 1) {
      await pending;
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture key creation failed' }) });
    }
    return route.fallback();
  });
  await page.getByRole('button', { name: '创建 API Key', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称', { exact: true }).fill('Browser script');
  await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
  await dialog.getByRole('button', { name: '创建中…', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByLabel('名称', { exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'pending creation cannot be dismissed');
  // A second native submit event while the request is pending is guarded too.
  await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  release();
  await dialog.getByRole('alert').filter({ hasText: 'Fixture key creation failed' }).waitFor();
  assert.equal(attempts, 1);
  assert.equal(await dialog.getByLabel('名称', { exact: true }).inputValue(), 'Browser script');
  await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
  await dialog.getByRole('heading', { name: 'API Key 已创建', exact: true }).waitFor();
  const raw = await dialog.getByLabel('API Key', { exact: true }).inputValue();
  assert.match(raw, /^tab_[A-Za-z0-9_-]{43}$/);
  // Clipboard is isolated in this page; neither raw keys nor cookies are logged.
  await page.evaluate(() => { window.__copiedKey = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedKey = value; } } }); });
  await dialog.getByRole('button', { name: '复制 API Key', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__copiedKey), raw);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  assert.equal(await page.locator('input').evaluateAll((inputs, secret) => inputs.some(input => input.value === secret), raw), false);
  assert.equal((await page.locator('body').innerText()).includes(raw), false);
  const list = await api('/user/api-keys');
  assert.equal(list.keys.length, 1); assert.equal(JSON.stringify(list).includes(raw), false);
  const key = list.keys[0];
  assert.equal((await ctx.request.get(base + '/api/tables', { headers: { Authorization: `Bearer ${raw}` } })).status(), 200);
  await page.reload();
  await page.getByRole('button', { name: '撤销 Browser script', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'secret creation stage never comes back after reload');
  await page.getByRole('button', { name: '撤销 Browser script', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/user/api-keys')).keys[0].revokedAt, null);
  let revokeAttempts = 0;
  await page.route(`**/api/user/api-keys/${key.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    if (++revokeAttempts === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture revocation failed' }) });
    return route.fallback();
  });
  await page.getByRole('button', { name: '撤销 Browser script', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByRole('button', { name: '撤销密钥', exact: true }).click();
  await confirmation.getByRole('alert').filter({ hasText: 'Fixture revocation failed' }).waitFor();
  assert.equal((await api('/user/api-keys')).keys[0].revokedAt, null);
  await confirmation.getByRole('button', { name: '撤销密钥', exact: true }).click();
  await page.getByText('已撤销', { exact: true }).waitFor();
  assert.equal((await ctx.request.get(base + '/api/tables', { headers: { Authorization: `Bearer ${raw}` } })).status(), 401);
  assert.equal(await page.getByRole('button', { name: '撤销 Browser script', exact: true }).count(), 0);
  await page.getByLabel('English', { exact: true }).click();
  await page.getByRole('heading', { name: 'Personal API keys', exact: true }).waitFor();
  await page.setViewportSize({ width: 420, height: 740 });
  await page.getByLabel('Dark', { exact: true }).click();
  await page.getByRole('button', { name: 'Create API key', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Second key');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'compact settings do not overflow');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await api('/user/api-keys')).keys.length, 1, 'cancel never creates a key');
  assert.deepEqual(errors, []);
  console.log('PASS API keys: guarded creation/failure retry, one-time secret/copy, metadata reload, cancel/revoke failure retry, immediate denial, compact English dark form');
} finally { await fixture.close(); }
