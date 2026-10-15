import test from 'node:test';
import assert from 'node:assert/strict';
import { matrixCapabilities, matrixWork, matrixResearchItem, matrixResearchSearch, matrixComments, matrixCheckLogin, matrixPublishPlan, matrixPublishReceipt, matrixPublishOptions } from '../server/matrix-adapters.mjs';
const tool = (name, required = []) => ({ name, inputSchema: { type: 'object', required } });
const result = value => ({ content: [{type:'text',text:JSON.stringify(value)}] });
const youtube = [tool('youtube_search',['q']), tool('youtube_videos_list'), tool('youtube_comment_threads_list'), tool('youtube_channels_list'), tool('youtube_videos_insert',['title','filePath'])];
const instagram = [tool('instagram_get_account'),tool('instagram_search_hashtag',['hashtag']),tool('instagram_get_hashtag_media',['hashtagId','edge']),tool('instagram_list_media'),tool('instagram_list_comments',['mediaId']),tool('instagram_post_image'),tool('instagram_post_reel')];
const douyin = [tool('douyin_search',['keyword']),tool('douyin_video',['url']),tool('douyin_comments',['url'])];
const tiktok = [tool('get_profile'),tool('get_creator_info'),tool('post_video',['video_url','privacy_level']),tool('post_photos',['photo_urls','privacy_level'])];
const at = '2026-10-15T10:00:00.000Z', published = '2026-10-13T08:00:00Z', videoId = 'abcdefghijk';
const video = (id=videoId) => ({id,snippet:{title:'大学生学习习惯',description:'学习记录，原始事实',publishedAt:published},statistics:{viewCount:'80000',likeCount:'2500',commentCount:'120'}});

test('matrix MCP capability discovery checks each reviewed contract and does not invent TikTok search/comments', () => {
  assert.equal(matrixCapabilities('youtube',youtube).search,true); assert.equal(matrixCapabilities('youtube',youtube).video,true);
  assert.equal(matrixCapabilities('instagram',instagram).comments,true); assert.equal(matrixCapabilities('douyin',douyin).video,false);
  assert.equal(matrixCapabilities('tiktok',tiktok).comments,false); assert.equal(matrixCapabilities('tiktok',tiktok).search,false);
  assert.equal(matrixCapabilities('youtube',[tool('youtube_search',['q','unknownRequired']),tool('youtube_videos_list')]).search,false);
  assert.equal(matrixCapabilities('instagram',youtube).comments,false);
});
test('matrix source URLs canonicalize only intended platform and stable identity', () => {
  assert.equal(matrixWork('youtube','https://youtu.be/abcdefghijk?token=secret').canonical,'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(matrixWork('instagram','https://www.instagram.com/reel/Abcd_12/?igsh=x').itemId,'Abcd_12');
  assert.equal(matrixWork('douyin','https://www.douyin.com/note/7585164848590687525?foo=a').itemId,'7585164848590687525');
  for (const url of ['https://youtube.com.attacker.test/watch?v=abcdefghijk','http://www.youtube.com/watch?v=abcdefghijk','https://me:secret@www.youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=short']) assert.throws(()=>matrixWork('youtube',url));
  assert.throws(()=>matrixWork('youtube','https://www.youtube.com/watch?v=abcdefghijk&v=12345678901'),/重复/);
});
test('research details require evidence of title/date/id and preserve missing metrics', () => {
  const item = matrixResearchItem('youtube',video(),{at,accountId:'brand-a',accountName:'大学生账号'});
  assert.equal(item.metrics.views,80000); assert.equal(item.metrics.favorites,null); assert.equal(item.sourceAccountId,'brand-a');
  assert.throws(()=>matrixResearchItem('youtube',video(),{expectedId:'12345678901'}));
  assert.throws(()=>matrixResearchItem('youtube',{...video(),snippet:{title:'标题'}},{at}));
  for (const invalidDate of ['2026-10-13T08:00:00','2026-02-30T08:00:00Z','2026-10-13T24:00:00Z']) assert.throws(()=>matrixResearchItem('youtube',{...video(),snippet:{...video().snippet,publishedAt:invalidDate}},{at}));
  assert.equal(matrixResearchItem('youtube',{...video(),snippet:{...video().snippet,publishedAt:'2026-10-13T16:00:00+0800'}},{at}).publishedAt,'2026-10-13T08:00:00.000Z');
  const ig = matrixResearchItem('instagram',{id:'178999',permalink:'https://www.instagram.com/p/Abcd12/',caption:'[UNTRUSTED source: "instagram-user-content"]\n学习资料\n[/UNTRUSTED]',timestamp:published,media_type:'IMAGE',like_count:0},{at});
  assert.equal(ig.title,'学习资料'); assert.equal(ig.metrics.views,null); assert.equal(ig.metrics.likes,0);
  const dy = matrixResearchItem('douyin',{aweme_id:'7585164848590687525',url:'https://www.douyin.com/video/7585164848590687525',description:'学习资料',published_at:published,likes:0,comments:200},{at});
  assert.equal(dy.metrics.likes,null); assert.equal(dy.metrics.comments,200);
});
test('YouTube discovery merges relevance and traffic queries then verifies IDs with videos details', async () => {
  const calls=[]; const client={call:async(name,args)=>{calls.push({name,args}); if(name==='youtube_search')return result({items:[{id:{videoId}}]});return result({items:[video(),video('12345678901')]});}};
  const found=await matrixResearchSearch({platform:'youtube',client,tools:youtube,queries:['学习'],at,discovery:{timeRange:'week'},accountId:'brand-a'});
  assert.deepEqual(calls.slice(0,2).map(c=>c.args.order),['relevance','viewCount']); assert.equal(calls[0].args.publishedAfter,'2026-10-08T10:00:00.000Z');
  assert.equal(calls[2].name,'youtube_videos_list'); assert.equal(found.items.length,1); assert.equal(found.items[0].sourceAccountId,'brand-a'); assert.match(found.reports[0].message,/1 条详情未通过/);
});
test('Instagram discovery binds remote account and distinguishes hashtag-only capability', async () => {
  const calls=[]; const client={call:async(name,args)=>{calls.push({name,args});return result(name==='instagram_search_hashtag'?{ids:['178999']}:{items:[{id:'181111',permalink:'https://www.instagram.com/p/Abcd12/',caption:'学习资料',timestamp:published,like_count:100}]});}};
  const found=await matrixResearchSearch({platform:'instagram',client,tools:instagram,queries:['学习资料'],at,remoteAccount:'campus'});
  assert.equal(found.items.length,1); assert.deepEqual(calls.map(c=>c.args.account),['campus','campus','campus']); assert.deepEqual(calls.slice(1).map(c=>c.args.edge),['top','recent']);
  assert.match(found.reports[0].message,/不是全站/);
  const bad=await matrixResearchSearch({platform:'instagram',client,tools:instagram,queries:['college study'],at}); assert.equal(bad.items.length,0); assert.match(bad.reports[0].message,/不含空格/);
});
test('discovery never swallows account-switch cancellation or dispatches unsupported TikTok search', async()=>{
  let calls=0; const client={call:async()=>{calls++; return result({items:[]});}};
  const unsupported=await matrixResearchSearch({platform:'tiktok',client,tools:tiktok,queries:['大学'],at}); assert.equal(unsupported.reports[0].status,'skipped'); assert.equal(calls,0);
  const stop=Object.assign(new Error('账号已切换'),{status:409}); await assert.rejects(()=>matrixResearchSearch({platform:'youtube',client,tools:youtube,queries:['大学'],at,assertActive:()=>{throw stop;}}),error=>error===stop); assert.equal(calls,0);
});
test('YouTube comment import rejects another video and strips personal fields', async()=>{
  const work=matrixWork('youtube',`https://www.youtube.com/watch?v=${videoId}`);
  const data={items:[{snippet:{videoId,topLevelComment:{id:'comment1',snippet:{textOriginal:'这个适合新生',publishedAt:published,likeCount:5,authorDisplayName:'不要导入昵称'}}},replies:{comments:[{id:'reply1',snippet:{parentId:'comment1',textOriginal:'同意',publishedAt:published,likeCount:0}}]}}]};
  const found=await matrixComments({platform:'youtube',client:{call:async()=>result(data)},tools:youtube,work,includeReplies:true,accountId:'brand-a'});
  assert.equal(found.rows.length,2); assert.equal(found.rows[1].parentCommentId,'comment1'); assert.equal(found.sourceAccountId,'brand-a'); assert.doesNotMatch(JSON.stringify(found),/不要导入昵称/);
  data.items[0].snippet.videoId='12345678901'; await assert.rejects(()=>matrixComments({platform:'youtube',client:{call:async()=>result(data)},tools:youtube,work}),/其他作品/);
});
test('Instagram imports resolve shortcode against own media and bind the same remote account for every call',async()=>{
  const calls=[], work=matrixWork('instagram','https://www.instagram.com/p/MyPost/'); const client={call:async(name,args)=>{calls.push({name,args});return result(name==='instagram_list_media'?{items:[{id:'188888',permalink:work.canonical}]}:{items:[{id:'1999',text:'谢谢分享',like_count:1,timestamp:published}]});}};
  const found=await matrixComments({platform:'instagram',client,tools:instagram,work,remoteAccount:'a'}); assert.equal(found.rows.length,1); assert.equal(calls[1].args.mediaId,'188888'); assert(calls.every(c=>c.args.account==='a'));
  await assert.rejects(()=>matrixComments({platform:'instagram',client:{call:async()=>result({items:[]})},tools:instagram,work}),/当前授权账号/);
});
test('Douyin comments require matching post and ignore replies unless selected',async()=>{
  const work=matrixWork('douyin','https://www.douyin.com/video/7585164848590687525');const data={aweme_id:work.itemId,items:[{comment_id:'123',text:'不错',likes:20,published_at:published},{comment_id:'124',parent_comment_id:'123',text:'同意',likes:1,published_at:published}]};
  const found=await matrixComments({platform:'douyin',client:{call:async()=>result(data)},tools:douyin,work}); assert.equal(found.rows.length,1);
  data.aweme_id='999999'; await assert.rejects(()=>matrixComments({platform:'douyin',client:{call:async()=>result(data)},tools:douyin,work}),/来源无法核对/);
});
test('OAuth status is confirmed by account identity rather than available tool names',async()=>{
  assert.equal((await matrixCheckLogin({platform:'youtube',client:{call:async()=>result({items:[{id:'UC123'}]})},tools:youtube})).loginState,'logged-in');
  await assert.rejects(()=>matrixCheckLogin({platform:'tiktok',client:{call:async()=>result({display_name:'someone'})},tools:tiktok}),/身份无法核对/);
});
test('publish planning never writes and requires platform-specific explicit choices',()=>{
  const draft={title:'学习方法',body:'过程记录',mime:'video/mp4'};
  assert.throws(()=>matrixPublishPlan('youtube',draft,'C:\\clips\\one.mp4'),/可见范围/);
  const yt=matrixPublishPlan('youtube',draft,'C:\\clips\\one.mp4',{privacy:'private'}); assert.equal(yt.args.privacyStatus,'private');
  assert.throws(()=>matrixPublishPlan('instagram',draft,'C:\\clips\\one.mp4',{publicMediaUrl:'https://127.0.0.1/video.mp4'}),/公开 HTTPS/);
  const ig=matrixPublishPlan('instagram',draft,null,{publicMediaUrl:'https://media.example.com/video.mp4',remoteAccount:'brand'}); assert.equal(ig.args.account,'brand'); assert.equal(ig.args.apply,true);
  assert.throws(()=>matrixPublishPlan('tiktok',draft,null,{publicMediaUrl:'https://media.example.com/video.mp4',privacy:'private'}),/发布权限/);
  const tk=matrixPublishPlan('tiktok',draft,null,{publicMediaUrl:'https://media.example.com/video.mp4',privacy:'private',creatorOptions:{privacyOptions:['SELF_ONLY'],commentDisabled:false,duetDisabled:true,stitchDisabled:true,maxVideoDurationSeconds:60},brandOrganic:false,brandContent:false,aiGenerated:true,allowComments:false,allowDuet:false,allowStitch:false,durationSeconds:20,musicConfirmed:true}); assert.equal(tk.args.privacy_level,'SELF_ONLY'); assert.equal(tk.args.is_aigc,true); assert.equal(tk.args.disable_duet,true);
  assert.equal(matrixPublishReceipt('instagram',result({status:'preview',media_id:'123'})).state,'unknown');
  assert.equal(matrixPublishReceipt('instagram',result({status:'published',media_id:'123'})).state,'submitted');
  assert.equal(matrixPublishReceipt('tiktok',result({publish_id:'job1'})).state,'pending');
});
test('TikTok creator preflight checks current identity, available privacy and interaction restrictions',async()=>{
  const calls=[], client={call:async(name,args)=>{calls.push({name,args});return result(name==='get_profile'?{open_id:'user_a'}:{creator_nickname:'Campus',creator_username:'campus',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60});}};
  const found=await matrixPublishOptions({platform:'tiktok',client,tools:tiktok,remoteAccount:'campus'}); assert.equal(found.accountIdentity,'user_a'); assert.equal(found.creatorNickname,'Campus'); assert.equal(found.maxVideoDurationSeconds,60); assert.equal(found.duetDisabled,true); assert(calls.every(c=>c.args.account==='campus'));
  await assert.rejects(()=>matrixPublishOptions({platform:'tiktok',client:{call:async(name)=>result(name==='get_profile'?{open_id:'user_a'}:{privacy_level_options:[]})},tools:tiktok}),/可见范围/);
});
