import assert from 'node:assert/strict';
import { createBrowserFixture, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Use the existing frontend; never restart it');
const fixture = await createBrowserFixture({ name: 'Agent capability settings browser' });
const { page, api, users, errors } = fixture;
try {
  const catalog = await api('/members/agents/tools?harness=pi');
  const tableToolIds = catalog.tools.filter(tool => tool.source === 'platform' && ['表格与记录', '关联记录', '视图'].includes(tool.group)).map(tool => tool.id);
  assert(tableToolIds.includes('create_table') && tableToolIds.includes('query_rows'));
  const group = id => page.getByTestId('agent-tool-fields').locator(`[data-tool-group="${id}"]`);
  const toggle = id => group(id).getByRole('switch');
  const toolsStep = async () => { await page.getByRole('button', { name: '下一步', exact: true }).click(); await page.getByRole('button', { name: '下一步', exact: true }).click(); await toggle('builtin-commands').waitFor(); };
  const basicsStep = async () => { await page.getByRole('button', { name: '上一步', exact: true }).click(); await page.getByRole('button', { name: '上一步', exact: true }).click(); };
  const selectHarness = async label => { await page.locator('#agent-harness').click(); await page.getByRole('option', { name: new RegExp(label) }).click(); };
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'configuration stays in the viewport');
    assert.equal(await page.getByTestId('agent-editor').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'configuration has no hidden horizontal overflow');
  };

  await page.goto(frontend + '/app/agents/new');
  await page.locator('#agentName').fill('能力配置助手');
  await toolsStep();
  assert.equal(await page.getByTestId('agent-tool-fields').getByRole('switch').count(), 10, 'Pi exposes four native and six platform capabilities instead of every API');
  assert.equal(await page.getByTestId('agent-tool-fields').locator('[role="switch"][aria-checked="false"]').count(), 0);
  assert.equal(await page.locator('details[open]').count(), 0, 'API details start collapsed');
  await toggle('builtin-commands').click(); await toggle('platform-tables').click();
  await group('platform-tables').locator('summary').click(); await group('platform-tables').locator('[data-tool-id="create_table"]').waitFor();
  assert.equal(await group('platform-tables').locator('[data-tool-id]').getByRole('switch').count(), 0, 'API detail rows are read-only');

  await basicsStep(); await selectHarness('Codex'); await toolsStep();
  assert.equal(await toggle('platform-tables').getAttribute('aria-checked'), 'false', 'platform category draft follows the Harness');
  await toggle('builtin-search').click();
  await basicsStep(); await selectHarness('Pi'); await toolsStep();
  assert.equal(await toggle('builtin-commands').getAttribute('aria-checked'), 'false', 'returning to Pi restores its native draft');
  assert.equal(await toggle('platform-tables').getAttribute('aria-checked'), 'false');
  await basicsStep(); await selectHarness('Codex'); await toolsStep();
  assert.equal(await toggle('builtin-search').getAttribute('aria-checked'), 'false', 'Codex keeps its own native draft too');
  await basicsStep(); await selectHarness('Pi'); await toolsStep();
  await page.getByRole('button', { name: '创建智能体', exact: true }).click(); await page.waitForURL('**/app/agents');
  const created = (await api('/members')).members.find(member => member.name === '能力配置助手'); users.push(created.userId);
  assert.deepEqual([...created.agent.persona.disabledTools].sort(), ['bash', ...tableToolIds].sort());

  // Existing per-API choices become mixed capabilities without discarding them.
  await api(`/members/agents/${created.id}`, { persona: { ...created.agent.persona, disabledTools: ['read', 'create_table'] } }, 'PATCH');
  await page.goto(frontend + `/app/agents/${created.id}/edit`); await page.locator('#agentName').waitFor();
  const avatar = page.getByTestId('avatar-field').getByRole('img').first();
  const avatarBox = await avatar.boundingBox(); assert(avatarBox.width <= 40 && avatarBox.height <= 40, 'avatar shares the compact member size');
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
  const basicTab = page.getByRole('tab', { name: '基础信息', exact: true });
  await basicTab.focus(); await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-label="Skill"]')?.getAttribute('aria-selected') === 'true');
  await page.keyboard.press('ArrowDown'); await toggle('builtin-files').waitFor();
  await page.locator('#agent-tool-search').focus(); // Measure the tab surface after moving the keyboard focus ring.
  const activeStyle = await page.getByRole('tab', { name: '工具', exact: true }).evaluate(node => ({ background: getComputedStyle(node).backgroundColor, shadow: getComputedStyle(node).boxShadow }));
  assert.equal(activeStyle.background, 'rgba(0, 0, 0, 0)'); assert(activeStyle.shadow === 'none' || /^(?:rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(?:, )?)+$/.test(activeStyle.shadow), 'line tabs have no visible shadow; keyboard focus retains its ring');
  assert.equal(await page.getByRole('tablist', { name: '智能体配置', exact: true }).getAttribute('data-orientation'), 'vertical');
  assert.equal(await group('builtin-files').getAttribute('data-mixed'), 'true'); assert.equal(await group('platform-tables').getAttribute('data-mixed'), 'true');
  await toggle('builtin-files').click();
  assert.equal(await group('builtin-files').getAttribute('data-mixed'), 'false'); assert.equal(await group('platform-tables').getAttribute('data-mixed'), 'true', 'toggling files preserves the table exception');
  await page.getByRole('tab', { name: 'Skill', exact: true }).click(); await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('builtin-files').waitFor();
  assert.equal(await toggle('builtin-files').getAttribute('aria-checked'), 'true', 'tabs retain the capability draft');
  await toggle('builtin-commands').click(); await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual([...((await api('/members')).members.find(member => member.id === created.id).agent.persona.disabledTools)].sort(), ['create_table', 'read'], 'cancel discards unsaved group changes');

  await page.goto(frontend + `/app/agents/${created.id}/edit`); await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('builtin-files').waitFor(); await toggle('builtin-files').click();
  const fields = page.getByTestId('agent-tool-fields'); await fields.locator('#agent-tool-search').fill('no-such-tool'); await fields.getByText('没有匹配的工具。', { exact: true }).waitFor(); await fields.locator('#agent-tool-search').fill('');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme }); await page.waitForFunction(value => document.documentElement.classList.contains(value), theme); await noOverflow();
  }
  for (const width of [700, 320]) {
    if (width === 320) { await page.getByRole('button', { name: '收起侧栏', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid=app-sidebar]').getBoundingClientRect().width <= 56); }
    await page.setViewportSize({ width, height: 650 }); await noOverflow();
    await page.getByRole('tab', { name: '基础信息', exact: true }).click(); await noOverflow();
    await page.locator('#agentName').fill('保留跨 tab 草稿'); await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('builtin-files').waitFor(); await noOverflow();
    await page.getByRole('tab', { name: '基础信息', exact: true }).click(); assert.equal(await page.locator('#agentName').inputValue(), '保留跨 tab 草稿'); await page.locator('#agentName').fill('能力配置助手');
    await page.getByRole('button', { name: '保存修改', exact: true }).scrollIntoViewIfNeeded(); const footer = await page.getByRole('button', { name: '保存修改', exact: true }).boundingBox(); assert(footer.y >= 0 && footer.y + footer.height <= 650, 'footer actions remain reachable');
  }
  await page.route(`**/api/members/agents/${created.id}`, route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) }));
  await page.getByRole('button', { name: '保存修改', exact: true }).click(); await page.getByRole('alert').getByText('测试保存失败', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '工具', exact: true }).click(); await toggle('builtin-files').waitFor(); assert.equal(await toggle('builtin-files').getAttribute('aria-checked'), 'true', 'failed save keeps the draft');
  await page.unroute(`**/api/members/agents/${created.id}`); await page.getByRole('button', { name: '保存修改', exact: true }).click(); await page.waitForURL('**/app/agents');
  assert.deepEqual((await api('/members')).members.find(member => member.id === created.id).agent.persona.disabledTools, ['create_table']);

  await page.setViewportSize({ width: 700, height: 650 }); await page.goto(frontend + `/app/agents/${created.id}/edit`);
  await page.route('**/api/members/agents/tools?**', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '工具目录加载失败' }) }));
  await page.getByRole('tab', { name: '工具', exact: true }).click(); await fields.getByText('工具目录加载失败', { exact: true }).waitFor(); await page.unroute('**/api/members/agents/tools?**');
  await fields.getByRole('button', { name: '重试', exact: true }).click(); await toggle('builtin-files').waitFor(); assert.equal(await toggle('builtin-files').getAttribute('aria-checked'), 'true');
  await page.goto(frontend + '/app/members'); await page.getByRole('button', { name: '编辑 Agent capability settings browser 的头像', exact: true }).click();
  const memberEditor = page.getByRole('dialog', { name: '编辑成员头像', exact: true });
  const humanAvatar = await memberEditor.getByTestId('avatar-field').locator(':scope > div > span').first().boundingBox(); assert(humanAvatar.width <= 40 && humanAvatar.height <= 40, 'member and agent avatar editors share density');
  await memberEditor.getByRole('button', { name: '取消', exact: true }).click(); await memberEditor.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS agent capability groups/mixed state, create/edit persistence, per-Harness drafts, cancel/failed save/retry, vertical line tabs and keyboard, member avatar density, light/dark/700/320/footer; no screenshots');
} finally { await fixture.close(); }
