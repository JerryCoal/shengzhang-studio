const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readCommentPage } = require('./comment-reader.cjs');
const { commentPageStep } = require('./comment-page-step.cjs');
const { createCommentBuffer, captureOptions } = require('./comment-buffer.cjs');
const { watchCommentResponses } = require('./comment-network.cjs');

function allowedCommentPage(value, platform) {
  try {
    const url = new URL(value), hosts = platform === 'xiaohongshu' ? ['xiaohongshu.com','xhslink.com'] : ['douyin.com','iesdouyin.com'];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.some(h => url.hostname === h || url.hostname.endsWith('.'+h));
  } catch { return false; }
}
function createCommentCollector({ BrowserWindow, WebContentsView, session, Menu, dialog, ipcMain, getParent, intervalMs = 4000 }) {
  let current, generation = 0;
  const toolbarPath = join(__dirname, 'comment-toolbar.html'), toolbarURL = pathToFileURL(toolbarPath).href;
  function cancel() { generation++; current?.finish({ cancelled: true }); }
  ipcMain.handle('studio:comment-toolbar', async (event, payload) => {
    const active = current;
    if (!active || event.sender !== active.child.webContents || event.senderFrame !== active.child.webContents.mainFrame || event.senderFrame.url !== toolbarURL) throw Error('请从评论采集面板操作');
    return active.command(payload?.action, payload?.options);
  });
  async function open(value, {sharedSession} = {}) {
    cancel(); const ticket = generation;
    const { commentSource, sameCommentWork } = await import('./comment-source.mjs');
    const expected = commentSource(typeof value === 'string' ? value : value?.url);
    if (ticket !== generation) return { cancelled: true };
    const platform = expected.platform, label = platform === 'xiaohongshu' ? '小红书' : '抖音';
    const isolated = sharedSession || session.fromPartition(`comment-read-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const blockDownload = event => event.preventDefault(); isolated.on('will-download', blockDownload);
    return new Promise(resolve => {
      const child = new BrowserWindow({ parent: getParent(), width: 1140, height: 920, minWidth: 760, minHeight: 680, show: false, title: `${label}评论采集 · 生长`, backgroundColor:'#f8faf6', webPreferences: { session: isolated, preload: join(__dirname,'comment-toolbar-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
      const view = new WebContentsView({ webPreferences: { session: isolated, nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true, devTools:false } });
      const page = view.webContents;
      child.contentView.addChildView(view);
      function layout() { const [width,height] = child.getContentSize(), top = width < 1050 ? 246 : 196; view.setBounds({ x:0,y:top,width,height:Math.max(100,height-top) }); }
      layout(); child.on('resize', layout);
      let buffer = createCommentBuffer(captureOptions(value)), source = null, mode = 'page';
      let done = false, running = false, busy = false, rounds = 0, runRounds = 0, stable = 0, runId = 0, nextTimer, closingPrompt = false, lastAction = '';
      let reason = '', message = '在下方官方页面登录、打开评论区，再点击“开始自动采集”。';
      let networkCount = 0;
      const network = watchCommentResponses(page, actualWork);
      const snapshot = () => ({ ...buffer.stats(), hasMetrics:!!network.metrics(), platform, running, busy, rounds, networkCount, structured:network.available(), locked: buffer.stats().count > 0, reason, message });
      const publish = () => { if(!done && !child.webContents.isDestroyed()) { child.webContents.send('studio:comment-progress', snapshot()); child.setTitle(`${label}评论采集 · ${buffer.stats().count} 条 · 生长`); } };
      const pause = (text, why='paused') => { running=false; runId++; clearTimeout(nextTimer); reason=why; message=text; publish(); };
      const result = () => ({ rows:buffer.rows(), metrics:network.metrics(), sourceUrl:source?.canonical || (network.metrics()?actualWork().canonical:undefined), platform, mode, includeReplies:buffer.stats().includeReplies, limited:true, skipped:buffer.stats().skipped, rounds, networkCount, stopReason:reason, notice:message });
      const finish = value => {
        if(done)return;done=true;running=false;runId++;clearTimeout(nextTimer);clearTimeout(expiry);
        network.close();
        isolated.webRequest.onBeforeRequest(null);isolated.removeListener('will-download',blockDownload);
        if(!page.isDestroyed()) page.close();
        if(!child.isDestroyed()) child.destroy();
        if(!sharedSession)void isolated.clearStorageData().catch(()=>{});
        buffer.clear();if(current?.child===child)current=undefined;resolve(value);
      };
      const expiry=setTimeout(()=>{pause('本次采集窗口已到时，已保留已读评论。','timeout');finish(buffer.stats().count?result():{error:'采集窗口已超时，请重新打开作品页。'});},30*60000);
      async function execute(fn, args) {
        let timer;
        try { return await Promise.race([page.executeJavaScriptInIsolatedWorld(998,[{code:`(${fn.toString()})(${args.map(a=>JSON.stringify(a)).join(',')})`}]),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('页面响应超时，请暂停后刷新网页重试。')),12000);})]); }
        finally { clearTimeout(timer); }
      }
      function actualWork() {
        const actual=commentSource(page.getURL());
        if(!sameCommentWork(source||expected,actual))throw Error('页面已切换到其他作品，请回到原作品。');
        return actual;
      }
      async function checkedExecute(fn,args) {
        const before=actualWork(), raw=await execute(fn,args), after=actualWork();
        if(done)return null;
        if(!sameCommentWork(before,after)||!sameCommentWork(before,commentSource(raw?.url)))throw Error('读取期间页面已切换，本次读取未采用。');
        source ||= after;
        return raw;
      }
      async function step(advance) {
        const actual=actualWork();
        return checkedExecute(commentPageStep,[platform,{itemId:actual.itemId,advance,includeReplies:buffer.stats().includeReplies}]);
      }
      async function read(selected=false) {
        let added=0;
        if(!selected){const actual=actualWork();const rows=network.drain();added=buffer.merge(rows);networkCount+=added;if(rows.length)source ||= actual;}
        const raw=await checkedExecute(readCommentPage,[platform,selected]);
        if(!raw)return added;
        if(raw.error){if(added)return added;throw Error(raw.error);}
        if(selected)mode='selection';
        return added+buffer.merge(raw.rows,raw.skipped);
      }
      async function tick(token) {
        if(done||!running||token!==runId||busy)return;
        busy=true;publish();
        try {
          const probe=await step(false);
          if(done||token!==runId)return;
          if(probe.blocked){pause(probe.blocked,'attention');return;}
          const added=await read();
          if(done||token!==runId)return;
          rounds++;runRounds++;stable=added||lastAction==='scroll'?0:stable+1;publish();
          if(buffer.stats().full){pause('已达到本次数量或文字上限，可以返回预览。','limit');return;}
          if(stable>=5){pause('连续多轮没有新增评论，已暂停。可检查页面后继续，或返回预览。','no-new');return;}
          if(runRounds>=60){pause('本轮已运行 60 次，已暂停。可核对进度后继续。','round-limit');return;}
          const action=await step(true);
          if(done||token!==runId)return;
          if(action.blocked){pause(action.blocked,'attention');return;}
          if(action.atEnd){pause('网页显示没有更多评论。已加载内容可返回预览，仍请核对采集范围。','page-end');return;}
          lastAction=action.action;
          message=`本轮新增 ${added} 条；${action.action==='expand'?'正在展开回复':'正在滚动评论区并等待加载'}。`;
          nextTimer=setTimeout(()=>void tick(token),intervalMs);
        } catch(e) { if(!done&&token===runId)pause(e.message||'页面读取失败，已保留当前结果。','error'); }
        finally { busy=false;publish(); }
      }
      async function command(action, options) {
        if(done)return null;
        if(action==='status')return snapshot();
        if(action==='pause'){pause('已暂停，当前已采集内容保留。');return snapshot();}
        if(action==='cancel'){finish({cancelled:true});return null;}
        if(action==='finish') {
          pause('已结束本次采集，请在工作台核对后导入。','user-finished');
          if(!busy&&((buffer.stats().count&&source)||network.metrics()))finish(result());
          else {message=busy?'正在结束当前读取，请稍后再点返回预览。':'尚未采集到评论，请先开始或只读当前页。';publish();}
          return done?null:snapshot();
        }
        if(busy||running)return snapshot();
        if(!buffer.stats().count && ['start','read','selection'].includes(action))buffer=createCommentBuffer(captureOptions(options||value));
        if(action==='start') {
          if(buffer.stats().full){message='已达到本次上限，请返回预览后再开始新批次。';publish();return snapshot();}
          running=true;runRounds=0;stable=0;lastAction='';reason='';message='正在检查作品并读取评论…';const token=++runId;void tick(token);return snapshot();
        }
        if(action==='metrics') {message=network.metrics()?'作品数据已读取，可以返回预览。':'暂未读到此作品的结构化数据。请确认作品已打开，刷新网页后再点读取；未提供的指标会留空。';publish();return snapshot();}
        if(action==='read'||action==='selection') {
          busy=true;publish();
          try {const added=await read(action==='selection');rounds++;message=`本次新增 ${added} 条，已暂存 ${buffer.stats().count} 条，可继续采集或返回预览。`;reason='manual';}
          catch(e){message=e.message||'未能读取评论，请检查页面';reason='error';}
          finally{busy=false;publish();}
          return snapshot();
        }
        if(action==='reload'){message='正在刷新网页，已暂存内容保留。';page.reload();publish();return snapshot();}
        if(action==='detail') {try {const actual=actualWork();if(platform==='douyin'&&actual.canonical)await page.loadURL(actual.canonical);}catch{message='请先打开正确的作品链接';publish();}return snapshot();}
        throw Error('未知采集操作');
      }
      current={child,finish,command};
      child.setMenu(Menu.buildFromTemplate([{label:'评论采集',submenu:[{label:'开始 / 继续自动采集',click:()=>void command('start')},{label:'暂停采集',click:()=>void command('pause')},{label:'返回预览',click:()=>void command('finish')},{type:'separator'},{label:'打开独立作品页（抖音）',enabled:platform==='douyin',click:()=>void command('detail')},{label:'取消并关闭',click:()=>finish({cancelled:true})}]}]));
      child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      child.webContents.on('will-navigate',event=>event.preventDefault());
      child.webContents.on('will-attach-webview',event=>event.preventDefault());
      child.webContents.on('did-finish-load',publish);
      isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.resourceType==='mainFrame'&&details.url!==toolbarURL&&!allowedCommentPage(details.url,platform)}));
      page.setWindowOpenHandler(({url})=>{if(allowedCommentPage(url,platform)){pause('正在打开页面，点击继续即可恢复。');void page.loadURL(url).catch(()=>pause('页面打开失败，请检查网络。','error'));}return {action:'deny'};});
      page.on('will-attach-webview',event=>event.preventDefault());
      page.on('did-start-navigation',(_e,_url,_inPlace,mainFrame)=>{if(mainFrame&&running)pause('页面正在切换，已暂停；请确认原作品后继续。','navigation');});
      page.on('did-fail-load',(_e,code,_description,_url,mainFrame)=>{if(mainFrame&&code!==-3)pause('页面加载失败，已采集内容保留。请刷新网页或返回预览。','error');});
      page.on('render-process-gone',()=>pause('平台页面已停止，已采集内容保留。可返回预览或重新打开作品。','error'));
      child.on('close',event=>{
        if(done||(!buffer.stats().count&&!network.metrics()))return;
        event.preventDefault();if(closingPrompt)return;closingPrompt=true;pause('已暂停，等待选择如何处理本次结果。');
        void dialog.showMessageBox(child,{type:'question',message:`已采集 ${buffer.stats().count} 条评论`,detail:'关闭前可以把当前结果带回工作台核对。',buttons:['返回预览','留在采集窗口','放弃本次'],defaultId:0,cancelId:1}).then(({response})=>{closingPrompt=false;if(done)return;if(response===0)finish(result());else if(response===2)finish({cancelled:true});}).catch(()=>{closingPrompt=false;});
      });
      child.on('closed',()=>finish({cancelled:true}));
      child.once('ready-to-show',()=>{if(!done)child.show();});
      void child.loadFile(toolbarPath).catch(()=>finish({error:'采集面板未能打开，请完整解压新版应用后重试。'}));
      void page.loadURL(platform==='douyin'&&expected.canonical?expected.canonical:expected.url).catch(()=>pause('作品页暂时无法打开，请检查网络后刷新。','error'));
    });
  }
  return { open,cancel };
}
module.exports = { allowedCommentPage,createCommentCollector };
