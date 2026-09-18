const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog } = require('electron');
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
const report = event => writeFileSync(reportFile, JSON.stringify({ ...event, at: new Date().toISOString() }));
let window, tray, backend, website = '', quitting = false, shutdownRequested = false, proxyEnabled = false;
function safeExternal(url) { try { const target = new URL(url); if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.href); } catch {} }
async function proxyEnvironment() {
  const env = { ...process.env, NO_PROXY: 'localhost,127.0.0.1,::1', NODE_USE_ENV_PROXY: '1' };
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
  backend = fork(join(__dirname, 'backend.cjs'), [], { execPath: join(process.resourcesPath, 'runtime', 'node.exe'), execArgv: ['--use-env-proxy'], cwd: __dirname, env: { ...env, PORT: '0', STUDIO_DATA_DIR: join(dataRoot, 'data'), STUDIO_STATIC_DIR: join(__dirname, 'dist') }, windowsHide: true, silent: true });
  backend.stdout.resume();
  backend.stderr.on('data', () => { /* Never persist request bodies or credentials in diagnostics. */ });
  backend.on('exit', code => { if (!quitting) { report({ status: 'backend-stopped', code }); if (!smoke) void dialog.showMessageBox({ type: 'error', message: '本地服务已停止', detail: '请退出并重新打开应用。项目数据仍保存在这台电脑。' }); app.quit(); } });
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
      website = await startBackend();
      const icon = nativeImage.createFromPath(join(__dirname, 'dist', 'icon-192.png'));
      window = new BrowserWindow({ width: 1440, height: 940, minWidth: 760, minHeight: 620, show: false, title: '生长 · AI 运营工作台', backgroundColor: '#f6f7f2', icon, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.webContents.setWindowOpenHandler(({ url }) => { safeExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== website) { event.preventDefault(); safeExternal(url); } });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.on('render-process-gone', () => { report({ status: 'renderer-stopped' }); if (!smoke) void dialog.showMessageBox({ type: 'error', message: '页面已停止，请重新打开应用。' }); app.quit(); });
      window.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); window.hide(); } });
      window.webContents.on('did-finish-load', () => {
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
  if (shutdownRequested || !backend || backend.exitCode !== null) { quitting = true; return; }
  event.preventDefault(); quitting = true; shutdownRequested = true; window?.hide();
  const timeout = setTimeout(() => { backend.kill(); app.exit(0); }, 45000);
  backend.once('exit', () => { clearTimeout(timeout); app.exit(0); });
  if (backend.connected) backend.send({ event: 'shutdown' }); else { backend.kill(); app.exit(0); }
});
