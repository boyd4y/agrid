import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

export const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
export const frontend = process.env.BROWSER_BASE_URL ?? 'http://localhost:5173';
export const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl && new URL(databaseUrl).pathname.endsWith('_agent_test'), 'Set DATABASE_URL to an isolated, migrated *_agent_test database');
export const postgres = createRequire(new URL('../../../server/package.json', import.meta.url))('postgres');
export const artifactDir = process.env.BROWSER_ARTIFACT_DIR ?? join(workspace, 'apps/client/test/artifacts', new Date().toISOString().replaceAll(':', '-'));
await mkdir(artifactDir, { recursive: true });
export const artifact = (name) => join(artifactDir, name);
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const launchOptions = process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : process.env.BROWSER_CHANNEL === 'bundled' ? {} : { channel: process.env.BROWSER_CHANNEL ?? 'chrome' };

/** Owns only its API process and freshly created workspace/users; never resets a database. */
export async function createBrowserFixture({ name = 'Builder Browser', modelRequest, serverEnv = {} } = {}) {
  const port = Number(process.env.BROWSER_API_PORT ?? 3112);
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve) => probe.close(resolve));
  const model = createServer(async (req, res) => {
    if (modelRequest) await modelRequest(req, res);
    else { res.writeHead(500); res.end('No model calls expected in this browser regression'); }
  });
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${port}`;
  const log = createWriteStream(artifact('api.log'));
  const server = spawn('pnpm', ['--filter', '@tabdo/server', 'exec', 'tsx', '--conditions=development', 'src/index.ts'], {
    cwd: workspace, detached: true, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), APP_URL: frontend, BETTER_AUTH_URL: base,
      PI_MODEL: 'fixture/model', PI_CONTEXT_WINDOW: '200000', PI_API_KEY: 'browser-local-fixture', PI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
      OPENAI_API_KEY: '', CODEX_API_KEY: '', ANTHROPIC_API_KEY: '', CLAUDE_API_KEY: '', ...serverEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log); server.stderr.pipe(log);
  let browser, ctx, page;
  const users = [], organizations = [], errors = [];
  const close = async () => {
    if (browser) await browser.close();
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    model.closeAllConnections(); await new Promise((resolve) => model.close(resolve));
    const db = postgres(databaseUrl);
    try { for (const id of organizations) await db`delete from organization where id=${id}`; for (const id of users) await db`delete from "user" where id=${id}`; }
    finally { await db.end(); log.end(); }
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) { try { ready = (await fetch(base + '/api/chat/status')).ok; } catch {} if (ready) break; assert(server.exitCode == null, 'test API exited; inspect api.log'); await pause(100); }
    assert(ready, 'test API starts; inspect api.log');
    browser = await chromium.launch({ headless: true, ...launchOptions });
    ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    page = await ctx.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    const api = async (path, data, method = data === undefined ? 'GET' : 'POST') => {
      const response = await ctx.request.fetch(base + '/api' + path, { method, headers: { Origin: frontend }, ...(data === undefined ? {} : { data }) });
      assert(response.ok(), path + ': ' + await response.text()); return response.json();
    };
    users.push((await api('/auth/sign-up/email', { email: 'browser-' + crypto.randomUUID() + '@local.test', password: 'Browser-Test-123!', name })).user.id);
    organizations.push((await api('/auth/organization/create', { name, slug: 'browser-' + crypto.randomUUID() })).id);
    await api('/auth/organization/set-active', { organizationId: organizations[0] });
    await page.route('**/api/**', async (route) => { const url = new URL(route.request().url()); const response = await route.fetch({ url: base + url.pathname + url.search }); await route.fulfill({ response }); });
    return { browser, ctx, page, api, base, users, organizations, errors, close, artifact, frontend };
  } catch (error) { await close(); throw error; }
}
