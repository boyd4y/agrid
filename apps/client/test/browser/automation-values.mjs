import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Automation typed values' });
const { page, api, frontend, errors } = fixture;
try {
  const agent = (await api('/members/agents', { name: 'Typed trigger agent', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member;fixture.users.push(agent.userId);
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
  await then.getByRole('combobox', { name: '动作', exact: true }).click();
  await page.getByRole('option', { name: '执行智能体', exact: true }).click();
  await then.getByRole('textbox').fill('整理当前记录 {{event.row.id}} 的跟进事项');
  assert.equal(await editor.getByTestId('automation-result-value').count(), 0, 'native actions have no simulated result value');

  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL('**/app/automations');
  const [rule] = (await api('/automations')).rules;
  assert.equal(rule.enabled, false, 'this fixture never executes automation/model work');
  assert.deepEqual(rule.trigger.toValue, records.map(row => row.id), 'WHEN relation equals the complete array, not the IF scalar');
  assert.equal(rule.conditions[0].value, -2.5);
  assert.deepEqual(rule.actions, [{ type: 'run_agent', agentUserId: agent.userId, prompt: '整理当前记录 {{event.row.id}} 的跟进事项' }]);

  await page.goto(frontend + `/app/automations/${rule.id}`);await editor.waitFor();
  await when.getByRole('combobox').first().click();
  await page.getByRole('option', { name: '进入状态时', exact: true }).click();
  await choose(when.getByRole('combobox').nth(1), multi);
  await when.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: 'Beta', exact: true }).click();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL('**/app/automations');
  const updated = await api(`/automations/${rule.id}`);
  assert.deepEqual(updated.trigger, { type: 'enter_status', columnId: multi.id, optionId: 'b' }, 'multi-select status is configurable even when a single-select column exists');
  const plain = await api('/tables', { name: 'No status options' });
  await page.goto(frontend + `/app/automations/new?source=${plain.id}`);await editor.waitFor();
  await when.getByRole('combobox').first().click();
  assert.equal(await page.getByRole('option', { name: '进入状态时', exact: true }).getAttribute('aria-disabled'), 'true', 'tables without selectable statuses cannot configure a meaningless status trigger');
  assert.deepEqual(errors, []);
  console.log('PASS typed automation conditions, computed/relation trigger values, actual agent/prompt configuration, multi-select status trigger and canonical persistence');
} finally { await fixture.close(); }
