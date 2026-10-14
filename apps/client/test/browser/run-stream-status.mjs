import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
let release, modelStarted = false;
const fixture = await createBrowserFixture({ name: 'Live run status without polling', modelRequest: async (request,response) => {
  for await (const _ of request) { /* drain */ }
  modelStarted = true;
  response.writeHead(200,{'content-type':'text/event-stream'});response.flushHeaders();
  await new Promise(resolve => { release=resolve;response.once('close',resolve); });
  if (response.destroyed) return;
  const event = (delta,finish_reason=null) => response.write(`data: ${JSON.stringify({id:'live-status',object:'chat.completion.chunk',created:1,model:'openrouter/free',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  event({role:'assistant',content:'Live stream completed without polling.'});event({},'stop');response.end('data: [DONE]\n\n');
} });
const {page,api,base,users,frontend,errors}=fixture;
let reads=0;
page.on('request',request=>{if(/\/api\/threads\/[^/]+\/runs(?:\?|$)/.test(request.url())) reads++;});
try {
  const agent=(await api('/members/agents',{name:'Live status',persona:{defaultHarness:'pi',defaultModel:'openrouter/free',runtime:'local'}})).member;
  users.push(agent.userId);
  await page.addInitScript(base=>{const original=window.fetch;window.fetch=(input,init)=>typeof input==='string' && input==='/api/chat'?original(base+input,{...init,credentials:'include'}):original(input,init);},base);
  await page.route('**/api/chat',route=>route.continue());
  const thread=await api('/threads',{clientId:crypto.randomUUID(),agentId:agent.id,context:{page:'ai'}});
  await page.goto(frontend+'/app');
  await page.evaluate(id=>localStorage.setItem('agrid.chat.lastThreadByResource',JSON.stringify({workspace:id})),thread.id);
  await Promise.all([page.waitForResponse(response=>response.url().includes(`/threads/${thread.id}/messages`) && response.status()===200),page.reload()]);
  const input=page.getByRole('textbox',{name:'消息输入框'});await input.waitFor();
  await input.fill('Verify a live stream');await input.press('Enter');
  await page.getByTestId('chat-run-status').waitFor();
  for(let i=0;i<100&&!modelStarted;i++) await new Promise(resolve=>setTimeout(resolve,50));
  assert(modelStarted);await page.waitForTimeout(100);reads=0;
  await page.waitForTimeout(2500);assert.equal(reads,0,'healthy live SSE must not poll /runs');
  release();await page.getByText('Live stream completed without polling.',{exact:true}).waitFor();
  await page.getByTestId('chat-run-status').waitFor({state:'detached'});
  await page.waitForTimeout(300);reads=0;
  await page.waitForTimeout(8500);assert.equal(reads,0,'completed/idle chat must not schedule periodic /runs reads');
  assert.deepEqual(errors,[]);
  console.log('PASS live SSE and idle chat have no recurring Run HTTP polling');
} finally {release?.();await fixture.close();}
