import assert from 'node:assert/strict';
import { createBrowserFixture, frontend, artifact } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Grok Bot MCP' });
const { page, api, ctx, errors } = fixture;
page.setDefaultTimeout(15000);
try {
  const selected = await api('/tables', { name: 'Grok selected' });
  const excluded = await api('/tables', { name: 'Grok excluded' });
  await page.goto(frontend + '/app/settings?tab=api-keys');
  const settings = page.getByTestId('api-keys-settings');
  const dialog = page.getByRole('dialog');
  await settings.getByRole('button', { name: '一键启用 Grok Bot', exact: true }).click();
  assert(await dialog.getByRole('button', { name: '一键启用 Grok Bot', exact: true }).isDisabled());
  await dialog.getByRole('checkbox', { name: /Grok selected$/ }).check();
  await dialog.getByRole('button', { name: '一键启用 Grok Bot', exact: true }).click();
  await dialog.getByRole('heading', { name: '连接 Grok Bot', exact: true }).waitFor();
  const secret = await dialog.getByRole('textbox', { name: 'API Key（仅显示一次）', exact: true }).inputValue();
  assert.match(secret, /^tab_[A-Za-z0-9_-]{43}$/);
  const endpoint = frontend + '/mcp';
  assert.equal(await dialog.getByRole('textbox', { name: 'MCP 服务地址', exact: true }).inputValue(), endpoint);
  assert.equal(await dialog.getByRole('textbox', { name: 'HTTP 请求头名称', exact: true }).inputValue(), 'Authorization');
  assert.equal(await dialog.getByRole('textbox', { name: 'HTTP 请求头值', exact: true }).inputValue(), `Bearer ${secret}`);
  assert(!(await dialog.innerText()).includes('OpenAPI'));
  assert((await dialog.innerText()).includes('Remote HTTPS'));
  assert((await dialog.innerText()).includes('仅提供 OAuth'));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const [label, value] of [['MCP 服务地址', endpoint], ['HTTP 请求头名称', 'Authorization'], ['HTTP 请求头值', `Bearer ${secret}`]]) {
    await dialog.getByRole('button', { name: `复制${label}`, exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), value);
  }
  const keys = (await api('/user/api-keys')).keys;
  assert.equal(keys.length, 1);
  assert.deepEqual(keys[0].permissions, [{ tableId: selected.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }]);
  assert(!JSON.stringify(keys).includes(excluded.id));
  assert(!JSON.stringify(keys).includes(secret));
  assert.deepEqual(keys[0].documentPermissions.map(grant => grant.tableId), [selected.id]);
  assert.deepEqual(keys[0].blogPermissions.map(grant => grant.tableId), [selected.id]);
  assert(keys[0].documentPermissions.every(grant => grant.canRead && !grant.canCreate && !grant.canUpdate && !grant.canUpload));
  assert(keys[0].blogPermissions.every(grant => grant.canRead && !grant.canBuild && !grant.canPublish));
  // Inspect the real feature in both viewport classes and themes in one batch.
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: artifact(`grok-mcp-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await settings.getByRole('button', { name: '一键启用 Grok Bot', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'API Key（仅显示一次）', exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('textbox', { name: 'HTTP 请求头值', exact: true }).inputValue(), 'Bearer <已保存的 API Key>');
  assert(!(await dialog.locator('input').evaluateAll(inputs => inputs.map(input => input.value))).some(value => value.includes(secret)));
  assert.equal((await api('/user/api-keys')).keys.length, 1, 'reopening must reuse the key');
  await dialog.getByRole('button', { name: '编辑 API Key', exact: true }).click();
  assert(await dialog.getByRole('textbox', { name: '名称', exact: true }).isVisible());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: '常规', exact: true }).click();
  await page.getByLabel('English', { exact: true }).click();
  await page.getByRole('tab', { name: 'API Key', exact: true }).click();
  await settings.getByRole('button', { name: 'Enable Grok Bot', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'MCP server URL', exact: true }).inputValue(), endpoint);
  assert.equal(await dialog.getByRole('textbox', { name: 'HTTP header value', exact: true }).inputValue(), 'Bearer <your saved API key>');
  assert((await dialog.innerText()).includes('only offers OAuth'));
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await settings.getByRole('button', { name: 'Enable Grok Bot', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: 'API key (shown once)', exact: true }).count(), 0);
  assert(!(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(secret));
  assert.deepEqual(errors, []);
  console.log('PASS Grok Bot MCP: selected-table read-only scope, URL/header copy, secret once and no persistence, reused key, permission editor, English/Chinese, desktop/mobile light/dark.');
} finally {
  await fixture.close();
}
