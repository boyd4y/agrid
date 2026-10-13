import assert from 'node:assert/strict';
import { createBrowserFixture, databaseUrl, postgres, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Use the existing frontend; this suite never restarts it');
const fixture = await createBrowserFixture({ name: 'Typed filters browser' });
const { page, api, errors } = fixture;
try {
  const agent = (await api('/members/agents', { name: '筛选助手', persona: { defaultHarness: 'pi', defaultModel: 'openrouter/free', runtime: 'local', skillNames: ['table'] } })).member;
  fixture.users.push(agent.userId);
  const target = await api('/tables', { name: 'Filter relation target' });
  const targetTitle = (await api(`/tables/${target.id}`)).columns[0];
  const amount = await api(`/tables/${target.id}/columns`, { name: '关联金额', type: 'number' });
  const targetDate = await api(`/tables/${target.id}/columns`, { name: '关联日期', type: 'date' });
  const targets = [];
  for (const [index, number, date] of [[1, 3, '2026-01-01'], [2, 4, '2026-04-01']]) targets.push(await api(`/tables/${target.id}/rows`, { cells: { [targetTitle.id]: `关联记录 ${index}`, [amount.id]: number, [targetDate.id]: date } }));
  const table = await api('/tables', { name: 'Typed filter records' });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const column = (name, type, config = {}) => api(`/tables/${table.id}/columns`, { name, type, config });
  const person = await column('负责人', 'person');
  const number = await column('金额', 'number');
  const date = await column('日期', 'date');
  const checked = await column('完成', 'checkbox');
  const options = [{ id: 'red', label: '红色标签', color: '#ffe2dd' }, { id: 'blue', label: '蓝色标签', color: '#d3e5ef' }];
  const multi = await column('多选标签', 'multi_select', { options });
  const select = await column('状态', 'select', { options });
  const relation = await column('关联', 'relation', { relation: { targetTableId: target.id, limit: 'many' } });
  const numericFormula = await column('自动金额公式', 'formula', { formula: '{金额} * 2', formulaResultType: 'auto' });
  const dateFormula = await column('日期公式', 'formula', { formula: '{日期}', formulaResultType: 'date' });
  const autoCheckboxFormula = await column('自动完成公式', 'formula', { formula: 'IF({金额} = 0, "false", {完成})', formulaResultType: 'auto' });
  const checkboxFormula = await column('完成公式', 'formula', { formula: '{完成}', formulaResultType: 'checkbox' });
  const textFormula = await column('文字公式', 'formula', { formula: '"文字"', formulaResultType: 'text' });
  const sum = await column('汇总金额', 'rollup', { rollup: { relationColumnId: relation.id, targetColumnId: amount.id, operation: 'sum' } });
  const earliest = await column('最早日期', 'rollup', { rollup: { relationColumnId: relation.id, targetColumnId: targetDate.id, operation: 'earliest' } });
  const rows = [];
  for (const [name, owner, value, day, flag, tags, links] of [
    ['真人记录', fixture.users[0], -1.5, '2026-01-01', false, ['red', 'blue'], targets.map(row => row.id)],
    ['智能体记录', agent.userId, 7, '2026-05-01', true, ['blue'], [targets[0].id]],
    ['无负责人记录', null, 0, '2026-09-01', false, [], []],
  ]) rows.push(await api(`/tables/${table.id}/rows`, { cells: { [title.id]: name, [person.id]: owner, [number.id]: value, [date.id]: day, [checked.id]: flag, [multi.id]: tags, [select.id]: 'red', [relation.id]: links } }));
  const query = async (col, op, value) => (await api(`/tables/${table.id}/rows/query`, { filters: [{ id: 'real-query', columnId: col.id, op, value }], includeTotal: true })).rows.map(row => row.id).sort();
  assert.deepEqual(await query(person, 'eq', fixture.users[0]), [rows[0].id]);
  assert.deepEqual(await query(person, 'eq', agent.userId), [rows[1].id]);
  assert.deepEqual(await query(multi, 'contains', ['red']), [rows[0].id]);
  assert.deepEqual(await query(relation, 'contains', [targets[1].id]), [rows[0].id]);
  assert.deepEqual(await query(dateFormula, 'gte', '2026-05-01'), [rows[1].id, rows[2].id].sort(), 'formula dates use date comparisons');
  assert.deepEqual(await query(checkboxFormula, 'eq', false), [rows[0].id, rows[2].id].sort());
  for (const col of [checked, checkboxFormula]) {
    assert.deepEqual(await query(col, 'is_empty'), [rows[0].id, rows[2].id].sort(), 'false checkboxes match empty, including formula results');
    assert.deepEqual(await query(col, 'is_not_empty'), [rows[1].id], 'not-empty is the inverse checkbox condition');
  }
  assert.deepEqual(await query(autoCheckboxFormula, 'is_empty'), [rows[0].id], 'auto Boolean false is empty, while text false stays nonempty');
  assert.deepEqual(await query(autoCheckboxFormula, 'is_not_empty'), [rows[1].id, rows[2].id].sort());
  assert.deepEqual(await query(sum, 'gt', 4), [rows[0].id]);
  assert.deepEqual(await query(earliest, 'lte', '2026-02-01'), [rows[0].id, rows[1].id].sort());

  await page.goto(frontend + `/app/tables/${table.id}`);
  await page.locator(`[data-cell][data-row-id="${rows[0].id}"]`).first().waitFor();
  await page.getByRole('button', { name: '条件', exact: true }).click();
  const condition = page.getByTestId('filter-condition');
  const chooseColumn = async col => { await condition.getByRole('combobox', { name: '列', exact: true }).click(); await page.getByRole('option', { name: col.name, exact: true }).click(); };
  const chooseOp = async name => { await condition.getByRole('combobox', { name: '条件', exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); };
  const expectRows = async expected => page.waitForFunction(ids => {
    const actual = [...new Set([...document.querySelectorAll('[data-cell][data-row-id]')].map(node => node.dataset.rowId))].sort();
    return JSON.stringify(actual) === JSON.stringify(ids.sort());
  }, expected.map(row => row.id));
  const filterValue = condition.getByTestId('filter-value');
  const assertType = async type => assert.equal(await filterValue.getAttribute('data-filter-type'), type);

  await chooseColumn(person); await assertType('person');
  await filterValue.getByRole('button').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Typed filters browser', exact: true }).click();
  await expectRows([rows[0]]);
  await filterValue.getByRole('button').click();
  await page.getByRole('dialog').getByRole('button', { name: '筛选助手', exact: true }).click();
  await expectRows([rows[1]]);
  await chooseOp('为空'); assert.equal(await filterValue.count(), 0); await expectRows([rows[2]]);
  await chooseOp('等于'); await assertType('person'); await expectRows(rows);

  await chooseColumn(number); await assertType('number');
  await filterValue.fill('-'); assert.equal(await filterValue.inputValue(), '-'); assert.equal(await filterValue.getAttribute('aria-invalid'), 'true');
  await expectRows(rows);
  await filterValue.fill('1e999'); assert.equal(await filterValue.getAttribute('aria-invalid'), 'true'); await expectRows(rows);
  await filterValue.fill('-1.'); assert.equal(await filterValue.inputValue(), '-1.');
  await filterValue.fill('-1.5'); await expectRows([rows[0]]);
  await chooseColumn(multi); await assertType('multi_select'); await expectRows(rows);
  await filterValue.click(); await page.getByRole('option', { name: '红色标签', exact: true }).click(); await expectRows([rows[0]]);
  await chooseOp('不包含'); await filterValue.click(); await page.getByRole('option', { name: '红色标签', exact: true }).click(); await expectRows([rows[1], rows[2]]);

  await chooseColumn(relation); await assertType('relation');
  await filterValue.getByRole('button').click();
  const picker = page.getByLabel('选择关联关联记录', { exact: true });
  await picker.locator('button[aria-pressed="false"]').filter({ hasText: '关联记录 2' }).click();
  await page.keyboard.press('Escape'); await expectRows([rows[0]]);
  const unchanged = await api('/commands', { command: 'queryRelationRecords', input: { columnId: relation.id, rowId: rows[0].id, mode: 'related' } });
  assert.equal(unchanged.result.records.length, 2, 'filter picker does not mutate real links');

  await chooseColumn(numericFormula); await assertType('number');
  await chooseOp('小于'); await filterValue.fill('0'); await expectRows([rows[0]]);
  await chooseColumn(dateFormula); await assertType('date');
  await chooseOp('大于等于'); await filterValue.getByRole('button').click();
  await page.getByRole('dialog', { name: '选择日期', exact: true }).getByRole('textbox').fill('2026-05-01');
  await page.keyboard.press('Enter'); await expectRows([rows[1], rows[2]]);
  await chooseColumn(checkboxFormula); await assertType('checkbox');
  await filterValue.click(); await page.getByRole('option', { name: '勾选', exact: true }).click(); await expectRows([rows[1]]);
  await chooseColumn(textFormula); await assertType('text');
  await condition.getByRole('combobox', { name: '条件', exact: true }).click(); assert.equal(await page.getByRole('option', { name: '大于', exact: true }).count(), 0); await page.keyboard.press('Escape');
  await chooseColumn(sum); await assertType('number'); await chooseOp('大于'); await filterValue.fill('4'); await expectRows([rows[0]]);
  await chooseColumn(earliest); await assertType('date');
  await chooseColumn(select); await assertType('select'); await filterValue.click(); await page.getByRole('option', { name: '蓝色标签', exact: true }).click(); await expectRows([]);
  // Simulate one persisted computed failure in this fixture's own table, alongside valid rows.
  const failedRow = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '错误计算记录' } });
  const testDb = postgres(databaseUrl);
  try {
    await testDb`update rows set cells=cells || ${testDb.json({ [numericFormula.id]: '#ERR:numeric calculation failed', [dateFormula.id]: '#ERR:date calculation failed', [autoCheckboxFormula.id]: null })}::jsonb where id=${failedRow.id} and table_id=${table.id}`;
  } finally { await testDb.end(); }
  assert.deepEqual(await query(checked, 'is_empty'), [rows[0].id, rows[2].id, failedRow.id].sort(), 'missing checkbox and false share the SQL empty semantics');
  assert.deepEqual(await query(checkboxFormula, 'is_empty'), [rows[0].id, rows[2].id, failedRow.id].sort());
  assert.deepEqual(await query(autoCheckboxFormula, 'is_empty'), [rows[0].id, failedRow.id].sort(), 'auto Boolean false and native null are empty');
  assert.deepEqual(await query(numericFormula, 'eq', 0), [rows[2].id], 'numeric equality skips failed formulas without a query 400');
  assert.deepEqual(await query(numericFormula, 'gte', 0), [rows[1].id, rows[2].id].sort(), 'numeric ordering keeps valid results beside an error');
  assert.deepEqual(await query(dateFormula, 'lte', '2026-02-01'), [rows[0].id], 'date errors do not match by text order');
  assert.deepEqual(errors, []);
  console.log('PASS typed filters: real human/agent IDs, arrays and non-mutating relation selection, negative/decimal drafts, empty-op/value reset, formula/rollup resolved types and actual SQL results');
} finally { await fixture.close(); }
