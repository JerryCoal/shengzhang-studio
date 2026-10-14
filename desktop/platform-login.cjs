const PAGES={xiaohongshu:'https://creator.xiaohongshu.com/',douyin:'https://creator.douyin.com/'};
function allowed(platform,value) {
  if(!Object.hasOwn(PAGES,platform))return false;
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(platform==='xiaohongshu'?['xiaohongshu.com']:['douyin.com','open-douyin.com','bytedance.com','toutiao.com']).some(host=>url.hostname===host||url.hostname.endsWith('.'+host));}catch{return false;}
}
function createPlatformLogin({BrowserWindow,getParent}) {
  let current;
  const cancel=()=>current?.finish({cancelled:true});
  async function open(platform,sharedSession) {
    if(!Object.hasOwn(PAGES,platform))throw Error('不支持的平台');
    cancel();sharedSession.setPermissionRequestHandler((_c,_p,done)=>done(false));sharedSession.setPermissionCheckHandler(()=>false);
    return new Promise(resolve=>{
      let child,done=false;
      const blockDownload=event=>event.preventDefault();
      function finish(result){if(done)return;done=true;sharedSession.removeListener('will-download',blockDownload);if(child&&!child.isDestroyed())child.destroy();if(current?.child===child)current=undefined;resolve(result);}
      try {child=new BrowserWindow({parent:getParent(),width:1040,height:820,show:false,autoHideMenuBar:true,title:(platform==='xiaohongshu'?'小红书':'抖音')+'官方登录 · 登录后关闭此窗口',webPreferences:{session:sharedSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false}});}catch{finish({error:'官方登录窗口未能打开，请重新打开应用后重试。'});return;}
      sharedSession.on('will-download',blockDownload);
      current={child,finish};
      const failed=error=>{if(error?.errno!==-3&&error?.code!=='ERR_ABORTED')finish({error:'登录页面未打开，请检查网络。'});};
      const navigate=url=>{try{void child.loadURL(url).catch(failed);}catch(error){failed(error);}};
      child.webContents.setWindowOpenHandler(({url})=>{if(!done&&allowed(platform,url))navigate(url);return{action:'deny'};});
      child.webContents.on('will-navigate',(event,url)=>{if(!allowed(platform,url))event.preventDefault();});
      child.webContents.on('will-redirect',(event,url)=>{if(!allowed(platform,url))event.preventDefault();});
      child.webContents.on('will-attach-webview',event=>event.preventDefault());
      child.webContents.on('did-fail-load',(_e,code,_d,_u,main)=>{if(main&&code!==-3)finish({error:'官方登录页面未能打开，请检查网络后重试。'});});
      child.webContents.on('render-process-gone',()=>finish({error:'官方登录页面已停止，请重新打开登录窗口。'}));
      child.once('ready-to-show',()=>{if(!done)child.show();});
      child.on('closed',()=>finish({closed:true,note:'登录窗口已关闭。请到评论页选择自己的作品进行采集；实际登录状态以官方页面为准。'}));
      navigate(PAGES[platform]);
    });
  }
  return {open,cancel};
}
module.exports={createPlatformLogin,allowed};
