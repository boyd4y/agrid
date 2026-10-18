import assert from 'node:assert/strict';
import { createBrowserFixture, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Existing frontend must be available; this suite does not restart it');
const fixture = await createBrowserFixture({ name: 'Table scroll browser' });
const { page, api, errors } = fixture;
const command = async (command, input) => (await api('/commands', { command, input })).result;
try {
  const target = await api('/tables', { name: 'Scroll relation targets' });
  const targetTitle = (await api(`/tables/${target.id}`)).columns[0];
  const targets = [];
  for (let i = 0; i < 25; i++) targets.push(await api(`/tables/${target.id}/rows`, { cells: { [targetTitle.id]: `关联 ${String(i + 1).padStart(2, '0')}：这是一个超过窄列宽度的很长记录标题，用来验证截断后计数仍然可见` } }));
  const table = await api('/tables', { name: 'Wide and long scroll table' });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const relation = await api(`/tables/${table.id}/columns`, { name: '关联长标题', type: 'relation', width: 140, config: { relation: { targetTableId: target.id, direction: 'source', limit: 'many' } } });
  const columns = [title, relation];
  for (let i = 0; i < 16; i++) columns.push(await api(`/tables/${table.id}/columns`, { name: `滚动字段 ${i + 1}`, type: 'text', width: 110 + (i % 4) * 30 }));
  const rows = [];
  for (let i = 0; i < 80; i++) rows.push(await api(`/tables/${table.id}/rows`, { cells: { [title.id]: `Scroll row ${String(i + 1).padStart(3, '0')}`, ...Object.fromEntries(columns.slice(2).map((column, index) => [column.id, `Row ${i + 1}, field ${index + 1}`])), ...(i === 0 ? { [relation.id]: targets.map((row) => row.id) } : {}) } }));
  const hydrated = await command('getRow', { rowId: rows[0].id });
  assert.equal(hydrated.relations[relation.id].records.length, 20, 'fixture exceeds relation preview limit');
  assert.equal(hydrated.relations[relation.id].total, 25);
  const firstRelated = hydrated.relations[relation.id].records[0];
  const selectedIds = async () => (await command('queryRelationRecords', { columnId: relation.id, rowId: rows[0].id, mode: 'related', limit: 100 })).records.map((row) => row.id).sort();
  const originalIds = await selectedIds();

  await page.goto(frontend + `/app/tables/${table.id}`);
  const scroll = page.getByTestId('table-scroll');
  await scroll.waitFor();
  await page.locator(`[data-cell][data-row-id="${rows[0].id}"]`).first().waitFor();
  assert.equal(await scroll.count(), 1);
  const dimensions = await scroll.evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight }));
  assert(dimensions.scrollWidth > dimensions.width + 1000, 'fixture requires horizontal scrolling');
  assert(dimensions.scrollHeight > dimensions.height * 2, 'fixture requires vertical virtualization');
  const headerTop = await scroll.locator('[data-col-header]').first().evaluate((node) => node.getBoundingClientRect().top);
  const alignments = [];
  for (const [left, top] of [[0, 0], [650, 0], [650, 650], [dimensions.scrollWidth, 1300], [0, dimensions.scrollHeight], [dimensions.scrollWidth, dimensions.scrollHeight]]) {
    await scroll.evaluate(async (node, position) => { node.scrollLeft = position.left; node.scrollTop = position.top; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, { left, top });
    await page.waitForFunction(() => {
      const surface = document.querySelector('[data-testid="table-scroll"]'), bounds = surface.getBoundingClientRect();
      const header = surface.querySelector('[data-col-header]').getBoundingClientRect();
      return [...surface.querySelectorAll('[data-cell]')].some((cell) => { const box = cell.getBoundingClientRect(); return box.top >= header.bottom && box.bottom <= bounds.bottom; });
    });
    const geometry = await scroll.evaluate((surface) => {
      const bounds = surface.getBoundingClientRect(), headers = [...surface.querySelectorAll('[data-col-header]')];
      const bottom = headers[0].getBoundingClientRect().bottom;
      const visibleCell = [...surface.querySelectorAll('[data-cell]')].find((cell) => { const box = cell.getBoundingClientRect(); return box.top >= bottom && box.bottom <= bounds.bottom; });
      return { left: surface.scrollLeft, top: surface.scrollTop, headerTop: headers[0].getBoundingClientRect().top, pairs: headers.map((header) => {
        const cell = [...surface.querySelectorAll('[data-cell]')].find((node) => node.dataset.rowId === visibleCell.dataset.rowId && node.dataset.colName === header.dataset.colHeader);
        const h = header.getBoundingClientRect(), c = cell.getBoundingClientRect();
        return { column: header.dataset.colHeader, headerX: h.x, cellX: c.x, headerWidth: h.width, cellWidth: c.width };
      }) };
    });
    assert(Math.abs(geometry.headerTop - headerTop) <= 1, `sticky header at scroll ${geometry.left}/${geometry.top}`);
    for (const pair of geometry.pairs) {
      assert(Math.abs(pair.headerX - pair.cellX) <= 1, `header/cell x alignment: ${JSON.stringify({ ...pair, left: geometry.left, top: geometry.top })}`);
      assert(Math.abs(pair.headerWidth - pair.cellWidth) <= 1, `header/cell width alignment: ${pair.column}`);
    }
    alignments.push({ left: geometry.left, top: geometry.top, columns: geometry.pairs.length });
  }
  const lastCell = scroll.locator(`[data-cell][data-row-id="${rows.at(-1).id}"]`).first();
  await lastCell.waitFor();
  const lastBounds = await lastCell.boundingBox(), scrollBounds = await scroll.boundingBox();
  assert(lastBounds.y >= headerTop + 36 && lastBounds.y + lastBounds.height <= scrollBounds.y + scrollBounds.height + 1, 'last row is fully visible below sticky header');

  await scroll.evaluate((node) => { node.scrollLeft = 0; node.scrollTop = 0; });
  const relationCell = scroll.locator(`[data-cell][data-row-id="${rows[0].id}"][data-col-name="${relation.name}"]`);
  const badge = relationCell.locator('[data-relation-more]');
  await badge.waitFor();
  assert.equal(await badge.textContent(), '+24', 'count uses total records rather than the 20-record preview');
  const relationGeometry = await relationCell.evaluate((cell) => {
    const count = cell.querySelector('[data-relation-more]'), title = cell.querySelector('button span'), c = cell.getBoundingClientRect(), b = count.getBoundingClientRect();
    return { inside: b.left >= c.left && b.right <= c.right && b.top >= c.top && b.bottom <= c.bottom, countWidth: b.width, truncated: title.scrollWidth > title.clientWidth };
  });
  assert(relationGeometry.inside && relationGeometry.countWidth > 0 && relationGeometry.truncated, 'long first title truncates while remaining badge stays entirely visible');
  await relationCell.getByRole('button').click();
  const sheet = page.getByTestId('related-record-panel');
  await sheet.locator(`input[value=${JSON.stringify(firstRelated.title)}]`).waitFor();
  await sheet.getByRole('button', { name: '关闭记录', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  assert.deepEqual(await selectedIds(), originalIds, 'opening the first record preserves all relations');
  await badge.click();
  const picker = page.getByLabel('选择关联长标题关联记录', { exact: true });
  await picker.waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="选择关联长标题关联记录"]')?.querySelectorAll('button[aria-label^="解除关联 "]').length === 25);
  const removed = targets.at(-1), removedTitle = removed.cells[targetTitle.id];
  await picker.getByRole('button', { name: `解除关联 ${removedTitle}`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="选择关联长标题关联记录"]')?.querySelectorAll('button[aria-label^="解除关联 "]').length === 24);
  assert.deepEqual(await selectedIds(), originalIds.filter((id) => id !== removed.id), 'unlink only changes the requested record');
  await picker.locator('button[aria-pressed="false"]').filter({ hasText: removedTitle }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="选择关联长标题关联记录"]')?.querySelectorAll('button[aria-label^="解除关联 "]').length === 25);
  assert.deepEqual(await selectedIds(), originalIds, 'remaining-count picker restores the record without losing hidden preview relations');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  await badge.waitFor(); assert.equal(await badge.textContent(), '+24');
  assert.deepEqual(errors, []);
  console.log('PASS table scroll alignment/sticky header/final row and relation first-record/count/picker preservation', JSON.stringify(alignments));
} finally { await fixture.close(); }
