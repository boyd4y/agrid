import assert from 'node:assert/strict';
import { createBrowserFixture, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Use the existing frontend; never restart it');
const fixture = await createBrowserFixture({ name: 'Agent capability settings browser' });
const { page, api, users, errors } = fixture;
try {
  const catalog = await api('/members/agents/tools?harness=pi');
  const tableToolIds = catalog.tools.filter(tool => tool.source === 'platform' && ['表格与记录', '关联记录', '视图'].includes(tool.group)).map(tool => tool.id);
  const formToolIds = catalog.tools.filter(tool => tool.source === 'platform' && tool.group === '表单').map(tool => tool.id);
  assert(tableToolIds.includes('create_table') && tableToolIds.includes('query_rows'));
  assert(formToolIds.includes('create_form_view'));
  assert(catalog.tools.every(tool => tool.source === 'platform'), 'catalog configures platform tools only');
  assert.equal(catalog.tools.some(tool => ['get_task_state', 'create_goal', 'update_goal', 'update_plan'].includes(tool.id)), false, 'retired task controls are absent');
  const expectedGroups = ['platform-tables', 'platform-forms', 'platform-reports', 'platform-automations', 'platform-sites'].sort();
  const assertPlatformGroups = async () => {
    assert.deepEqual(await page.getByTestId('agent-tool-fields').locator('[data-tool-group]').evaluateAll(nodes => nodes.map(node => node.dataset.toolGroup).sort()), expectedGroups, 'exactly five platform groups; no native or task group');
    assert.equal(await page.getByTestId('agent-tool-fields').getByRole('switch').count(), expectedGroups.length);
  };
  const group = id => page.getByTestId('agent-tool-fields').locator(`[data-tool-group="${id}"]`);
  const toggle = id => group(id).getByRole('switch');
  const toolsStep = async () => { await page.getByRole('button', { name: '下一步', exact: true }).click(); await page.getByRole('button', { name: '下一步', exact: true }).click(); await toggle('platform-tables').waitFor(); await assertPlatformGroups(); };
  const basicsStep = async () => { await page.getByRole('button', { name: '上一步', exact: true }).click(); await page.getByRole('button', { name: '上一步', exact: true }).click(); };
  const selectHarness = async label => { await page.locator('#agent-harness').click(); await page.getByRole('option', { name: new RegExp(label) }).click(); };
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'configuration stays in the viewport');
    assert.equal(await page.getByTestId('agent-editor').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'configuration has no hidden horizontal overflow');
  };

  await page.goto(frontend + '/app/agents/new');
  await page.locator('#agentName').fill('能力配置助手');
  await toolsStep();
  assert.equal(await page.getByTestId('agent-tool-fields').locator('[role="switch"][aria-checked="false"]').count(), 0);
  assert.equal(await page.locator('[data-slot=collapsible][data-state=open]').count(), 0, 'API details start collapsed');
  await toggle('platform-tables').click();
  await group('platform-tables').locator('[data-slot=collapsible-trigger]').click(); await group('platform-tables').locator('[data-tool-id="create_table"]').waitFor();
  assert.equal(await group('platform-tables').locator('[data-tool-id]').getByRole('switch').count(), 0, 'API detail rows are read-only');

  await basicsStep(); await selectHarness('Codex'); await toolsStep();
  assert.equal(await toggle('platform-tables').getAttribute('aria-checked'), 'false', 'platform category draft follows the Harness');
  await toggle('platform-forms').click();
  await basicsStep(); await selectHarness('Pi'); await toolsStep();
  assert.equal(await toggle('platform-forms').getAttribute('aria-checked'), 'false', 'a platform change in Codex remains shared after returning to Pi');
  assert.equal(await toggle('platform-tables').getAttribute('aria-checked'), 'false');
  await basicsStep(); await selectHarness('Codex'); await toolsStep();
  assert.equal(await toggle('platform-forms').getAttribute('aria-checked'), 'false', 'switching back to Codex retains the same platform draft');
  await basicsStep(); await selectHarness('Pi'); await toolsStep();
  await page.getByRole('button', { name: '创建智能体', exact: true }).click(); await page.waitForURL('**/app/agents');
  const created = (await api('/members')).members.find(member => member.name === '能力配置助手'); users.push(created.userId);
  assert.deepEqual([...created.agent.persona.disabledTools].sort(), [...tableToolIds, ...formToolIds].sort());

  // Existing per-API choices become mixed capabilities without discarding them.
  await api(`/members/agents/${created.id}`, { persona: { ...created.agent.persona, disabledTools: ['read', 'create_goal', 'create_table'] } }, 'PATCH');
  assert.deepEqual((await api('/members')).members.find(member => member.id === created.id).agent.persona.disabledTools, ['create_table'], 'legacy native/task choices normalize away while the platform exception remains');
  await page.goto(frontend + `/app/agents/${created.id}/edit`); await page.locator('#agentName').waitFor();
  const avatar = page.getByTestId('avatar-field').getByRole('img').first();
  const avatarBox = await avatar.boundingBox(); assert(avatarBox.width <= 40 && avatarBox.height <= 40, 'avatar shares the compact member size');
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
  const basicTab = page.getByRole('tab', { name: '基础信息', exact: true });
  await basicTab.focus(); await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Skill');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-label="Skill"]')?.getAttribute('aria-selected') === 'true');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '工具');
  await page.keyboard.press('Enter'); await toggle('platform-tables').waitFor(); await assertPlatformGroups();
  await page.locator('#agent-tool-search').focus(); // Measure the tab surface after moving the keyboard focus ring.
  const activeStyle = await page.getByRole('tab', { name: '工具', exact: true }).evaluate(node => ({ background: getComputedStyle(node).backgroundColor, shadow: getComputedStyle(node).boxShadow }));
  assert.notEqual(activeStyle.background, 'rgba(0, 0, 0, 0)', 'the current editor navigation has a selected background');
  assert.equal(await page.getByRole('tab', { name: '工具', exact: true }).evaluate(node => getComputedStyle(node, '::after').display), 'none', 'no selected white dot');
  assert.equal(await page.getByRole('tablist', { name: '智能体配置', exact: true }).getAttribute('data-orientation'), 'vertical');
  assert.equal(await page.getByRole('tablist', { name: '智能体配置', exact: true }).getAttribute('data-variant'), 'navigation');
  assert.equal(await page.getByTestId('agent-editor').locator('aside').count(), 1);
  assert.equal(await group('platform-tables').getAttribute('data-mixed'), 'true');
  await toggle('platform-forms').click();
  assert.equal(await group('platform-forms').getAttribute('data-mixed'), 'false'); assert.equal(await group('platform-tables').getAttribute('data-mixed'), 'true', 'toggling forms preserves the existing table exception');
  await page.getByRole('tab', { name: 'Skill', exact: true }).click(); await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('platform-forms').waitFor();
  assert.equal(await toggle('platform-forms').getAttribute('aria-checked'), 'false', 'tabs retain the platform capability draft');
  await toggle('platform-reports').click(); await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual([...((await api('/members')).members.find(member => member.id === created.id).agent.persona.disabledTools)].sort(), ['create_table'], 'cancel discards unsaved group changes');

  await page.goto(frontend + `/app/agents/${created.id}/edit`); await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('platform-forms').waitFor(); await toggle('platform-forms').click();
  const fields = page.getByTestId('agent-tool-fields'); await fields.locator('#agent-tool-search').fill('no-such-tool'); await fields.getByText('没有匹配的工具。', { exact: true }).waitFor(); await fields.locator('#agent-tool-search').fill('');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme }); await page.waitForFunction(value => document.documentElement.classList.contains(value), theme); await noOverflow();
  }
  for (const width of [700, 320]) {
    await page.setViewportSize({ width, height: 650 }); await noOverflow();
    await page.waitForFunction(() => document.querySelector('[data-testid=app-sidebar]').getBoundingClientRect().width <= 56);
    await page.getByRole('tab', { name: '基础信息', exact: true }).click(); await noOverflow();
    await page.locator('#agentName').fill('保留跨 tab 草稿'); await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('platform-forms').waitFor(); await noOverflow();
    await page.getByRole('tab', { name: '基础信息', exact: true }).click(); assert.equal(await page.locator('#agentName').inputValue(), '保留跨 tab 草稿'); await page.locator('#agentName').fill('能力配置助手');
    await page.getByRole('button', { name: '保存修改', exact: true }).scrollIntoViewIfNeeded(); const footer = await page.getByRole('button', { name: '保存修改', exact: true }).boundingBox(); assert(footer.y >= 0 && footer.y + footer.height <= 650, 'footer actions remain reachable');
  }
  await page.route(`**/api/members/agents/${created.id}`, route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) }));
  await page.getByRole('button', { name: '保存修改', exact: true }).click(); await page.getByRole('alert').getByText('测试保存失败', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('platform-forms').waitFor(); assert.equal(await toggle('platform-forms').getAttribute('aria-checked'), 'false', 'failed save keeps the platform draft');
  await page.unroute(`**/api/members/agents/${created.id}`); await page.getByRole('button', { name: '保存修改', exact: true }).click(); await page.waitForURL('**/app/agents');
  assert.deepEqual([...((await api('/members')).members.find(member => member.id === created.id).agent.persona.disabledTools)].sort(), ['create_table', ...formToolIds].sort());

  await page.setViewportSize({ width: 700, height: 650 }); await page.goto(frontend + `/app/agents/${created.id}/edit`);
  await page.route('**/api/members/agents/tools?**', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '工具目录加载失败' }) }));
  await page.getByRole('tab', { name: '工具', exact: true }).click(); await fields.getByText('工具目录加载失败', { exact: true }).waitFor(); await page.unroute('**/api/members/agents/tools?**');
  await fields.getByRole('button', { name: '重试', exact: true }).click(); await toggle('platform-forms').waitFor(); await assertPlatformGroups(); assert.equal(await toggle('platform-forms').getAttribute('aria-checked'), 'false');
  await page.goto(frontend + '/app/members'); await page.getByRole('button', { name: '编辑 Agent capability settings browser 的头像', exact: true }).click();
  const memberEditor = page.getByRole('dialog', { name: '编辑成员头像', exact: true });
  const humanAvatar = await memberEditor.getByTestId('avatar-field').locator(':scope > div > span').first().boundingBox(); assert(humanAvatar.width <= 40 && humanAvatar.height <= 40, 'member and agent avatar editors share density');
  await memberEditor.getByRole('button', { name: '取消', exact: true }).click(); await memberEditor.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS five platform capability groups without duplicate skill reader/no native or task config, mixed legacy platform choices, shared Harness settings, create/edit persistence, cancel/failed save/retry, settings-style vertical navigation without dot and keyboard, member avatar density, light/dark/700/320/footer; no model calls or screenshots');
} finally { await fixture.close(); }
