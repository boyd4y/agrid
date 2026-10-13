import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
process.env.AI_RUN_POLL_MS = '50';
process.env.AI_CHAT_MAX_STEPS = '2';
for (const key of ['AI_CHAT_TOTAL_MS', 'AI_CHAT_STEP_MS', 'AI_CHAT_FIRST_CHUNK_MS', 'AI_CHAT_CHUNK_MS']) process.env[key] = '60000';
let mode = 'recovery', requests = 0, release, continueMode = false;
const names = { recovery: `Run-refresh-${crypto.randomUUID()}`, stop: `Run-stop-${crypto.randomUUID()}`, suspend: `Run-continue-${crypto.randomUUID()}`, early: `Run-early-${crypto.randomUUID()}`, failure: `Run-failed-${crypto.randomUUID()}` };
const fixture = await createBrowserFixture({ name: 'Run recovery browser', modelRequest: async (req, res) => {
  for await (const _ of req) { /* drain */ }
  requests++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'native-run-browser', object: 'chat.completion.chunk', created: 1, model: 'openrouter/free', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  if (requests === 1 || (mode === 'suspend' && requests === 2)) {
    const name = requests === 1 ? 'create_table' : 'list_tables';
    send({ role: 'assistant', tool_calls: [{ index: 0, id: `${mode}-${requests}`, type: 'function', function: { name, arguments: requests === 1 ? JSON.stringify({ name: names[mode] }) : '{}' } }] }); send({}, 'tool_calls');
  } else if (mode === 'suspend' && !continueMode) { send({ role: 'assistant', content: '等待暂停边界' }); res.flushHeaders(); return; }
  else if (mode === 'failure') { send({ role: 'assistant', reasoning: '只有思考，缺少正文' }); send({}, 'stop'); }
  else if (!continueMode) {
    res.flushHeaders();
    await new Promise((resolve) => { release = resolve; res.on('close', resolve); });
    if (res.destroyed) return;
    send({ role: 'assistant', content: '刷新后仍看到真实执行结果。' }); send({}, 'stop');
  } else { send({ role: 'assistant', content: '原生继续完成，已执行工具没有重放。' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');

} });
const { page, api, base, users, errors, artifact, frontend: ui } = fixture;
try {
  const agent = (await api('/members/agents', { name: '原生运行助手', persona: { defaultHarness: 'pi', defaultModel: 'openrouter/free', runtime: 'local' } })).member;
  users.push(agent.userId);
  // Native browser fetch, streamed end to end. Reload really closes this HTTP socket.
  await page.addInitScript((base) => {
    const original = window.fetch;
    window.fetch = (input, init) => typeof input === 'string' && input === '/api/chat' ? original(base + input, { ...init, credentials: 'include' }) : original(input, init);
  }, base);
  await page.route('**/api/chat', (route) => route.continue());

  const newThread = async () => api('/threads', { clientId: crypto.randomUUID(), agentId: agent.id, context: { page: 'ai' } });
  const send = async (text) => { const input = page.getByRole('textbox', { name: '消息输入框' }); await input.fill(text); await input.press('Enter'); };
  const waitRun = async (thread, status) => {
    for (let i = 0; i < 150; i++) { const run = (await api(`/threads/${thread.id}/runs`)).runs[0]; if (run?.status === status && (status !== 'running' || run.activity?.completedTools > 0)) return run; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error(`Run never became ${status}`);
  };
  const go = async (thread) => { await page.goto(ui + '/app'); await page.evaluate((id) => localStorage.setItem('agrid.chat.lastThreadByResource', JSON.stringify({ workspace: id })), thread.id); await Promise.all([page.waitForResponse((res) => res.url().includes('/threads/' + thread.id + '/messages') && res.status() === 200), page.reload()]); await page.getByRole('textbox', { name: '消息输入框' }).waitFor(); };
  const first = await newThread(); await go(first); await send('执行刷新恢复'); await waitRun(first, 'running'); await page.getByTestId('chat-run-status').waitFor();
  await page.reload(); await page.getByTestId('recovered-run-status').waitFor(); assert(await page.getByRole('textbox', { name: '消息输入框' }).isDisabled());
  await page.reload(); await page.getByTestId('recovered-run-status').waitFor(); assert.equal(await page.getByTestId('agent-runs-toggle').count(), 0); await page.screenshot({ path: artifact('run-recovery-active.png') });
  release(); await page.getByText('刷新后仍看到真实执行结果。', { exact: true }).waitFor(); await page.getByTestId('recovered-run-status').waitFor({ state: 'detached' });
  assert.equal((await waitRun(first, 'completed')).canContinue, false); assert.equal((await api('/tables')).filter((t) => t.name === names.recovery).length, 1);
  await page.screenshot({ path: artifact('run-recovery-completed.png') });
  mode = 'stop'; requests = 0; const second = await newThread(); await go(second); await send('停止原生执行'); await waitRun(second, 'running');
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click(); await waitRun(second, 'cancelled');
  await page.getByTestId('recovered-run-status').waitFor({ state: 'detached' }); assert.equal((await api('/tables')).filter((t) => t.name === names.stop).length, 1);
  mode = 'suspend'; requests = 0; const third = await newThread(); await go(third); await send('执行两项工具并暂停'); const suspended = await waitRun(third, 'suspended'); assert(suspended.canContinue); const pausedRequests = requests;
  await page.getByTestId('agent-run-resume').waitFor(); await page.reload(); await page.getByTestId('agent-run-resume').waitFor(); continueMode = true;
  await page.getByTestId('agent-run-resume').click(); await page.getByText('原生继续完成，已执行工具没有重放。', { exact: true }).waitFor(); await waitRun(third, 'completed'); assert.equal(requests, pausedRequests + 1); assert.equal((await api('/tables')).filter((t) => t.name === names.suspend).length, 1);
  assert.equal(await page.getByTestId('agent-runs-toggle').count(), 0);
  await page.setViewportSize({ width: 1600, height: 1000 });
  mode = 'early'; requests = 0; continueMode = false;
  await page.route('**/api/chat', async (route) => { await new Promise((resolve) => setTimeout(resolve, 800)); await route.continue(); });
  const fourth = await newThread(); await go(fourth); await send('启动过程中立即停止');
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click(); const earlyRun = await waitRun(fourth, 'cancelled'); assert(earlyRun.endedAt);
  await page.getByTestId('recovered-run-status').waitFor({ state: 'detached' });
  await page.getByText('已停止执行。已完成的工具结果会保留。', { exact: false }).waitFor();
  assert((await api('/tables')).filter((t) => t.name === names.early).length <= 1);
  mode = 'failure'; requests = 0; const fifth = await newThread(); await go(fifth); await send('验证真实失败详情'); const failed = await waitRun(fifth, 'failed'); assert.equal(failed.canContinue, false);
  await page.getByText('模型未返回正文', { exact: false }).first().waitFor(); await page.screenshot({ path: artifact('run-failure-message.png') });
  assert.deepEqual(errors, []); console.log('PASS native Pi: actual streaming socket closes on refresh; server Run stays alive; durable running state blocks duplicate send; terminal message imports in place; no execution-history UI; failure message; composer stop and early claim race; checkpoint continuation after reload; no tool replay');

} catch (error) { console.error((await page.locator('body').innerText()).slice(-7000)); throw error; }
finally { await fixture.close(); }
