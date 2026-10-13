import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {commentRequest,parseCommentResponse,watchCommentResponses}=require('../desktop/comment-network.cjs');
const {validateDraft,creatorAllowed,stageDraft}=require('../desktop/creator-payload.cjs');
const {createCommentBuffer}=require('../desktop/comment-buffer.cjs');
const xhs={platform:'xiaohongshu',itemId:'a'.repeat(24)},dy={platform:'douyin',itemId:'7585164848590687525'};
const xurl=`https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${xhs.itemId}`;
test('comment response scope rejects unrelated works, hosts, ports and non-comment requests',()=>{
  assert.deepEqual(commentRequest(xurl,xhs),{...xhs,reply:false});
  assert.equal(commentRequest(xurl.replace(xhs.itemId,'b'.repeat(24)),xhs),null);
  for(const url of [xurl.replace('edith.xiaohongshu.com','evil.xiaohongshu.com'),xurl.replace('https:','http:'),xurl.replace('.com/','.com:8443/'),xurl.replace('/comment/page','/user/me'),xurl.replace('edith.','user:pass@edith.')])assert.equal(commentRequest(url,xhs),null);
  assert.equal(commentRequest(xurl,dy),null);
  assert.equal(commentRequest(`https://www.douyin.com/aweme/v1/web/comment/list/reply/?item_id=${dy.itemId}`,dy).reply,true);
});
test('XHS parser extracts parent/reply text without profiles; IDs remain exact; buffer merges DOM overlap',()=>{
  const body=JSON.stringify({success:true,data:{comments:[{id:'p1',note_id:xhs.itemId,content:'价格多少❤️[赞R]',like_count:'12',create_time:1780000000000,user_info:{secret:'not-for-import'},sub_comments:[{id:'r1',content:'收到✨',like_count:0}]},{id:'other',note_id:'b'.repeat(24),content:'别的作品'},{id:'photo',content:''}]}});
  const rows=parseCommentResponse(body,commentRequest(xurl,xhs));assert.equal(rows.length,2);assert.equal(rows[0].likes,12);assert.equal(rows[1].isReply,true);assert(!JSON.stringify(rows).includes('secret'));
  const buffer=createCommentBuffer({limit:50,includeReplies:false});assert.equal(buffer.merge(rows),1);assert.equal(buffer.merge([{text:rows[0].text,platformCommentId:'p1',likes:14}]),0);assert.equal(buffer.rows()[0].likes,14);
});
test('Douyin parser preserves long string IDs and rejects errors/malformed payloads',()=>{
  const request={...dy,reply:false},id='7586183917691650874';
  const body=JSON.stringify({status_code:0,comments:[{cid:id,aweme_id:dy.itemId,text:'想试一下',digg_count:3,create_time:1700000000,reply_comment:[{cid:'7586183917691650875',text:'谢谢',digg_count:0}]}]});
  const rows=parseCommentResponse(body,request);assert.equal(rows[0].platformCommentId,id);assert.equal(rows[1].isReply,true);
  for(const raw of ['null','<html>登录</html>','{}','{"status_code":1,"comments":[]}','x'.repeat(5_000_001)])assert.deepEqual(parseCommentResponse(raw,request),[]);
  assert.deepEqual(parseCommentResponse(JSON.stringify({status_code:0,comments:[{cid:Number(id),text:'unsafe numeric ID'}]}),request),[]);
});
test('response watcher bounds access to matching response bodies and discards in-flight navigation',async()=>{
  const page=new EventEmitter(),debuggerApi=new EventEmitter();page.debugger=debuggerApi;let attached=false,resolver,calls=[];let work=xhs;
  debuggerApi.attach=()=>{attached=true;};debuggerApi.isAttached=()=>attached;debuggerApi.detach=()=>{attached=false;};
  debuggerApi.sendCommand=async(method,args)=>{calls.push([method,args]);if(method==='Network.getResponseBody')return await new Promise(r=>{resolver=r;});return {};};
  const watch=watchCommentResponses(page,()=>work);
  debuggerApi.emit('message',{},'Network.responseReceived',{requestId:'no',response:{url:'https://edith.xiaohongshu.com/api/sns/web/v1/user/me',status:200}});
  debuggerApi.emit('message',{},'Network.loadingFinished',{requestId:'no',encodedDataLength:100});
  assert.equal(calls.filter(([m])=>m==='Network.getResponseBody').length,0);
  debuggerApi.emit('message',{},'Network.responseReceived',{requestId:'yes',response:{url:xurl,status:200}});
  debuggerApi.emit('message',{},'Network.loadingFinished',{requestId:'yes',encodedDataLength:100});
  page.emit('did-start-navigation',{},'https://www.xiaohongshu.com/explore/'+'b'.repeat(24),true,true);work={...xhs,itemId:'b'.repeat(24)};
  resolver({body:'{"success":true,"data":{"comments":[{"id":"p","content":"old"}]}}'});await new Promise(r=>setImmediate(r));
  assert.deepEqual(watch.drain(),[]);watch.close();assert(!attached);assert.equal(debuggerApi.listenerCount('message'),0);
});
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
const draft={platform:'xiaohongshu',title:'标题',body:'正文✨',mime:'image/png',mediaData:'data:image/png;base64,'+png.toString('base64')};
test('draft validates type/bytes/length and permits only creator origin',()=>{
  assert.equal(validateDraft(draft).bytes.toString('hex'),png.toString('hex'));
  for(const patch of [{platform:'__proto__'},{title:'字'.repeat(21)},{body:'字'.repeat(1001)},{mime:'text/html'},{mediaData:'https://evil.test/a.png'},{mediaData:'data:image/png;base64,aHRtbA=='}])assert.throws(()=>validateDraft({...draft,...patch}));
  assert(creatorAllowed('https://creator.xiaohongshu.com/publish/publish','xiaohongshu'));
  for(const url of ['https://creator.xiaohongshu.com.evil.test/','https://user:pass@creator.xiaohongshu.com/','http://creator.xiaohongshu.com/','file:///C:/secret.txt'])assert(!creatorAllowed(url,'xiaohongshu'));
});
test('draft staging writes only chosen media, ignores attacker supplied paths and removes its own directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-draft-test-'));
  try{const staged=await stageDraft({...draft,file:'C:/secret.txt'},root);assert(staged.file.startsWith(root));assert.deepEqual(await readFile(staged.file),png);await staged.dispose();await assert.rejects(()=>readFile(staged.file));}finally{await rm(root,{recursive:true,force:true});}
});
