import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
let requests = [];
const question = { allowPartialAnswers:false, questions:[
  {id:'direction',question:'选择记录操作',options:[{id:'a',label:'新增记录',description:'新建独立记录，专门记录客户跟进情况'},{id:'b',label:'修改记录',description:'保留现有客户资料，补充跟进字段和最近沟通摘要'}],allowFreeForm:false},
  {id:'attributes',question:'选择包含字段',options:[{id:'title',label:'标题'},{id:'number',label:'数字'}],allowMultiple:true,allowFreeForm:false},
  {id:'note',question:'补充要求',allowFreeForm:true},
] };
let questionInput = question;
const fixture = await createBrowserFixture({name:'Native question browser',modelRequest:async(req,res)=>{
  let raw=''; for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'native-questions',object:'chat.completion.chunk',created:1,model:'fixture/model',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  if(!requests.at(-1).messages.some(message=>message.role==='tool'&&message.tool_call_id==='browser-question')){send({role:'assistant',tool_calls:[{index:0,id:'browser-question',type:'function',function:{name:'askUserQuestions',arguments:JSON.stringify(questionInput)}}]});send({},'tool_calls');}
  else{send({role:'assistant',content:'已收到结构化回答并继续原生会话。'});send({},'stop');}
  res.end('data: [DONE]\n\n');
} });
const {page,api,base,frontend,users,errors}=fixture;
try{
  const agent=(await api('/members/agents',{name:'提问助手',persona:{defaultHarness:'pi',defaultModel:'fixture/model',runtime:'local'}})).member;users.push(agent.userId);
  await page.addInitScript((base)=>{const original=window.fetch;window.fetch=(input,init)=>typeof input==='string'&&input==='/api/chat'?original(base+input,{...init,credentials:'include'}):original(input,init);},base);
  await page.route('**/api/chat',route=>route.continue());
  const thread=await api('/threads',{clientId:crypto.randomUUID(),agentId:agent.id,context:{page:'ai'}});
  await page.goto(frontend+'/app');
  await page.evaluate(id=>localStorage.setItem('tabdo.chat.lastThreadByResource',JSON.stringify({workspace:id})),thread.id);
  await Promise.all([page.waitForResponse(response => response.url().includes(`/threads/${thread.id}/messages`) && response.status() === 200),page.reload()]);
  await page.getByText("提问助手",{exact:true}).waitFor();
  const composer=page.getByRole('textbox',{name:'消息输入框'});await composer.fill('请问我如何操作');await composer.press('Enter');
  const card=page.getByTestId('ask-user-questions');await card.waitFor();
  await card.getByRole('button',{name:'下一题',exact:true}).waitFor();
  assert.equal(await card.locator('fieldset').count(),1,'only one question is displayed');
  assert.equal(await card.getByText('选择包含字段',{exact:true}).count(),0,'later questions are not displayed');
  assert.equal(await card.getByRole('button',{name:'提交回答',exact:true}).count(),0,'submit is shown only at the final step');
  for(let i=0;i<100;i++){if((await api(`/threads/${thread.id}/runs`)).runs[0]?.status==='suspended')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api(`/threads/${thread.id}/runs`)).runs[0].status,'suspended');
  assert.equal(await page.getByTestId('agent-run-resume').count(),0,'question has no generic resume button');
  assert.equal(await page.getByRole('button',{name:'Add Attachment',exact:true}).count(),0,'unsupported attachment button stays hidden');
  // A malformed historical tool input must not crash the chat or add a product
  // error message. Restoring the valid history still permits the native answer.
  const historyRoute = `**/api/threads/${thread.id}/messages`;
  await page.route(historyRoute, async route => {
    const response = await route.fetch({ url:base+new URL(route.request().url()).pathname });
    const history = await response.json();
    for (const message of history.messages) for (const part of message.content.parts ?? []) {
      if (part.type === 'tool-askUserQuestions' || part.type === 'dynamic-tool' && part.toolName === 'askUserQuestions') {
        part.input.questions[0].options = { a:'新增记录', b:'修改记录' };
      }
    }
    await route.fulfill({ response, json:history });
  });
  await page.reload();await page.getByText('提问助手',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'消息输入框'}).waitFor();
  assert.equal(await card.count(),0,'malformed question is hidden');
  assert.equal(await page.getByText('提问格式异常，请让智能体重新提问。',{exact:true}).count(),0);
  assert.deepEqual(errors,[],'malformed choices do not crash rendering');
  await page.unroute(historyRoute);
  await page.reload();await card.waitFor();
  const next=card.getByRole('button',{name:'下一题',exact:true});assert(await next.isDisabled());
  assert(await card.getByRole('button',{name:'上一题',exact:true}).isDisabled());
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const [theme,width,height] of [['light',1600,1000],['dark',1600,1000],['light',390,844],['dark',390,844]]){
    await page.setViewportSize({width,height});
    await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');},theme);
    await card.screenshot({path:fixture.artifact(`question-${theme}-${width}.png`)});
    assert.equal(await card.evaluate(node=>node.scrollWidth>node.clientWidth+1),false,'question card does not overflow');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page does not overflow');
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  await card.getByRole('radio',{name:'修改记录'}).click();
  await card.getByText('第 2 / 3 题',{exact:true}).waitFor();
  assert.equal(await card.getByRole('radio').count(),0,'single choice automatically advances');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'选择包含字段','step change focuses the question');
  assert(await next.isDisabled());
  await card.getByRole('button',{name:'上一题',exact:true}).click();
  assert(await card.getByRole('radio',{name:'修改记录'}).isChecked(),'previous answer is retained');
  await next.click();
  await card.getByRole('checkbox',{name:'标题'}).check();await card.getByRole('checkbox',{name:'数字'}).check();
  assert.equal(await card.getByText('第 2 / 3 题',{exact:true}).count(),1,'multi-select waits for explicit next');
  await next.click();
  const submit=card.getByRole('button',{name:'提交回答',exact:true});assert(await submit.isDisabled());
  await card.getByRole('textbox',{name:'补充说明'}).fill('   ');assert(await submit.isDisabled(),'whitespace is not an answer');
  await card.getByRole('textbox',{name:'补充说明'}).fill('请保留现有字段');
  await card.getByRole('button',{name:'上一题',exact:true}).click();
  assert(await card.getByRole('checkbox',{name:'标题'}).isChecked());
  assert(await card.getByRole('checkbox',{name:'数字'}).isChecked());
  await card.getByRole('checkbox',{name:'数字'}).uncheck();
  await next.click();
  assert.equal(await card.getByRole('textbox',{name:'补充说明'}).inputValue(),'请保留现有字段','freeform draft survives backward navigation');
  assert(await submit.isEnabled());
  assert.equal(requests.length,1,'step navigation does not resume the harness');
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
  assert.deepEqual(JSON.parse(tool.content),{action:'answered',answers:{direction:{optionIds:['b']},attributes:{optionIds:['title']},note:{optionIds:[],freeform:'请保留现有字段'}}});
  assert.equal(requests[1].messages.filter(message=>message.role==='user').length,1,'fresh user prompt not replayed');
  const history=await api(`/threads/${thread.id}/messages`);assert.equal(history.messages.length,2);
  await page.reload();await page.getByText('已收到结构化回答并继续原生会话。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'提交回答',exact:true}).count(),0,'answered history is read-only');
  assert.equal(await card.getByRole('radio').count(),0,'history shows a compact answer summary');
  assert.equal(await card.getByText('新增记录',{exact:true}).count(),0,'unselected options are omitted from history');
  assert.equal(await card.getByText('修改记录',{exact:true}).count(),1);
  await card.screenshot({path:fixture.artifact('question-answered.png')});

  const openQuestion = async input => {
    questionInput = input;
    const pending = await api('/threads',{clientId:crypto.randomUUID(),agentId:agent.id,context:{page:'ai'}});
    await page.evaluate(id=>localStorage.setItem('tabdo.chat.lastThreadByResource',JSON.stringify({workspace:id})),pending.id);
    await Promise.all([page.waitForResponse(response=>response.url().includes(`/threads/${pending.id}/messages`)&&response.status()===200),page.reload()]);
    await composer.fill('请问我如何操作');await composer.press('Enter');await card.waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-testid="ask-user-questions"] fieldset')?.disabled===false);
  };
  const waitForAnswer = async () => {
    await page.getByText('已收到结构化回答并继续原生会话。',{exact:true}).waitFor({timeout:15000});
    return JSON.parse(requests.at(-1).messages.find(message=>message.role==='tool'&&message.tool_call_id==='browser-question').content);
  };
  await openQuestion({...question,allowPartialAnswers:true});
  await card.getByRole('button',{name:'跳过此题',exact:true}).click();
  await card.getByRole('checkbox',{name:'标题'}).check();await next.click();
  await submit.click();
  assert.deepEqual(await waitForAnswer(),{action:'partially-answered',answers:{attributes:{optionIds:['title']}}},'optional questions can be skipped without empty answers');

  await openQuestion({allowPartialAnswers:false,questions:[{id:'secret',question:'提供访问密钥',allowFreeForm:{secret:true}}]});
  assert.equal(await card.getByRole('button',{name:'上一题',exact:true}).count(),0,'single question has no step navigation');
  assert.equal(await card.getByRole('status').count(),0,'single question has no step counter');
  await card.locator('input[type=password]').fill('fixture-secret');
  await submit.click();
  assert.deepEqual(await waitForAnswer(),{action:'answered',answers:{secret:{optionIds:[],freeform:'fixture-secret'}}});
  assert.equal(await card.getByText('fixture-secret',{exact:true}).count(),0,'secret stays masked in the summary');
  await page.reload();await card.getByText('••••••',{exact:true}).waitFor();

  await openQuestion({allowPartialAnswers:false,questions:[question.questions[0]]});
  await card.getByRole('radio',{name:'新增记录'}).focus();await page.keyboard.press('Space');
  assert(await submit.isEnabled(),'keyboard choice answers a single question');
  assert.equal(await card.getByRole('radio').count(),2,'last choice does not submit automatically');
  await submit.click();
  assert.deepEqual(await waitForAnswer(),{action:'answered',answers:{direction:{optionIds:['a']}}});

  await openQuestion(question);
  await card.getByRole('button',{name:'暂不回答',exact:true}).click();
  assert.deepEqual(await waitForAnswer(),{action:'declined'});
  assert.deepEqual(errors,[]);console.log('PASS native question UI: one step at a time, single-choice auto-advance, back/edit, multi/freeform/secret, partial/decline, reload, retry and one unchanged SDK continuation per submission');
}catch(error){console.error((await page.locator('body').innerText()).slice(-5500));throw error;}finally{await fixture.close();}
