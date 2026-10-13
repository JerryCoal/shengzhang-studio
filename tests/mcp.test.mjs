import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { createMCPClient, localMCPEndpoint, mcpValue } from '../server/mcp-client.mjs';
import { xhsMCPComments, toolAvailable } from '../server/mcp-platforms.mjs';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { updatePlatformDelivery } from '../server/platform-delivery.mjs';
import { createRequire } from 'node:module';
const { startDesktopMCP } = createRequire(import.meta.url)('../desktop/mcp-server.cjs');
const tool = (name, required = []) => ({ name, inputSchema: { type: 'object', required } });
const tools = [tool('publish_content',['title','content','images']),tool('publish_with_video',['title','content','video']),tool('get_feed_detail',['feed_id','xsec_token']),tool('get_login_qrcode')];
const noteId = 'a'.repeat(24), sourceUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
const fixtureComments = () => ({ feed_id: noteId, data: { note: { noteId }, comments: { list: [{ id:'comment-1',noteId,content:'价格是多少？✨',likeCount:'3',createTime:1720000000000,userInfo:{nickname:'不要保存此昵称'},subComments:[{id:'reply-1',content:'我也想知道',likeCount:'0',createTime:1720000001000}]},{id:'comment-2',noteId,content:'值得一看[赞R]',likeCount:'1.2万'}] } } });
function mockMCP(onCall, items = tools) {
  return async (_url, init) => {
    if(init.method==='DELETE')return new Response(null,{status:204});
    const request=JSON.parse(init.body),result= request.method==='initialize' ? {protocolVersion:'2025-06-18',capabilities:{tools:{}}} : request.method==='tools/list' ? {tools:items} : request.method==='notifications/initialized' ? null : await onCall(request.params.name,request.params.arguments);
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:request.id,result});
  };
}
const vault = () => {let value='';return{status:()=>({supported:true,configured:!!value}),getKey:async()=>value,save:async v=>{value=v;},remove:()=>{value='';}};};
async function fixture(t, onCall, extra={}) {
  const store=createStore(':memory:'),mcpVaults={xiaohongshu:vault(),douyin:vault()};
  const app=createApp(store,{mcpVaults,mcpFetcher:mockMCP(onCall),...extra});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const req=async(path,body,method=body===undefined?'GET':'POST',headers={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};};
  t.after(async()=>{await app.locals.integrations.close();server.close();server.closeAllConnections();store.close();});
  const p=store.get().projects[0],publication={assetId:'fixture-asset',assetRevision:1,strategyId:'fixture-strategy',accountId:'fixture-account',accountName:'测试账号',scheduledAt:new Date().toISOString()};
  Object.assign(publication,{id:'mcp-pub',sample:false,status:'scheduled',platform:'xiaohongshu',url:'',title:'测试标题',body:'真实内容',mime:'image/png',mediaData:'data:image/png;base64,'+readFileSync('public/icon-192.png').toString('base64')});delete publication.delivery;delete publication.manualReviewRequired;
  store.mutate(s=>{s.projects[0].publications.push(publication);});
  await req('/mcp/xiaohongshu',{mode:'external',endpoint:'http://127.0.0.1:18060/mcp'},'PUT');
  return{req,store,p,publication,base:`/projects/${p.id}/publications/${publication.id}/mcp`,mcpVaults};
}
test('MCP transport rejects external hosts, credentials, redirects and unrelated RPC results',async()=>{
  for(const url of ['https://example.com/mcp','http://localhost:18060/mcp','http://127.0.0.1:1234/mcp?key=x','http://user:pass@127.0.0.1:1234/mcp','http://169.254.169.254:80/mcp'])assert.throws(()=>localMCPEndpoint(url));
  assert.equal(localMCPEndpoint('http://127.0.0.1:18060/mcp'),'http://127.0.0.1:18060/mcp');
  const client=createMCPClient({endpoint:'http://127.0.0.1:18060/mcp',fetcher:async(_u,init)=>{assert.equal(init.redirect,'error');return Response.json({jsonrpc:'2.0',id:'other',result:{}});}});
  await assert.rejects(client.connect(),/编号不匹配/);
});
test('MCP handles split SSE, session headers, protocol version, notifications and paged tools without replay',async()=>{
  let call=0,deleted=false;const events=[];
  const client=createMCPClient({endpoint:'http://127.0.0.1:18060/mcp',token:'fixture-only-token',fetcher:async(_u,init)=>{
    assert.equal(init.headers.Authorization,'Bearer fixture-only-token');
    if(init.method==='DELETE'){deleted=true;return new Response(null,{status:204});}
    const req=JSON.parse(init.body);events.push(req.method);
    if(req.method==='initialize')return Response.json({jsonrpc:'2.0',id:req.id,result:{protocolVersion:'2025-06-18'}},{headers:{'Mcp-Session-Id':'test-session'}});
    assert.equal(init.headers['Mcp-Session-Id'],'test-session');assert.equal(init.headers['MCP-Protocol-Version'],'2025-06-18');
    if(req.method==='notifications/initialized')return new Response(null,{status:202});
    if(req.method==='tools/list')return Response.json({jsonrpc:'2.0',id:req.id,result:req.params.cursor?{tools:[tools[1]]}:{tools:[tools[0]],nextCursor:'page-2'}});
    call++;const payload=': heartbeat\n\nevent: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:req.id,result:{content:[{type:'text',text:'{"ok":true}'}]}})+'\n\n';const encoder=new TextEncoder();
    return new Response(new ReadableStream({start(c){for(const part of [payload.slice(0,26),payload.slice(26,43),payload.slice(43)])c.enqueue(encoder.encode(part));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
  }});
  assert.equal((await client.connect()).length,2);assert.deepEqual(mcpValue(await client.call('publish_content',{})),{ok:true});await client.close();assert.equal(call,1);assert(deleted);assert(events.includes('notifications/initialized'));
});
test('XHS MCP adapter verifies work identity, preserves Unicode/reply metadata, omits profiles and ambiguous counts',()=>{
  const value=fixtureComments(),result=xhsMCPComments(value,{itemId:noteId,canonical:sourceUrl},{limit:10,includeReplies:true});
  assert.equal(result.rows.length,3);assert.equal(result.rows[1].parentCommentId,'comment-1');assert.equal(result.rows[2].likes,null);assert(result.rows[0].commentAt);assert(!JSON.stringify(result).includes('不要保存此昵称'));
  assert.equal(xhsMCPComments(value,{itemId:noteId,canonical:sourceUrl},{limit:1,includeReplies:false}).rows.length,1);
  value.data.note.noteId='b'.repeat(24);assert.throws(()=>xhsMCPComments(value,{itemId:noteId}),/无法核对/);
  assert.equal(toolAvailable([tool('publish_content',['password'])],'publish_content',['title','content','images']),false);
  assert.equal(toolAvailable([null,{name:'broken',inputSchema:{type:'object',required:'bad'}}],'broken'),false);
});
test('MCP settings do not reveal access tokens, disallow origin/proxy access and clear tokens when endpoint changes',async t=>{
  let calls=0;const {req,mcpVaults}=await fixture(t,async()=>{calls++;return{};});
  const key='mcp-access-token-for-test';
  assert.equal((await req('/mcp/xiaohongshu',{mode:'external',endpoint:'http://127.0.0.1:18060/mcp',apiKey:key},'PUT')).status,200);
  for(const path of ['/mcp/settings','/backup','/state'])assert(!JSON.stringify((await req(path)).data).includes(key));
  assert.equal((await req('/mcp/xiaohongshu/check',{},'POST',{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await req('/mcp/xiaohongshu/check',{},'POST',{'X-Forwarded-For':'1.2.3.4'})).status,403);
  const checked=await req('/mcp/xiaohongshu/check',{});assert.equal(checked.data.capabilities.comments,true);assert.equal(calls,0);
  await req('/mcp/xiaohongshu',{mode:'external',endpoint:'http://127.0.0.1:18061/mcp'},'PUT');assert.equal(JSON.parse(await mcpVaults.xiaohongshu.getKey()).apiKey,'');
});
test('external MCP publishing requires explicit consent, journals before dispatch, cleans media and locks unknown results',async t=>{
  let calls=0,mediaFile;
  const f=await fixture(t,async(name,args)=>{calls++;assert.equal(name,'publish_content');assert.equal(args.title,'测试标题');mediaFile=args.images[0];assert(existsSync(mediaFile));assert.equal(f.store.get().projects[0].publications.find(p=>p.id===f.publication.id).delivery.phase,'submitting');return{content:[{type:'text',text:'内容发布成功（未返回作品编号）'}]};});
  const input={confirmed:true,expectedRevision:f.publication.assetRevision,title:'测试标题',body:'正文'};
  assert.equal((await f.req(f.base+'/publish',{...input,confirmed:false})).status,400);assert.equal(calls,0);
  const published=await f.req(f.base+'/publish',input);assert.equal(published.status,200,JSON.stringify(published.data));assert.equal(calls,1);assert(!existsSync(mediaFile));
  assert.equal((await f.req(f.base+'/publish',input)).status,409);assert.equal(calls,1);
  assert.equal(f.store.get().projects[0].publications.find(p=>p.id===f.publication.id).status,'scheduled');
});
test('external MCP failure never retries and preserves submission journal',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return{isError:true,content:[{type:'text',text:'secret-should-not-be-echoed'}]};});
  const response=await f.req(f.base+'/publish',{confirmed:true,expectedRevision:f.publication.assetRevision,title:'测试标题',body:'正文'});
  assert.equal(response.status,502);assert(!JSON.stringify(response).includes('secret-should-not-be-echoed'));assert.equal(calls,1);assert.equal(f.store.get().projects[0].publications.find(p=>p.id===f.publication.id).delivery.phase,'submitting');
});
test('MCP comments require matching own work, server-bound preview and import confirmation; duplicate reads preserve human review',async t=>{
  let calls=0;const f=await fixture(t,async(name,args)=>{calls++;assert.equal(name,'get_feed_detail');assert.equal(args.xsec_token,'test-note-access');return{content:[{type:'text',text:JSON.stringify(fixtureComments())}]};});
  f.store.mutate(s=>Object.assign(s.projects[0].publications.find(p=>p.id===f.publication.id),{status:'published',url:sourceUrl}));
  assert.equal((await f.req(f.base+'/comments',{})).status,400);assert.equal(calls,0);
  const opts={sourceUrl:sourceUrl+'?xsec_token=test-note-access',includeReplies:true};
  const first=await f.req(f.base+'/comments',opts);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.rows.length,3);assert(!JSON.stringify(first.data).includes('test-note-access'));
  const save={previewId:first.data.previewId,confirmed:true,indices:[0,1,2]};
  assert.equal((await f.req(f.base+'/comments/import',{...save,confirmed:false})).status,400);
  assert.equal((await f.req(f.base+'/comments/import',save)).data.result.added,3);
  assert.equal((await f.req(f.base+'/comments/import',save)).status,409);
  f.store.mutate(s=>{const c=s.projects[0].comments.find(c=>c.platformCommentId==='comment-1');c.tags=['价格敏感'];c.correctedAt='human';});
  const next=await f.req(f.base+'/comments',opts), result=await f.req(f.base+'/comments/import',{...save,previewId:next.data.previewId});assert.equal(result.data.result.duplicates,3);
  const row=f.store.get().projects[0].comments.find(c=>c.platformCommentId==='comment-1');assert.equal(row.source,'mcp');assert.equal(row.correctedAt,'human');assert.deepEqual(row.tags,['价格敏感']);
});
test('built-in MCP speaks real HTTP, rejects anonymous/browser access and isolates concurrent tasks',async t=>{
  let finish;const wait=new Promise(r=>{finish=r;});let calls=0;
  const server=await startDesktopMCP({token:'private-fixture-token',execute:async()=>{calls++;await wait;return{cancelled:true};}});t.after(()=>server.close());
  assert.equal((await fetch(server.endpoint,{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(server.endpoint,{method:'POST',headers:{Authorization:'Bearer private-fixture-token',Origin:'https://evil.example'},body:'{}'})).status,403);
  const a=createMCPClient({endpoint:server.endpoint,token:'private-fixture-token'}),b=createMCPClient({endpoint:server.endpoint,token:'private-fixture-token'});assert.equal((await a.connect()).length,2);await b.connect();
  const pending=a.call('studio_comments',{});while(!calls)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(b.call('studio_comments',{}),/未完成/);finish();assert.equal(mcpValue(await pending).cancelled,true);assert.equal(calls,1);await a.close();await b.close();
});
test('built-in provider dispatches both platforms via MCP without external API credentials or premature publish status',async t=>{
  let f;const server=await startDesktopMCP({token:'internal-only-test',execute:async(name,args)=>{
    assert.equal(name,'studio_publish');assert.equal(args.sessionToken,'profile-session');
    const attemptId='12345678-1234-4123-8123-123456789012';f.store.mutate(s=>{const p=s.projects[0];updatePlatformDelivery(p,f.publication.id,{action:'start',platform:args.platform,attemptId,title:args.title,body:args.body});updatePlatformDelivery(p,f.publication.id,{action:'receipt',attemptId,url:args.platform==='douyin'?'https://www.douyin.com/video/7585164848590687525':sourceUrl});});
    return{attempted:true,receipt:{url:sourceUrl}};
  }});t.after(()=>server.close());
  f=await fixture(t,async()=>{throw Error('unexpected external service');},{desktopMCP:{endpoint:server.endpoint,token:'internal-only-test'},mcpFetcher:fetch});
  await f.req('/mcp/xiaohongshu',{mode:'builtin'},'PUT');
  for(const platform of ['xiaohongshu','douyin']) {
    f.store.mutate(s=>{const pub=s.projects[0].publications.find(p=>p.id===f.publication.id);pub.platform=platform;delete pub.delivery;});
    const result=await f.req(f.base+'/publish',{confirmed:true,expectedRevision:f.publication.assetRevision,title:'测试标题',body:'正文'},'POST',{Authorization:'Bearer profile-session'});
    assert.equal(result.status,200,JSON.stringify(result.data));const pub=f.store.get().projects[0].publications.find(p=>p.id===f.publication.id);assert.equal(pub.delivery.phase,'submitted');assert.equal(pub.status,'scheduled');
  }
});
