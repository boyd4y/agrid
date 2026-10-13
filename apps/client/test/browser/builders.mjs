import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture();
const { page, api, errors, frontend, artifact } = fixture;
const goto = (path) => page.goto(frontend + path);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const traces = [];
try {
  const table = await api('/tables', { name: 'Builder source' });
  const title = await api(`/tables/${table.id}/columns`, { name: '名称', type: 'text' });
  await api(`/tables/${table.id}/columns`, { name: '数量', type: 'number' });

  await goto('/app/automations');
  await page.getByTestId('automations-hub').waitFor();
  await page.getByRole('link', { name: '新建自动化', exact: true }).first().click();
  await page.getByTestId('automation-source-step').waitFor();
  assert.equal(await page.getByTestId('automation-editor').count(), 0, 'creation chooses source before editor');
  await page.getByTestId('automation-source-step').getByRole('combobox', { name: '来源表格', exact: true }).click();
  await page.getByRole('option', { name: 'Builder source', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const editor = page.getByTestId('automation-editor');
  await editor.waitFor();
  await editor.getByPlaceholder('自动化名称').fill('Builder automation');
  await editor.getByRole('combobox').first().click();
  await page.getByRole('option', { name: '新建记录时', exact: true }).click();
  await editor.getByRole('switch', { name: '启用', exact: true }).click();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL('**/app/automations');
  await page.getByRole('link', { name: /Builder automation/ }).click();
  await editor.getByPlaceholder('自动化名称').fill('Edited automation');
  assert.equal(await page.locator('#automation-source').isDisabled(), true, 'saved source is fixed');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL('**/app/automations');
  const rules = (await api('/automations')).rules;
  const rule = rules.find((rule) => rule.name === 'Edited automation');
  assert(rule && rule.tableId === table.id && rule.enabled === false);
  await goto(`/app/automations/${rule.id}`);
  await editor.getByPlaceholder('自动化名称').waitFor();
  assert.equal(await editor.getByPlaceholder('自动化名称').inputValue(), 'Edited automation');
  await page.getByRole('button', { name: '运行记录', exact: true }).click();
  await page.getByText('还没有运行记录。', { exact: true }).waitFor();
  await goto(`/app/tables/${table.id}/automations`);
  await page.waitForURL(`**/app/automations/new?source=${table.id}`);
  await editor.waitFor();
  assert.match(await page.getByTestId('automation-configuration-step').innerText(), /Builder source/);
  await goto('/app/automations');
  await page.getByRole('button', { name: 'Edited automation自动化操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除规则', exact: true }).click();
  await page.getByRole('alertdialog', { name: '删除自动化规则？' }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert((await api('/automations')).rules.some((r) => r.id === rule.id), 'cancel keeps automation');
  await page.getByRole('button', { name: 'Edited automation自动化操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除规则', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  assert(!(await api('/automations')).rules.some((r) => r.id === rule.id));
  assert((await api(`/tables/${table.id}`)).columns.some((column) => column.id === title.id), 'automation removal preserves source');
  console.log('PASS independent automation create/edit/reload/runs/delete/cancel/legacy redirect');

  await goto(`/app/tables/${table.id}`);
  await page.getByTestId('view-grid').first().waitFor();
  await page.getByTestId('add-view').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '表单视图', exact: true }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'add-view');
  assert.equal(await page.getByTestId('add-view').evaluate((node) => document.activeElement === node), true);
  await page.getByTestId('add-view').click();
  await page.getByRole('menuitem', { name: '表单视图', exact: true }).click();
  const form = page.getByTestId('form-designer');
  await form.getByTestId('builder-layout').waitFor();
  const formOutline = page.getByRole('complementary', { name: '表单题目', exact: true });
  const formInspector = page.getByRole('complementary', { name: '题型设置', exact: true });
  await form.getByRole('button', { name: '经典堆叠', exact: true }).click();
  await formOutline.getByRole('button', { name: /名称TEXT/i }).click();
  await formInspector.getByRole('textbox').first().fill('任务名称');
  await formInspector.getByRole('textbox').first().press('Tab');
  await formOutline.getByRole('button', { name: /任务名称TEXT/i }).waitFor();
  await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'setFormFieldSettings'), formInspector.getByRole('checkbox', { name: '必填', exact: true }).click()]);
  const views = await command('listViews', { tableId: table.id });
  const formView = views.find((view) => view.type === 'form');
  const savedForm = await command('getView', { viewId: formView.id });
  assert.equal(savedForm.resolvedFields.find((field) => field.columnId === title.id).label, '任务名称');
  assert.equal(savedForm.resolvedFields.find((field) => field.columnId === title.id).required, true);
  const outlineBox = await formOutline.boundingBox(), inspectorBox = await formInspector.boundingBox();
  assert(outlineBox.x < inspectorBox.x && outlineBox.y === inspectorBox.y, 'shared BuilderLayout has columns on desktop');
  await page.screenshot({ path: artifact('form-builder-desktop.png') });
  await page.reload();
  await page.getByTestId('view-form').click();
  await formOutline.getByRole('button', { name: /任务名称TEXT/i }).click();
  assert.equal(await formInspector.getByRole('checkbox', { name: '必填', exact: true }).isChecked(), true);
  await form.getByRole('button', { name: '填写', exact: true }).click();
  assert.equal(await form.getByTestId('builder-layout').count(), 0, 'fill mode renders the real form');
  await form.getByRole('button', { name: '设计', exact: true }).click();
  await form.getByTestId('builder-layout').waitFor();
  await page.setViewportSize({ width: 700, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: artifact('form-builder-compact.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByTestId('view-menu-' + formView.id).click();
  await page.getByTestId('delete-view-' + formView.id).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert((await command('listViews', { tableId: table.id })).some((view) => view.id === formView.id));
  await page.getByTestId('view-menu-' + formView.id).click();
  await page.getByTestId('delete-view-' + formView.id).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  assert(!(await command('listViews', { tableId: table.id })).some((view) => view.id === formView.id));
  console.log('PASS shared form builder layout/edit/required/reload/fill/compact and keyboard/Escape/delete view menus');

  await goto('/app/reports/new');
  await page.getByTestId('builder-layout').waitFor();
  await page.locator('#report-name').fill('Continuous dashboard');
  const palette = page.getByRole('complementary', { name: '组件', exact: true });
  await palette.getByRole('button', { name: '说明文字', exact: true }).click();
  await palette.getByRole('button', { name: '说明文字', exact: true }).first().click();
  assert.equal(await page.getByRole('complementary', { name: '组件设置', exact: true }).getByRole('button', { name: /页面设置/ }).count(), 0, 'page settings lives in palette');
  await palette.getByRole('button', { name: '页面设置', exact: true }).click();
  await page.locator('#report-name').waitFor();
  const item = page.locator('[data-dashboard-item]').first();
  const surface = page.getByTestId('report-widgets');
  const sample = async (label) => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frame = await surface.evaluate((element, label) => {
      const card = element.querySelector('[data-dashboard-item]');
      const shadow = element.querySelector('.react-grid-placeholder');
      const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { label, interacting: element.dataset.interacting, card: rect(card), shadow: shadow ? rect(shadow) : null };
    }, label);
    assert.equal(frame.interacting, 'true', label);
    assert(frame.shadow, label + ' placeholder exists');
    for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(frame.card[key] - frame.shadow[key]) < 1.1, `${label}: shadow ${key} follows card (${frame.card[key]} vs ${frame.shadow[key]})`);
    traces.push(frame);
  };
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction((theme) => document.documentElement.classList.contains(theme), theme);
    await page.waitForTimeout(250); // Let the responsive grid settle after theme/layout changes.
    for (let pass = 0; pass < 2; pass++) {
      await item.scrollIntoViewIfNeeded();
      const handle = await item.locator('.report-drag-handle').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
      for (const [index, delta] of [[9, 8], [21, 17], [37, 29], [63, 45], [97, 67], [-17, 21], [-130, 0]].entries()) {
        await page.mouse.move(handle.x + handle.width / 2 + delta[0], handle.y + handle.height / 2 + delta[1]);
        await sample(`${theme}-drag-${pass}-${index}`);
      }
      await page.screenshot({ path: artifact(`dashboard-drag-${theme}-${pass}.png`) });
      await page.mouse.up();
      assert.equal(await surface.getAttribute('data-interacting'), null);
      const resize = await item.locator('.react-resizable-handle').boundingBox();
      await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down();
      for (const [index, delta] of [[7, 5], [17, 11], [33, 27], [63, 41], [97, 73], [-13, -11]].entries()) {
        await page.mouse.move(resize.x + resize.width / 2 + delta[0], resize.y + resize.height / 2 + delta[1]);
        await sample(`${theme}-resize-${pass}-${index}`);
      }
      await page.screenshot({ path: artifact(`dashboard-resize-${theme}-${pass}.png`) });
      await page.mouse.up();
      assert.equal(await surface.getAttribute('data-interacting'), null);
    }
  }
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForURL((url) => /\/app\/reports\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'));
  const reportId = page.url().split('/').at(-1);
  const saved = await api('/reports/' + reportId);
  await page.reload(); await page.getByTestId('report-widgets').waitFor();
  assert.deepEqual((await api('/reports/' + reportId)).widgets.map((w) => w.layout), saved.widgets.map((w) => w.layout));
  await page.setViewportSize({ width: 700, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual((await api('/reports/' + reportId)).widgets.map((w) => w.layout), saved.widgets.map((w) => w.layout), 'compact rendering preserves desktop coordinates');
  await writeFile(artifact('dashboard-frames.json'), JSON.stringify(traces, null, 2));
  assert.deepEqual(errors, []);
  console.log(`PASS continuous dashboard drag/resize including sub-cell moves and edges, ${traces.length} light/dark frame samples, feedback removal, save/reload/compact; artifacts: ${artifact('dashboard-frames.json')}`);
} catch (error) {
  await writeFile(artifact('dashboard-frames.json'), JSON.stringify(traces, null, 2));
  console.error((await page.locator('body').innerText()).slice(-5000));
  await page.screenshot({ path: artifact('failure.png') });
  throw error;
} finally { await fixture.close(); }
