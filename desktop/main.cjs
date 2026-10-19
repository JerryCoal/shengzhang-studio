const { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, shell, dialog, ipcMain, session, clipboard } = require('electron');
const { startDesktopMCP } = require('./mcp-server.cjs');
const { createPlatformLogin } = require('./platform-login.cjs');
const { createMCPLauncher } = require('./mcp-launcher.cjs');
const { createDocumentParser } = require('./document-parser.cjs');
const { randomBytes, createHash } = require('node:crypto');
const mcpSecret = randomBytes(32).toString('base64url');
let mcpServer;
const { createCreatorController } = require('./creator-window.cjs');
const { createDouyinAuthController } = require('./douyin-auth.cjs');
const { createCommentCollector } = require('./comment-collector.cjs');
const { createPlatformSessions } = require('./platform-sessions.cjs');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');

app.setName('Shengzhang Studio');
const smoke = process.argv.includes('--studio-smoke-test');
const dataRoot = process.env.STUDIO_DESKTOP_DATA_DIR || join(process.env.LOCALAPPDATA || app.getPath('appData'), 'ShengzhangStudio');
mkdirSync(dataRoot, { recursive: true });
app.setPath('userData', join(dataRoot, 'browser'));
const reportFile = join(dataRoot, 'startup-status.json');
const externalMCP = createMCPLauncher({dataRoot:join(dataRoot,'external-mcp')});
const documentParser = createDocumentParser({dataRoot:join(dataRoot,'document-parser')});
let launchEpoch=0, activePlatformTask=null;
const report = event => writeFileSync(reportFile, JSON.stringify({ ...event, at: new Date().toISOString() }));
let window, tray, backend, website = '', quitting = false, shutdownRequested = false, proxyEnabled = false;
let taskState = { active: 0, paused: 0 }, quitPrompt = false, quitApproved = false, rendererReady = false, taskBridgeActive = false, resolveTaskSave;
const douyinAuth = createDouyinAuthController({ BrowserWindow, session, getParent: () => window });
const platformLogin = createPlatformLogin({ BrowserWindow, getParent: () => window });
const commentCollector = createCommentCollector({ BrowserWindow, WebContentsView, session, Menu, dialog, ipcMain, getParent: () => window });
const creator = createCreatorController({ BrowserWindow, WebContentsView, session, ipcMain, dialog, clipboard, getParent: () => window, tempRoot: () => app.getPath('temp') });
const platformSessions = createPlatformSessions(session, async token => {
  const result = await fetch(website + '/api/profiles/session', {headers:{'X-Studio-Client':'studio-v1',Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
  if (!result.ok) throw Error('工作台登录已失效，请重新登录');
});
function trustedRenderer(event) { try { return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === website; } catch { return false; } }
ipcMain.on('studio:task-state', (event, value) => {
  if (!trustedRenderer(event)) return;
  if (Number.isInteger(value?.active) && value.active >= 0 && value.active <= 256 && Number.isInteger(value?.paused) && value.paused >= 0 && value.paused <= value.active) { taskState = { active: value.active, paused: value.paused }; taskBridgeActive = value.connected !== false; }
});
ipcMain.handle('studio:task-save-confirmed', (event, value) => { if (trustedRenderer(event)) resolveTaskSave?.(value?.saved === true); });
async function saveBeforeQuit() {
  const saved = await new Promise(resolve => {
    const timer = setTimeout(() => { resolveTaskSave = undefined; resolve(false); }, 10000);
    resolveTaskSave = value => { clearTimeout(timer); resolveTaskSave = undefined; resolve(value); };
    window?.webContents.send('studio:prepare-quit');
  });
  if (!saved) { await dialog.showMessageBox(window, { type: 'warning', message: '工作进度尚未确认保存', detail: '请保持应用运行，回到任务中心核对保存状态后再退出。', buttons: ['返回工作台'] }); showWindow(); return false; }
  quitApproved = true; app.quit(); return true;
}
async function askTaskClose(background = false) {
  if (quitPrompt) return; quitPrompt = true;
  try {
    const result = await dialog.showMessageBox(window, { type: 'question', message: `还有 ${taskState.active} 项 Agent 任务未完成`, detail: '退出前会保存最后检查点。已提交的模型请求无法撤销，可能继续计费；重新打开后会提示核对结果，不会自动重复生成。', buttons: background ? ['后台继续运行', '保存进度并退出', '取消'] : ['保存进度并退出', '取消'], defaultId: background ? 0 : 1, cancelId: background ? 2 : 1 });
    if (background && result.response === 0) window.hide();
    else if (result.response === (background ? 1 : 0)) await saveBeforeQuit();
  } finally { quitPrompt = false; }
}
ipcMain.handle('studio:douyin-authorize', async (event, url) => {
  if (!trustedRenderer(event)) throw new Error('请从工作台开始授权');
  try { return await douyinAuth.open(url); } catch { return { error: '无法打开抖音授权窗口，请重新准备授权或使用官方链接。' }; }
});
ipcMain.handle('studio:douyin-cancel', event => { if (trustedRenderer(event)) douyinAuth.cancel(); });
async function openComments(url, automatic = false) {
  if(activePlatformTask)return {error:'已有平台窗口正在操作，请先完成或关闭后重试。'};
  const task=Symbol('comments');activePlatformTask=task;
  try {
    platformLogin.cancel();
    commentCollector.cancel();creator.cancel();
    const {commentSource}=await import('./comment-source.mjs');
    const platform=commentSource(typeof url==='string'?url:url?.url).platform;
    const sharedSession=await platformSessions.acquire(platform,url?.sessionToken);
    return await commentCollector.open(url,{sharedSession,automatic});
  } catch(e) { return { error:e.message || '无法打开作品，请检查链接后重试。' }; } finally {if(activePlatformTask===task)activePlatformTask=null;}
}
ipcMain.handle('studio:comments-open', (event,url)=>{if(!trustedRenderer(event))throw Error('请从工作台开始评论采集');return openComments(url);});
ipcMain.handle('studio:comments-cancel', event => { if (trustedRenderer(event)) commentCollector.cancel(); });
async function openCreator(draft, automatic = false) {
  if(activePlatformTask)return {error:'已有平台窗口正在操作，请先完成或关闭后重试。'};
  const task=Symbol('creator');activePlatformTask=task;
  try {
    platformLogin.cancel();
    commentCollector.cancel();creator.cancel();
    const sharedSession=await platformSessions.acquire(draft?.platform,draft?.sessionToken);
    const canTrack=typeof draft.projectId==='string'&&/^[\w-]{1,100}$/.test(draft.projectId)&&typeof draft.publicationId==='string'&&/^[\w-]{1,100}$/.test(draft.publicationId);
    const saveDelivery=canTrack?async body=>{
      const response=await fetch(`${website}/api/projects/${encodeURIComponent(draft.projectId)}/publications/${encodeURIComponent(draft.publicationId)}/delivery`,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Client':'studio-v1',Authorization:'Bearer '+draft.sessionToken},body:JSON.stringify({...body,...(body.action==='start'?{platform:draft.platform}:{})}),signal:AbortSignal.timeout(10000)});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'发布记录未能保存，已停止提交');}
    }:null;
    return await creator.open(draft,{sharedSession,saveDelivery,automatic});
  } catch(e) { return { error:e.message || '无法打开发布助手' }; } finally {if(activePlatformTask===task)activePlatformTask=null;}
}
ipcMain.handle('studio:creator-open',(event,draft)=>{if(!trustedRenderer(event))throw Error('请从工作台打开发布助手');return openCreator(draft);});
ipcMain.handle('studio:creator-cancel', event => { if (trustedRenderer(event)) creator.cancel(); });
ipcMain.handle('studio:platform-lock', async event => {if (!trustedRenderer(event)) return;launchEpoch++;await documentParser.close();await externalMCP.stopAll();platformLogin.cancel();commentCollector.cancel();creator.cancel();await platformSessions.clear();});
async function profileScope(args) {
  if(typeof args?.sessionToken!=='string'||!args.sessionToken||args.sessionToken.length>1024)throw Error('请先登录工作台');
  const response=await fetch(website+'/api/profiles/session',{headers:{'X-Studio-Client':'studio-v1',Authorization:'Bearer '+args.sessionToken},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('工作台登录已失效');
  const profile=await response.json();
  if(typeof profile.username!=='string'||!profile.username)throw Error('无法确认工作台用户');
  return createHash('sha256').update(profile.username).digest('hex');
}
async function externalScope(args) {
  if(!['xiaohongshu','douyin'].includes(args?.platform))throw Error('平台无效');
  return profileScope(args);
}
ipcMain.handle('studio:document-parser-status',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台检查文档解析器');
  const scope=await profileScope(args);return documentParser.status({scope});
});
ipcMain.handle('studio:document-parser-configure',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台配置文档解析器');
  const epoch=launchEpoch,scope=await profileScope(args);
  const chosen=await dialog.showOpenDialog(window,{title:'选择已安装 Docling 环境中的 python.exe',buttonLabel:'选择并检查',properties:['openFile'],filters:[{name:'Python 程序',extensions:['exe']}]});
  if(chosen.canceled||!chosen.filePaths[0])return documentParser.status({scope});
  if(epoch!==launchEpoch||scope!==await profileScope(args))throw Error('工作台用户已切换，请重新配置');
  return documentParser.configure({scope,pythonPath:chosen.filePaths[0]});
});
ipcMain.handle('studio:document-parse',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台导入文档');
  const epoch=launchEpoch,scope=await profileScope(args);
  if(epoch!==launchEpoch)throw Error('工作台用户已切换，请重新导入');
  return documentParser.parse({scope,requestId:args?.requestId,name:args?.name,base64:args?.base64});
});
ipcMain.handle('studio:document-parse-cancel',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台取消文档解析');
  const scope=await profileScope(args);return documentParser.cancel({scope,requestId:args?.requestId});
});
async function selectedExternalAccount(args) {
  const response=await fetch(website+'/api/mcp/settings',{headers:{'X-Studio-Client':'studio-v1',Authorization:'Bearer '+args.sessionToken},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('无法读取本机平台账号设置');
  const platform=(await response.json()).platforms?.find(value=>value.platform===args.platform);
  const accountId=args.accountId||platform?.accountId||'default';
  if(!platform||platform.accountId&&platform.accountId!==accountId)throw Error('当前平台账号已切换，请重新操作');
  return accountId;
}
ipcMain.handle('studio:mcp-external-start',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台选择 MCP 程序');
  const epoch=launchEpoch;
  try {
    const scope=await externalScope(args);
    const accountId=await selectedExternalAccount(args);
    const previous=(await externalMCP.status({platform:args.platform,scope,accountId}))[0];
    let exePath;
    if(args.chooseProgram===true||!previous.programSaved){
      const selected=await dialog.showOpenDialog(window,{title:'为当前平台账号选择 MCP 程序（选择后将启动）',buttonLabel:'选择并启动',properties:['openFile'],filters:[{name:'Windows MCP 程序',extensions:['exe']}]});
      if(selected.canceled||!selected.filePaths[0])return {cancelled:true};
      exePath=selected.filePaths[0];
    }
    if(epoch!==launchEpoch||scope!==await externalScope(args))throw Error('工作台用户已切换，请重新选择');
    if(accountId!==await selectedExternalAccount(args))throw Error('当前平台账号已切换，请重新操作');
    const result=await externalMCP.start({platform:args.platform,scope,accountId,exePath});
    if(epoch!==launchEpoch){await externalMCP.stop({platform:args.platform,scope,accountId});return {error:'用户已切换，本次启动已取消。'};}
    try { if(scope!==await externalScope(args)||accountId!==await selectedExternalAccount(args))throw Error('工作台账号已切换'); }
    catch {await externalMCP.stop({platform:args.platform,scope,accountId});return {error:'工作台或平台账号已切换，本次启动已取消。'};}
    return {endpoint:result.endpoint,token:result.apiKey,note:result.note,ready:result.ready,accountId};
  }catch(error){return {error:error.message||'外部服务未能启动，请核对下载的程序。'};}
});
ipcMain.handle('studio:mcp-external-stop',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台停止服务');
  try {const scope=await externalScope(args),accountId=await selectedExternalAccount(args);await externalMCP.stop({platform:args.platform,scope,accountId});return {note:'已停止当前平台账号的外部服务，程序位置和本机登录资料仍保留。'};}catch{return {error:'服务尚未确认停止，请完成平台任务后重试。'};}
});
ipcMain.handle('studio:mcp-external-status',async(event,args)=>{
  if(!trustedRenderer(event))throw Error('请从工作台检查服务');
  try {const scope=await externalScope(args),accountId=await selectedExternalAccount(args);return {items:await externalMCP.status({platform:args.platform,scope,accountId})};}catch(error){return {error:error.message||'无法读取当前账号服务状态'};}
});
ipcMain.handle('studio:mcp-restart', async event => {
  if (!trustedRenderer(event)) throw Error('请从工作台修复连接');
  if(activePlatformTask)return {error:'平台窗口正在操作，请先完成或关闭后再修复连接。'};
  try { return await mcpServer.restart(); } catch { return { error:'内置服务暂时无法重启。请先完成或关闭平台任务；仍失败时从菜单“退出并停止后台任务”，再打开新版应用。' }; }
});
ipcMain.handle('studio:platform-login', async (event, args) => {
  if (!trustedRenderer(event)) throw Error('请从工作台开始登录');
  if(activePlatformTask)return {error:'平台窗口正在操作，请先完成或关闭当前发布、采集任务后再登录。'};
  const task=Symbol('login');activePlatformTask=task;
  try {const sharedSession=await platformSessions.acquire(args?.platform,args?.sessionToken);return await platformLogin.open(args.platform,sharedSession);}catch{return {error:'官方登录窗口未能打开，请重新登录工作台后重试。'};}finally{if(activePlatformTask===task)activePlatformTask=null;}
});
function safeExternal(url) { try { const target = new URL(url); if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.href); } catch {} }
async function proxyEnvironment() {
  const env = { ...process.env, NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1', NODE_USE_ENV_PROXY: '1' };
  if (env.HTTPS_PROXY || env.HTTP_PROXY) return env;
  try {
    const executable = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await promisify(execFile)(executable, ['-NoProfile', '-NonInteractive', '-Command', "$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if($p.ProxyEnable -eq 1){[Console]::Out.Write($p.ProxyServer)}"], { windowsHide: true, timeout: 5000 });
    const server = stdout.trim();
    const preferred = server.includes('=') ? server.split(';').map(item => item.split('=')).find(([kind]) => kind === 'https')?.[1] : server;
    if (preferred && /^(?:https?:\/\/)?[A-Za-z0-9.\[\]:-]+$/.test(preferred)) env.HTTPS_PROXY = env.HTTP_PROXY = preferred.includes('://') ? preferred : `http://${preferred}`;
  } catch { /* A computer without a configured proxy connects directly. */ }
  return env;
}
async function startBackend() {
  const env = await proxyEnvironment();
  proxyEnabled = !!(env.HTTPS_PROXY || env.HTTP_PROXY);
  backend = fork(join(__dirname, 'backend.cjs'), [], { execPath: join(process.resourcesPath, 'runtime', 'node.exe'), execArgv: ['--use-env-proxy'], cwd: __dirname, env: { ...env, STUDIO_MCP_ENDPOINT: mcpServer.endpoint, STUDIO_MCP_SECRET: mcpSecret, PORT: '0', STUDIO_DATA_DIR: join(dataRoot, 'data'), STUDIO_STATIC_DIR: join(__dirname, 'dist') }, windowsHide: true, silent: true });
  backend.stdout.resume();
  backend.stderr.on('data', () => { /* Never persist request bodies or credentials in diagnostics. */ });
  backend.on('exit', code => { if (!quitting) { rendererReady = false; taskBridgeActive = false; taskState = { active: 0, paused: 0 }; report({ status: 'backend-stopped', code }); if (!smoke) void dialog.showMessageBox({ type: 'error', message: '本地服务已停止', detail: '请退出并重新打开应用。项目数据仍保存在这台电脑。' }); app.quit(); } });
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 25000);
    backend.once('error', () => { clearTimeout(timer); reject(new Error('无法启动内置服务')); });
    backend.once('exit', () => { clearTimeout(timer); reject(new Error('内置服务启动失败')); });
    backend.on('message', message => { if (message?.event === 'ready' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.url)) { clearTimeout(timer); accept(message.url); } });
  });
}
function showWindow() { if (window) { window.show(); if (window.isMinimized()) window.restore(); window.focus(); } }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    try {
      mcpServer = await startDesktopMCP({ token: mcpSecret, execute: async (name, args) => {
        if (!args || typeof args.sessionToken !== 'string' || !args.sessionToken) throw Error('请登录工作区');
        // Recheck profile identity immediately before each browser action.
        const response = await fetch(website + '/api/profiles/session', {headers:{'X-Studio-Client':'studio-v1',Authorization:'Bearer '+args.sessionToken},signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw Error('工作区登录已失效');
        if (name === 'studio_publish') return openCreator(args, true);
        if (name === 'studio_comments') return openComments(args, true);
        throw Error('未知工具');
      }});
      website = await startBackend();
      const icon = nativeImage.createFromPath(join(__dirname, 'dist', 'icon-192.png'));
      window = new BrowserWindow({ width: 1440, height: 940, minWidth: 760, minHeight: 620, show: false, title: '生长 · AI 运营工作台', backgroundColor: '#f6f7f2', icon, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
      window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { douyinAuth.cancel(); platformLogin.cancel(); commentCollector.cancel(); creator.cancel(); void platformSessions.clear(); } });
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.webContents.setWindowOpenHandler(({ url }) => { safeExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== website) { event.preventDefault(); safeExternal(url); } });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.on('render-process-gone', () => { rendererReady = false; taskBridgeActive = false; taskState = { active: 0, paused: 0 }; report({ status: 'renderer-stopped' }); if (!smoke) void dialog.showMessageBox({ type: 'error', message: '页面已停止，请重新打开应用。' }); app.quit(); });
      window.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); if (taskState.active) void askTaskClose(true); else window.hide(); } });
      window.webContents.on('did-finish-load', () => {
        rendererReady = true;
        report({ status: 'ready', url: website, version: app.getVersion(), title: window.getTitle(), proxy: proxyEnabled });
        if (smoke) setTimeout(() => app.quit(), 1200); else showWindow();
      });
      const menu = [
        { label: '工作台', submenu: [{ label: '在浏览器中打开', click: () => safeExternal(website) }, { label: '打开本地数据目录', click: () => void shell.openPath(dataRoot) }, { type: 'separator' }, { label: '退出并停止后台任务', click: () => app.quit() }] },
        { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { label: '视图', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
      if (!smoke) { tray = new Tray(icon.resize({ width: 24, height: 24 })); tray.setToolTip('生长 · 后台服务运行中'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开生长工作台', click: showWindow }, { label: '在浏览器中打开', click: () => safeExternal(website) }, { type: 'separator' }, { label: '退出并停止后台任务', click: () => app.quit() }])); tray.on('double-click', showWindow); }
      await window.loadURL(website);
    } catch (error) { report({ status: 'startup-failed', message: error.message }); if (!smoke) await dialog.showMessageBox({ type: 'error', message: '暂时无法启动生长', detail: error.message }); app.quit(); }
  });
}
app.on('before-quit', event => {
  if (!smoke && !quitApproved && taskState.active && !shutdownRequested) { event.preventDefault(); void askTaskClose(); return; }
  if (!smoke && !quitApproved && rendererReady && taskBridgeActive && !shutdownRequested && window && !window.isDestroyed()) { event.preventDefault(); if (!quitPrompt) { quitPrompt = true; void saveBeforeQuit().finally(() => { quitPrompt = false; }); } return; }
  launchEpoch++; const externalClosed=Promise.allSettled([externalMCP.stopAll(),documentParser.close()]);
  mcpServer?.close();
  douyinAuth.cancel();
  platformLogin.cancel();
  commentCollector.cancel();
  creator.cancel();
  if (shutdownRequested) { quitting = true; return; }
  if (!backend || backend.exitCode !== null) { event.preventDefault();quitting=true;shutdownRequested=true;void externalClosed.finally(()=>app.exit(0));return; }
  event.preventDefault(); quitting = true; shutdownRequested = true; window?.hide();
  const timeout = setTimeout(() => { backend.kill(); app.exit(0); }, 45000);
  backend.once('exit', () => { clearTimeout(timeout); void externalClosed.finally(()=>app.exit(0)); });
  if (backend.connected) backend.send({ event: 'shutdown' }); else { backend.kill(); app.exit(0); }
});
