import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const fixture = await createBrowserFixture({ name: 'Automation Creation Browser' });
const { page, api, errors, frontend } = fixture;
const goto = (path) => page.goto(frontend + path);
try {
  // Only freshly created fixture workspace data is used.
  const table = await api('/tables', { name: 'Reading notes' });
  await api(`/tables/${table.id}`, { description: 'Books and excerpts' }, 'PATCH');
  await api(`/tables/${table.id}/columns`, { name: 'Title', type: 'text' });
  const other = await api('/tables', { name: 'Travel plans' });
  await api(`/tables/${other.id}/columns`, { name: 'Destination', type: 'text' });
  const assignee = await api(`/tables/${other.id}/columns`, { name: 'Assignee', type: 'person' });
  const agent = (await api('/members/agents', { name: 'Notes assistant', persona: { defaultHarness: 'pi' } })).member;
  fixture.users.push(agent.userId);
  await goto('/app/automations/new');
  const source = page.getByTestId('automation-source-step');
  const editor = page.getByTestId('automation-editor');
  await source.waitFor();
  assert.equal(await source.getByRole('button', { name: '下一步', exact: true }).isDisabled(), true);
  assert.equal(await editor.count(), 0);
  const search = source.getByRole('textbox', { name: '搜索表格…', exact: true });
  await search.fill('no-such-table');
  await source.getByText('没有找到匹配的表格', { exact: true }).waitFor();
  await search.fill('excerpts');
  await source.getByRole('radio', { name: /Reading notes/ }).waitFor();
  assert.equal(await source.getByRole('radio', { name: /Travel plans/ }).count(), 0, 'search includes description');
  await source.getByRole('radio', { name: 'Reading notes', exact: true }).focus();
  await page.keyboard.press('Space');
  assert.equal(await source.getByRole('radio', { name: 'Reading notes', exact: true }).isChecked(), true);

  let failSource = true;
  await page.route(`**/api/tables/${table.id}`, async (route) => {
    if (route.request().method() === 'GET' && failSource) {
      failSource = false;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture source unavailable' }) });
    } else await route.fallback();
  });
  await source.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture source unavailable' }).waitFor();
  assert.equal(await editor.count(), 0, 'failed source does not open an incomplete editor');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await editor.waitFor();
  await editor.getByPlaceholder('自动化名称').fill('Preserved draft');
  await editor.getByRole('switch', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await source.waitFor();
  assert.equal(await editor.isVisible(), false, 'draft stays mounted but inaccessible in source step');
  await source.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal(await editor.getByPlaceholder('自动化名称').inputValue(), 'Preserved draft');
  assert.equal(await editor.getByRole('switch', { name: '启用', exact: true }).isChecked(), false);

  // Picking another table does not change anything until the explicit next step.
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await source.getByRole('textbox', { name: '搜索表格…', exact: true }).fill('Travel');
  await source.getByRole('radio', { name: /Travel plans/ }).click();
  assert.equal(await source.getByRole('radio', { name: 'Travel plans', exact: true }).isChecked(), true);
  await source.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByTestId('automation-configuration-step').getByText('Travel plans', { exact: true }).waitFor();
  await editor.waitFor();
  await editor.getByPlaceholder('自动化名称').fill('Travel automation');
  assert.equal(await editor.getByRole('switch', { name: '启用', exact: true }).isChecked(), true, 'different source gets compatible fresh defaults');
  await editor.getByRole('switch', { name: '启用', exact: true }).click();

  const then = editor.locator('section').filter({ has: page.getByText('就', { exact: true }) });
  await then.getByRole('combobox', { name: '添加字段', exact: true }).click();
  await page.getByRole('option', { name: 'Assignee', exact: true }).click();
  await then.getByRole('button', { name: '选择成员…', exact: true }).click();
  await page.getByRole('button', { name: 'Automation Creation Browser', exact: true }).click();
  await then.getByRole('button', { name: 'Automation Creation Browser', exact: true }).waitFor();
  await then.getByRole('button', { name: '动作', exact: true }).click();
  const secondAction = then.getByRole('region', { name: '动作 2', exact: true });
  await secondAction.getByRole('combobox', { name: '动作', exact: true }).click();
  await page.getByRole('option', { name: '执行智能体', exact: true }).click();
  await secondAction.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Notes assistant', exact: true }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'Automation Creation Browser', exact: true }).count(), 0, 'humans are excluded only from agent execution');
  await page.keyboard.press('Escape');
  await secondAction.getByRole('textbox').fill('Summarize the travel plan');
  const firstAction = then.getByRole('region', { name: '动作 1', exact: true });
  const typeBox = await firstAction.getByRole('combobox', { name: '动作', exact: true }).boundingBox();
  const commandBox = await firstAction.getByRole('combobox', { name: '数据操作', exact: true }).boundingBox();
  assert.equal(Math.round(typeBox.y), Math.round(commandBox.y), 'type and command share a row');
  const tableBox = await firstAction.getByRole('combobox', { name: '目标表格', exact: true }).boundingBox();
  const recordBox = await firstAction.getByRole('combobox', { name: '值来源', exact: true }).first().boundingBox();
  assert.equal(Math.round(tableBox.y), Math.round(recordBox.y), 'target table and record share a row');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=app-sidebar]').getBoundingClientRect().width <= 56);
  if (await editor.evaluate(el => el.scrollWidth > el.clientWidth)) console.error(await editor.evaluate(el => [...el.querySelectorAll('*')].filter(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).slice(0, 12).map(child => ({ tag: child.tagName, classes: child.className, text: child.textContent?.slice(0, 70), width: child.getBoundingClientRect().width }))));
  assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false, 'compact action controls wrap at narrow width');
  await page.setViewportSize({ width: 1600, height: 1000 });


  let attempts = 0, releaseSave;
  const saving = new Promise((resolve) => { releaseSave = resolve; });
  await page.route(`**/api/automations`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    if (attempts === 1) {
      await saving;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture save rejected' }) });
    } else await route.fallback();
  });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.getByRole('button', { name: '保存中…', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '返回来源', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '返回列表', exact: true }).isDisabled(), true);
  assert.equal(await editor.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  releaseSave();
  await editor.getByRole('alert').filter({ hasText: 'Fixture save rejected' }).waitFor();
  assert.equal(attempts, 1);
  assert.equal(await editor.getByPlaceholder('自动化名称').inputValue(), 'Travel automation');
  assert.equal(await page.getByRole('button', { name: '返回来源', exact: true }).isEnabled(), true);
  assert.equal((await api('/automations')).rules.length, 0, 'failed submit does not create a rule');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL('**/app/automations');
  const rules = (await api('/automations')).rules;
  assert.equal(rules.length, 1); assert.equal(rules[0].tableId, other.id);
  assert.equal(rules[0].name, 'Travel automation'); assert.equal(rules[0].enabled, false);
  assert.equal(Object.keys(rules[0].actions[0].input.cells)[0], assignee.id);
  assert.equal(rules[0].actions[0].input.cells[assignee.id], fixture.users[0], 'person field mutation preserves the selected human user ID');
  assert.equal(rules[0].actions[1].agentUserId, agent.userId, 'default execution assignee is an agent, regardless of member order');
  assert.equal(attempts, 2, 'one failed attempt and one successful retry');

  await goto(`/app/automations/${rules[0].id}`);
  await editor.waitFor();
  assert.equal(await page.locator('#automation-source').isDisabled(), true, 'saved source remains fixed');
  await goto(`/app/tables/${table.id}/automations`);
  await page.waitForURL(`**/app/automations/new?source=${table.id}`);
  await editor.waitFor();
  assert.equal(await source.count(), 0, 'preselected legacy source goes directly to configuration');
  await page.getByRole('button', { name: '返回来源', exact: true }).click();
  await source.waitFor();
  await page.setViewportSize({ width: 700, height: 650 });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction((theme) => document.documentElement.classList.contains(theme), theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await source.getByRole('button', { name: '下一步', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await source.getByRole('button', { name: '下一步', exact: true }).isVisible(), true);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => localStorage.setItem('tabdo.locale', 'en')); await page.reload();
  await editor.waitFor();
  await page.getByRole('button', { name: 'Back to source', exact: true }).click();
  await source.waitFor();
  await source.getByRole('textbox', { name: 'Search tables…' }).fill('Reading');
  await source.getByRole('radio', { name: /Reading notes/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS automation creation searchable source/keyboard/next/load failure retry/draft preservation/source switch/person action with human/agent-only execution/save loading/failure retry/canonical persisted rule/legacy entry/compact light-dark/English');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-6000));
  throw error;
} finally { await fixture.close(); }
