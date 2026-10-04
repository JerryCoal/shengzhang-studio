const { randomUUID } = require('node:crypto');

function parseAuthorization(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('授权地址无效');
  const url = new URL(value);
  if (url.origin !== 'https://open.douyin.com' || !/^\/platform\/oauth\/connect\/?$/.test(url.pathname) || url.username || url.password || url.hash) throw new Error('只能打开抖音官方授权页面');
  for (const key of ['client_key', 'response_type', 'scope', 'redirect_uri', 'state']) if (url.searchParams.getAll(key).length !== 1) throw new Error('授权参数不完整');
  if (url.searchParams.get('response_type') !== 'code' || !/^[A-Za-z0-9_-]{32,100}$/.test(url.searchParams.get('state'))) throw new Error('授权校验参数无效');
  const redirect = new URL(url.searchParams.get('redirect_uri'));
  if (redirect.username || redirect.password || redirect.hash || redirect.search || !(redirect.protocol === 'https:' || (redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)))) throw new Error('回调地址无效');
  return { url, redirect, state: url.searchParams.get('state') };
}
function matchCallback(value, request) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.origin !== request.redirect.origin || url.pathname !== request.redirect.pathname) return null;
  if (url.username || url.password || url.hash || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== request.state) return { error: '授权校验不匹配，请关闭窗口后重试。' };
  if (url.searchParams.has('error') || url.searchParams.has('errCode')) return { callbackUrl: url.href };
  if (url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code') || url.searchParams.get('code').length > 1024) return { error: '抖音未返回有效授权码，请检查应用权限和回调域名。' };
  return { callbackUrl: url.href };
}
function allowedLoginPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && ['douyin.com', 'open-douyin.com', 'bytedance.com', 'snssdk.com', 'toutiao.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}
function createDouyinAuthController({ BrowserWindow, session, getParent }) {
  let current;
  function cancel() { current?.finish({ cancelled: true }); }
  async function open(value) {
    const request = parseAuthorization(value);
    cancel();
    const parent = getParent();
    const isolated = session.fromPartition(`douyin-auth-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    isolated.setPermissionCheckHandler(() => false);
    return new Promise(resolve => {
      const child = new BrowserWindow({ parent, width: 820, height: 820, minWidth: 560, minHeight: 600, show: false, autoHideMenuBar: true, title: '抖音官方授权 · open.douyin.com', webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
      let done = false, intercepted = false;
      const finish = result => {
        if (done) return; done = true;
        clearTimeout(timer);
        isolated.webRequest.onBeforeRequest(null);
        if (!child.isDestroyed()) child.destroy();
        void isolated.clearStorageData().catch(() => {});
        if (current?.child === child) current = undefined;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ error: '授权窗口已超时，请重新连接抖音。' }), 15 * 60000);
      current = { child, finish };
      // Capture only the expected main-frame callback, before any request can send its code to the redirect host.
      isolated.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType === 'mainFrame') {
          const result = matchCallback(details.url, request);
          if (result) { intercepted = true; callback({ cancel: true }); setImmediate(() => finish(result)); return; }
          if (!allowedLoginPage(details.url)) { intercepted = true; callback({ cancel: true }); setImmediate(() => finish({ error: '官方登录跳转需要在浏览器继续，请使用下方授权链接。' })); return; }
        }
        callback({ cancel: false });
      });
      child.webContents.setWindowOpenHandler(({ url }) => {
        const result = matchCallback(url, request);
        if (result) { intercepted = true; setImmediate(() => finish(result)); }
        else if (allowedLoginPage(url)) void child.loadURL(url).catch(() => finish({ error: '内置授权页面未打开，请使用浏览器授权链接。' }));
        return { action: 'deny' };
      });
      child.webContents.on('will-attach-webview', event => event.preventDefault());
      child.webContents.on('did-navigate', (_event, url) => { if (!child.isDestroyed()) child.setTitle(`抖音官方授权 · ${new URL(url).hostname}`); });
      child.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) finish({ error: '抖音登录页面加载失败，可以改用浏览器授权。' }); });
      child.on('closed', () => finish({ cancelled: true }));
      child.once('ready-to-show', () => { if (!done) child.show(); });
      void child.loadURL(request.url.href).catch(() => { if (!done && !intercepted) finish({ error: '内置登录未完成，可以使用浏览器授权链接。' }); });
    });
  }
  return { open, cancel };
}
module.exports = { parseAuthorization, matchCallback, allowedLoginPage, createDouyinAuthController };
