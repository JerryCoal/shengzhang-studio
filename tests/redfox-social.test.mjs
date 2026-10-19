import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { mountRedfoxSocial, redfoxSocialItem, redfoxDate, redfoxExactCount, redfoxCommentRows } from '../server/redfox-social.mjs';
import { REDFOX_SOCIAL_OPERATIONS, redfoxSocialCapabilities } from '../server/redfox-social-catalog.mjs';
import { currentActor, runWithActor } from '../server/request-actor.mjs';
import { cleanReferences } from '../server/research-data.mjs';
import { saveMetricSnapshot } from '../server/operating-data.mjs';
import { teamPermission } from '../server/team-permissions.mjs';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';

const workId='687df3a1000000000d0184a4';
const xhs={workId,workTitle:'主题参考',workDesc:'主题的真实内容',workPublishTime:'2026-01-01 10:20:30',workLikedCount:0,workReadedCount:42,workType:'normal'};
const actors={alice:{userId:'alice',username:'Alice',role:'editor'},bob:{userId:'bob',username:'Bob',role:'editor'}};
async function fixture(t,onRequest) {
  const state={projects:[{id:'p',revision:1,publications:[{id:'pub',accountId:'a',accountName:'账号 A',platform:'xiaohongshu',status:'published',publishedAt:'2025-01-01T00:00:00Z',url:`https://www.xiaohongshu.com/explore/${workId}`}],comments:[],metricSnapshots:[]}],activities:[]};
  const store={get:()=>state,mutate:fn=>fn(state)},calls=[],activeJobs=new Set();
  const service={enabled:()=>true,status:()=>({configured:true}),request:async(operation,body,context)=>{calls.push({operation,body,context});return onRequest(operation,body,context);}};
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.teamUser=actors[req.get('X-Actor')];runWithActor(req.teamUser,next);});
  const social=mountRedfoxSocial(app,store,{redfox:service,teamMode:true,authorizeCredentials:req=>!!req.teamUser,getActor:currentActor},{project:(s,id)=>{const p=s.projects.find(p=>p.id===id);assert.ok(p);return p;},activeJobs});
  app.use((err,req,res,next)=>res.status(err.status || 400).json({error:err.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{social.close();server.close();server.closeAllConnections();});
  const req=async(actor,path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/p/publications/pub/redfox${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Actor':actor || ''},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
  return {state,store,calls,req,social,service,activeJobs};
}
test('social registry matches downloaded official route and price declarations',{skip:!existsSync(new URL('../.tools/redfox-docs/OWIBYU1V.json',import.meta.url))},()=>{
  assert.equal(Object.keys(REDFOX_SOCIAL_OPERATIONS).length,15);
  for(const entry of Object.values(REDFOX_SOCIAL_OPERATIONS)) {
    const doc=JSON.parse(readFileSync(new URL(`../.tools/redfox-docs/${entry.interfaceNo}.json`,import.meta.url),'utf8')).data.interfaceInfo;
    assert.equal(entry.path,doc.path);assert.equal(entry.method,doc.httpMethod);assert.equal(entry.priceCny,Number(doc.price));
  }
  assert.equal(redfoxSocialCapabilities().find(cap=>cap.platform==='douyin').comments,false);
});
test('team editors can read and import public data without gaining publishing permission',()=>{
  const base='/api/projects/p/publications/pub/';
  for(const suffix of ['redfox/detail','redfox/detail/import','redfox/comments','redfox/comments/import','redfox/comments/status','redfox/comments/reset']) assert.equal(teamPermission('editor','POST',base+suffix),'');
  for(const suffix of ['mcp/publish','redfox/publish','redfox/comments/delete','redfox/detail/publish']) assert.match(teamPermission('editor','POST',base+suffix),/发布员/);
});
test('normalization preserves unknown counters and precise time basis without retaining author data',()=>{
  for(const input of [undefined,null,'','1.2万','1k',false,-1,1.5]) assert.equal(redfoxExactCount(input),null);
  assert.equal(redfoxExactCount('9,228次观看'),9228);assert.equal(redfoxExactCount('0'),0);
  assert.equal(redfoxDate('2026-02-30 12:00:00',{domestic:true}).publishedAt,'');
  assert.equal(redfoxDate('2 weeks ago').publishedAt,'');
  assert.equal(redfoxDate('2026-01-01 10:20:30').publishedAt,'');
  const item=redfoxSocialItem('xiaohongshu',{...xhs,accountNickname:'private',avatar:'secret'},{at:Date.parse('2026-01-02T00:00:00Z')});
  assert.equal(item.publishedAt,'2026-01-01T02:20:30.000Z');assert.match(item.dateBasis,/assumed-Asia/);assert.equal(item.metrics.likes,0);assert.equal(item.metrics.views,42);assert.equal(item.metrics.shares,null);
  assert.ok(!JSON.stringify(item).includes('private'));assert.ok(!JSON.stringify(item).includes('secret'));
  const refs=cleanReferences([item],{at:Date.parse('2026-01-02T00:00:00Z')}).references;assert.equal(refs.length,1);assert.equal(refs[0].provider,'redfox');assert.match(refs[0].dateNote,/UTC/);
  assert.throws(()=>redfoxSocialItem('xiaohongshu',xhs,{expectedId:'000000000000000000000000'}),/不一致/);
});
test('comments reject a wrong target and never persist upstream author details or relative dates',()=>{
  assert.throws(()=>redfoxCommentRows('xiaohongshu',{commentList:[{commentId:'c',noteId:'other',content:'内容'}]},workId),/其他作品/);
  const rows=redfoxCommentRows('youtube',{comments:[{commentId:'c',content:'内容',likeCount:'1.2万',publishedTime:'2 years ago',author:{email:'secret'}}]},'sa8AzBK4dao');
  assert.deepEqual(rows,[{text:'内容',platformCommentId:'c',likes:null,timeLabel:'2 years ago',isReply:false}]);
});
test('details require login and imports bind actor, publication account and server preview',async t=>{
  const f=await fixture(t,()=>xhs);
  assert.equal((await f.req('', '/detail',{confirmed:true})).status,403);assert.equal(f.calls.length,0);
  const read=await f.req('alice','/detail',{confirmed:true});assert.equal(read.status,200);
  assert.equal(f.calls[0].context.accountId,'a');assert.equal(read.data.metrics.shares,null);
  assert.equal((await f.req('bob','/detail/import',{previewId:read.data.previewId,confirmed:true})).status,409);
  f.state.projects[0].publications[0].accountId='b';assert.equal((await f.req('alice','/detail/import',{previewId:read.data.previewId,confirmed:true})).status,409);
  f.state.projects[0].publications[0].accountId='a';const saved=await f.req('alice','/detail/import',{previewId:read.data.previewId,confirmed:true});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.result.source,'redfox');assert.equal(saved.data.result.accountId,'a');assert.equal(saved.data.result.metrics.shares,null);
  assert.equal((await f.req('alice','/detail/import',{previewId:read.data.previewId,confirmed:true})).status,409);
  assert.throws(()=>saveMetricSnapshot(f.state.projects[0],{publicationId:'pub',capturedAt:new Date().toISOString(),metrics:read.data.metrics,source:'redfox'}),/预览/);
});
test('async comments submit only once, restore task, free-poll and import selected rows',async t=>{
  const f=await fixture(t,(operation)=>operation==='social.comments.xiaohongshu'?{taskId:'task1',status:'pending'}:{taskId:'task1',status:'completed',commentList:[{commentId:'c1',noteId:workId,content:'好用',likeNum:0,nickname:'private',ipLocation:'private'}]});
  const submit=await f.req('alice','/comments',{confirmed:true,limit:50});assert.equal(submit.status,202);assert.equal(submit.data.pending,true);
  assert.equal((await f.req('alice','/comments',{confirmed:true})).status,409);assert.equal(f.calls.length,1);
  assert.equal((await f.req('alice','/comments/status')).data.jobId,submit.data.jobId);assert.equal((await f.req('bob','/comments/status')).data.pending,false);
  assert.equal((await f.req('bob','/comments/status',{jobId:submit.data.jobId})).status,409);assert.equal(f.calls.length,1);
  const done=await f.req('alice','/comments/status',{jobId:submit.data.jobId});assert.equal(done.status,200);assert.equal(done.data.cost.estimatedCny,0);assert.equal(done.data.rows.length,1);assert.ok(!JSON.stringify(done.data).includes('private'));
  const imported=await f.req('alice','/comments/import',{previewId:done.data.previewId,confirmed:true,indices:[0]});assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.result.added,1);assert.equal(f.state.projects[0].comments[0].accountId,'a');assert.equal(f.state.projects[0].comments[0].source,'redfox');
  assert.deepEqual(f.calls.map(c=>c.operation),['social.comments.xiaohongshu','social.comments-result.xiaohongshu']);
});
test('an uncertain async submission is never silently resubmitted',async t=>{
  const f=await fixture(t,()=>{throw Error('connection lost');});
  assert.equal((await f.req('alice','/comments',{confirmed:true})).status,400);
  assert.equal((await f.req('alice','/comments',{confirmed:true})).status,409);assert.equal(f.calls.length,1);
  assert.equal((await f.req('alice','/comments/status')).data.status,'uncertain');
  const jobId=(await f.req('alice','/comments/status')).data.jobId;
  assert.equal((await f.req('bob','/comments/reset',{jobId,confirmed:true})).status,409);
  assert.equal((await f.req('alice','/comments/reset',{jobId})).status,400);
  assert.equal((await f.req('alice','/comments/reset',{jobId,confirmed:true})).status,200);assert.equal(f.calls.length,1);
  assert.equal((await f.req('alice','/comments/status')).data.pending,false);
});
test('search is bounded, isolates provider author from publication account, and keeps undated clues',async t=>{
  const f=await fixture(t,operation=>operation==='social.search.youtube'?{videos:[1,2,3,4,5].map((_,i)=>({videoId:`abcdefghij${i}`,title:`样本 ${i}`,description:'正文',publishedTime:'2 weeks ago'}))}:{videoId:`abcdefghij${f.calls.length-2}`,title:'样本',description:'正文',date:'首播开始于 2022年1月29日'});
  const req={teamUser:actors.alice};let checked=0;
  const result=await f.social.researchSearch(req,{projectId:'p',platform:'youtube',queries:['主题'],assertActive:()=>checked++});
  assert.equal(f.calls.length,4);assert.ok(checked>=8);assert.equal(result.items.length,0);assert.equal(result.pendingReferences.length,5);assert.equal(result.cost.estimatedCny,.24);assert.ok(f.calls.every(c=>!c.context.accountId));
  f.service.request=async()=>{throw Error('raw upstream secret');};const failed=await f.social.researchSearch(req,{projectId:'p',platform:'douyin',queries:['主题']});assert.equal(failed.reports[0].status,'failed');assert.ok(!JSON.stringify(failed).includes('secret'));
});
test('public metric schemas map each platform without inferring absent values',()=>{
  const time=1767225600;
  const dy=redfoxSocialItem('douyin',{videoId:'1234567890123456789',content:'内容',publishTime:time,likeCount:5,commentCount:2,shareCount:3,collectCount:4});
  assert.deepEqual(dy.metrics,{views:null,likes:5,comments:2,favorites:4,shares:3});assert.equal(dy.noteType,'unknown');
  const tt=redfoxSocialItem('tiktok',{workId:'1234567890123456789',content:'内容',publishTime:time,authorData:{userHandle:'sample'},statsData:{viewCount:12,likeCount:0,forwardTotal:9},mediaType:'video'});
  assert.equal(tt.metrics.views,12);assert.equal(tt.metrics.likes,0);assert.equal(tt.metrics.shares,null);assert.equal(tt.sourceAccountId,undefined);
  const ig=redfoxSocialItem('instagram',{code:'ABCDEFG',captionText:'内容',takenAt:time,commentCount:0,playCount:'1.2万',user:{id:'secret'}});
  assert.equal(ig.externalId,'ABCDEFG');assert.equal(ig.metrics.comments,0);assert.equal(ig.metrics.views,null);assert.equal(ig.metrics.favorites,null);
});
test('async failed tasks release their paid-submit lock and completed previews survive free recovery',async t=>{
  let status='failed';const f=await fixture(t,operation=>operation==='social.comments.xiaohongshu'?{taskId:'task1',status:'pending'}:{taskId:'task1',status,commentList:[]});
  const first=await f.req('alice','/comments',{confirmed:true});assert.equal((await f.req('alice','/comments/status',{jobId:first.data.jobId})).status,502);assert.equal(f.state.projects[0].redfoxCommentJobs[0].status,'failed');
  status='completed';const second=await f.req('alice','/comments',{confirmed:true});assert.equal(second.status,202);
  assert.equal((await f.req('alice','/comments/status',{jobId:second.data.jobId})).status,200);
  assert.equal((await f.req('alice','/comments/status')).data.jobId,second.data.jobId);
  const before=f.calls.filter(c=>c.operation==='social.comments.xiaohongshu').length;
  assert.equal((await f.req('alice','/comments/status',{jobId:second.data.jobId})).status,200);assert.equal(f.calls.filter(c=>c.operation==='social.comments.xiaohongshu').length,before);
});
test('research cancellation halts further requests and partial successful queries remain usable',async t=>{
  const f=await fixture(t,()=>({list:[xhs]})),req={teamUser:actors.alice};
  let checks=0;await assert.rejects(f.social.researchSearch(req,{projectId:'p',platform:'xiaohongshu',queries:['第一','第二'],assertActive:()=>{if(++checks>1)throw Error('cancelled');}}),/cancelled/);assert.equal(f.calls.length,1);
  let count=0;f.service.request=async()=>{if(count++)throw Object.assign(Error('安全连接提示'),{redfoxSafe:true});return {list:[xhs]};};
  const partial=await f.social.researchSearch(req,{projectId:'p',platform:'xiaohongshu',queries:['第一','第二','第三']});assert.equal(count,2);assert.equal(partial.items.length,1);assert.equal(partial.reports[1].message,'安全连接提示');
});
test('changing a publication account invalidates a pending task but its owner can end the stale tracking',async t=>{
  const f=await fixture(t,()=>({taskId:'task1',status:'pending'}));const first=await f.req('alice','/comments',{confirmed:true});
  f.state.projects[0].publications[0].accountId='new-account';
  assert.equal((await f.req('alice','/comments/status',{jobId:first.data.jobId})).status,409);assert.equal(f.calls.length,1);
  assert.equal((await f.req('alice','/comments/status')).data.jobId,first.data.jobId);
  assert.equal((await f.req('bob','/comments/reset',{jobId:first.data.jobId,confirmed:true})).status,409);
  assert.equal((await f.req('alice','/comments/reset',{jobId:first.data.jobId,confirmed:true})).status,200);assert.equal(f.calls.length,1);
});
test('enabled Redfox with an unavailable key remains selected and blocks without MCP fallback',async t=>{
  const store=createStore(':memory:'),preferences=createIntegrationPreferences(),calls=[];
  preferences.saveRedfox({enabled:true,mediaEnabled:false,searchEnabled:false});
  const app=createApp(store,{profileMode:true,integrationPreferences:preferences,
    redfoxVault:{status:()=>({supported:true,configured:false,problem:'不可用'})},
    vault:{status:()=>({supported:true,configured:true}),getKey:async()=>'fixture'},
    deepseekVault:{status:()=>({supported:true,configured:true}),getKey:async()=>'fixture'},
    fetcher:async()=>{calls.push('model');throw Error('unexpected model');},mcpFetcher:async()=>{calls.push('mcp');throw Error('unexpected MCP');},redfoxFetcher:async()=>{calls.push('redfox');throw Error('unexpected Redfox');}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await app.locals.integrations.close();server.close();server.closeAllConnections();store.close();});
  const request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  const settings=(await request('/research/settings')).data,source=settings.platformSources.find(row=>row.platform==='xiaohongshu');
  assert.equal(source.provider,'redfox');assert.equal(source.configured,false);assert.match(source.note,/不会自动切换/);
  const result=await request(`/projects/${store.get().projects[0].id}/research/run`,{keywords:['主题'],sources:['xiaohongshu'],expectedRevision:0,confirmed:true,discovery:{platform:'xiaohongshu',timeRange:'week',sortBy:'general',noteType:'all'}});
  assert.equal(result.status,400);assert.match(result.data.error,/Redfox/);assert.deepEqual(calls,[]);
  preferences.saveRedfox({enabled:false,mediaEnabled:false,searchEnabled:false});
  assert.equal((await request('/research/settings')).data.platformSources.find(row=>row.platform==='xiaohongshu').provider,'mcp');
});
