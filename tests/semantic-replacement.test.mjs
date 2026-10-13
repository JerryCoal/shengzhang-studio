import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createModelStore } from '../server/models.mjs';
import { semanticCandidates, semanticResult } from '../server/semantic-replacement.mjs';
import { screenCopy, saveRules } from '../server/workflow.mjs';
import { parseRules, serializeRules } from '../server/sensitive-checker.mjs';
const rules=[{id:'yuan',term:'元',action:'semantic',replacement:'圆',risk:'PRICE',enabled:true}];

test('semantic rules only mark candidates locally and preserve user mappings in files',()=>{
  const draft={title:'元气满满',body:'19.9元起，元宇宙体验'};
  assert.deepEqual(screenCopy(draft,rules).value,draft);
  assert.equal(screenCopy(draft,rules).review.remaining.length,3);
  for(const format of ['txt','csv']){const imported=parseRules(serializeRules(rules,format),format);assert.equal(imported[0].action,'semantic');assert.equal(imported[0].replacement,'圆');}
  for(const replacement of ['','99圆','圆1']) assert.throws(()=>saveRules({rulesRevision:0},{rules:[{...rules[0],replacement}],expectedRevision:0}));
  assert.throws(()=>saveRules({rulesRevision:0},{rules:[{...rules[0],replacement:'元元'}],expectedRevision:0}),/循环/);
});
test('per-occurrence decisions change only the selected literal span, with numeric and context preservation',()=>{
  const draft={title:'✨ 元气满满',body:'19.9元起，元宇宙展；会员优惠价 9.9元，是否按元计费待核实。'};
  const matches=semanticCandidates(draft,rules);
  const decisions=matches.map((m,i)=>({id:m.id,decision:['keep','replace','keep','replace','uncertain'][i],reason:'逐处判断'}));
  const result=semanticResult(draft,rules,decisions);
  assert.equal(result.candidate.title,draft.title);
  assert.equal(result.candidate.body,'19.9圆起，元宇宙展；会员优惠价 9.9圆，是否按元计费待核实。');
  assert.equal(result.review.remaining.length,1);
  assert.equal(result.review.remaining[0].original,'元');
  assert.equal(result.semanticReview.decisions[4].decision,'uncertain');
  for(const m of result.review.remaining)assert.equal(result.candidate[m.field].slice(m.start,m.end),m.original);
  const longer=[{...rules[0],replacement:'圆圆'}];
  const again=semanticResult(draft,longer,decisions);assert.equal(again.review.remaining.length,1);
});
test('invalid references and digit-joining replacements cannot corrupt a candidate',()=>{
  const draft={title:'标题',body:'1元2'};
  assert.throws(()=>semanticResult(draft,rules,[{id:'invented',decision:'replace',reason:'bad'}]),/位置/);
  assert.throws(()=>semanticResult(draft,[{...rules[0],replacement:'.'}],[{id:'m1',decision:'replace',reason:'金额单位'}]),/数字/);
});

for(const provider of ['openai','deepseek']) test(`${provider} classifies semantic candidates without supplying replacement text; originals and costs are retained`,async t=>{
  let mode='valid',captured,calls=0;
  const store=createStore(':memory:'),models=createModelStore();
  if(provider==='deepseek')models.save({...models.get(),copy:'deepseek-v4-pro'});
  const app=createApp(store,{apiKey:'fake-openai',modelStore:models,deepseekVault:{status:()=>({supported:true,configured:true}),getKey:async()=> 'sk-fake-deepseek-test-only'},fetcher:async(_,init)=>{
    calls++;captured=JSON.parse(init.body);
    const decisions=mode==='bad'?[{id:'unknown',decision:'replace',reason:'错误'}]:[{id:'m1',decision:'keep',reason:'元气是精神状态'},{id:'m2',decision:'replace',reason:'商品的金额单位'},{id:'m3',decision:'keep',reason:'元宇宙是名称'}];
    if(mode==='stale')store.mutate(s=>saveRules(s,{expectedRevision:s.rulesRevision,rules:[{...rules[0],replacement:'园'}]}));
    const value={decisions};
    return provider==='openai'?Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:100}}):Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100}});
  }});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await app.locals.integrations.close();server.close();store.close();});
  const req=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  const p=store.get().projects[0];await req(`/projects/${p.id}/strategies/${p.strategies[0].id}/confirm`,{});
  store.mutate(s=>saveRules(s,{rules:[...rules,{id:'hidden',term:'无关词',action:'semantic',replacement:'用户私定文字',risk:'PRICE',enabled:true}],expectedRevision:0}));
  const asset=store.get().projects[0].assets[0],before=JSON.stringify(asset);
  const path=`/projects/${p.id}/assets/${asset.id}/copy`,body={reviewOnly:true,reviewMode:'semantic',expectedRevision:asset.revision,rulesRevision:1,draft:{title:'元气满满',body:'19.9元起，元宇宙体验'}};
  const result=await req(path,body);
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.result.candidate.body,'19.9圆起，元宇宙体验');
  assert.equal(result.data.result.candidate.title,'元气满满');
  assert.equal(result.data.result.review.remaining.length,0);
  const sent=provider==='openai'?captured.input:JSON.stringify(captured.messages);
  assert.ok(!sent.includes('用户私定文字'));assert.ok(!sent.includes('replacement'));
  assert.equal(JSON.stringify(store.get().projects[0].assets[0]),before);
  assert.equal(calls,1);assert.equal(store.get().projects[0].usage.at(-1).status,'completed');
  mode='bad';assert.equal((await req(path,body)).status,502);
  assert.equal(JSON.stringify(store.get().projects[0].assets[0]),before);
  mode='stale';assert.equal((await req(path,body)).status,409);
  assert.equal(JSON.stringify(store.get().projects[0].assets[0]),before);
  const prior=calls;
  assert.equal((await req(path,{...body,rulesRevision:2,draft:{title:'普通标题',body:'没有候选'}})).status,400);
  assert.equal((await req(path,{...body,rulesRevision:2,draft:{title:'普通标题',body:'元'.repeat(41)}})).status,400);
  assert.equal(calls,prior);
});
