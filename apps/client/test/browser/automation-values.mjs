import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Automation typed values' });
const { page, api, frontend, errors } = fixture;
try {
  const target = await api('/tables', { name: 'Customers' });
  const title = (await api(`/tables/${target.id}`)).columns[0];
  const records = [];
  for (const name of ['Customer A', 'Customer B']) records.push(await api(`/tables/${target.id}/rows`, { cells: { [title.id]: name } }));
  const table = await api('/tables', { name: 'Typed automation' });
  const column = (name, type, config = {}) => api(`/tables/${table.id}/columns`, { name, type, config });
  const relation = await column('客户', 'relation', { relation: { targetTableId: target.id, limit: 'many' } });
  const person = await column('负责人', 'person');
  const number = await column('金额', 'number');
  const date = await column('日期', 'date');
  const checkbox = await column('完成', 'checkbox');
  const options = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }];
  const select = await column('状态', 'select', { options });
  const multi = await column('标签', 'multi_select', { options });
  const formula = await column('自动金额', 'formula', { formula: '{金额} * 2', formulaResultType: 'auto' });
  const rollup = await column('客户数量', 'rollup', { rollup: { relationColumnId: relation.id, operation: 'count' } });
  await api(`/tables/${table.id}/rows`, { cells: { [number.id]: 2 } });

  await page.goto(frontend + `/app/automations/new?source=${table.id}`);
  const editor = page.getByTestId('automation-editor');
  await editor.waitFor();
  await editor.getByRole('switch', { name: '启用', exact: true }).click();
  await editor.getByRole('button', { name: '条件', exact: true }).click();
  const condition = editor.getByTestId('automation-condition');
  const choose = async (trigger, col) => { await trigger.click(); await page.getByRole('option', { name: col.name, exact: true }).click(); };
  const conditionValue = condition.getByTestId('filter-value');
  for (const [col, type] of [[relation, 'relation'], [person, 'person'], [select, 'select'], [multi, 'multi_select'], [date, 'date'], [checkbox, 'checkbox'], [number, 'number'], [formula, 'number'], [rollup, 'number']]) {
    await choose(condition.getByRole('combobox').first(), col);
    await page.waitForFunction(type => document.querySelector('[data-testid="automation-condition"] [data-filter-type]')?.dataset.filterType === type, type);
    const dimensions = await condition.evaluate(row => {
      const value = row.querySelector('[data-testid="filter-value"]');
      const control = value.matches('button,input') ? value : value.querySelector('button,input');
      return [...Array.from(row.querySelectorAll(':scope > button[role="combobox"]')).slice(0, 2), control].map(node => { const b = node.getBoundingClientRect(); return [b.width, b.height]; });
    });
    assert.deepEqual(dimensions, [[176, 32], [176, 32], [176, 32]], `${type} IF controls stay uniform`);
  }
  await choose(condition.getByRole('combobox').first(), formula);
  await conditionValue.fill('-2.5');

  const when = editor.locator('section').filter({ has: page.getByText('当', { exact: true }) });
  await when.getByRole('combobox').first().click();
  await page.getByRole('option', { name: '字段变更时', exact: true }).click();
  await choose(when.getByRole('combobox').nth(1), formula);
  await when.getByRole('checkbox').click();
  const triggerValue = editor.getByTestId('automation-trigger-value');
  await triggerValue.locator('input').fill('4');
  assert.equal(await triggerValue.getByTestId('filter-value').getAttribute('data-filter-type'), 'number', 'computed trigger values are editable comparisons');
  await choose(when.getByRole('combobox').nth(1), relation);
  await when.getByRole('checkbox').click();
  await triggerValue.getByRole('button').click();
  const relationPicker = page.getByLabel('选择客户关联记录', { exact: true });
  for (const name of ['Customer A', 'Customer B']) await relationPicker.locator('button[aria-pressed="false"]').filter({ hasText: name }).click();
  await page.keyboard.press('Escape');

  const then = editor.locator('section').filter({ has: page.getByText('就', { exact: true }) });
  await choose(then.getByRole('combobox').nth(1), person);
  await editor.getByTestId('automation-action-value').getByRole('button').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Automation typed values', exact: true }).click();
  await then.getByRole('button', { name: '动作', exact: true }).click();
  await then.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: '执行智能体', exact: true }).click();
  let writebackColumn = then.getByRole('combobox').nth(4);
  let resultValue = editor.getByTestId('automation-result-value').last();
  const addAgentAction = async () => {
    await then.getByRole('button', { name: '动作', exact: true }).click();
    const controls = then.getByRole('combobox');
    await controls.nth(await controls.count() - 2).click();
    await page.getByRole('option', { name: '执行智能体', exact: true }).click();
    writebackColumn = controls.last();
    resultValue = editor.getByTestId('automation-result-value').last();
  };
  await writebackColumn.click();
  assert.equal(await page.getByRole('option', { name: formula.name, exact: true }).count(), 0);
  assert.equal(await page.getByRole('option', { name: rollup.name, exact: true }).count(), 0);
  await page.getByRole('option', { name: number.name, exact: true }).click();
  await resultValue.locator('input').fill('-12.5');
  await addAgentAction();
  await choose(writebackColumn, checkbox);
  await resultValue.getByRole('checkbox').click();
  await addAgentAction();
  await choose(writebackColumn, date);
  await resultValue.getByRole('button').click();
  await page.getByRole('dialog', { name: '选择日期', exact: true }).getByRole('textbox').fill('2026-10-14');
  await page.keyboard.press('Enter');
  await addAgentAction();
  await choose(writebackColumn, multi);
  await resultValue.getByRole('button').click();
  const choices = page.getByRole('dialog');
  await choices.getByRole('button', { name: 'Alpha', exact: true }).click();
  await choices.getByRole('button', { name: 'Beta', exact: true }).click();
  await page.keyboard.press('Escape');

  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL('**/app/automations');
  const [rule] = (await api('/automations')).rules;
  assert.equal(rule.enabled, false, 'this fixture never executes automation/model work');
  assert.deepEqual(rule.trigger.toValue, records.map(row => row.id), 'WHEN relation equals the complete array, not the IF scalar');
  assert.equal(rule.conditions[0].value, -2.5);
  assert.equal(rule.actions[0].value, fixture.users[0]);
  assert.equal(rule.actions[1].resultValue, -12.5);
  assert.equal(rule.actions[2].resultValue, true);
  assert.equal(rule.actions[3].resultValue, '2026-10-14');
  assert.deepEqual(rule.actions[4].resultValue, ['a', 'b']);
  assert.deepEqual(errors, []);
  console.log('PASS automation typed IF sizes/computed WHEN input/complete relation trigger/person action/typed agent writeback/read-only exclusion/canonical saved values');
} finally { await fixture.close(); }
