import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Field option form drafts' });
const { page, api, frontend, artifact } = fixture;
const command = async (command, input) => (await api('/commands', { command, input })).result;
const form = page.getByTestId('table-form');
const field = label => form.locator('[data-slot="form-item"]').filter({ has: page.locator('[data-slot="form-label"]').filter({ hasText: label }) });
const popup = page.getByRole('dialog');
try {
  const table = await api('/tables', { name: 'Option form drafts' });
  const options = [{ id: 'stable-a', label: 'Alpha' }, { id: 'stable-b', label: 'Beta' }];
  const single = await command('addColumn', { tableId: table.id, name: 'Stage', type: 'select', config: { options } });
  const multi = await command('addColumn', { tableId: table.id, name: 'Tags', type: 'multi_select', config: { options } });
  const person = await command('addColumn', { tableId: table.id, name: 'Owner', type: 'person' });
  await command('createFormView', {
    tableId: table.id, name: 'Options form',
    config: { layout: 'classic', theme: { preset: 'ocean' } },
    fields: [single, multi, person].map(column => ({ columnId: column.id })),
  });
  await page.goto(frontend + '/app/tables/' + table.id);
  await page.getByTestId('view-form').click();
  await page.getByTestId('form-designer').getByRole('button', { name: '填写', exact: true }).click();
  await form.waitFor();
  const rowWrites = [];
  page.on('request', request => {
    if (request.url().includes('/api/tables/' + table.id + '/rows') && request.method() === 'POST') rowWrites.push(request.postDataJSON());
  });
  await field('Stage').getByRole('button').click();
  assert.equal(await popup.getByRole('textbox').count(), 0);
  await popup.getByRole('button', { name: 'Beta', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
  await field('Tags').getByRole('button').click();
  await popup.getByRole('button', { name: 'Alpha', exact: true }).click();
  await popup.getByRole('button', { name: 'Beta', exact: true }).click();
  assert(await popup.isVisible());
  await page.keyboard.press('Escape');
  await field('Owner').getByRole('button').click();
  await popup.getByRole('button', { name: 'Field option form drafts', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
  assert.equal(rowWrites.length, 0, 'selecting and dismissing only updates the form draft');
  assert.equal((await api('/tables/' + table.id)).rowCount, 0, 'draft does not create a record');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await page.screenshot({ animations: 'disabled', path: artifact('option-form-draft-' + theme + '.png') });
  }
  await form.getByRole('button', { name: '提交', exact: true }).click();
  await page.getByTestId('table-form-success').waitFor();
  assert.equal(rowWrites.length, 1, 'explicit submit creates exactly one record');
  const pageRows = await api('/tables/' + table.id + '/rows');
  assert.equal(pageRows.rows.length, 1);
  const cells = pageRows.rows[0].cells;
  assert.equal(cells[single.id], 'stable-b');
  assert.deepEqual(cells[multi.id], ['stable-a', 'stable-b']);
  assert.equal(cells[person.id], fixture.users[0]);
  assert.deepEqual(fixture.errors, []);
  console.log('PASS actual form fill: select/multi/person stay local drafts; zero rows before submit; explicit submit writes one row with stable option IDs/userId; independent ocean theme in workspace light/dark');
} catch (error) {
  await page.screenshot({ path: artifact('option-form-failure.png') }).catch(() => {});
  throw error;
} finally { await fixture.close(); }
