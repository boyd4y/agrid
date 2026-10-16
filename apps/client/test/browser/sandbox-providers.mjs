import assert from 'node:assert/strict';
import { createBrowserFixture, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Start the frontend in this implementation worktree');
const fixture = await createBrowserFixture({ name: 'Sandbox provider browser', serverEnv: {
  SANDBOX_PROVIDER: 'railway', RAILWAY_API_TOKEN: 'fixture-never-used-for-network', RAILWAY_SANDBOX_ENVIRONMENT_ID: 'dedicated-browser-fixture',
  E2B_API_KEY: '', VERCEL_TOKEN: '', VERCEL_TEAM_ID: '', VERCEL_PROJECT_ID: '', VERCEL_OIDC_TOKEN: '',
} });
const { page, api, users, errors } = fixture;
const select = async (id, name) => { await page.locator(id).click();await page.getByRole('option', { name, exact: true }).click(); };
try {
  await page.goto(frontend + '/app/agents/new');
  await page.locator('#agentName').fill('运行提供商助手');
  await select('#agent-runtime', 'Sandbox');
  assert((await page.locator('#agent-sandbox-provider').innerText()).includes('Railway'), 'new agent reflects configured provider default');
  assert(await page.getByText('Railway 在每轮结束后继续运行并计费，直至空闲超时或环境被销毁；超时后无法恢复原会话。', { exact: true }).isVisible());
  await page.locator('#agent-sandbox-provider').click();
  for (const label of ['E2B', 'Vercel']) assert.equal(await page.getByRole('option', { name: new RegExp(label) }).getAttribute('aria-disabled'), 'true', 'unconfigured cloud providers are disabled');
  await page.keyboard.press('Escape');
  for (let step = 0; step < 2; step++) await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '创建智能体', exact: true }).click();await page.waitForURL('**/app/agents');
  const created = (await api('/members')).members.find(member => member.name === '运行提供商助手');users.push(created.userId);
  assert.equal(created.agent.persona.runtime, 'sandbox');assert.equal(created.agent.persona.sandboxProvider, 'railway');
  await page.goto(frontend + `/app/agents/${created.id}/edit`);await page.locator('#agent-runtime').waitFor();
  assert((await page.locator('#agent-sandbox-provider').innerText()).includes('Railway'));
  await select('#agent-runtime', '本地工作区');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/members')).members.find(member => member.id === created.id).agent.persona.runtime, 'sandbox');
  await page.goto(frontend + `/app/agents/${created.id}/edit`);await page.locator('#agent-runtime').waitFor();
  await select('#agent-runtime', '本地工作区');
  await page.route(`**/api/members/agents/${created.id}`, route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) }));
  await page.getByRole('button', { name: '保存修改', exact: true }).click();await page.getByRole('alert').getByText('测试保存失败', { exact: true }).waitFor();
  assert((await page.locator('#agent-runtime').innerText()).includes('本地工作区'), 'failed save retains draft');
  await page.unroute(`**/api/members/agents/${created.id}`);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();await page.waitForURL('**/app/agents');
  await page.goto(frontend + `/app/agents/${created.id}/edit`);await page.locator('#agent-runtime').waitFor();
  assert((await page.locator('#agent-runtime').innerText()).includes('本地工作区'));
  const restored = (await api('/members')).members.find(member => member.id === created.id).agent.persona;
  assert.equal(restored.runtime, 'local');assert.equal(restored.sandboxProvider, 'railway');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 700, height: 900 });
    assert(await page.locator('#agent-runtime').isVisible());
    assert.equal(await page.getByTestId('agent-editor').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
  }
  assert.deepEqual(errors, []);
  console.log('PASS actual agent create/edit/readback, provider default, unconfigured providers disabled, cancel, failed save/retry, Local switch, light/dark/narrow; credentials are inert fixtures, no cloud resources or model runs');
} finally { await fixture.close(); }
