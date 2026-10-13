import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Agent tool settings browser' });
const { page, api, users, frontend, errors, artifact } = fixture;
try {
  await page.goto(frontend + '/app/agents/new');
  await page.locator('#agentName').fill('工具配置助手');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const fields = page.getByTestId('agent-tool-fields');
  await fields.locator('[data-tool-id="bash"]').waitFor();
  assert.equal(await fields.locator('[role="switch"][aria-checked="false"]').count(), 0, 'all tools default enabled');
  const toggle = (id) => fields.locator(`[data-tool-id="${id}"]`).getByRole('switch');
  await toggle('bash').click();
  await fields.locator('#agent-tool-search').fill('create_table');
  await toggle('create_table').click();
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await fields.locator('[data-tool-id="bash"]').waitFor();
  assert.equal(await toggle('bash').getAttribute('aria-checked'), 'false', 'step navigation retains the draft');
  await fields.locator('#agent-tool-search').fill('create_table');
  assert.equal(await toggle('create_table').getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: '创建智能体', exact: true }).click();
  await page.waitForURL('**/app/agents');
  const created = (await api('/members')).members.find((member) => member.name === '工具配置助手');
  users.push(created.userId);
  assert.deepEqual([...created.agent.persona.disabledTools].sort(), ['bash', 'create_table']);

  await page.goto(frontend + `/app/agents/${created.id}/edit`);
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await toggle('bash').waitFor();
  assert.equal(await toggle('bash').getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
  await toggle('bash').click();
  await page.getByRole('tab', { name: 'Skill', exact: true }).click();
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await toggle('bash').waitFor();
  assert.equal(await toggle('bash').getAttribute('aria-checked'), 'true', 'tabs retain draft changes');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual([...(await api('/members')).members.find((member) => member.id === created.id).agent.persona.disabledTools].sort(), ['bash', 'create_table']);
  await page.goto(frontend + `/app/agents/${created.id}/edit`);
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await toggle('bash').waitFor(); await toggle('bash').click();
  await fields.locator('#agent-tool-search').fill('no-such-tool');
  await fields.getByText('没有匹配的工具。', { exact: true }).waitFor();
  await fields.locator('#agent-tool-search').fill('');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction((value) => document.documentElement.classList.contains(value), theme);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#agent-tool-search')).backgroundColor === getComputedStyle(document.body).backgroundColor);
    await page.screenshot({ path: artifact(`agent-tools-${theme}.png`) });
  }
  await page.setViewportSize({ width: 700, height: 650 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'compact tool fields do not overflow');
  await page.getByRole('button', { name: '保存修改', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForURL('**/app/agents');
  assert.deepEqual((await api('/members')).members.find((member) => member.id === created.id).agent.persona.disabledTools, ['create_table']);
  await page.goto(frontend + `/app/agents/${created.id}/edit`);
  await page.route('**/api/members/agents/tools?**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '工具目录加载失败' }) }));
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await fields.getByText('工具目录加载失败', { exact: true }).waitFor();
  await page.unroute('**/api/members/agents/tools?**');
  await fields.getByRole('button', { name: '重试', exact: true }).click();
  await toggle('bash').waitFor();
  assert.equal(await toggle('bash').getAttribute('aria-checked'), 'true');
  assert.deepEqual(errors, []);
  console.log('PASS agent tool UI: native/platform default enabled, real create/edit persistence, step/tab draft retention, cancel/search/error retry, light/dark/compact');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-5000));
  await page.screenshot({ path: artifact('agent-tools-failure.png') });
  throw error;
} finally { await fixture.close(); }
