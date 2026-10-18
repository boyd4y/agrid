import assert from 'node:assert/strict';
import { createBrowserFixture, databaseUrl, postgres, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Use the existing frontend; never restart it');
const fixture = await createBrowserFixture({ name: '分页验收' });
const { page, api, users, organizations, errors } = fixture;
const db = postgres(databaseUrl);
try {
  const organizationId = organizations[0];
  const humans = Array.from({ length: 20 }, (_, index) => ({ id: crypto.randomUUID(), name: `分页成员 ${String(index + 1).padStart(2, '0')}`, email: `${crypto.randomUUID()}@local.test` }));
  users.push(...humans.map(user => user.id));
  // Existing custom skills are supported by the list even while new skill creation is closed.
  const builtinSkillCount = (await api('/skills')).skills.length;
  assert(builtinSkillCount < 21, 'fixture leaves room for custom skills on two pages');
  const skills = Array.from({ length: 21 - builtinSkillCount }, (_, index) => {
    const name = `pagination-skill-${String(index + 1).padStart(2, '0')}`;
    return { organization_id: organizationId, name, description: '分页验收技能', document: `---\nname: ${name}\ndescription: 分页验收技能\n---\n\nOnly a local pagination fixture.\n` };
  });
  await db.begin(async transaction => {
    await transaction`insert into "user" ${transaction(humans, 'id', 'name', 'email')}`;
    await transaction`insert into member ${transaction(humans.map(user => ({ id: crypto.randomUUID(), organization_id: organizationId, user_id: user.id })), 'id', 'organization_id', 'user_id')}`;
    await transaction`insert into skills ${transaction(skills, 'organization_id', 'name', 'description', 'document')}`;
  });
  for (let index = 1; index <= 21; index++) {
    await api('/tables', { name: `分页表格 ${String(index).padStart(2, '0')}` });
    await api('/sites', { name: `分页站点 ${String(index).padStart(2, '0')}`, files: [{ path: 'index.html', content: '<!doctype html><title>Pagination fixture</title>' }] });
    const result = await api('/members/agents', { name: `分页智能体 ${String(index).padStart(2, '0')}`, persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } });
    users.push(result.member.userId);
  }
  const pager = page.getByRole('navigation', { name: '分页', exact: true });
  const countRows = async (selector, count) => page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
  const aligned = async expectedWidth => {
    const measured = await page.waitForFunction(expectedWidth => {
      const header = document.querySelector('[data-slot=app-page-header-content]')?.getBoundingClientRect();
      const content = document.querySelector('[data-slot=app-page-content]')?.getBoundingClientRect();
      const sidebar = document.querySelector('[data-testid=app-sidebar]')?.getBoundingClientRect();
      if (!header || !content || !sidebar || (!expectedWidth && Math.abs(sidebar.width - 56) >= 1)) return false;
      if (Math.abs(header.x - content.x) >= 1 || Math.abs(header.width - content.width) >= 1) return false;
      return { header: header.toJSON(), content: content.toJSON(), sidebar: sidebar.toJSON() };
    }, expectedWidth);
    const { content, sidebar } = await measured.jsonValue();
    if (expectedWidth) assert.equal(content.width, expectedWidth, 'wide pages use the common 1024px content width');
    else assert(content.x >= sidebar.x + sidebar.width + 24 - 1 && content.x + content.width <= 700 - 24 + 1, 'narrow content fits the actual responsive sidebar bounds');
  };
  const cases = [
    { path: 'tables', search: '搜索表格', rows: '[data-testid=table-list-item]', fullQuery: '分页', exactQuery: '分页表格 01' },
    { path: 'members', search: '搜索成员', rows: '[data-testid=member-directory-row]', fullQuery: '分页', exactQuery: '分页成员 01' },
    { path: 'agents', search: '搜索智能体', rows: '[data-testid=member-directory-row]', fullQuery: '分页', exactQuery: '分页智能体 01' },
    { path: 'sites', search: '搜索站点', rows: 'ul[aria-label=站点] > li', fullQuery: '分页', exactQuery: '分页站点 01' },
    { path: 'skills', search: '搜索技能', rows: 'tbody > tr', fullQuery: '', exactQuery: 'pagination-skill-01' },
  ];
  for (const scenario of cases) {
    await page.goto(`${frontend}/app/${scenario.path}`); await countRows(scenario.rows, 20); await aligned(1024);
    await pager.getByRole('button', { name: '下一页', exact: true }).click(); await countRows(scenario.rows, 1);
    assert.equal(await pager.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    const search = page.getByRole('textbox', { name: scenario.search, exact: true });
    if (scenario.fullQuery) {
      await search.fill(scenario.fullQuery); await countRows(scenario.rows, 20);
      assert.equal(await pager.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true, 'a changed search returns to page one even when page two remains valid');
    }
    await search.fill(scenario.exactQuery); await countRows(scenario.rows, 1); await aligned(1024);
    assert.equal(await pager.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
    await search.fill('no-such-pagination-result'); await countRows(scenario.rows, 0);
    await search.fill(''); await countRows(scenario.rows, 20);
  }
  // Actual deletion empties page two; the retained complete sidebar list is independent of paging.
  await page.goto(`${frontend}/app/tables`); await countRows('[data-testid=table-list-item]', 20);
  assert.equal(await page.locator('#sidebar-my-tables a').count(), 21, 'sidebar still receives all tables');
  await pager.getByRole('button', { name: '下一页', exact: true }).click(); await countRows('[data-testid=table-list-item]', 1);
  await page.getByTestId('table-list-item').getByRole('button').click();
  assert.equal(new URL(page.url()).pathname, '/app/tables', 'the independent table menu does not navigate');
  await page.getByRole('button', { name: '删除表格', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await countRows('[data-testid=table-list-item]', 20);
  assert.equal(await pager.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true, 'deleting the last page immediately clamps to the preceding page');
  assert.equal(await pager.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#sidebar-my-tables a').count(), 20);
  assert.equal((await api('/members')).members.length, 42, 'directory pagination never truncates the member API used by pickers');
  await page.setViewportSize({ width: 700, height: 650 }); await aligned();
  await page.goto(`${frontend}/app/members`); await countRows('[data-testid=member-directory-row]', 20); await aligned();
  await pager.getByRole('button', { name: '下一页', exact: true }).scrollIntoViewIfNeeded();
  const footer = await pager.boundingBox(); assert(footer.y >= 0 && footer.y + footer.height <= 650, 'outer page scrolling reaches pagination');
  // Main item surfaces navigate through native sibling links; actions remain independent.
  const source = (await api('/tables'))[0];
  const column = await api(`/tables/${source.id}/columns`, { name: 'Title', type: 'text' });
  const rule = await api(`/tables/${source.id}/automations`, { name: 'Navigation automation', enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'update_field', columnId: column.id, value: 'Fixture' }] });
  const report = await api('/reports', { name: 'Navigation report', columns: 1, widgets: [{ id: crypto.randomUUID(), type: 'text', title: 'Note', width: 'full', content: 'Fixture' }] });
  const items = [
    { path: 'tables', selector: '[data-testid=table-list-item]' },
    { path: 'automations', selector: '[data-testid=automation-list-item]' },
    { path: 'reports', selector: '[data-testid=report-list-item]' },
    { path: 'agents', selector: '[data-testid=member-directory-row]' },
  ];
  for (const scenario of items) {
    await page.goto(`${frontend}/app/${scenario.path}`);
    const item = page.locator(scenario.selector).first(); await item.waitFor();
    const link = item.locator(':scope > a').first(); await link.waitFor();
    const href = await link.getAttribute('href'); assert(href.startsWith(`/app/${scenario.path}/`));
    assert.equal(await item.locator('a button, button a, a a').count(), 0, 'navigation never contains another interactive control');
    await link.hover(); assert.equal(await item.locator('h2, .font-medium').first().evaluate(node => getComputedStyle(node).textDecorationLine), 'none', 'titles remain plain even on hover');
    if (scenario.path === 'reports') {
      await item.getByRole('button').click(); await page.getByRole('alertdialog').waitFor();
      assert.equal(new URL(page.url()).pathname, '/app/reports', 'report deletion does not follow the card link');
      await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    } else if (scenario.path === 'automations') {
      await item.getByRole('button').click(); await page.getByRole('menuitem', { name: '删除自动化', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/app/automations', 'automation menu does not follow the row link');
      await page.keyboard.press('Escape');
    }
    if (scenario.path === 'agents') { await link.focus(); await page.keyboard.press('Enter'); }
    else await item.click({ position: { x: 8, y: 8 } });
    await page.waitForURL(frontend + href);
  }
  await page.goto(`${frontend}/app/skills`);
  const skillRow = page.locator('tbody > tr').filter({ has: page.getByRole('link', { name: 'pagination-skill-01', exact: true }) });
  const skillLink = skillRow.getByRole('link', { name: 'pagination-skill-01', exact: true }); await skillLink.waitFor();
  const skillHref = await skillLink.getAttribute('href');
  assert.equal(await skillLink.locator('button, [role=switch]').count(), 0);
  await skillRow.getByRole('switch').click();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('pagination-skill-01'))?.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
  assert.equal(new URL(page.url()).pathname, '/app/skills', 'skill switching remains separate from navigation');
  await skillLink.focus(); await page.keyboard.press('Enter'); await page.waitForURL(frontend + skillHref);
  await page.goto(`${frontend}/app/members`);
  const memberRow = page.getByTestId('member-directory-row').first(); await memberRow.waitFor();
  await memberRow.click({ position: { x: 8, y: 8 } });
  const avatarEditor = page.getByRole('dialog', { name: '编辑成员头像', exact: true }); await avatarEditor.waitFor();
  assert.equal(new URL(page.url()).pathname, '/app/members', 'member main area uses its existing avatar editor');
  await avatarEditor.getByRole('button', { name: '取消', exact: true }).click(); await avatarEditor.waitFor({ state: 'detached' });
  await memberRow.locator('div.relative').getByRole('button').click(); await avatarEditor.waitFor();
  await page.keyboard.press('Escape'); await avatarEditor.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('PASS five real array lists (including Sites): 20/page, full-list search/reset, empty search, last-page delete clamp, complete sidebar/member API, 1024px header/content alignment and 700px scroll, native whole-item navigation/plain titles/independent actions/member Popover; no screenshots/model calls');
} finally { await db.end(); await fixture.close(); }
