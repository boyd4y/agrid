import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Responsive table header' });
const { page, api, frontend, artifact } = f;
const command = async (command, input) => (await api('/commands', { command, input })).result;

try {
  const table = await api('/tables', { name: '普通文章表' });
  const titleColumn = (await api(`/tables/${table.id}`)).columns[0];
  await api(`/tables/${table.id}/rows`, { cells: { [titleColumn.id]: 'Header regression record' } });
  const grid = await command('createGridView', { tableId: table.id, name: '表格 Grid' });
  const board = await command('createBoardView', { tableId: table.id, name: '看板 Board' });
  await command('setDefaultView', { viewId: grid.id });
  await page.goto(frontend + `/app/tables/${table.id}`);
  await page.getByTestId('table-header').waitFor();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();

  const header = page.getByTestId('table-header');
  const toolbar = page.getByTestId('table-toolbar');
  const title = header.getByRole('textbox');
  const breadcrumb = page.getByTestId('table-breadcrumb');
  const gridTab = page.locator(`[data-view-id="${grid.id}"]`);
  const boardTab = page.locator(`[data-view-id="${board.id}"]`);

  const checkLayout = async (width, fullName) => {
    const sizes = await header.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert(sizes.scroll <= sizes.width + 1, `header does not overflow at ${width}px: ${JSON.stringify(sizes)}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page horizontal overflow');
    const titleBox = await title.boundingBox(), toolbarBox = await toolbar.boundingBox();
    assert(titleBox.width >= (width < 768 ? 160 : 220), `title has usable width: ${titleBox.width}`);
    if (width < 768) assert(toolbarBox.y >= titleBox.y + titleBox.height, 'narrow toolbar follows title');
    else {
      assert(toolbarBox.y < titleBox.y + titleBox.height, 'desktop header stays compact');
      assert(toolbarBox.height <= 40, 'desktop views and actions stay in a single toolbar row');
    }
    const link = breadcrumb.getByRole('link');
    assert(await link.evaluate(node => node.getBoundingClientRect().height < 30), 'breadcrumb back link stays on one line');
    assert.equal(await title.inputValue(), fullName);
    assert.equal(await title.getAttribute('title'), fullName);
    assert.equal(await breadcrumb.locator('span').last().getAttribute('title'), fullName);
    for (const button of await toolbar.locator('button:not([role="tab"])').all()) {
      const box = await button.boundingBox(), headerBox = await header.boundingBox();
      assert(box && box.x >= headerBox.x && box.x + box.width <= headerBox.x + headerBox.width + 1, 'toolbar action stays inside header');
    }
  };

  for (const locale of ['zh-CN', 'en']) {
    const normal = locale === 'zh-CN' ? '普通文章表' : 'Article table';
    const long = locale === 'zh-CN' ? '跨团队产品发布与客户反馈跟进的超长表格名称'.repeat(3) : 'CrossTeamProductLaunchAndCustomerFeedbackTracking'.repeat(4);
    for (const name of [normal, long]) {
      await api(`/tables/${table.id}`, { name }, 'PATCH');
      await page.evaluate(locale => localStorage.setItem('tabdo.locale', locale), locale);
      await page.reload();
      await title.waitFor();
      for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        await pause(200);
        await checkLayout(width, name);
        if (name === normal) {
          assert(await title.evaluate(node => {
            const context = document.createElement('canvas').getContext('2d');
            context.font = getComputedStyle(node).font;
            return context.measureText(node.value).width <= node.clientWidth;
          }), 'ordinary table name is fully readable');
        } else {
          await title.focus(); await title.press('End');
          assert(await title.evaluate(node => node.selectionStart === node.value.length), 'long title end is keyboard accessible');
          await title.press('Home'); await title.blur();
        }
        await page.getByTestId('add-view').click();
        await page.getByRole('menuitem', { name: locale === 'en' ? 'Grid view' : '表格视图', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByTestId(`view-menu-${grid.id}`).click();
        await page.getByRole('menuitem', { name: locale === 'en' ? 'Rename' : '重命名', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        const refreshed = page.waitForResponse(response => response.url().endsWith(`/api/tables/${table.id}`) && response.request().method() === 'GET' && response.ok());
        await toolbar.getByRole('button', { name: locale === 'en' ? 'Refresh' : '刷新', exact: true }).click();
        await refreshed;
        if (name === long) await page.screenshot({ path: artifact(`header-${locale}-${width}-${theme}.png`) });
      }
    }
    // Many long view names stay within their own scroll area; keyboard navigation
    // scrolls the selected tab into view without moving the whole page.
    for (let i = 0; i < 4; i++) await command('createGridView', { tableId: table.id, name: `Very long view name ${locale} ${i}` });
    await page.reload(); await title.waitFor();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await boardTab.click();
      await page.getByTestId('board-properties-trigger').waitFor();
      await checkLayout(width, long);
      await page.getByTestId('board-properties-trigger').click();
      await page.getByTestId('board-properties').waitFor();
      await page.keyboard.press('Escape');
      await gridTab.focus(); await gridTab.press('End');
      const selected = page.getByTestId('view-switcher').locator('[role="tab"][data-state="active"]');
      const tabBox = await selected.boundingBox(), listBox = await page.getByTestId('view-switcher').boundingBox();
      const visibleWidth = Math.min(tabBox.x + tabBox.width, listBox.x + listBox.width) - Math.max(tabBox.x, listBox.x);
      assert(visibleWidth >= Math.min(tabBox.width, listBox.width) - 8, `keyboard-selected tab fills the available scroll area: ${JSON.stringify({ tabBox, listBox })}`);
      await gridTab.click();
    }
  }
  assert.deepEqual(f.errors, []);
  console.log('PASS responsive table header: 320/390/1440, zh/en, light/dark, normal/long names, menus, refresh, board settings and keyboard-scrollable views.');
} catch (error) {
  await page.screenshot({ path: artifact('header-failure.png') }).catch(() => {});
  throw error;
} finally {
  await f.close();
}
