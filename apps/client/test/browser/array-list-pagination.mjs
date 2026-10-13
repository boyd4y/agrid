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
  const skills = Array.from({ length: 17 }, (_, index) => {
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
    const result = await api('/members/agents', { name: `分页智能体 ${String(index).padStart(2, '0')}`, persona: { defaultHarness: 'pi', defaultModel: 'openrouter/free', runtime: 'local' } });
    users.push(result.member.userId);
  }
  const pager = page.getByRole('navigation', { name: '分页', exact: true });
  const countRows = async (selector, count) => page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
  const aligned = async expectedWidth => {
    const header = await page.locator('[data-slot=app-page-header-content]').boundingBox();
    const content = await page.locator('[data-slot=app-page-content]').boundingBox();
    assert(Math.abs(header.x - content.x) < 1 && Math.abs(header.width - content.width) < 1, 'header and list share their horizontal bounds');
    if (expectedWidth) assert.equal(content.width, expectedWidth, 'wide pages use the common 1024px content width');
    else assert(content.width <= 700 - 240 - 48 && content.x + content.width <= 700, 'narrow content fits the available workspace pane');
  };
  const cases = [
    { path: 'tables', search: '搜索表格', rows: '[data-testid=table-list-item]', fullQuery: '分页', exactQuery: '分页表格 01' },
    { path: 'members', search: '搜索成员', rows: '[data-testid=member-directory-row]', fullQuery: '分页', exactQuery: '分页成员 01' },
    { path: 'agents', search: '搜索智能体', rows: '[data-testid=member-directory-row]', fullQuery: '分页', exactQuery: '分页智能体 01' },
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
  assert.deepEqual(errors, []);
  console.log('PASS four real array lists: 20/page, full-list search/reset, empty search, last-page delete clamp, complete sidebar/member API, 1024px header/content alignment and 700px scroll; no screenshots/model calls');
} finally { await db.end(); await fixture.close(); }
