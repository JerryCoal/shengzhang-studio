import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const {allowedCommentPage,createCommentCollector}=createRequire(import.meta.url)('../desktop/comment-collector.cjs');
const url='https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa';
async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for collector');}
function fixture(){
  const windows=[],views=[],partitions=[],handlers=new Map();
  const session={fromPartition(name,options){const p=new EventEmitter();Object.assign(p,{name,options,webRequest:{onBeforeRequest(handler){p.before=handler;}},setPermissionRequestHandler(handler){p.permission=handler;},setPermissionCheckHandler(handler){p.check=handler;},async clearStorageData(){p.cleared=true;}});partitions.push(p);return p;}};
  class Contents extends EventEmitter{
    constructor(){super();this.mainFrame={url:''};this.readCalls=0;this.steps=0;this.reads=[];}
    getURL(){return this.mainFrame.url;}isDestroyed(){return !!this.destroyed;}close(){this.destroyed=true;}
    async loadURL(value){this.mainFrame.url=value;this.emit('did-finish-load');}setWindowOpenHandler(handler){this.popup=handler;}
    send(_channel,state){this.state=state;}reload(){this.reloaded=true;}
    async executeJavaScriptInIsolatedWorld(world,scripts){this.world=world;const code=scripts[0].code;
      if(code.includes('function readCommentPage')){this.readCalls++;return this.readResult?this.readResult():{url:this.getURL(),rows:this.reads,skipped:0};}
      this.steps++;const advance=code.includes('"advance":true');if(advance)this.advances=(this.advances||0)+1;
      return this.stepResult?this.stepResult(advance):{url:this.getURL(),blocked:'',atEnd:false,action:advance?'wait':'none'};
    }
  }
  class FakeWindow extends EventEmitter{
    constructor(options){super();this.options=options;this.webContents=new Contents();this.contentView={addChildView:v=>this.view=v};windows.push(this);}
    async loadFile(path){this.webContents.mainFrame.url=(await import('node:url')).pathToFileURL(path).href;this.webContents.emit('did-finish-load');}
    getContentSize(){return [1100,900];}isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;this.webContents.destroyed=true;this.emit('closed');}setTitle(title){this.title=title;}setMenu(menu){this.menu=menu;}show(){this.shown=true;}
  }
  class FakeView{constructor(options){this.options=options;this.webContents=new Contents();views.push(this);}setBounds(bounds){this.bounds=bounds;}}
  let dialogResponse=0;
  const controller=createCommentCollector({BrowserWindow:FakeWindow,WebContentsView:FakeView,session,Menu:{buildFromTemplate:t=>t},dialog:{async showMessageBox(){return {response:dialogResponse};}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getParent:()=>({id:'parent'}),intervalMs:2});
  const start=async value=>{const before=windows.length,pending=controller.open(value);await until(()=>windows.length>before&&windows.at(-1).webContents.mainFrame.url);return {pending,window:windows.at(-1),page:views.at(-1).webContents,view:views.at(-1),partition:partitions.at(-1)};};
  const command=(w,action,options)=>handlers.get('studio:comment-toolbar')({sender:w.webContents,senderFrame:w.webContents.mainFrame},{action,options});
  return {controller,start,command,windows,views,partitions,handlers,setDialogResponse:r=>dialogResponse=r};
}
test('local controls and remote platform use separate contents; remote IPC, frames, downloads and foreign navigation are blocked',async()=>{
  const f=fixture(),{pending,window:w,page,view,partition:p}=await f.start(url+'?xsec_token=fixture-only');
  try{assert(!p.name.startsWith('persist:'));assert.equal(view.options.webPreferences.preload,undefined);assert.equal(view.options.webPreferences.nodeIntegration,false);assert.equal(view.options.webPreferences.contextIsolation,true);assert.equal(view.options.webPreferences.sandbox,true);assert.match(w.options.webPreferences.preload,/comment-toolbar-preload/);assert.equal(p.check(),false);assert(view.bounds.y>100);
    let prevented=false;p.emit('will-download',{preventDefault(){prevented=true;}});assert(prevented);
    let decision;p.before({resourceType:'mainFrame',url:'https://evil.test'},d=>decision=d);assert.equal(decision.cancel,true);
    assert.equal(page.popup({url:'file:///private'}).action,'deny');assert.equal(w.webContents.popup({url:'https://evil.test'}).action,'deny');
    const handle=f.handlers.get('studio:comment-toolbar');await assert.rejects(handle({sender:page,senderFrame:page.mainFrame},{action:'start'}));await assert.rejects(handle({sender:w.webContents,senderFrame:{url:w.webContents.mainFrame.url}},{action:'start'}));
    page.reads=[{text:'原文[赞R]',likes:2,timeLabel:'04-22',platformCommentId:'c1',isReply:false,cookie:'discard'}];await f.command(w,'read');await f.command(w,'finish');
    const result=await pending;assert.equal(result.sourceUrl,url);assert.equal(result.rows[0].text,'原文[赞R]');assert.doesNotMatch(JSON.stringify(result),/fixture-only|cookie/);assert.equal(page.world,998);assert(p.cleared);assert(page.destroyed);assert(w.destroyed);assert.equal(p.before,null);
  }finally{f.controller.cancel();}
});
test('automatic rounds retain virtualized comments by ID even when the DOM row count stays constant, then stop without claiming complete',async()=>{
  const f=fixture(),{pending,window:w,page}=await f.start({url,limit:50,includeReplies:true});
  try{page.readResult=()=>({url,rows:[{text:'第'+Math.min(page.readCalls,3)+'条',platformCommentId:'c'+Math.min(page.readCalls,3),isReply:page.readCalls===2}]});
    await f.command(w,'start');await until(()=>w.webContents.state.reason==='no-new');const state=w.webContents.state;assert.equal(state.count,3);assert.equal(state.replies,1);assert.equal(state.running,false);assert(page.advances>0);
    await f.command(w,'finish');const result=await pending;assert.equal(result.rows.length,3);assert.equal(result.limited,true);assert(result.includeReplies);
  }finally{f.controller.cancel();}
});
test('automatic collection obeys the requested limit and never sends another page action after reaching it',async()=>{
  const f=fixture(),{pending,window:w,page}=await f.start({url,limit:50});
  try{page.reads=Array.from({length:80},(_,i)=>({text:'评论'+i,platformCommentId:'id'+i}));await f.command(w,'start');await until(()=>w.webContents.state.reason==='limit');assert.equal(w.webContents.state.count,50);assert.equal(page.advances||0,0);await f.command(w,'finish');assert.equal((await pending).rows.length,50);}finally{f.controller.cancel();}
});
test('pausing an in-flight round prevents any further scroll, and resume retains collected comments',async()=>{
  const f=fixture(),{pending,window:w,page}=await f.start(url);
  try{page.reads=[{text:'已暂存',platformCommentId:'old'}];await f.command(w,'read');let release;
    page.stepResult=()=>new Promise(r=>{release=r;});await f.command(w,'start');await until(()=>!!release);await f.command(w,'pause');release({url,blocked:'',atEnd:false,action:'none'});await until(()=>!w.webContents.state.busy);assert.equal(page.advances||0,0);assert.equal(page.readCalls,1);
    page.stepResult=()=>({url,blocked:'请先完成安全验证',atEnd:false});await f.command(w,'start');await until(()=>w.webContents.state.reason==='attention');assert.equal(w.webContents.state.count,1);await f.command(w,'finish');assert.equal((await pending).rows.length,1);
  }finally{f.controller.cancel();}
});
test('work identity is frozen after resolving a short URL; navigation cannot mix other works into a batch',async()=>{
  const f=fixture(),{pending,window:w,page}=await f.start('https://xhslink.com/a/abc123');
  try{page.mainFrame.url=url;page.reads=[{text:'第一条',platformCommentId:'one'}];await f.command(w,'read');page.mainFrame.url=url.replaceAll('aaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbb');page.reads=[{text:'另一个作品'}];await f.command(w,'read');assert.match(w.webContents.state.message,/其他作品/);await f.command(w,'finish');assert.equal((await pending).rows.length,1);}finally{f.controller.cancel();}
});
test('close can return partial results, while explicit cancellation clears session and pending startup creates no window',async()=>{
  const f=fixture(),{pending,window:w,page,partition:p}=await f.start(url);page.reads=[{text:'原文'}];await f.command(w,'read');let prevented=false;w.emit('close',{preventDefault(){prevented=true;}});const result=await pending;assert(prevented);assert.equal(result.rows.length,1);assert(p.cleared);
  const next=f.controller.open(url);f.controller.cancel();assert.deepEqual(await next,{cancelled:true});assert.equal(f.windows.length,1);
});
test('Douyin profile modal opens its standalone page and only official HTTPS hosts are allowed',async()=>{
  const f=fixture(),{pending,page}=await f.start('https://www.douyin.com/user/self?modal_id=7585164848590687525');assert.equal(page.getURL(),'https://www.douyin.com/video/7585164848590687525');f.controller.cancel();assert.deepEqual(await pending,{cancelled:true});
  assert(allowedCommentPage(url,'xiaohongshu'));assert(allowedCommentPage('https://passport.douyin.com/login','douyin'));
  for(const bad of ['https://douyin.com.evil.test','http://www.douyin.com','https://user:pass@www.douyin.com','file:///a','https://www.douyin.com:8443'])assert.equal(allowedCommentPage(bad,'douyin'),false);
});
