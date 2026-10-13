import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, STAGES } from '../server/models.mjs';
import { createQwenTransport, QWEN_BASE } from '../server/qwen.mjs';
const key='sk-qwen-fixture-only-1234567890';
const routes=Object.fromEntries(STAGES.map(s=>[s.id,s.id==='classification'?'qwen-flash':'qwen-plus']));
function vault(){let value='';return{status:()=>({supported:true,configured:!!value,suffix:value.slice(-4),problem:''}),save:async next=>{value=next;},getKey:async()=>value,remove:()=>{value='';}};}
async function fixture(t,fetcher){const store=createStore(':memory:'),modelStore=createModelStore(),qwenVault=vault(),openaiVault=vault();const app=createApp(store,{qwenVault,vault:openaiVault,modelStore,fetcher});const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await app.locals.integrations.close();server.close();server.closeAllConnections();store.close();});const req=async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};};return{req,store,modelStore,qwenVault,openaiVault,p:store.get().projects[0]};}
const completion=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value),reasoning_content:'private reasoning'}}],usage:{prompt_tokens:100,completion_tokens:200}});
test('Qwen credentials remain separate, check uses official model list without generation or key disclosure',async t=>{
  let calls=0;const f=await fixture(t,async(url,init)=>{calls++;assert.equal(url,QWEN_BASE+'/models');assert.equal(init.headers.Authorization,'Bearer '+key);assert.equal(init.redirect,'error');assert.equal(init.method,'GET');return Response.json({data:[{id:'qwen-plus'},{id:'qwen-flash'}]});});
  const path='/settings/providers/qwen/credential';await f.openaiVault.save('sk-openai-not-to-be-used-1111111');
  assert.equal((await f.req(path,'PUT',{apiKey:key,baseUrl:'https://untrusted.example'})).status,400);
  assert.equal((await f.req(path,'PUT',{apiKey:key})).status,200);assert.equal(calls,0);
  const checked=await f.req(path+'/check','POST');assert.equal(checked.status,200);assert(checked.data.providers.qwen.verification.models.every(m=>m.available));assert.equal(calls,1);
  for(const p of ['/settings','/state','/backup'])assert(!JSON.stringify((await f.req(p)).data).includes(key));
  await f.req(path,'DELETE');const settings=(await f.req('/settings')).data;assert.equal(settings.providers.qwen.configured,false);assert.equal(settings.openaiConfigured,true);
});
test('Qwen drives all five stages with corpus, structured output, screening and protected manual classifications',async t=>{
  const calls=[];const f=await fixture(t,async(url,init)=>{
    assert.equal(url,QWEN_BASE+'/chat/completions');assert.equal(init.headers.Authorization,'Bearer '+key);
    const body=JSON.parse(init.body),input=JSON.parse(body.messages[1].content);calls.push(body);
    assert.equal(body.enable_thinking,false);assert.equal(body.stream,false);assert.equal(body.response_format.type,'json_object');assert.match(body.messages[0].content,/json/i);assert(!body.tools);
    if(input.task)return completion({title:'测试需替换词',body:'真实介绍',prompt:'画面说明',scenes:['开场','演示','结尾']});
    if(input.comments&&!input.brief)return completion({comments:input.comments.map(c=>({id:c.id,tags:['使用疑问'],sentiment:'neutral',reason:'提出疑问',evidence:c.text,needsReview:false}))});
    if(input.comments)return completion({insights:[{category:'使用疑问',title:'补充说明',observation:'用户提出疑问',recommendation:'补充使用说明',evidenceIds:[input.comments[0].id]}]});
    assert(input.corpusReferences.some(r=>r.text.includes('校园学习伙伴')));return completion({title:'测试需替换词',core:'真实事实',direction:'校园场景',prompt:'遵守资料内容'});
  });
  await f.qwenVault.save(key);f.modelStore.save(routes);
  await f.req('/content-rules','PUT',{expectedRevision:0,rules:[{id:'qwen-rule',term:'测试需替换词',replacement:'克制表达',enabled:true}]});
  await f.req(`/projects/${f.p.id}/corpus`,'POST',{name:'事实介绍',text:'校园学习伙伴是我们的产品定位。'});
  for(const stage of ['strategy','planning']){const result=await f.req(`/projects/${f.p.id}/strategies`,'POST',{mode:'openai',stage,query:'校园学习伙伴'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.result.source,'qwen');assert.equal(result.data.result.title,'克制表达');}
  const strategy=f.store.get().projects[0].strategies.at(-1);await f.req(`/projects/${f.p.id}/strategies/${strategy.id}/confirm`,'POST');
  const asset=f.store.get().projects[0].assets[0];const copied=await f.req(`/projects/${f.p.id}/assets/${asset.id}/copy`,'POST',{expectedRevision:asset.revision});assert.equal(copied.status,200);assert.equal(copied.data.result.title,'克制表达');
  await f.req(`/projects/${f.p.id}/comments/sample`,'POST');
  f.store.mutate(s=>{s.projects[0].comments[0].correctedAt='human';s.projects[0].comments[0].tags=['价格敏感'];});
  assert.equal((await f.req(`/projects/${f.p.id}/comments/classify`,'POST')).status,200);
  assert.equal((await f.req(`/projects/${f.p.id}/analysis`,'POST',{mode:'openai'})).status,200);
  assert.deepEqual(calls.map(c=>c.model),['qwen-plus','qwen-plus','qwen-plus','qwen-flash','qwen-plus']);
  const state=f.store.get();assert(!JSON.stringify(state).includes('private reasoning'));assert.deepEqual(state.projects[0].comments[0].tags,['价格敏感']);assert(state.projects[0].usage.every(u=>u.amountUsd>0));
});
test('Qwen missing key never falls back; quota failures and truncated output preserve current content',async t=>{
  let code=401,calls=0;const f=await fixture(t,async()=>{calls++;return code===200?Response.json({choices:[{finish_reason:'length',message:{content:'{broken'}}],usage:{prompt_tokens:3,completion_tokens:20}}):Response.json({error:{message:key}},{status:code});});f.modelStore.save(routes);await f.openaiVault.save('sk-openai-only-key-1234567890');
  const path=`/projects/${f.p.id}/strategies`;assert.equal((await f.req(path,'POST',{mode:'openai'})).status,400);assert.equal(calls,0);await f.qwenVault.save(key);
  const original=f.store.get().projects[0].strategies.length;
  const response=await f.req(path,'POST',{mode:'openai'});assert.equal(response.status,502);assert(!JSON.stringify(response).includes(key));assert.equal(f.store.get().projects[0].usage.at(-1).amountUsd,0);
  code=200;assert.equal((await f.req(path,'POST',{mode:'openai'})).status,502);assert.equal(f.store.get().projects[0].strategies.length,original);assert.equal(f.store.get().projects[0].usage.at(-1).status,'uncertain');
});
test('Qwen cooldown blocks repeated paid calls and never exposes provider error bodies',async()=>{
  let calls=0;const transport=createQwenTransport(async()=>{calls++;return Response.json({error:key},{status:429,headers:{'retry-after':'60'}});});
  const invoke=()=>transport.fetch(QWEN_BASE+'/chat/completions',{body:JSON.stringify({model:'qwen-plus'})});
  await assert.rejects(invoke(),e=>e.diagnostic.provider==='qwen'&&!e.message.includes(key));await assert.rejects(invoke(),e=>e.status===429&&e.noCharge);assert.equal(calls,1);assert(!JSON.stringify(transport.diagnostic()).includes(key));
});
