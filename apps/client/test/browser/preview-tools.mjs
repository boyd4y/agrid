import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
let reportId, siteId, turn = 0, calls = 0;
const f = await createBrowserFixture({ name: '原生工具打开三类预览', modelRequest: async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw); calls++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'preview-tool', object: 'chat.completion.chunk', created: 1, model: 'fixture/model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  if (calls % 2 === 1) {
    const declaration = input.tools.find(tool => tool.function.name === 'open_preview');
    assert(declaration.function.parameters.properties.reportId, 'native catalog carries the shared report contract');
    const args = turn === 0 ? { kind: 'report', reportId } : { kind: 'site', siteId };
    send({ tool_calls: [{ index: 0, id: `preview_${calls}`, type: 'function', function: { name: 'open_preview', arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls');
  } else { send({ content: turn === 0 ? '报告已在右侧打开。' : '站点已在右侧打开。' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
} });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
try {
  const report = await api('/reports', { name: '工具报告', description: '', columns: 1, widgets: [{ id: crypto.randomUUID(), type: 'text', title: '工具报告正文', content: '通过真实原生工具打开', width: 'full' }] }); reportId = report.id;
  const site = await api('/sites', { name: '工具HTML', files: [{ path: 'index.html', content: '<!doctype html><h1>工具站点正文</h1>' }] }); siteId = site.id;
  const agent = (await api('/members/agents', { name: '预览助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; f.users.push(agent.userId);
  await page.goto(frontend + '/app');
  const composer = page.getByRole('textbox', { name: '消息输入框', exact: true });
  await composer.fill('打开现有报告预览'); await composer.press('Enter');
  await page.getByText('报告已在右侧打开。', { exact: true }).waitFor({ timeout: 30000 });
  const slot = page.getByTestId('workspace-preview-slot'), header = slot.getByTestId('preview-slot-header');
  await header.getByRole('tab', { name: '报告', exact: true }).waitFor();
  await slot.getByText('通过真实原生工具打开', { exact: true }).waitFor();
  assert.equal(await header.getByTestId('preview-resource-picker').getAttribute('title'), '工具报告');
  turn = 1;
  await composer.fill('打开现有HTML站点'); await composer.press('Enter');
  await page.getByText('站点已在右侧打开。', { exact: true }).waitFor({ timeout: 30000 });
  await slot.locator('[data-preview-resource-id]:not([hidden])').frameLocator('iframe').getByRole('heading', { name: '工具站点正文' }).waitFor();
  assert.equal(await header.getByRole('tab', { name: '报告', exact: true }).count(), 1);
  assert.equal(await header.getByRole('tab', { name: '站点', exact: true }).count(), 1);
  assert.equal(calls, 4); assert.deepEqual(f.errors, []);
  console.log('PASS official native Harness tool -> persisted output/event -> real report/HTML preview, shared reportId contract, unique type tabs.');
} finally { await f.close(); }
