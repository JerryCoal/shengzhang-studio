import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const {readCommentPage}=createRequire(import.meta.url)('../desktop/comment-reader.cjs');
const text=value=>({nodeType:3,textContent:value});
const element=(tag,children=[],alt='')=>({nodeType:1,tagName:tag,childNodes:children,matches:()=>false,getAttribute:key=>key==='alt'?alt:null,querySelector:()=>children.some(c=>c.tagName==='IMG')?{}:null,innerText:children.filter(c=>c.nodeType===3).map(c=>c.textContent).join('')});
function comment(platform,{body='可试用吗？',id='one',reply=false,likes='1',hidden=false,nested=[]}={}){
  const selector=platform==='douyin'?'[data-e2e="comment-item"]':'.comment-item';
  const node={id:platform==='douyin'?'':'comment-'+id,getClientRects:()=>hidden?[]:[{}],closest:s=>s===selector?node:s==='.replyContainer'&&reply?{}:null,classList:{contains:s=>s==='comment-item-sub'&&reply}};
  const leaf=value=>({innerText:value,closest:s=>s===selector?node:null});
  const content=typeof body==='string'?{...leaf(body),querySelector:()=>null}:Object.assign(body,{closest:s=>s===selector?node:null});
  const map=platform==='douyin'?{'.FduGc_lz > .Sh1Da424':content,'[data-e2e="video-comment-more"] [id]':{...leaf('...'),id:'tooltip_'+id},'.VAQA49VP > span':leaf('9月前·北京'),'.comment-item-stats-container p:first-child > span':leaf(likes)}:{'.content':content,'.info .date > span:not(.location)':leaf('04-22'),'.info .like .count':leaf(likes)};
  node.querySelectorAll=query=>[...nested.flatMap(n=>n.querySelectorAll(query)),...(map[query]?[map[query]]:[])];return node;
}
function read(platform,nodes,selection='',path='/video/1234567890123'){
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${readCommentPage.toString()})(${JSON.stringify(platform)},${selection!==''})`,{document:{title:'fixture',querySelectorAll:()=>nodes},location:{href:'https://fixture.invalid/work',pathname:path},window:{getSelection:()=>selection},getComputedStyle:()=>({display:'inline',visibility:'visible'})})));
}
test('XHS extractor keeps each comment separate from nested replies and ignores hidden/photo-only items',()=>{
  const reply=comment('xiaohongshu',{body:'谢谢[赞R]',id:'b'.repeat(24),reply:true,likes:'赞'}),parent=comment('xiaohongshu',{body:'原始一级评论',id:'a'.repeat(24),nested:[reply]});
  const photo=element('SPAN',[element('IMG',[],'用户上传的图片')]);
  const result=read('xiaohongshu',[parent,reply,comment('xiaohongshu',{body:photo}),comment('xiaohongshu',{hidden:true})]);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].text,'原始一级评论');assert.equal(result.rows[0].platformCommentId,'a'.repeat(24));assert.equal(result.rows[0].likes,1);assert.equal(result.rows[1].likes,null);assert(result.rows[1].isReply);assert.equal(result.rows[1].timeLabel,'04-22');assert.equal(result.skipped,1);
});
test('Douyin extractor preserves emoji order and multiline text, strips location, detects replies and cannot read a recommendation feed',()=>{
  const body=element('SPAN',[text('体验❤️'),element('IMG',[],'[捂脸]'),element('BR'),text('第二行'),element('IMG',[],'[玫瑰]')]);
  const r=read('douyin',[comment('douyin',{body,id:'7586183917691650874',reply:true,likes:'0'})]);
  assert.equal(r.rows[0].text,'体验❤️[捂脸]\n第二行[玫瑰]');assert.equal(r.rows[0].likes,0);assert.equal(r.rows[0].timeLabel,'9月前');assert.equal(r.rows[0].platformCommentId,'7586183917691650874');assert(r.rows[0].isReply);
  assert.match(read('douyin',[],'','/user/self').error,/独立作品页/);
});
test('selection fallback has explicit limits and never fabricates comment IDs, likes or timestamps',()=>{
  const r=read('douyin',[],'你好✨\n[笑哭R]\n'+ '长'.repeat(4001));assert.equal(r.rows.length,2);assert.equal(r.skipped,1);assert.equal(r.rows[0].likes,null);assert.equal(r.rows[0].timeLabel,'');assert.equal(r.rows[0].platformCommentId,undefined);
  assert.match(read('xiaohongshu',[],'一\n'.repeat(1001)).error,/1,000/);assert.match(read('douyin',[],'长'.repeat(120001)).error,/过长/);
});
