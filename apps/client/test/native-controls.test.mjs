import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function sources(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? sources(new URL(entry.name + '/', root)) : /\.[jt]sx?$/.test(entry.name) ? [new URL(entry.name, root)] : []));
  return nested.flat();
}
test('product controls use shared UI instead of browser picker surfaces', async () => {
  const roots = [new URL('../src/', import.meta.url), new URL('../../../packages/ui/src/', import.meta.url)];
  const files = (await Promise.all(roots.map(sources))).flat();
  const nativeUI = /<(?:select|datalist|details|summary)(?:\s|>)|type=["'](?:date|time|datetime-local|month|week|color|radio|range)["']|\blist=|window\.(?:alert|confirm|prompt)\s*\(|\.reportValidity\s*\(/;
  for (const file of files) { const content = await readFile(file, 'utf8'); assert.equal(nativeUI.test(content), false, file.pathname); for (const form of content.matchAll(/<form\b[^>]*>/gs)) assert.match(form[0], /\bnoValidate\b/, file.pathname); }
});
