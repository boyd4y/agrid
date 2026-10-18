import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Scheduled list pagination' });
const { page, api, frontend, artifact } = fixture;
page.setDefaultTimeout(15000);
const sidebar = page.getByTestId('scheduled-task-sidebar');
const pager = sidebar.getByRole('navigation', { name: '分页', exact: true });
const items = page.getByTestId('scheduled-task-item');
const count = n => page.waitForFunction(n => document.querySelectorAll('[data-testid=scheduled-task-item]').length === n, n);
try {
  const agent = (await api('/members/agents', { name: 'Pagination agent', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model' } })).member;
  fixture.users.push(agent.userId);
  const tasks = [];
  for (let index = 1; index <= 21; index++) tasks.push(await api('/automations', {
    name: `Pagination task ${String(index).padStart(2, '0')}`,
    source: { kind: 'schedule', cron: '0 9 * * *', timeZone: 'UTC' }, trigger: { type: 'schedule_due' },
    actions: [{ type: 'run_agent', agentUserId: agent.userId, prompt: 'No execution in this fixture' }],
  }));
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(frontend + '/app/schedules'); await count(20);
  const selected = await items.first().getByRole('link').getAttribute('href');
  await page.waitForURL(frontend + selected);
  assert(await pager.getByRole('button', { name: '上一页', exact: true }).isDisabled());
  assert.equal(await pager.locator('[aria-live=polite]').getAttribute('aria-atomic'), 'true');
  let release, failed = false;
  await page.route('**/api/automations?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('kind') === 'schedule' && url.searchParams.get('offset') === '20' && !failed) {
      failed = true;
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ status: 400, json: { error: 'Scheduled page rejected' } });
    } else await route.fallback();
  });
  await pager.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=scheduled-task-sidebar] [aria-busy=true]'));
  assert(await pager.getByRole('button', { name: '上一页', exact: true }).isDisabled());
  assert(await pager.getByRole('button', { name: '下一页', exact: true }).isDisabled());
  assert(release, 'the requested page is held while loading'); release();
  await sidebar.getByRole('alert').filter({ hasText: 'Scheduled page rejected' }).waitFor();
  await pager.getByText('第 1 页', { exact: true }).waitFor(); await count(20);
  assert.equal(new URL(page.url()).pathname, selected, 'page errors preserve the selected route');
  await sidebar.getByRole('button', { name: '重新加载', exact: true }).click();
  await count(1); await pager.getByText('第 2 页', { exact: true }).waitFor();
  assert(await pager.getByRole('button', { name: '下一页', exact: true }).isDisabled());
  const lastRoute = await items.first().getByRole('link').getAttribute('href');
  await items.first().getByRole('link').click(); await page.waitForURL(frontend + lastRoute);
  await page.unroute('**/api/automations?*');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.classList.contains(theme), theme);
    await sidebar.evaluate(el => { el.style.width = '264px'; });
    const bounds = await sidebar.boundingBox(), footer = await pager.boundingBox();
    assert.equal(bounds.width, 264);
    assert(footer.y >= bounds.y && footer.y + footer.height <= 600, 'footer remains reachable at 1440×600');
    for (const button of await pager.getByRole('button').all()) {
      const box = await button.boundingBox(); assert(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
    }
    assert(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth), '264px sidebar has no horizontal overflow');
    await page.screenshot({ path: artifact(`scheduled-pagination-264-${theme}.png`) });
  }
  await pager.getByRole('button', { name: '上一页', exact: true }).click(); await count(20);
  await pager.getByText('第 1 页', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, lastRoute, 'paging does not replace the selected task');
  for (const task of tasks.slice(1)) await api(`/automations/${task.id}`, undefined, 'DELETE');
  await sidebar.getByRole('button', { name: '刷新', exact: true }).click(); await count(1);
  assert.equal(await pager.count(), 0, 'single-page schedules hide pagination');
  assert.deepEqual(fixture.errors, []);
  console.log('PASS scheduled list: shared compact pager, route selection, first/last/loading disabled, failed page/retry, aria-live/atomic page, 264px sidebar and 1440×600 light/dark footer, one-page hidden; no model calls');
} finally { await fixture.close(); }
