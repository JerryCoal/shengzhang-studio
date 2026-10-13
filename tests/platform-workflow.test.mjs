import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter,once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {saveMetricSnapshot} from '../server/operating-data.mjs';
import {updatePlatformDelivery} from '../server/platform-delivery.mjs';
import {createApp} from '../server/app.mjs';
import {createStore} from '../server/store.mjs';
import {importComments} from '../server/domain.mjs';
const require=createRequire(import.meta.url);
const {count,metricRequest,parseMetricResponse,publishRequest,parsePublishResponse,watchPublication}=require('../desktop/platform-data.cjs');
const {createPlatformSessions}=require('../desktop/platform-sessions.cjs');
const {parseCommentResponse,watchCommentResponses}=require('../desktop/comment-network.cjs');
const xhs={platform:'xiaohongshu',itemId:'a'.repeat(24)},dy={platform:'douyin',itemId:'7585164848590687525'};
const url='https://www.xiaohongshu.com/explore/'+xhs.itemId;
const metricBody=JSON.stringify({success:true,data:{items:[{id:xhs.itemId,note_card:{note_id:xhs.itemId,interact_info:{liked_count:'123',comment_count:0,collected_count:'1万+',share_count:'2'}}}]}});
const turn=()=>new Promise(r=>setImmediate(r));
function pageFixture(){const page=new EventEmitter();page.debugger=new EventEmitter();Object.assign(page.debugger,{attach(){this.attached=true;},isAttached(){return !!this.attached;},detach(){this.attached=false;},async sendCommand(method){return method==='Network.getResponseBody'?{body:page.body}:{};}});return page;}

test('work metrics use exact work identity, keep zero and unknown separate, and reject rounded display values',()=>{
  for(const value of [null,undefined,'','1万+','1.2k',true,-1,1.5,1e13])assert.equal(count(value),null);
  assert.equal(count('0'),0);
  const metric=parseMetricResponse(metricBody,xhs);
  assert.deepEqual(metric.metrics,{views:null,likes:123,comments:0,favorites:null,shares:2});
  assert.equal(parseMetricResponse(metricBody,{...xhs,itemId:'b'.repeat(24)}),null);
  const body=JSON.stringify({status_code:0,aweme_list:[{aweme_id:'wrong',statistics:{digg_count:99999}},{aweme_id:dy.itemId,statistics:{aweme_id:dy.itemId,play_count:17,comment_count:'4'}}]});
  assert.deepEqual(parseMetricResponse(body,dy).metrics,{views:17,likes:null,comments:4,favorites:null,shares:null});
  assert.equal(metricRequest('https://evil.test/api/sns/web/v1/feed',xhs),null);
  assert.equal(metricRequest('http://edith.xiaohongshu.com/api/sns/web/v1/feed',xhs),null);
  assert(metricRequest('https://edith.xiaohongshu.com/api/sns/web/v1/feed',xhs));
});

test('response observer returns only current work metrics and clears on navigation',async()=>{
  const page=pageFixture();page.body=metricBody;let work=xhs;
  const watcher=watchCommentResponses(page,()=>work);
  page.debugger.emit('message',{},'Network.responseReceived',{requestId:'1',response:{status:200,url:'https://edith.xiaohongshu.com/api/sns/web/v1/feed'}});
  page.debugger.emit('message',{},'Network.loadingFinished',{requestId:'1',encodedDataLength:500});await turn();
  assert.equal(watcher.metrics().metrics.likes,123);assert.deepEqual(watcher.drain(),[]);
  work={...xhs,itemId:'b'.repeat(24)};assert.equal(watcher.metrics(),null);
  page.emit('did-start-navigation',{},'https://www.xiaohongshu.com/',false,true);work=xhs;assert.equal(watcher.metrics(),null);watcher.close();
});

test('comments retain exact parent IDs and dates through local import without overwriting human review',()=>{
  const rows=parseCommentResponse(JSON.stringify({success:true,data:{comments:[{id:'parent',content:'如何使用',create_time:1700000000000,sub_comments:[{id:'child',content:'看说明✨',create_time:1700000001000}]}]}}),{...xhs,reply:false});
  const project={comments:[],revision:1,publications:[{id:'p',platform:'xiaohongshu',url,status:'published'}]};
  const input={publicationId:'p',source:'browser-page',sourceUrl:url,mode:'page',confirmed:true,rows};
  importComments(project,input);assert.equal(project.comments[1].parentCommentId,'parent');assert.equal(project.comments[1].commentAt,new Date(1700000001000).toISOString());
  project.comments[1].tags=['人工已核对'];importComments(project,input);assert.deepEqual(project.comments[1].tags,['人工已核对']);assert.equal(project.comments.length,2);
});

test('metric snapshots require own-work confirmation, sanitize source URLs and remain transactional',()=>{
  const project={publications:[{id:'p',status:'published',platform:'xiaohongshu',url}]};
  const input={publicationId:'p',...parseMetricResponse(metricBody,xhs),source:'browser-page',sourceUrl:url+'?xsec_token=not-saved',confirmed:true};delete input.platform;delete input.itemId;
  for(const patch of [{confirmed:undefined},{sourceUrl:url.replaceAll('a'.repeat(24),'b'.repeat(24))},{metrics:{...input.metrics,likes:-1}},{sourceUrl:'https://evil.test'}]){const before=structuredClone(project);assert.throws(()=>saveMetricSnapshot(project,{...input,...patch}));assert.deepEqual(project,before);}
  const result=saveMetricSnapshot(project,input);assert.equal(result.source,'browser-page');assert.equal(result.sourceUrl,url);assert.doesNotMatch(JSON.stringify(project),/not-saved/);
  assert.throws(()=>saveMetricSnapshot(project,input),/已有数据/);
});

test('publishing receipts require string IDs and exact known hosts/endpoints; accepted is not public visibility',()=>{
  assert(publishRequest('https://creator.douyin.com/web/api/media/aweme/create_v2/','douyin'));
  for(const bad of ['https://creator.douyin.com.evil.test/web/api/media/aweme/create_v2/','http://creator.douyin.com/web/api/media/aweme/create_v2/','https://creator.douyin.com/other'])assert(!publishRequest(bad,'douyin'));
  assert.equal(parsePublishResponse(JSON.stringify({status_code:0,item_id:dy.itemId}),'douyin').itemId,dy.itemId);
  for(const data of [{status_code:0,item_id:Number(dy.itemId)},{status_code:1,item_id:dy.itemId},{status_code:0},{status_code:0,item_id:'https://evil.test'}])assert.equal(parsePublishResponse(JSON.stringify(data),'douyin'),null);
  assert.equal(parsePublishResponse(JSON.stringify({success:true,code:0,data:{id:xhs.itemId}}),'xiaohongshu').url,url);
});

test('publish observer ignores pre-confirmation requests, GETs, foreign endpoints, and emits one receipt',async()=>{
  const page=pageFixture(),receipts=[];page.body=JSON.stringify({status_code:0,item_id:dy.itemId});
  const observer=watchPublication(page,'douyin',r=>receipts.push(r));await observer.start();
  const request=(id,method='POST',path='https://creator.douyin.com/web/api/media/aweme/create_v2/')=>page.debugger.emit('message',{},'Network.requestWillBeSent',{requestId:id,request:{method,url:path}});
  const finish=async id=>{page.debugger.emit('message',{},'Network.loadingFinished',{requestId:id,encodedDataLength:80});await turn();};
  request('before');observer.arm();await finish('before');assert.equal(receipts.length,0);
  request('get','GET');await finish('get');request('foreign','POST','https://evil.test/');await finish('foreign');assert.equal(receipts.length,0);
  request('confirmed');await finish('confirmed');await finish('confirmed');assert.equal(receipts.length,1);observer.close();assert.equal(page.debugger.listenerCount('message'),0);
});

test('submission journal survives restart, blocks duplicates, rejects mismatched receipts, and requires explicit reset',()=>{
  let p={publications:[{id:'p',status:'scheduled',platform:'xiaohongshu'}]};const attemptId=randomUUID();
  const start={action:'start',platform:'xiaohongshu',attemptId,title:'草稿',body:'正文'};
  assert.throws(()=>updatePlatformDelivery(p,'p',{...start,platform:'douyin'}),/平台.*不一致/);
  updatePlatformDelivery(p,'p',start);p=JSON.parse(JSON.stringify(p));assert.equal(p.publications[0].delivery.phase,'submitting');
  assert.throws(()=>updatePlatformDelivery(p,'p',start),/已经尝试/);
  for(const bad of [{action:'receipt',attemptId:randomUUID(),url},{action:'receipt',attemptId,url:'https://www.douyin.com/video/'+dy.itemId},{action:'reset',confirmedNotPublished:false}])assert.throws(()=>updatePlatformDelivery(p,'p',bad));
  updatePlatformDelivery(p,'p',{action:'receipt',attemptId,url});assert.equal(p.publications[0].status,'scheduled');assert.equal(p.publications[0].delivery.phase,'submitted');
  updatePlatformDelivery(p,'p',{action:'reset',confirmedNotPublished:true});assert.equal(p.publications[0].deliveryHistory.length,1);
  updatePlatformDelivery(p,'p',{...start,attemptId:randomUUID()});assert.throws(()=>updatePlatformDelivery(p,'p',{action:'receipt',attemptId,url}),/已变化/);
});

test('platform memory sessions are scoped to authenticated app login and cleared on logout/account changes',async()=>{
  const made=[],authenticated=[];
  const pool=createPlatformSessions({fromPartition(name){const s={name,async clearStorageData(){s.cleared=true;}};made.push(s);return s;}},async token=>{if(token==='invalid')throw Error('invalid');authenticated.push(token);});
  await assert.rejects(pool.acquire('xiaohongshu','invalid'));assert.equal(made.length,0);
  const first=await pool.acquire('xiaohongshu','one');assert.equal(await pool.acquire('xiaohongshu','one'),first);
  const second=await pool.acquire('douyin','one');assert.notEqual(first,second);assert(!first.name.startsWith('persist:'));
  const third=await pool.acquire('xiaohongshu','two');assert(first.cleared&&second.cleared);assert.notEqual(first,third);
  await pool.clear();assert(third.cleared);assert.equal(authenticated.length,4);
});

test('logout during platform authentication cannot create a new session',async()=>{
  let release;const pool=createPlatformSessions({fromPartition(){assert.fail('must not create session');}},()=>new Promise(r=>{release=r;}));
  const pending=pool.acquire('douyin','token');await pool.clear();release();await assert.rejects(pending,/登录已变化/);
});

test('HTTP workflow journals submission, returns conflict on duplicates and stores metric provenance',async t=>{
  const store=createStore(':memory:');store.mutate(s=>{s.projects[0].publications=[{id:'draft',platform:'xiaohongshu',status:'scheduled'},{id:'published',platform:'xiaohongshu',status:'published',url}];});
  const server=createApp(store).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();store.close();});
  const projectId=store.get().projects[0].id,base=`http://127.0.0.1:${server.address().port}/api/projects/${projectId}`;
  const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const attemptId=randomUUID(),body={action:'start',platform:'xiaohongshu',attemptId,title:'标题',body:'正文'};
  assert.equal((await post('/publications/draft/delivery',body)).status,200);assert.equal((await post('/publications/draft/delivery',body)).status,409);
  assert.equal((await post('/publications/draft/delivery',{action:'receipt',attemptId,url})).data.result.delivery.url,url);
  const metric=parseMetricResponse(metricBody,xhs);
  assert.equal((await post('/metrics',{publicationId:'published',metrics:metric.metrics,capturedAt:metric.capturedAt,source:'browser-page',sourceUrl:url,confirmed:true})).data.result.source,'browser-page');
});
