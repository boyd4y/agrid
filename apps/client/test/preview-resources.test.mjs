import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/components/preview/preview-resources.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { loadPreviewResources, filterPreviewResources } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('reports follow hasMore past 100; search covers the complete authorized list', async () => {
  const requests = [], reports = Array.from({ length: 205 }, (_, n) => ({ id: String(n), name: n === 204 ? '末页资源' : '报告 ' + n }));
  const api = { async listReports(offset, limit) { requests.push([offset, limit]); return { reports: reports.slice(offset, offset + limit), hasMore: offset + limit < reports.length }; } };
  const all = await loadPreviewResources('report', api, () => true);
  assert.deepEqual(requests, [[0, 100], [100, 100], [200, 100]]);
  assert.equal(all.length, 205);
  assert.equal(filterPreviewResources(all, '末页')[0].id, '204');
});

test('superseded report reads stop requesting pages and discard late results', async () => {
  let current = true, calls = 0;
  const api = { async listReports() { calls++; current = false; return { reports: [{ id: 'old', name: '旧工作区' }], hasMore: true }; } };
  assert.deepEqual(await loadPreviewResources('report', api, () => current), []);
  assert.equal(calls, 1);
});

test('full-list filtering preserves duplicate identity and does not mutate input', () => {
  const resources = [{ id: 'a', name: 'Same' }, { id: 'b', name: 'Other' }, { id: 'c', name: 'Same' }];
  assert.deepEqual(filterPreviewResources(resources, ' SAME '), [{ id: 'a', name: 'Same', duplicateIndex: 1 }, { id: 'c', name: 'Same', duplicateIndex: 2 }]);
  assert.equal(filterPreviewResources(resources, '').length, 3);
  assert.deepEqual(filterPreviewResources(resources, '不存在'), []);
  assert.equal(resources[0].duplicateIndex, undefined);
});

test('tables and sites use their existing full-list contracts; errors propagate for retry', async () => {
  const item = { id: 'a', name: 'A' };
  assert.deepEqual(await loadPreviewResources('table', { async listTables() { return [item]; } }, () => true), [item]);
  assert.deepEqual(await loadPreviewResources('site', { async listSites() { return [item]; } }, () => true), [item]);
  await assert.rejects(loadPreviewResources('report', { async listReports() { throw new Error('failed'); } }, () => true), /failed/);
});
