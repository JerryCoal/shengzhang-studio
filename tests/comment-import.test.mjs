import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { commentSource, sameCommentWork } from '../desktop/comment-source.mjs';
import { importComments } from '../server/domain.mjs';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
const note='aaaaaaaaaaaaaaaaaaaaaaaa',other='bbbbbbbbbbbbbbbbbbbbbbbb';
const url='https://www.xiaohongshu.com/explore/'+note;
const makeProject=()=>({revision:1,comments:[],publications:[{id:'pub',status:'published',sample:false,url,platform:'xiaohongshu',strategyId:'strategy',accountName:'自己的账号'}]});
const input=(rows,extra={})=>({publicationId:'pub',source:'browser-page',sourceUrl:url,confirmed:true,mode:'page',rows,...extra});
test('comment URLs support share text, short links and Douyin profile modal, strip transient query from saved provenance',()=>{
  assert.equal(commentSource(`分享这篇 https://www.xiaohongshu.com/explore/${note}?xsec_token=fixture-only`).canonical,url);
  assert.equal(commentSource('https://www.douyin.com/user/self?modal_id=7585164848590687525&showTab=post').canonical,'https://www.douyin.com/video/7585164848590687525');
  assert.equal(commentSource('https://v.douyin.com/abc123/').itemId,null);
  assert.throws(()=>commentSource('https://www.douyin.com/video/7585164848590687525?modal_id=7585164848590687526'));
  assert.throws(()=>commentSource('https://www.douyin.com/user/self?modal_id=7585164848590687525&modal_id=7585164848590687526'));
  assert.equal(commentSource('https://xhslink.com/a/abc123').platform,'xiaohongshu');
  assert(sameCommentWork(commentSource('https://xhslink.com/a/abc123'),commentSource(url)));
  assert(!sameCommentWork(commentSource(url),commentSource('https://www.xiaohongshu.com/explore/'+other)));
  for(const bad of ['http://www.xiaohongshu.com/explore/'+note,'https://www.xiaohongshu.com.evil.test/explore/'+note,'https://user:pass@www.xiaohongshu.com/explore/'+note,'https://www.xiaohongshu.com:444/explore/'+note,'file:///private','https://www.douyin.com/user/self','https://www.xiaohongshu.com/search_result?keyword=test'])assert.throws(()=>commentSource(bad));
});
test('structured comments preserve raw Unicode and metadata, repeated IDs never overwrite corrected text or classification',()=>{
  const p=makeProject();let out=importComments(p,input([{text:'价格有点贵❤️[赞R]\n能试用吗？',platformCommentId:'c1',likes:2,timeLabel:'04-22',isReply:true}],{sourceUrl:url+'?xsec_token=fixture-only'}));
  assert.equal(out.added,1);const c=p.comments[0];assert.equal(c.sourceUrl,url);assert.equal(c.commentAt,null);assert.equal(c.isReply,true);assert.equal(c.timeLabel,'04-22');assert.doesNotMatch(JSON.stringify(p),/fixture-only/);
  c.tags=['人工标签'];c.correctedAt='manual';c.irrelevant=true;
  out=importComments(p,input([{text:'后来变化的正文',platformCommentId:'c1',likes:3}]));
  assert.equal(out.added,0);assert.equal(out.duplicates,1);assert.equal(c.text,'价格有点贵❤️[赞R]\n能试用吗？');assert.deepEqual(c.tags,['人工标签']);assert(c.irrelevant);assert.equal(c.likes,3);
  importComments(p,input([{text:'新正文',platformCommentId:'c1',likes:null}]));assert.equal(c.likes,3);
});
test('fallback text dedup bridges pasted comments while distinct platform IDs keep identical comments separate',()=>{
  const p=makeProject();importComments(p,{publicationId:'pub',source:'paste',text:'希望看到使用演示'});
  assert.equal(importComments(p,input([{text:'希望看到使用演示',platformCommentId:'first'}])).duplicates,1);
  assert.equal(p.comments[0].source,'paste');assert.equal(p.comments[0].platformCommentId,'first');
  assert.equal(importComments(p,input([{text:'希望看到使用演示',platformCommentId:'second'}])).added,1);
  assert.equal(importComments(p,input([{text:'希望 看到使用演示'}],{mode:'selection'})).duplicates,1);
  p.publications.push({...p.publications[0],id:'pub2'});
  assert.equal(importComments(p,input([{text:'希望看到使用演示',platformCommentId:'first'}],{publicationId:'pub2'})).added,1);
});
test('invalid sources, sample works, unconfirmed previews and invalid batches fail without partial imports',()=>{
  const bad=[input([{text:'正常'},{text:''}]),input([{text:'正常'}],{confirmed:false}),input([{text:'正常'}],{sourceUrl:'https://www.xiaohongshu.com/explore/'+other}),input([{text:'正常'}],{sourceUrl:'https://evil.test/'}),input([{text:'a'.repeat(4001)}]),input([{text:'正常',likes:-1}]),input(Array.from({length:31},()=>({text:'长'.repeat(4000)})))];
  for(const value of bad){const p=makeProject(),before=structuredClone(p);assert.throws(()=>importComments(p,value));assert.deepEqual(p,before);}
  for(const patch of [{sample:true},{status:'scheduled'},{platform:'douyin'}]){const p=makeProject();Object.assign(p.publications[0],patch);assert.throws(()=>importComments(p,input([{text:'正常'}])));assert.equal(p.comments.length,0);}
});
test('local API imports and deduplicates captured comments transactionally, rejects malformed URLs as user errors',async t=>{
  const store=createStore(':memory:');store.mutate(s=>{s.projects[0].publications=makeProject().publications;s.projects[0].comments=[];});
  const server=createApp(store).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await server.close();store.close();});
  const p=store.get().projects[0];const request=async body=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p.id}/comments/import`,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const body=input([{text:'请展示使用方法',platformCommentId:'test1'}]);assert.equal((await request(body)).body.result.added,1);assert.equal((await request(body)).body.result.duplicates,1);
  assert.equal((await request({...body,sourceUrl:'https://evil.test/'})).status,400);assert.equal(store.get().projects[0].comments.length,1);
});
