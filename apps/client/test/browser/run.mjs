import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const available = (await readdir(new URL('.', import.meta.url))).filter((name) => name.endsWith('.mjs') && !['fixture.mjs', 'run.mjs'].includes(name)).sort();
const requested = process.argv.slice(2).filter((name) => name !== '--').map((name) => name.endsWith('.mjs') ? name : name + '.mjs');
const suites = requested.length ? requested : available;
for (const suite of suites) {
  if (!available.includes(suite)) throw new Error(`Unknown browser suite ${suite}; available: ${available.join(', ')}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
