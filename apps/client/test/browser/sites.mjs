import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserFixture, postgres, databaseUrl, artifact, pause } from './fixture.mjs';
const directory = await mkdtemp(join(tmpdir(), 'tabdo-site-workflow-'));
let nativeFiles, nativeId, calls = 0, readSkill = false;
const fixture = await createBrowserFixture({ name: 'Sites workflow', serverEnv: { FILE_STORAGE_LOCAL_DIR: directory }, modelRequest: async(req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw); calls++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'site-ui', object: 'chat.completion.chunk', created: 1, model: 'fixture/model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  let name, args;
  if (calls === 1) {
    const system = body.messages.filter(message => message.role === 'system').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
    const path = system.match(/\/[^\s"'<>()[\]\\]+\/site\/SKILL\.md/)?.[0];
    assert(path, 'native harness advertises the actual Site skill path');
    const props = body.tools.find(tool => tool.function.name === 'read').function.parameters.properties;
    name = 'read'; args = { [props.path ? 'path' : 'file_path']: path };
  } else if (calls === 2) {
    const tool = body.messages.filter(message => message.role === 'tool').at(-1);
    assert(JSON.stringify(tool).includes('save_site'), 'Harness read returns actual Site instructions'); readSkill = true;
    name = 'save_site'; args = { name: '活动报名网站', files: nativeFiles };
  } else if (calls === 3) {
    const [saved] = await db`select id from sites where organization_id=${fixture.organizations[0]} and name='活动报名网站'`;
    assert(saved, 'native host tool really persisted the generated site'); nativeId = saved.id;
    name = 'open_preview'; args = { kind: 'site', siteId: nativeId };
  } else { send({ content: '报名网站已生成，可以在右侧预览。' }); send({}, 'stop'); res.end('data: [DONE]\n\n'); return; }
  send({ tool_calls: [{ index: 0, id: 'site_call_' + calls, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls'); res.end('data: [DONE]\n\n');
} });
const { page, ctx, api, base, frontend, errors } = fixture;
const db = postgres(databaseUrl); let visitor;
try {
  const content = await api('/tables', { name: 'Public events' }), submissions = await api('/tables', { name: 'Event registrations' });
  const title = (await api('/tables/' + content.id)).columns[0].id, name = (await api('/tables/' + submissions.id)).columns[0].id;
  await api(`/tables/${content.id}/rows`, { cells: { [title]: '春日设计分享会' } });
  const key = await api('/user/api-keys', { name: 'Registration page', permissions: [
    { tableId: content.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false },
    { tableId: submissions.id, canRead: false, canCreate: true, canUpdate: false, canDelete: false },
  ] });
  const agent = (await api('/members/agents', { name: '页面助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local', skillNames: ['site'] } })).member; fixture.users.push(agent.userId);
  nativeFiles = [
    { path: 'index.html', content: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>活动报名</title><link rel="stylesheet" href="./styles.css"></head><body><main><h1>活动报名</h1><p id="event">正在加载活动…</p><form id="registration"><label>姓名<input id="name" name="name" aria-label="姓名"></label><button type="submit">提交报名</button></form><p id="result" role="status"></p></main><script type="module" src="./app.js"></script></body></html>' },
    { path: 'styles.css', content: 'body{margin:0;padding:32px;font:16px/1.6 system-ui;background:#fff;color:#37352f}main{max-width:600px;margin:auto}label{display:block}input,button{padding:12px;margin-top:16px;border-radius:6px;border:1px solid #d0d0d0}button{display:block;background:#1769b7;color:#fff}' },
    { path: 'app.js', content: `import { createClient } from './tabdo.js'; import { config } from './tabdo-config.js';\nconst client = createClient(config);\nconst rows = await client.table('${content.id}').list();document.querySelector('#event').textContent = rows.rows[0].cells['${title}'];\ndocument.querySelector('form').addEventListener('submit',async event=>{event.preventDefault(); const button=document.querySelector('button');button.disabled=true;try {await client.table('${submissions.id}').create({'${name}':document.querySelector('input').value}); document.querySelector('#result').textContent='报名已收到';}catch(error){document.querySelector('#result').textContent=error.message;}finally{button.disabled=false;}});` },
    { path: 'tabdo-config.js', content: `export const config = ${JSON.stringify({ url: base, key: key.secret })};` },
  ];
  await page.goto(frontend + '/app/sites');
  await page.getByText('创建你的第一个站点', { exact: true }).waitFor();
  await page.goto(frontend + '/app');
  const composer = page.getByRole('textbox', { name: '消息输入框' }); await composer.waitFor();
  await composer.fill('使用 site 技能创建活动报名网站并打开预览。'); await composer.press('Enter');
  await page.getByText('报名网站已生成，可以在右侧预览。', { exact: true }).waitFor({ timeout: 30000 });
  assert(readSkill); assert.equal(calls, 4);
  const workspacePreview = page.getByTestId('workspace-preview-slot');
  await workspacePreview.getByRole('link', { name: '编辑站点', exact: true }).waitFor();
  await workspacePreview.frameLocator('iframe').getByRole('heading', { name: '活动报名', exact: true }).waitFor();
  await workspacePreview.getByRole('link', { name: '编辑站点', exact: true }).click();
  await page.waitForURL(`**/app/sites/${nativeId}`); const editor = page.getByTestId('site-editor');
  await editor.getByRole('button', { name: '发布', exact: true }).waitFor();
  const frame = editor.frameLocator('iframe'); await frame.getByText('春日设计分享会', { exact: true }).waitFor();
  await editor.getByRole('button', { name: '连接数据', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'API Key', exact: true }).fill(key.secret);
  await page.getByRole('dialog').getByRole('button', { name: '写入页面配置', exact: true }).click();
  await editor.getByRole('button', { name: 'index.html', exact: true }).click();
  const source = editor.locator('.cm-content[aria-label="编辑 index.html"]'); await source.fill(nativeFiles[0].content.replace('<h1>活动报名</h1>', '<h1>春日活动报名</h1>'));
  await frame.getByRole('heading', { name: '春日活动报名', exact: true }).waitFor();
  assert.equal((await api('/sites/' + nativeId)).version, 1, 'live preview does not save a version');
  await page.reload(); await editor.getByRole('button', { name: '保存版本', exact: true }).waitFor();
  await editor.frameLocator('iframe').getByRole('heading', { name: '春日活动报名', exact: true }).waitFor();
  await editor.getByRole('button', { name: '保存版本', exact: true }).click();
  await page.getByText('已保存 · 版本 2', { exact: true }).waitFor();
  await editor.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  visitor = await ctx.newPage(); visitor.on('pageerror', error => errors.push(error.message));
  const site = await api('/sites/' + nativeId); await visitor.goto(site.publicUrl);
  await visitor.getByRole('heading', { name: '春日活动报名', exact: true }).waitFor();
  await visitor.getByText('春日设计分享会', { exact: true }).waitFor();
  const isolation = await visitor.evaluate(() => {
    let cookie = false, storage = false;
    try { document.cookie; cookie = true; } catch {}
    try { localStorage.getItem('table-theme'); storage = true; } catch {}
    return { origin: window.origin, cookie, storage };
  });
  assert.deepEqual(isolation, { origin: 'null', cookie: false, storage: false });
  await visitor.getByRole('textbox', { name: '姓名', exact: true }).fill('Site workflow attendee');
  await visitor.getByRole('button', { name: '提交报名', exact: true }).click();
  await visitor.getByText('报名已收到', { exact: true }).waitFor();
  const rows = await api(`/tables/${submissions.id}/rows/query`, {});
  assert(rows.rows.some(row => row.cells[name] === 'Site workflow attendee'));
  const denied = await ctx.request.post(base + '/api/graphql', { headers: { Authorization: `Bearer ${key.secret}` }, data: { query: `query { table(id:"${submissions.id}") { rows { rows { id } } } }` } }); assert((await denied.json()).errors?.length);
  await editor.getByRole('tab', { name: '版本', exact: true }).click();
  await editor.getByRole('button', { name: /^版本 1/ }).click();
  await editor.frameLocator('iframe').getByRole('heading', { name: '活动报名', exact: true }).waitFor();
  await editor.getByRole('button', { name: '恢复为新版本', exact: true }).click();
  await page.getByText('已保存 · 版本 3', { exact: true }).waitFor();
  await visitor.reload(); await visitor.getByRole('heading', { name: '春日活动报名', exact: true }).waitFor();
  await editor.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '撤下站点', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await ctx.request.get(site.publicUrl)).status(), 404);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light']]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await pause(180);
    if (width === 390) { await editor.getByRole('tab', { name: '预览', exact: true }).click(); await editor.frameLocator('iframe').getByRole('heading', { name: '活动报名', exact: true }).waitFor(); }
    await editor.frameLocator("iframe").getByRole("heading", { name: "活动报名", exact: true }).waitFor();
    await editor.frameLocator("iframe").getByText("春日设计分享会", { exact: true }).waitFor();
    assert.equal(await editor.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'editor fits viewport');
    assert.equal(await page.locator('select:not([aria-hidden="true"]),input[type=date],input[type=time]').count(), 0);
    await page.screenshot({ path: artifact(`sites-${width}-${theme}.png`), animations: 'disabled' });
  }
  await page.goto(frontend + '/app/sites');
  await page.getByRole('link', { name: '编辑 活动报名网站', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除 活动报名网站', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByText('创建你的第一个站点', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS native Site skill read + real save/preview tools, editor live preview/recovery/save, published SDK module imports, opaque-origin isolation, actual registration, version restore, unpublish, desktop/dark/mobile and deletion');
} catch(error) { console.error('Site browser diagnostics:', errors, page.url(), (await page.locator('body').innerText().catch(()=>'' )).slice(0,1200)); throw error; } finally { await visitor?.close(); await db.end(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
