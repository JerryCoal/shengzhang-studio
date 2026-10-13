import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import * as d from '../server/domain.mjs';
import { classifyComment, correctComment, applyRuleClassification, selectCommentScope, needsCommentReview, commentSummary, commentReport } from '../server/comment-analysis.mjs';
import { saveMetricSnapshot, latestMetricSnapshots, operatingSummary } from '../server/operating-data.mjs';

const clock = () => Date.parse('2026-10-09T14:00:00Z');
function project() {
  const p = d.seedState().projects[0]; p.sample = false; p.comments=[]; p.insights=[];
  p.publications=[{id:'work1',title:'测试作品',platform:'xiaohongshu',status:'published',publishedAt:'2026-10-01T00:00:00Z',sample:false,accountName:'测试账号',strategyId:'s1'}];
  d.importComments(p,{publicationId:'work1',text:'一盒多少钱？\n这个价格不贵\n价格太贵，不喜欢\n可以演示一下安装吗？\n[赞R]'});
  return p;
}
const snapshot = (overrides={}) => ({ publicationId:'work1',capturedAt:'2026-10-08T12:00:00Z',metrics:{views:100,likes:10,comments:null,favorites:0,shares:null},note:'后台手动抄录',...overrides });

test('rule screening separates price questions, clear criticism, negation, mixed sentiment and ambiguous emoji',()=>{
  assert.equal(classifyComment('一盒多少钱？').sentiment,'neutral');
  const negation=classifyComment('这个价格不贵');assert.equal(negation.sentiment,'neutral');assert.equal(negation.classification.needsReview,true);
  assert.equal(classifyComment('价格太贵，不喜欢').sentiment,'negative');
  assert.equal(classifyComment('好用但是会闪退').classification.needsReview,true);
  assert.equal(classifyComment('[赞R]').classification.needsReview,true);
  assert.deepEqual(classifyComment('希望多拍校园里的真实使用过程').tags,['内容建议']);
  const c=classifyComment('可以演示一下安装吗？');assert.deepEqual(c.tags,['使用疑问','内容建议']);assert.ok('可以演示一下安装吗？'.includes(c.classification.evidence));
});
test('scope rejects foreign IDs, handles duplicate IDs and never treats an explicit empty list as all comments',()=>{
  const p=project();assert.equal(selectCommentScope(p).length,5);assert.equal(selectCommentScope(p,{commentIds:[]}).length,0);
  assert.equal(selectCommentScope(p,{commentIds:[p.comments[0].id,p.comments[0].id]}).length,1);
  assert.throws(()=>selectCommentScope(p,{commentIds:['foreign']}),/不属于/);
  p.comments[0].irrelevant=true;assert.equal(selectCommentScope(p,{commentIds:[p.comments[0].id]}).length,0);
});
test('human correction preserves raw text and AI provenance, protects edits, and removes review queue item',()=>{
  const p=project(), c=p.comments[1], raw=c.text; c.classificationModel='test-model';
  const provenance=structuredClone(c.classification);
  correctComment(p,c.id,{tags:['价格顾虑'],sentiment:'neutral',note:'问价格不是负面',expectedCorrectedAt:null});
  assert.equal(c.text,raw);assert.deepEqual(c.classification,provenance);assert.equal(needsCommentReview(c),false);
  assert.throws(()=>correctComment(p,c.id,{tags:['其他'],expectedCorrectedAt:null}),/另一处/);
  assert.throws(()=>correctComment(p,c.id,{text:'改写原文'}));
  assert.throws(()=>correctComment(p,c.id,{tags:['其他','价格顾虑']}));
  const tags=c.tags;applyRuleClassification(p);assert.deepEqual(c.tags,tags);
});
test('rule refresh skips AI and human decisions while upgrading legacy comments',()=>{
  const p=project();delete p.comments[0].classification;p.comments[1].classificationModel='model';p.comments[2].correctedAt='2026-10-08T00:00:00Z';
  const ai=structuredClone(p.comments[1]),human=structuredClone(p.comments[2]);
  assert.equal(applyRuleClassification(p).count,3);assert.ok(p.comments[0].classification);assert.deepEqual(p.comments[1],ai);assert.deepEqual(p.comments[2],human);
});
test('scoped local analysis has exact evidence and window and report excludes unrelated project secrets',()=>{
  const p=project(), c=p.comments[0];c.importedAt='2026-10-02T12:00:00Z';
  const result=d.analyzeComments(p,{commentIds:[c.id]});assert.ok(result.length);assert.equal(result[0].sampleSize,1);assert.deepEqual(result[0].evidenceIds,[c.id]);assert.deepEqual(result[0].inputCommentIds,[c.id]);assert.equal(result[0].windowEnd,c.importedAt);
  assert.throws(()=>d.analyzeComments(p,{commentIds:[]}),/有效评论/);
  p.secret='private-secret';p.brief.facts='private-product-facts';
  const report=commentReport(p,[c]);assert.equal(report.summary.total,1);assert.doesNotMatch(JSON.stringify(report),/private-secret|private-product-facts/);
});
test('summary counts valid multi-label comments and excludes irrelevant entries',()=>{
  const p=project();p.comments[0].irrelevant=true;const s=commentSummary(p.comments);
  assert.equal(s.total,5);assert.equal(s.valid,4);assert.equal(s.excluded,1);assert.equal(s.topics.find(t=>t.name==='内容建议').count,1);
});
test('metric snapshots preserve unknowns and sum only the latest snapshot of each non-sample published work',()=>{
  const p=project();saveMetricSnapshot(p,snapshot(),clock);saveMetricSnapshot(p,snapshot({capturedAt:'2026-10-09T12:00:00Z',metrics:{views:150,likes:15,comments:null,favorites:0,shares:null}}),clock);
  assert.equal(latestMetricSnapshots(p).length,1);const summary=operatingSummary(p);assert.equal(summary.metrics.find(m=>m.key==='views').total,150);assert.equal(summary.metrics.find(m=>m.key==='comments').total,null);assert.equal(summary.metrics.find(m=>m.key==='favorites').total,0);
  p.publications[0].sample=true;assert.equal(operatingSummary(p).published,0);assert.equal(operatingSummary(p,true).metrics[0].total,150);
});
test('metric validation rejects negative or fractional counts, missing data, future and pre-publication times',()=>{
  const p=project();
  for(const value of [-1,1.5,1e13,NaN]) assert.throws(()=>saveMetricSnapshot(p,snapshot({metrics:{...snapshot().metrics,views:value}}),clock));
  assert.throws(()=>saveMetricSnapshot(p,snapshot({metrics:{views:null,likes:null,comments:null,favorites:null,shares:null}}),clock),/至少/);
  for(const capturedAt of ['2026-12-01T00:00:00Z','2026-09-01T00:00:00Z','invalid']) assert.throws(()=>saveMetricSnapshot(p,snapshot({capturedAt}),clock));
  p.publications[0].status='scheduled';assert.throws(()=>saveMetricSnapshot(p,snapshot(),clock),/先登记/);assert.equal(p.metricSnapshots,undefined);
});
test('metric edits require current revision; duplicate snapshot timestamps do not silently add rows',()=>{
  const p=project(), row=saveMetricSnapshot(p,snapshot(),clock);assert.equal(row.revision,1);
  assert.throws(()=>saveMetricSnapshot(p,snapshot(),clock),/已有/);
  assert.throws(()=>saveMetricSnapshot(p,snapshot({id:row.id,expectedRevision:99}),clock),/已变化/);
  const updated=saveMetricSnapshot(p,snapshot({id:row.id,expectedRevision:1,note:'修正来源备注'}),clock);assert.equal(updated.revision,2);assert.equal(p.metricSnapshots.length,1);
});
const output=value=>Response.json({status:'completed',usage:{input_tokens:10,output_tokens:20},output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function apiFixture(t, fetcher) {
  const store=createStore(':memory:');const p=project();store.mutate(s=>{s.projects=[p];});
  const app=createApp(store,{apiKey:'mock-key',fetcher});const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await app.locals.integrations.close();await new Promise(r=>server.close(r));store.close();});
  const req=async(path,body={},method='POST')=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/${path}`,{method,headers:{'X-Studio-Client':'studio-v1','Content-Type':'application/json'},body:JSON.stringify(body)});return{status:res.status,data:await res.json()};};
  return {store,p,req};
}
test('AI classification receives scoped comments and context, validates quotes, and records review metadata',async t=>{
  let calls=0,bad=false;
  const f=await apiFixture(t,async(_,init)=>{calls++;const b=JSON.parse(init.body),payload=JSON.parse(b.input);assert.equal(payload.comments.length,1);assert.ok(payload.product);assert.match(b.instructions,/价格咨询不是负面/);return output({comments:payload.comments.map(c=>({id:c.id,tags:['价格顾虑'],sentiment:'neutral',reason:'用户询问价格',evidence:bad?'完全捏造的原文':c.text,needsReview:true}))});});
  const id=f.p.comments[0].id;assert.equal((await f.req('comments/classify',{commentIds:[id]})).status,200);
  const c=f.store.get().projects[0].comments[0];assert.equal(c.classification.method,'ai');assert.equal(c.classification.needsReview,true);assert.equal(c.text,f.p.comments[0].text);
  const count=calls;assert.equal((await f.req('comments/classify',{commentIds:[]})).status,400);assert.equal(calls,count);
  bad=true;assert.equal((await f.req('comments/classify',{commentIds:[f.p.comments[1].id]})).status,502);assert.equal(f.store.get().projects[0].comments[1].classificationModel,undefined);
});
test('AI review sees selected samples only and rejects evidence outside that selection',async t=>{
  let bad=false;const f=await apiFixture(t,async(_,init)=>{const payload=JSON.parse(JSON.parse(init.body).input);assert.equal(payload.comments.length,1);return output({insights:[{category:'价格顾虑',title:'说明价格',observation:'有用户询价',recommendation:'补充真实价格说明',evidenceIds:[bad?f.p.comments[1].id:payload.comments[0].id]}]});});
  const scope={mode:'openai',commentIds:[f.p.comments[0].id]};const result=await f.req('analysis',scope);assert.equal(result.status,200);assert.equal(result.data.result[0].sampleSize,1);assert.deepEqual(result.data.result[0].inputCommentIds,scope.commentIds);
  bad=true;assert.equal((await f.req('analysis',scope)).status,502);assert.equal(f.store.get().projects[0].insights.length,1);
});
test('classification cannot overwrite a human correction made while the model is running',async t=>{
  let release,started;const entered=new Promise(r=>{started=r;});
  const f=await apiFixture(t,async(_,init)=>{const payload=JSON.parse(JSON.parse(init.body).input);started();await new Promise(r=>{release=r;});return output({comments:payload.comments.map(c=>({id:c.id,tags:['价格顾虑'],sentiment:'negative',reason:'测试理由',evidence:c.text,needsReview:false}))});});
  const c=f.p.comments[0];const pending=f.req('comments/classify',{commentIds:[c.id]});await entered;
  assert.equal((await f.req(`comments/${c.id}`,{tags:['使用疑问'],sentiment:'neutral',expectedCorrectedAt:null},'PATCH')).status,200);release();assert.equal((await pending).status,409);
  const saved=f.store.get().projects[0];assert.deepEqual(saved.comments[0].tags,['使用疑问']);assert.equal(saved.comments[0].classificationModel,undefined);assert.equal(saved.usage.at(-1).status,'completed');
});
test('rule classification, scoped review and metric records persist through the real local API',async t=>{
  const f=await apiFixture(t,()=>{throw new Error('should not call model');});
  assert.equal((await f.req('comments/classify-rules',{commentIds:[f.p.comments[0].id]})).data.result.count,1);
  const result=await f.req('analysis',{commentIds:[f.p.comments[1].id]});assert.equal(result.data.result[0].sampleSize,1);
  const metrics=await f.req('metrics',snapshot());assert.equal(metrics.status,200);assert.equal(metrics.data.state.projects[0].metricSnapshots.length,1);
  const version=f.store.get().projects[0].revision;assert.equal((await f.req('metrics',snapshot({publicationId:'foreign'}))).status,400);assert.equal(f.store.get().projects[0].revision,version);
});
