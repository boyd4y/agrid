import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserFixture, pause } from './fixture.mjs';

async function calendarFixture(name, viewport, recordCount = 0) {
  const fixture = await createBrowserFixture({ name });
  try {
    fixture.page.setDefaultTimeout(5000);
    await fixture.page.setViewportSize(viewport);
    const command = async (command, input) => (await fixture.api('/commands', { command, input })).result;
    const table = await fixture.api('/tables', { name });
    const title = (await fixture.api(`/tables/${table.id}`)).columns[0];
    const start = await fixture.api(`/tables/${table.id}/columns`, { name: '开始日期', type: 'date' });
    const now = new Date();
    const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-12`;
    const records = Array.from({ length: recordCount }, (_, index) => ({ cells: { [title.id]: `日期记录 ${index}`, [start.id]: date } }));
    for (let offset = 0; offset < records.length; offset += 100) {
      await command('batchAddRows', { tableId: table.id, rows: records.slice(offset, offset + 100) });
    }
    const view = await command('createCalendarView', { tableId: table.id, config: { startColumnId: start.id, titleColumnId: title.id } });
    await command('setDefaultView', { viewId: view.id });
    await fixture.page.goto(fixture.frontend + `/app/tables/${table.id}`);
    await fixture.page.getByTestId('table-calendar-view').waitFor();
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

test('390px calendar pagination remains clickable beside the floating AI control', async () => {
  const fixture = await calendarFixture('日历窄屏分页', { width: 390, height: 844 }, 105);
  const { page, artifact } = fixture;
  try {
    const more = page.getByRole('button', { name: '加载更多记录', exact: true });
    await more.waitFor();
    assert.equal(await page.locator('[data-calendar-row-id]').count(), 100);
    await more.scrollIntoViewIfNeeded();
    const button = await more.boundingBox(), ai = await page.getByTestId('global-ai-toggle').boundingBox();
    assert(button && ai);
    assert(button.x + button.width <= ai.x || button.x >= ai.x + ai.width || button.y + button.height <= ai.y || button.y >= ai.y + ai.height, 'the entire pagination button clears the floating AI control');
    await page.screenshot({ path: artifact('table-calendar-mobile-pagination.png') });
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-calendar-row-id]').length === 105);
    assert.equal(await more.count(), 0);
    assert.deepEqual(fixture.errors, []);
  } catch (error) {
    await page.screenshot({ path: artifact('table-calendar-mobile-pagination-failure.png') });
    throw error;
  } finally { await fixture.close(); }
});

test('320px calendar mapping can scroll to and save its original fields', async () => {
  const fixture = await calendarFixture('日历窄屏映射', { width: 320, height: 740 });
  const { page, artifact } = fixture;
  try {
    await page.getByTestId('calendar-mapping-trigger').click();
    const mapping = page.getByTestId('calendar-mapping');
    await mapping.waitFor();
    // A pointer user must be able to reach the footer on a short viewport.
    await mapping.hover();
    await page.mouse.wheel(0, 600);
    await pause(200);
    await page.screenshot({ path: artifact('table-calendar-mobile-mapping.png') });
    await mapping.getByRole('button', { name: '保存', exact: true }).click();
    await mapping.waitFor({ state: 'hidden' });
    assert.deepEqual(fixture.errors, []);
  } catch (error) {
    await page.screenshot({ path: artifact('table-calendar-mobile-mapping-failure.png') });
    throw error;
  } finally { await fixture.close(); }
});
