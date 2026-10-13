import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { scanText, parseRules, serializeRules, mergeRules } from '../server/sensitive-checker.mjs';
import { screenCopy, saveRules } from '../server/workflow.mjs';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
const r = (term, action = 'replace', replacement = '适合') => ({ id: term, term, action, replacement, risk: 'A', enabled: true });

test('literal matches preserve emoji, offsets, repetitions and longest exact allow rules', () => {
  const rules = [r('最好'), r('第一','rewrite',''), r('[最好R]','allow',''), r('a+b'), r('❤','rewrite',''), r('❤️','allow','')];
  const text = '✨👩‍💻 最好最好 [最好R] 第一 a+b ❤️ ❤';
  const hits = scanText(text, rules);
  assert.equal(hits.length, 5);
  hits.forEach(h => assert.equal(text.slice(h.start,h.end),h.original));
  const result = screenCopy({ body:text }, rules);
  assert.equal(result.value.body,'✨👩‍💻 适合适合 [最好R] 第一 适合 ❤️ ❤');
  assert.equal(result.review.remaining.length,2);
  assert.equal(result.review.hits[0].count,2);
  assert.equal(result.review.status,'needs-review');
});
test('replacement joins are rechecked; rewrite rules never become deletions', () => {
  const rules=[r('A','replace','B'),r('BC','rewrite','')];
  const result=screenCopy({body:'AC BC'},rules);
  assert.equal(result.value.body,'BC BC'); assert.equal(result.review.remaining.length,2);
  assert.equal(result.review.remaining[0].start,0);
});
test('UTF-8 TXT/CSV roundtrip optional enabled state and quoted fields; bad imports are atomic', () => {
  const rules=[r('a|b','replace','x,y'),{...r('say"hi','rewrite',''),enabled:false},r('❤️','allow','')];
  for(const format of ['txt','csv']) {
    const parsed=parseRules(serializeRules(rules,format),format);
    assert.deepEqual(parsed.map(({id,...rest})=>rest),rules.map(({id,...rest})=>rest));
  }
  assert.equal(parseRules('必买=先了解')[0].replacement,'先了解');
  for(const bad of ['a|unknown||A','a|replace|','a|rewrite||A\na|rewrite||A','a|replace|x|A|oops','"unclosed']) assert.throws(()=>parseRules(bad));
  const merged=mergeRules([r('最好','replace','我自己写的')],[r('最好'),r('治愈','rewrite','')]);
  assert.equal(merged.rules[0].replacement,'我自己写的'); assert.equal(merged.skipped,1);
});
test('legacy custom dictionaries migrate without overwriting choices or enable state', () => {
  const state={contentRules:[],rulesRevision:0};
  const old={id:'old',term:'敏感',replacement:'自定义文案',enabled:false};
  saveRules(state,{rules:[old],expectedRevision:0});
  assert.deepEqual(state.contentRules[0],{...old,action:'replace',risk:'A'});
  assert.throws(()=>saveRules(state,{expectedRevision:1,rules:[r('甲','replace','乙'),r('乙','rewrite','')]}),/循环/);
});
test('Python and application engines agree on wording and UTF-16 positions', t => {
  const python=process.env.STUDIO_TEST_PYTHON;
  if(!python) { t.skip('Set STUDIO_TEST_PYTHON to run the independent Python parity check'); return; }
  const rules=[r('最好'),r('治愈','rewrite',''),r('s','replace','字母'),r('❤','rewrite',''),r('❤️','allow',''),r('[笑哭R]','allow',''),r('元','semantic','圆')];
  for(const text of ['✨👩‍💻 最好最好 治愈\n[笑哭R] ❤️ ❤','ſ S s ß İ ı','元气满满 19.9元起']) {
    const proc=spawnSync(python,['scripts/sensitive_checker.py','--stdin-json'],{input:JSON.stringify({text,rules}),encoding:'utf8'});
    assert.equal(proc.status,0,proc.stderr); const actual=JSON.parse(proc.stdout),expected=screenCopy({body:text},rules);
    assert.equal(actual.value,expected.value.body);
    const positions=matches=>matches.map(({original,start,end,action})=>({original,start,end,action}));
    assert.deepEqual(positions(actual.matches),positions(expected.review.matches));
    assert.deepEqual(positions(actual.remaining),positions(expected.review.remaining));
  }
});
test('AI review uses compact matched context, returns a rechecked candidate and keeps original', async t => {
  let captured, changeRules=false, responseValue={title:'仍需治愈？',body:'最好 [笑哭R]'};
  const store=createStore(':memory:');
  const app=createApp(store,{apiKey:'fake',fetcher:async(_,init)=>{ captured=JSON.parse(init.body); if(changeRules) store.mutate(s=>saveRules(s,{expectedRevision:s.rulesRevision,rules:[r('新规则','rewrite','')]})); return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(responseValue)}]}],usage:{input_tokens:100,output_tokens:100}}); }});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{await app.locals.integrations.close();server.close();store.close();});
  const req=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  const p=store.get().projects[0];
  await req(`/projects/${p.id}/strategies/${p.strategies[0].id}/confirm`,{});
  store.mutate(s=>saveRules(s,{expectedRevision:0,rules:[r('最好'),r('治愈','rewrite',''),r('never-sent-unused-rule','rewrite','')]}));
  const asset=store.get().projects[0].assets[0],path=`/projects/${p.id}/assets/${asset.id}/copy`;
  const before=JSON.stringify(asset);
  const result=await req(path,{reviewOnly:true,expectedRevision:asset.revision,rulesRevision:1,draft:{title:'治愈',body:'最好 [笑哭R]'}});
  assert.equal(result.status,200,JSON.stringify(result.data));
  const payload=JSON.parse(captured.input); assert.equal(payload.copyReview.body,'适合 [笑哭R]');
  assert.ok(!captured.input.includes('never-sent-unused-rule'));
  assert.match(captured.instructions,/不自行创造谐音/); assert.match(captured.instructions,/不要把品牌介绍编造成亲身使用测评/);
  assert.equal(result.data.result.candidate.body,'适合 [笑哭R]');
  assert.equal(result.data.result.review.remaining.length,1);
  assert.equal(JSON.stringify(store.get().projects[0].assets[0]),before);
  const usages=store.get().projects[0].usage.length;
  assert.equal((await req(path,{reviewOnly:true,expectedRevision:asset.revision,rulesRevision:0,draft:{title:'治愈',body:''}})).status,409);
  assert.equal(store.get().projects[0].usage.length,usages);
  responseValue={title:''};
  assert.equal((await req(path,{reviewOnly:true,expectedRevision:asset.revision,rulesRevision:1,draft:{title:'治愈',body:''}})).status,502);
  assert.equal(JSON.stringify(store.get().projects[0].assets[0]),before);
  responseValue={title:'平实标题',body:'正文'}; changeRules=true;
  assert.equal((await req(path,{reviewOnly:true,expectedRevision:asset.revision,rulesRevision:1,draft:{title:'治愈',body:''}})).status,409);
  assert.equal(JSON.stringify(store.get().projects[0].assets[0]),before);
  assert.equal(store.get().projects[0].usage.at(-1).status,'completed');
});
test('distributed dictionary files load through the same import path',()=>{
  for(const format of ['txt','csv']) assert.ok(parseRules(readFileSync(`resources/sensitive/sensitive_words.${format}`,'utf8'),format).length>=26);
});
