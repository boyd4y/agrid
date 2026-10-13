import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
let requests = [];
const question = { allowPartialAnswers:false, questions:[
  {id:'direction',question:'选择记录操作',options:[{id:'a',label:'新增记录'},{id:'b',label:'修改记录'}],allowFreeForm:false},
  {id:'attributes',question:'选择包含字段',options:[{id:'title',label:'标题'},{id:'number',label:'数字'}],allowMultiple:true,allowFreeForm:false},
  {id:'note',question:'补充要求',allowFreeForm:true},
] };
const fixture = await createBrowserFixture({name:'Native question browser',modelRequest:async(req,res)=>{
  let raw=''; for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'native-questions',object:'chat.completion.chunk',created:1,model:'openrouter/free',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  if(requests.length===1){send({role:'assistant',tool_calls:[{index:0,id:'browser-question',type:'function',function:{name:'askUserQuestions',arguments:JSON.stringify(question)}}]});send({},'tool_calls');}
  else{send({role:'assistant',content:'已收到结构化回答并继续原生会话。'});send({},'stop');}
  res.end('data: [DONE]\n\n');
} });
const {page,api,base,frontend,users,errors}=fixture;
try{
  const agent=(await api('/members/agents',{name:'提问助手',persona:{defaultHarness:'pi',defaultModel:'openrouter/free',runtime:'local'}})).member;users.push(agent.userId);
  await page.addInitScript((base)=>{const original=window.fetch;window.fetch=(input,init)=>typeof input==='string'&&input==='/api/chat'?original(base+input,{...init,credentials:'include'}):original(input,init);},base);
  await page.route('**/api/chat',route=>route.continue());
  const thread=await api('/threads',{clientId:crypto.randomUUID(),agentId:agent.id,context:{page:'ai'}});
  await page.goto(frontend+'/app');
  await page.evaluate(id=>localStorage.setItem('agrid.chat.lastThreadByResource',JSON.stringify({workspace:id})),thread.id);
  await Promise.all([page.waitForResponse(response => response.url().includes(`/threads/${thread.id}/messages`) && response.status() === 200),page.reload()]);
  await page.getByText("提问助手",{exact:true}).waitFor();
  const composer=page.getByRole('textbox',{name:'消息输入框'});await composer.fill('请问我如何操作');await composer.press('Enter');
  const card=page.getByTestId('ask-user-questions');await card.waitFor();
  await page.getByRole('button',{name:'提交回答',exact:true}).waitFor();
  for(let i=0;i<100;i++){if((await api(`/threads/${thread.id}/runs`)).runs[0]?.status==='suspended')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api(`/threads/${thread.id}/runs`)).runs[0].status,'suspended');
  assert.equal(await page.getByTestId('agent-run-resume').count(),0,'question has no generic resume button');
  assert.equal(await page.getByRole('button',{name:'Add Attachment',exact:true}).count(),0,'unsupported attachment button stays hidden');
  await page.reload();await card.waitFor();
  const submit=page.getByRole('button',{name:'提交回答',exact:true});assert(await submit.isDisabled());
  await card.getByRole('radio',{name:'修改记录'}).check();
  await card.getByRole('checkbox',{name:'标题'}).check();await card.getByRole('checkbox',{name:'数字'}).check();
  await card.getByRole('textbox',{name:'补充说明'}).fill('请保留现有字段');
  assert(await submit.isEnabled());
  // A rejected HTTP submission preserves the tool output and can be retried by
  // the user; it neither repeats the original prompt nor invents a new Run.
  await page.evaluate(() => {
    const original = window.fetch; let failOnce = true;
    window.fetch = (input, init) => {
      if (failOnce && typeof init?.body === 'string' && JSON.parse(init.body).intent === 'tool-result') {
        failOnce = false;
        return Promise.resolve(new Response('Fixture temporary answer delivery failure', { status:503 }));
      }
      return original(input, init);
    };
  });
  await submit.click();
  const retry=page.getByRole('button',{name:'重试发送',exact:true});await retry.waitFor({timeout:15000});await retry.click();
  await page.getByText('已收到结构化回答并继续原生会话。',{exact:true}).waitFor({timeout:15000});
  assert.equal(requests.length,2,'one question and one answer continuation');
  const tool=requests[1].messages.find(message=>message.role==='tool'&&message.tool_call_id==='browser-question');assert(tool);
  assert.deepEqual(JSON.parse(tool.content),{action:'answered',answers:{direction:{optionIds:['b']},attributes:{optionIds:['title','number']},note:{optionIds:[],freeform:'请保留现有字段'}}});
  assert.equal(requests[1].messages.filter(message=>message.role==='user').length,1,'fresh user prompt not replayed');
  const history=await api(`/threads/${thread.id}/messages`);assert.equal(history.messages.length,2);
  await page.reload();await page.getByText('已收到结构化回答并继续原生会话。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'提交回答',exact:true}).count(),0,'answered history is read-only');
  assert.deepEqual(errors,[]);console.log('PASS native question UI: reload pending, single/multi/freeform, SDK tool result continuation once, stable history and no unsupported upload or fake resume');
}catch(error){console.error((await page.locator('body').innerText()).slice(-5500));throw error;}finally{await fixture.close();}
