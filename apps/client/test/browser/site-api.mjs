import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserFixture, workspace, artifact, pause } from './fixture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'tabdo-site-browser-'));
const fixture = await createBrowserFixture({ name: 'Site API browser', serverEnv: { FILE_STORAGE_LOCAL_DIR: directory } });
const { page, ctx, api, base, frontend, errors } = fixture;
const sitePort = Number(process.env.SITE_BROWSER_PORT ?? 4187);
const log = createWriteStream(artifact('site-examples.log'));
const server = spawn(process.execPath, ['examples/sites/server.mjs'], { cwd: workspace, detached: true, env: { ...process.env, SITE_EXAMPLES_PORT: String(sitePort) }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log); server.stderr.pipe(log);
let site;
try {
  const workspaceName = (await api('/commands', { command: 'getWorkspace' })).result.workspace.name;
  const catalog = await api('/tables', { name: 'Site catalog' });
  const leads = await api('/tables', { name: 'Site leads' });
  const schema = await api('/tables/' + catalog.id);
  const title = schema.columns[0].id;
  const fileColumn = await api(`/tables/${catalog.id}/columns`, { name: 'Cover image', type: 'file' });
  const uploaded = await ctx.request.post(base + `/api/tables/${catalog.id}/columns/${fileColumn.id}/files`, { multipart: { files: { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=', 'base64') } } });
  assert(uploaded.ok(), await uploaded.text()); const file = (await uploaded.json()).files[0];
  await api(`/tables/${catalog.id}/rows`, { cells: { [title]: '<img src=x onerror=alert(1)>', [fileColumn.id]: [file.id] } });
  const leadsTitle = (await api('/tables/' + leads.id)).columns[0].id;
  await api(`/tables/${leads.id}/rows`, { cells: { [leadsTitle]: 'Private historical submission' } });

  await page.goto(frontend + '/app/settings?tab=site-api');
  const settings = page.getByTestId('api-keys-settings'); await settings.getByText('创建你的第一个 API Key', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-state=open][data-slot=sheet-content]').count(), 0);
  async function createKey(name, grants) {
    await settings.getByRole('button', { name: '创建 API Key', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: '名称', exact: true }).fill(name);
    for (const [table, operations] of Object.entries(grants)) for (const operation of operations)
      await dialog.getByRole('checkbox', { name: `${workspaceName} / ${table} · ${operation}`, exact: true }).check();
    await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
    const secret = await dialog.getByRole('textbox', { name: 'API Key', exact: true }).inputValue();
    assert.match(secret, /^tab_[A-Za-z0-9_-]{43}$/);
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    assert(!(await page.locator('body').innerText()).includes(secret));
    await settings.getByText(name, { exact: true }).waitFor(); return secret;
  }
  const readKey = await createKey('Catalog website', { 'Site catalog': ['读取'], 'Site leads': ['新增'] });
  const createOnlyKey = await createKey('Landing page leads', { 'Site leads': ['新增', '更新', '删除'] });
  assert.equal(await page.getByRole('tab', { name: '站点 API', exact: true }).count(), 0);
  assert.equal(await page.getByRole('tab').count(), 4);
  await page.waitForURL(url => url.searchParams.get('tab') === 'api-keys');
  const rows = settings.locator('[data-slot=list-item]'); assert.equal(await rows.count(), 2);
  const background = await rows.first().evaluate(element => getComputedStyle(element).backgroundColor);
  await rows.first().hover(); await pause(180);
  assert.notEqual(await rows.first().evaluate(element => getComputedStyle(element).backgroundColor), background, 'settings items have hover feedback');
  // Match the existing settings frame at desktop and narrow width; native selects are absent.
  for (const width of [1440, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'settings fit the viewport');
    await page.screenshot({ path: artifact(`site-api-${width}-light.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await pause(200);
  await page.screenshot({ path: artifact('site-api-1440-dark.png'), fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await settings.getByRole('button', { name: '编辑 Catalog website', exact: true }).click();
  let dialog = page.getByRole('dialog'); assert.equal(await dialog.locator('select:not([aria-hidden="true"])').count(), 0);
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Catalog website edited');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await settings.getByText('Catalog website edited', { exact: true }).waitFor();

  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${sitePort}/catalog.html`)).ok) break; } catch {} assert(server.exitCode === null, 'example server must start'); await pause(100); }
  site = await ctx.newPage(); site.on('pageerror', error => errors.push(error.message));
  const fragment = (key, table) => new URLSearchParams({ url: base, key, table }).toString();
  let cookieSent = false;
  site.on('request', async request => { if (request.url() === base + '/api/graphql' && (await request.allHeaders()).cookie) cookieSent = true; });
  await site.goto(`http://127.0.0.1:${sitePort}/catalog.html#${fragment(readKey, catalog.id)}`);
  await site.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor();
  await site.waitForFunction(() => { const image = document.querySelector('#catalog img'); return image?.complete && image.naturalWidth === 1; });
  assert.equal(await site.locator('#catalog article').count(), 1);
  assert.equal(await site.locator('#catalog img').count(), 1, 'table text never becomes markup');
  await site.goto(`http://127.0.0.1:${sitePort}/lead-form.html#${fragment(createOnlyKey, leads.id)}`);
  await site.getByRole('textbox', { name: '标题', exact: true }).fill('New landing page submission');
  await site.getByRole('button', { name: 'Send message', exact: true }).click();
  await site.getByText('Message received. Thank you!', { exact: true }).waitFor();
  assert.equal(await site.getByText('Private historical submission', { exact: true }).count(), 0);
  assert((await api(`/tables/${leads.id}/rows/query`, {})).rows.some(row => row.cells[leadsTitle] === 'New landing page submission'));
  assert.equal(cookieSent, false, 'cross-origin SDK requests never send workspace cookies');
  await site.evaluate(async ({base, key, table, column}) => {
    const { createClient } = await import('/tabdo.js');
    const client = createClient({ url: base, key });
    const row = await client.table(table).create({ [column]: 'CRUD browser fixture' });
    await client.table(table).update(row.id, { [column]: 'Updated browser fixture' });
    await client.table(table).delete(row.id);
    let denied = false; try { await client.table(table).list(); } catch { denied = true; }
    if (!denied) throw Error('Update/delete grants must not imply read');
  }, {base, key: createOnlyKey, table: leads.id, column: leadsTitle});


  await settings.getByRole('button', { name: '删除 Catalog website edited', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await settings.getByText('Catalog website edited', { exact: true }).waitFor({ state: 'hidden' });
  await site.goto(`http://127.0.0.1:${sitePort}/catalog.html#${fragment(readKey, catalog.id)}`);
  await site.getByText('Invalid API key', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS site API: settings creation/edit/delete, selected-table permissions, hover/responsive controls, standalone SDK, real cross-origin HTML catalog/image/form, escaped content and immediate key deletion.');
} finally {
  await site?.close(); await fixture.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  log.end(); await rm(directory, { recursive: true, force: true });
}
