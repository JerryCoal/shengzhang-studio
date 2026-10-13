const {randomUUID}=require('node:crypto');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {copyFile}=require('node:fs/promises');
const {CREATORS,creatorAllowed,stageDraft}=require('./creator-payload.cjs');
const {creatorPage}=require('./creator-page.cjs');
const {watchPublication}=require('./platform-data.cjs');
function createCreatorController({BrowserWindow,WebContentsView,session,ipcMain,dialog,clipboard,getParent,tempRoot}) {
  let current,generation=0;
  const toolbar=join(__dirname,'creator-toolbar.html'),toolbarURL=pathToFileURL(toolbar).href;
  const cancel=()=>{generation++;current?.finish({cancelled:true});};
  ipcMain.handle('studio:creator-toolbar',(event,payload)=>{
    if(!current||event.sender!==current.child.webContents||event.senderFrame!==current.child.webContents.mainFrame||event.senderFrame.url!==toolbarURL)throw Error('请从发布助手操作');
    return current.command(payload?.action);
  });
  async function open(value,{sharedSession,saveDelivery,automatic=false}={}){
    cancel();const ticket=generation,draft=await stageDraft(value,tempRoot());
    if(ticket!==generation){await draft.dispose();return {cancelled:true};}
    const isolated=sharedSession||session.fromPartition('creator-draft-'+randomUUID(),{cache:false});
    isolated.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
    const blockDownload=e=>e.preventDefault();isolated.on('will-download',blockDownload);
    return new Promise(resolve=>{
      const child=new BrowserWindow({parent:getParent(),width:1200,height:940,minWidth:760,minHeight:680,show:false,title:'生长 · 官方发布助手',backgroundColor:'#f6f8f3',webPreferences:{session:isolated,preload:join(__dirname,'creator-toolbar-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false}});
      const view=new WebContentsView({webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false}}),page=view.webContents;
      child.contentView.addChildView(view);child.setMenu(null);
      const layout=()=>{const [width,height]=child.getContentSize(),top=width<1000?250:210;view.setBounds({x:0,y:top,width,height:Math.max(100,height-top)});};layout();child.on('resize',layout);
      let done=false,busy=false,uploaded=false,filled=false,message='请在下方登录，进入发布页并选择图文或视频，再点击“上传本次素材”。';
      let receipt=null,attempted=false,observerReady=false,receiptTimer,autoTimer,autoStarted=false;
      const attemptId=randomUUID();
      const observer=watchPublication(page,draft.platform,value=>{
        receipt=value;clearTimeout(receiptTimer);message='平台已接受提交，正在记录回执…';publish();
        void saveDelivery({action:'receipt',attemptId,url:receipt.url}).then(()=>{message='平台已返回作品编号，回执已保存。是否审核通过、公开可见，请在平台核对后回工作台登记。';publish();if(automatic)finish({prepared:filled,uploaded});}).catch(()=>{message='平台已接受提交，但本地回执保存失败。请返回工作台保留作品链接；不要重复发布。';publish();});
      });
      const snapshot=()=>({platform:draft.platform,title:draft.title,busy,uploaded,filled,attempted,receipt,canSubmit:!!saveDelivery&&observerReady,message});
      const publish=()=>{if(!done&&!child.webContents.isDestroyed())child.webContents.send('studio:creator-progress',snapshot());};
      const finish=result=>{
        if(done)return;done=true;clearTimeout(expiry);clearTimeout(receiptTimer);clearTimeout(autoTimer);observer.close();if(current?.child===child)current=undefined;
        isolated.webRequest.onBeforeRequest(null);isolated.removeListener('will-download',blockDownload);
        try{if(page.debugger.isAttached())page.debugger.detach();}catch{}
        if(!page.isDestroyed())page.close();if(!child.isDestroyed())child.destroy();
        if(!sharedSession)void isolated.clearStorageData().catch(()=>{});
        void draft.dispose().catch(()=>setTimeout(()=>void draft.dispose().catch(()=>{}),2000));
        resolve({...result,receipt,attempted});
      };
      const expiry=setTimeout(()=>finish({cancelled:true,error:'发布助手已超过一小时，请重新打开。平台草稿是否保存请在官方页面核对。'}),60*60000);
      const check=()=>{if(done||page.isDestroyed()||!creatorAllowed(page.getURL(),draft.platform))throw Error('请先在对应官方创作页面登录并打开编辑器');};
      async function execute(action){
        check();const url=page.getURL();let timer;
        try {
          const result=await Promise.race([page.executeJavaScriptInIsolatedWorld(999,[{code:`(${creatorPage.toString()})(${JSON.stringify(draft.platform)},${JSON.stringify(action)},${JSON.stringify({title:draft.title,body:draft.body,mime:draft.mime})})`}],true),new Promise((_r,reject)=>{timer=setTimeout(()=>reject(Error('页面响应超时，请检查页面后重试')),15000);})]);
          check();if(page.getURL()!==url)throw Error('页面正在切换，请在编辑器加载完成后重试');
          if(result.error)throw Error(result.error);return result;
        } finally{clearTimeout(timer);}
      }
      async function upload(){
        if(uploaded)throw Error('本次素材已交给平台，请在页面核对进度；不会重复上传');
        const probe=await execute('probe');
        if(probe.fileIndex<0)throw Error('请先在下方打开发布页，选择与素材一致的“图文”或“视频”；暂未找到唯一上传入口，可用“另存素材”。');
        if(probe.hasFile)throw Error('上传框已有文件，请先核对页面素材；不会覆盖已有选择');
        if(!page.debugger.isAttached())page.debugger.attach('1.3');
        const {root}=await page.debugger.sendCommand('DOM.getDocument',{depth:0});
        const {nodeIds}=await page.debugger.sendCommand('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'input[type="file"]'});
        const repeat=await execute('probe');
        if(repeat.fileIndex!==probe.fileIndex||repeat.hasFile||!nodeIds[probe.fileIndex])throw Error('上传入口发生变化，请确认页面后重试');
        check();if(page.getURL()!==probe.url)throw Error('页面正在切换，未上传');
        // Only the single validated, temporary media file can cross this bridge.
        await page.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:nodeIds[probe.fileIndex],files:[draft.file]});
        uploaded=true;message='素材已交给平台，请等待页面显示上传 / 转码完成，再点“填写标题与正文”。';
      }
      async function command(action){
        if(done)return null;if(action==='status')return snapshot();
        if(action==='finish'){finish({prepared:filled,uploaded});return null;}
        if(busy)return snapshot();busy=true;publish();
        try {
          if(action==='prepare'){
            if(!uploaded)await upload();
            message='正在等待平台编辑器，可随时返回工作台；最长等待 90 秒。';publish();
            const deadline=Date.now()+90000;
            while(!done&&Date.now()<deadline){const probe=await execute('probe');if(probe.title&&probe.body){const result=await execute('fill');filled=result.filled===true;break;}await new Promise(r=>setTimeout(r,1500));}
            message=filled?'素材已交给平台，标题与正文已填写。请核对实际账号、上传完成状态、封面与可见范围，再点“确认提交发布”。':'编辑器尚未就绪，请检查平台提示；可以单独点击填写文案。';
          }
          else if(action==='submit'){
            if(attempted)throw Error('本次已尝试提交，不能重复点击。请在平台检查发布记录。');
            if(!saveDelivery||!observerReady||!uploaded||!filled)throw Error('请先创建发布待办，并完成上传与文案填写。');
            await execute('ready');
            const {response,checkboxChecked}=await dialog.showMessageBox(child,{type:'question',message:`确认向${draft.platform==='douyin'?'抖音':'小红书'}提交这条内容？`,detail:`${draft.title}\n\n本操作会点击官方页面的发布按钮。请核对实际登录账号、素材、封面、可见范围与是否设置定时发布。结果不明时不会自动重试。`,checkboxLabel:'我已核对当前账号和素材，确认提交本条内容',checkboxChecked:false,buttons:['继续检查','确认提交发布'],defaultId:0,cancelId:0});
            if(response!==1||!checkboxChecked||done)throw Error('尚未提交，可继续核对草稿。');
            await execute('ready');
            await saveDelivery({action:'start',attemptId,title:draft.title,body:draft.body});
            attempted=true;check();observer.arm();
            try{await execute('submit');}catch{throw Error('提交结果尚不确定，请在平台检查；本条已锁定，避免重复投稿。');}
            message='已点击发布，等待平台回执。如平台要求补充选项，请在下方完成。';
            receiptTimer=setTimeout(()=>{if(!receipt&&!done){message='暂未收到可核验的发布回执。请检查官方作品列表，不要重复提交；回工作台核实后可登记链接或解锁。';publish();if(automatic)finish({prepared:filled,uploaded});}},45000);
          }
          else if(action==='upload')await upload();
          else if(action==='fill'){const result=await execute('fill');filled=result.filled===true;message=filled?'标题与正文已填写。请核对账号、素材、标签与可见范围，再确认提交。':'编辑器未完整保留输入，请核对文字或使用复制按钮。';}
          else if(action==='copy-title'||action==='copy-body'){clipboard.writeText(action==='copy-title'?draft.title:draft.body);message=action==='copy-title'?'标题已复制，可在平台标题框粘贴。':'正文已复制，可在平台正文框粘贴。';}
          else if(action==='save'){const {canceled,filePath}=await dialog.showSaveDialog(child,{title:'另存本次素材',defaultPath:'生长-待发布素材.'+draft.extension,filters:[{name:'素材',extensions:[draft.extension]}]});if(!canceled&&filePath){await copyFile(draft.file,filePath);message='素材已另存，可从平台上传框手动选择该文件。';}}
          else if(action==='reload'){
            const {response}=await dialog.showMessageBox(child,{type:'question',message:'刷新可能丢失平台内未保存的草稿',buttons:['继续编辑','确认刷新'],defaultId:0,cancelId:0});
            if(response===1&&!done){page.reload();uploaded=false;filled=false;message='已刷新，请确认平台是否恢复草稿，再决定是否重新上传。';}
          }else throw Error('未知发布助手操作');
        }catch(e){message=e.message||'操作未完成，请在官方页面核对。';}
        finally{busy=false;publish();}return snapshot();
      }
      const autoDeadline=Date.now()+10*60000;
      async function autoPrepare() {
        if (!automatic || done || autoStarted) return;
        try {
          if(busy)return;
          const probe=await execute('probe');
          if(probe.fileIndex<0||probe.hasFile)return;
          autoStarted=true;
          const prepared=await command('prepare');
          if(prepared?.filled&&prepared.uploaded&&!done)await command('submit');
        }catch { /* Login/captcha and unknown forms remain visible for the user. */ }
        finally {
          // SPA navigation and delayed editors may not cause another load event.
          clearTimeout(autoTimer);
          if(!done&&!autoStarted&&Date.now()<autoDeadline)autoTimer=setTimeout(()=>void autoPrepare(),2000);
        }
      }
      page.on('did-finish-load',()=>{if(automatic&&!autoStarted){clearTimeout(autoTimer);autoTimer=setTimeout(()=>void autoPrepare(),2000);}});
      current={child,finish,command};
      child.webContents.setWindowOpenHandler(()=>({action:'deny'}));child.webContents.on('will-navigate',e=>e.preventDefault());
      child.webContents.on('will-attach-webview',e=>e.preventDefault());child.webContents.on('did-finish-load',publish);
      isolated.webRequest.onBeforeRequest((details,cb)=>cb({cancel:details.resourceType==='mainFrame'&&details.url!==toolbarURL&&!creatorAllowed(details.url,draft.platform)}));
      page.setWindowOpenHandler(({url})=>{if(creatorAllowed(url,draft.platform))void page.loadURL(url).catch(()=>{});return {action:'deny'};});
      page.on('will-attach-webview',e=>e.preventDefault());
      page.on('did-fail-load',(_e,code,_description,_url,main)=>{if(main&&code!==-3){message='官方页面加载失败，请检查网络后刷新；也可以返回工作台导出素材。';publish();}});
      page.on('render-process-gone',()=>{message='平台页面已停止，请返回工作台后重新打开。';publish();});
      let closing=false;
      child.on('close',e=>{if(done)return;e.preventDefault();if(closing)return;closing=true;void dialog.showMessageBox(child,{type:'question',message:'返回工作台？',detail:'已确认的发布操作可能仍在平台处理中。请检查当前提示；关闭后不会自动重试，也不会代为保存平台草稿。',buttons:['继续编辑','返回工作台'],defaultId:0,cancelId:0}).then(({response})=>{closing=false;if(response===1)finish({prepared:filled,uploaded});}).catch(()=>{closing=false;});});
      child.on('closed',()=>finish({cancelled:true}));child.once('ready-to-show',()=>{if(!done)child.show();});
      void child.loadFile(toolbar).catch(()=>finish({error:'发布面板打开失败，请完整解压新版应用'}));
      void observer.start().then(()=>{observerReady=true;publish();}).catch(()=>{message='暂不能监听发布回执，仍可填写草稿和在平台手动发布。';publish();});
      void page.loadURL(CREATORS[draft.platform]).catch(()=>{message='官方创作页面暂时不可达，请检查网络后刷新。';publish();});
    });
  }
  return {open,cancel};
}
module.exports={createCreatorController};
