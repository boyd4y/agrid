import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
const fixture = await createBrowserFixture({ name: 'List Pagination Browser' });
const { page, api, errors, frontend } = fixture;
const goto = path => page.goto(frontend + path);
const pager = () => page.getByRole('navigation', { name: '分页', exact: true });
const reportLinks = () => page.getByRole('link', { name: /^Paging report / });
const ruleLinks = () => page.getByRole('link', { name: /^Paging rule / });
const countIs = async (locator, count) => {
  await page.waitForFunction(({ prefix, count }) => [...document.querySelectorAll('a')].filter(node => node.textContent.startsWith(prefix)).length === count,
    { prefix: locator === 'reports' ? 'Paging report ' : 'Paging rule ', count });
};
try {
  const table = await api('/tables', { name: 'Paging source' });
  const column = await api(`/tables/${table.id}/columns`, { name: 'Title', type: 'text' });
  for (let i = 0; i < 21; i++) {
    await api('/reports', { name: `Paging report ${i}`, columns: 2, widgets: [{ id: crypto.randomUUID(), type: 'text', title: 'Note', width: 'full', content: 'Fixture' }] });
    await api(`/tables/${table.id}/automations`, { name: `Paging rule ${i}`, enabled: false, trigger: { type: 'row_created' }, conditions: [], conditionLogic: 'and', actions: [{ type: 'update_field', columnId: column.id, value: 'Fixture' }] });
  }
  const reportPage1 = await api('/reports?offset=0&limit=20'), reportPage2 = await api('/reports?offset=20&limit=20');
  const rulePage1 = await api('/automations?offset=0&limit=20'), rulePage2 = await api('/automations?offset=20&limit=20');
  for (const [first, second, key] of [[reportPage1, reportPage2, 'reports'], [rulePage1, rulePage2, 'rules']]) {
    assert.equal(first[key].length, 20); assert.equal(first.hasMore, true);
    assert.equal(second[key].length, 1); assert.equal(second.hasMore, false);
    assert.equal(new Set([...first[key], ...second[key]].map(item => item.id)).size, 21);
  }
  assert.equal((await api('/reports')).reports.length, 21, 'existing default limit remains compatible');
  for (const path of ['/reports?limit=0', '/automations?limit=101', '/reports?limit=1.5']) {
    assert.equal((await fixture.ctx.request.get(fixture.base + '/api' + path)).status(), 400, 'invalid page size returns a client error');
  }
  await goto('/app/reports'); await countIs('reports', 20);
  await pager().getByText('第 1 页', { exact: true }).waitFor();
  assert.equal(await pager().getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
  let failNext = true;
  await page.route('**/api/reports?*', async route => {
    if (new URL(route.request().url()).searchParams.get('offset') === '20' && failNext) {
      failNext = false;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture next page rejected' }) });
    } else await route.fallback();
  });
  await pager().getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture next page rejected' }).waitFor();
  assert.equal(await reportLinks().count(), 20, 'failed next-page load keeps the committed list');
  await pager().getByText('第 1 页', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await countIs('reports', 1); await pager().getByText('第 2 页', { exact: true }).waitFor();
  assert.equal(await pager().getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
  await page.unroute('**/api/reports?*');
  await page.locator('article').getByRole('button').click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  await countIs('reports', 20); await pager().getByText('第 1 页', { exact: true }).waitFor();
  assert.equal((await api('/reports')).reports.length, 20, 'deleting the only last-page item reads the preceding real page');

  // Two refreshes deliberately race; the older request ignores its abort signal.
  // Only the request wrapper is delayed; both bodies come from the actual API.
  await page.evaluate(() => {
    const fetchReal = window.fetch;
    const race = { calls: 0, firstStarted: false, release: null, firstDone: null };
    window.__paginationRace = race;
    window.fetch = async (input, init) => {
      if (String(input).startsWith('/api/reports?')) {
        race.calls++;
        if (race.calls === 1) {
          const response = await fetchReal(input, { ...init, signal: undefined });
          race.firstStarted = true;
          await new Promise(resolve => { race.release = resolve; });
          const stale = await response.json(); stale.reports[0].name = 'STALE RESPONSE MUST NOT WIN';
          race.firstDone = true;
          return new Response(JSON.stringify(stale), { headers: { 'content-type': 'application/json' } });
        }
      }
      return fetchReal(input, init);
    };
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => window.__paginationRace.firstStarted);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => window.__paginationRace.calls >= 2);
  await page.waitForFunction(() => document.querySelector('[aria-busy]')?.getAttribute('aria-busy') === 'false');
  await page.evaluate(() => window.__paginationRace.release());
  await page.waitForFunction(() => window.__paginationRace.firstDone);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  assert.equal(await page.getByText('STALE RESPONSE MUST NOT WIN', { exact: true }).count(), 0);
  assert.equal(await reportLinks().count(), 20);

  await goto('/app/automations'); await countIs('rules', 20);
  await pager().getByRole('button', { name: '下一页', exact: true }).click();
  await countIs('rules', 1); await pager().getByText('第 2 页', { exact: true }).waitFor();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await pager().getByText('第 2 页', { exact: true }).waitFor();
  assert.equal(await ruleLinks().count(), 1, 'refresh preserves the current page');
  await page.getByRole('button', { name: /Paging rule .*自动化操作/ }).click();
  await page.getByRole('menuitem', { name: '删除规则', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  await countIs('rules', 20); await pager().getByText('第 1 页', { exact: true }).waitFor();
  assert.equal((await api('/automations')).rules.length, 20);
  await page.setViewportSize({ width: 700, height: 650 });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.classList.contains(theme), theme);
    await pager().scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await pager().getByRole('button', { name: '下一页', exact: true }).isVisible(), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS remote report/automation 21-item pagination/size validation/replace not append/committed page on error/retry target/last-page delete fallback/refresh/stale abort-ignoring response race/compact light-dark');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-5000));
  throw error;
} finally { await fixture.close(); }
