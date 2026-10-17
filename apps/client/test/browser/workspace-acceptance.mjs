import assert from 'node:assert/strict';
import { createBrowserFixture, postgres, databaseUrl } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Workspace independent acceptance' });
const { page, ctx, base, frontend, api } = f;
const db = postgres(databaseUrl);
page.setDefaultTimeout(15000);
let releaseOld = () => {};
const scoped = async (id, path, data, method = data === undefined ? 'GET' : 'POST') => {
  const response = await ctx.request.fetch(base + '/api' + path, { method, headers: { Origin: frontend, 'X-Workspace-Id': id },
    ...(data === undefined ? {} : { data }) });
  assert(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  return response.json();
};
async function eventually(check) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await page.waitForTimeout(50); }
  assert.fail('Expected browser state did not settle');
}
async function choose(id, name) {
  await page.getByTestId('workspace-switcher').focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name, exact: true }).focus(); await page.keyboard.press('Enter');
  await page.waitForURL(url => url.searchParams.get('workspace') === id);
  await page.getByTestId('workspace-switcher').waitFor();
}
try {
  const a = (await api('/commands', { command: 'listWorkspaces' })).result.find(item => item.isDefault);
  const b = (await api('/commands', { command: 'createWorkspace', input: { name: 'B acceptance' } })).result;
  const tableA = await scoped(a.id, '/tables', { name: 'A-generation-old' });
  await scoped(a.id, '/tables/' + tableA.id, { pinned: true }, 'PATCH');
  const tableB = await scoped(b.id, '/tables', { name: 'B independent table' });
  const ownerThread = await scoped(b.id, '/threads', { clientId: crypto.randomUUID(), context: { page: 'ai' } });
  await page.goto(frontend + '/app/tables?workspace=' + a.id);
  await page.getByTestId('workspace-switcher').waitFor();

  // A failed server validation must leave the original scope and page usable.
  const failSwitch = async route => {
    if (route.request().postDataJSON()?.command === 'getWorkspace')
      return route.fulfill({ status: 503, json: { error: 'Acceptance switch failure' } });
    return route.fallback();
  };
  await page.route('**/api/commands', failSwitch);
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: b.name, exact: true }).click();
  await page.getByText(/操作未完成，请重试|Could not complete this action/, { exact: false }).first().waitFor();
  await eventually(() => page.getByTestId('workspace-switcher').isEnabled());
  assert.equal(new URL(page.url()).searchParams.get('workspace'), a.id);
  assert.match(await page.locator('body').innerText(), /A-generation-old/);
  await page.unroute('**/api/commands', failSwitch);
  console.log('PASS: failed switch preserves the original usable page and request scope');

  let oldStarted, held = false;
  const oldReady = new Promise(resolve => { oldStarted = resolve; });
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const slowList = async route => {
    if (held || route.request().headers()['x-workspace-id'] !== a.id) return route.fallback();
    held = true;
    const response = await route.fetch({ url: base + '/api/tables' });
    oldStarted(); await oldGate;
    try { await route.fulfill({ response }); } catch { /* The old document was discarded. */ }
  };
  await page.route('**/api/tables', slowList);
  await page.goto(frontend + '/app/tables?workspace=' + a.id, { waitUntil: 'domcontentloaded' });
  await oldReady;
  await page.getByTestId('workspace-switcher').waitFor();
  await choose(b.id, b.name);
  await scoped(a.id, '/tables/' + tableA.id, { name: 'A-generation-new' }, 'PATCH');
  await choose(a.id, a.name);
  await eventually(async () => (await page.locator('body').innerText()).includes('A-generation-new'));
  releaseOld(); await page.unroute('**/api/tables', slowList);
  assert(!(await page.locator('body').innerText()).includes('A-generation-old'));
  console.log('PASS: keyboard A to B to A while old A response is held preserves the new A generation');

  await choose(b.id, b.name);
  const [account] = await db`select email from "user" where id=${f.users[0]}`;
  await api('/auth/sign-out', {});
  await page.goto(frontend + '/app');
  await page.waitForURL(url => url.pathname === '/login');
  await page.evaluate(() => sessionStorage.clear());
  await api('/auth/sign-in/email', { email: account.email, password: 'Browser-Test-123!' });
  await api('/auth/organization/set-active', { organizationId: f.organizations[0] });
  await page.goto(frontend + '/app/tables');
  await page.getByTestId('workspace-switcher').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('workspace'), b.id);
  await page.getByTestId('tables-page').getByRole('link', { name: 'B independent table', exact: true }).waitFor();
  assert.equal((await scoped(b.id, '/threads')).threads[0].id, ownerThread.id);
  console.log('PASS: real sign-out and sign-in restore the owner and organization remembered workspace');

  // A different account in the same enterprise must not reuse the first account's remembered workspace/private thread.
  await api('/auth/sign-out', {});
  const peer = (await api('/auth/sign-up/email', { email: `peer-${crypto.randomUUID()}@local.test`, password: 'Browser-Test-123!', name: 'Peer acceptance' })).user;
  f.users.push(peer.id);
  await db`insert into member (id,organization_id,user_id,role) values (${crypto.randomUUID()},${f.organizations[0]},${peer.id},'member')`;
  await api('/auth/organization/set-active', { organizationId: f.organizations[0] });
  await page.goto(frontend + '/app/tables');
  await page.getByTestId('workspace-switcher').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('workspace'), a.id);
  assert.equal((await scoped(b.id, '/threads')).threads.length, 0);
  assert.deepEqual((await scoped(a.id, '/tables')).map(item => item.id), [tableA.id]);
  assert.deepEqual((await scoped(b.id, '/tables')).map(item => item.id), [tableB.id]);
  console.log('PASS: different account memory and private threads stay isolated with shared enterprise data');

  await page.setViewportSize({ width: 320, height: 720 });
  await choose(b.id, b.name);
  await page.getByTestId('workspace-switcher').focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu'); await menu.waitFor();
  const box = await menu.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= 320);
  await page.keyboard.press('Escape');
  assert.deepEqual(f.errors, []);
  console.log('PASS: collapsed 320px sidebar supports keyboard switching and a menu within the viewport');

  // The recovery action promises the default workspace, even when the remembered selection is B.
  await page.goto(frontend + '/app?workspace=malformed-selector');
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: /进入默认工作区|Open default workspace/ }).click();
  await page.getByTestId('workspace-switcher').waitFor();
  await page.waitForURL(url => url.searchParams.has('workspace'));
  await page.screenshot({ path: f.artifact('default-recovery.png') });
  assert.equal(new URL(page.url()).searchParams.get('workspace'), a.id, 'Open default workspace must ignore a remembered non-default B selection');
  console.log('PASS: invalid deep-link recovery opens the actual default workspace');
} finally { releaseOld(); await db.end(); await f.close(); }
