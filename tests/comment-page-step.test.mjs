import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {createRequire} from 'node:module';
const {commentPageStep}=createRequire(import.meta.url)('../desktop/comment-page-step.cjs');
const itemId='a'.repeat(24),url='https://www.xiaohongshu.com/explore/'+itemId;
function fixture({nodes=true,barrier='',more=false,atEnd=false,replyText='展开 5 条回复',hidden=false,platform='xiaohongshu',bodyWrapped=false}={}){
  let clicked=0,scrolled=0;
  const visible={getClientRects:()=>[{}],getBoundingClientRect:()=>({top:10,bottom:60,left:0,right:100}),closest:()=>null,children:[]};
  const control={...visible,innerText:replyText,querySelector:()=>bodyWrapped?{}:null,scrollIntoView(){scrolled++;},click(){clicked++;}};
  const marker={...visible,innerText:atEnd?'暂时没有更多评论':'普通说明'};
  const scroller={scrollTop:0,scrollHeight:3000,clientHeight:500,parentElement:null,overflow:'scroll',querySelectorAll:()=>[],...visible};
  const scope={querySelectorAll:q=>q==='div, span, p'?[marker]:more?[control]:[]};
  const comment={...visible,parentElement:scroller,closest:q=>q==='.comments-container, .comment-list, [data-e2e="comment-list"]'?scope:null,scrollIntoView(){scrolled++;}};
  const blocker={...visible,innerText:barrier,getClientRects:()=>hidden?[]:[{}]};
  const document={scrollingElement:{scrollTop:0},querySelectorAll:q=>q===(platform==='douyin'?'[data-e2e="comment-item"]':'.comment-item')?nodes?[comment]:[]:barrier?[blocker]:[]};
  const actualId=platform==='douyin'?'1234567890123456789':itemId;
  const actualURL=platform==='douyin'?'https://www.douyin.com/video/'+actualId:url;
  const run=(options={},href=actualURL)=>JSON.parse(JSON.stringify(vm.runInNewContext(`(${commentPageStep.toString()})(${JSON.stringify(platform)},${JSON.stringify({itemId:actualId,advance:true,includeReplies:false,...options})})`,{location:{href},URL,document,innerHeight:800,innerWidth:1200,getComputedStyle:el=>({visibility:'visible',overflowY:el.overflow||'visible'})})));
  return {run,scroller,document,clicked:()=>clicked,scrolled:()=>scrolled};
}
test('automatic steps scroll the comment container and only expand exact reply controls when enabled',()=>{
  const f=fixture({more:true});assert.equal(f.run().action,'scroll');assert.equal(f.scroller.scrollTop,400);assert.equal(f.document.scrollingElement.scrollTop,0);assert.equal(f.clicked(),0);
  assert.equal(f.run({includeReplies:true}).action,'expand');assert.equal(f.clicked(),1);
  for(const replyText of ['回复','关注','发布','删除','查看更多商品']){const bad=fixture({more:true,replyText});bad.run({includeReplies:true});assert.equal(bad.clicked(),0);}
});
test('login, challenge, missing comments, or changed work stop before any scrolling or clicking',()=>{
  for(const barrier of ['请完成安全验证','扫码登录','登录后推荐更懂你的笔记']){const f=fixture({barrier,more:true});assert(f.run({includeReplies:true}).blocked);assert.equal(f.scroller.scrollTop,0);assert.equal(f.clicked(),0);}
  const f=fixture();assert(f.run({},url.replaceAll(itemId,'b'.repeat(24))).blocked);assert.equal(f.scroller.scrollTop,0);assert(fixture({nodes:false}).run().blocked);
  assert.equal(fixture({barrier:'扫码登录',hidden:true}).run().blocked,'');
});
test('page-end is bounded to visible status text and does not imply guaranteed completeness',()=>{
  const f=fixture({atEnd:true});assert.equal(f.run().atEnd,true);assert.equal(f.scroller.scrollTop,0);assert.equal(f.run({advance:false}).action,'none');
});
test('Douyin uses its full comment list for plain reply controls and footer, excluding comment body wrappers',()=>{
  const f=fixture({platform:'douyin',more:true,replyText:'展开 2 条回复'});assert.equal(f.run({includeReplies:true}).action,'expand');assert.equal(f.clicked(),1);
  const body=fixture({platform:'douyin',more:true,bodyWrapped:true});body.run({includeReplies:true});assert.equal(body.clicked(),0);
  assert.equal(fixture({platform:'douyin',atEnd:true}).run().atEnd,true);
});
