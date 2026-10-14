import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPlatformLogin, allowed } = require('../desktop/platform-login.cjs');
const { createPlatformSessions } = require('../desktop/platform-sessions.cjs');

function sharedSession() {
  const value = new EventEmitter();
  value.clearCount = 0;
  value.setPermissionRequestHandler = handler => { value.permissionRequest = handler; };
  value.setPermissionCheckHandler = handler => { value.permissionCheck = handler; };
  value.clearStorageData = async () => { value.clearCount++; };
  return value;
}
function fixture({ load, constructorError = false } = {}) {
  const windows = [], parent = {};
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      if (constructorError) throw Error('private-constructor-diagnostics');
      this.options = options; this.urls = []; this.destroyed = false; this.destroyCount = 0; this.shown = 0;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = fn => { this.popup = fn; };
      windows.push(this);
    }
    loadURL(url) { this.urls.push(url); return load ? load(url, this) : Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyCount++; this.destroyed = true; this.emit('closed'); }
    show() { this.shown++; }
    userClose() { this.destroyed = true; this.emit('closed'); }
  }
  return { controller: createPlatformLogin({ BrowserWindow, getParent: () => parent }), windows, parent };
}
const preventable = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
function noLoginClaim(result) {
  assert.notEqual(result.success, true); assert.notEqual(result.loggedIn, true); assert.notEqual(result.loginState, 'logged-in');
}

test('platform login permits only the selected official HTTPS domain family without credentials or custom ports', () => {
  for (const url of ['https://creator.xiaohongshu.com/', 'https://www.xiaohongshu.com/']) assert(allowed('xiaohongshu', url));
  for (const url of ['https://creator.douyin.com/', 'https://sso.douyin.com/', 'https://open-douyin.com/', 'https://sso.bytedance.com/', 'https://sso.toutiao.com/']) assert(allowed('douyin', url));
  for (const url of ['http://creator.douyin.com/', 'https://creator.douyin.com:8443/', 'https://user:pass@creator.douyin.com/', 'https://creator.douyin.com.evil.test/', 'https://evil-douyin.com/', 'https://douyin.com@evil.test/', 'https://creator.xiaohongshu.com/', 'javascript:alert(1)', 'file:///C:/private.txt', 'data:text/html,test', 'not-a-url']) assert.equal(allowed('douyin', url), false, url);
  for (const platform of ['unknown', '__proto__', 'toString', undefined, null]) assert.equal(allowed(platform, 'https://creator.douyin.com/'), false);
});

test('login reuses the same profile session, has no privileged preload and does not clear login state when closed', async () => {
  const made = [], authenticated = [];
  const pool = createPlatformSessions({ fromPartition(name) { assert(!name.startsWith('persist:')); const value = sharedSession(); made.push(value); return value; } }, async token => { authenticated.push(token); });
  const session = await pool.acquire('douyin', 'synthetic-profile-session');
  const f = fixture(), pending = f.controller.open('douyin', session), child = f.windows[0];
  assert.equal(child.options.parent, f.parent); assert.equal(child.options.webPreferences.session, session);
  assert.deepEqual(child.options.webPreferences, { session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false });
  assert.deepEqual(child.urls, ['https://creator.douyin.com/']); assert.equal(child.shown, 0);
  child.emit('ready-to-show'); assert.equal(child.shown, 1);
  let granted; session.permissionRequest({}, 'clipboard-read', value => { granted = value; }); assert.equal(granted, false); assert.equal(session.permissionCheck({}, 'notifications'), false);
  child.userClose(); const result = await pending;
  assert.equal(result.closed, true); noLoginClaim(result); assert.match(result.note, /实际登录状态以官方页面为准/);
  const reused = await pool.acquire('douyin', 'synthetic-profile-session'); assert.equal(reused, session); assert.equal(made.length, 1); assert.equal(session.clearCount, 0); assert.equal(session.listenerCount('will-download'), 0); assert.equal(authenticated.length, 2);
  await pool.clear(); assert.equal(session.clearCount, 1);
});

test('login blocks malicious navigations, redirects, popups, embedded webviews and downloads', async () => {
  const f = fixture(), session = sharedSession(), pending = f.controller.open('douyin', session), child = f.windows[0];
  for (const name of ['will-navigate', 'will-redirect']) {
    for (const url of ['https://evil.test/', 'https://creator.douyin.com:8443/', 'file:///C:/private.txt', 'javascript:alert(1)']) {
      const event = preventable(); child.webContents.emit(name, event, url); assert(event.prevented, name + ' ' + url);
    }
    const event = preventable(); child.webContents.emit(name, event, 'https://sso.douyin.com/'); assert.equal(event.prevented, false);
  }
  const originalLoads = child.urls.length;
  assert.deepEqual(child.popup({ url: 'https://evil.test/' }), { action: 'deny' }); assert.equal(child.urls.length, originalLoads);
  assert.deepEqual(child.popup({ url: 'https://sso.douyin.com/login' }), { action: 'deny' }); assert.equal(child.urls.at(-1), 'https://sso.douyin.com/login'); assert.equal(f.windows.length, 1);
  const webview = preventable(); child.webContents.emit('will-attach-webview', webview); assert(webview.prevented);
  const download = preventable(); session.emit('will-download', download); assert(download.prevented);
  f.controller.cancel(); const result = await pending; assert.equal(result.cancelled, true); noLoginClaim(result); assert.equal(child.destroyCount, 1); assert.equal(session.listenerCount('will-download'), 0);
});

test('cancelling or replacing a login closes only that window and resolves once without claiming success', async () => {
  const f = fixture(), session = sharedSession();
  const first = f.controller.open('xiaohongshu', session), firstWindow = f.windows[0];
  const second = f.controller.open('douyin', session), secondWindow = f.windows[1];
  assert.deepEqual(await first, { cancelled: true }); assert.equal(firstWindow.destroyCount, 1); assert.equal(secondWindow.destroyCount, 0);
  firstWindow.emit('ready-to-show'); assert.equal(firstWindow.shown, 0);
  firstWindow.webContents.emit('did-fail-load', {}, -105, 'late failure', '', true); assert.equal(secondWindow.destroyCount, 0);
  f.controller.cancel(); f.controller.cancel(); assert.deepEqual(await second, { cancelled: true }); assert.equal(secondWindow.destroyCount, 1); assert.equal(session.clearCount, 0); assert.equal(session.listenerCount('will-download'), 0);
});

test('invalid platform input cannot cancel an already open login or create a window', async () => {
  const f = fixture(), session = sharedSession(), pending = f.controller.open('douyin', session);
  for (const platform of ['__proto__', 'toString', 'unknown']) await assert.rejects(f.controller.open(platform, session), /不支持的平台/);
  assert.equal(f.windows.length, 1); assert.equal(f.windows[0].destroyCount, 0);
  f.controller.cancel(); await pending;
});

test('initial load failures close the login window and release session listeners without leaking errors', async t => {
  for (const mode of ['promise-rejection', 'synchronous-throw', 'constructor']) await t.test(mode, async () => {
    const f = fixture({ constructorError: mode === 'constructor', load: () => { if (mode === 'synchronous-throw') throw Error('private-load-error'); return Promise.reject(Error('private-load-error')); } });
    const session = sharedSession(), result = await f.controller.open('douyin', session);
    assert(result.error); assert(!JSON.stringify(result).includes('private-')); noLoginClaim(result);
    assert.equal(f.windows[0]?.destroyCount || 0, mode === 'constructor' ? 0 : 1); assert.equal(session.listenerCount('will-download'), 0); assert.equal(session.clearCount, 0);
    f.controller.cancel();
  });
});

test('main-frame load failure and renderer termination close the window; aborts and subframe errors do not', async () => {
  const f = fixture(), session = sharedSession(), pending = f.controller.open('douyin', session), child = f.windows[0];
  child.webContents.emit('did-fail-load', {}, -3, 'redirect aborted previous request', '', true);
  child.webContents.emit('did-fail-load', {}, -105, 'subframe failed', '', false); assert.equal(child.destroyCount, 0);
  child.webContents.emit('did-fail-load', {}, -105, 'private-load-details', '', true); const failed = await pending;
  assert(failed.error); noLoginClaim(failed); assert.equal(child.destroyCount, 1); assert.equal(session.listenerCount('will-download'), 0);
  const next = f.controller.open('douyin', session), other = f.windows[1];
  other.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); const crashed = await next;
  assert(crashed.error); noLoginClaim(crashed); assert.equal(other.destroyCount, 1); assert.equal(session.listenerCount('will-download'), 0);
});

test('a permitted SSO navigation superseding the initial load does not close the login window', async () => {
  let rejectInitial;
  const f = fixture({ load: (_url, child) => child.urls.length === 1 ? new Promise((_resolve, reject) => { rejectInitial = reject; }) : Promise.resolve() });
  const session = sharedSession(), pending = f.controller.open('douyin', session), child = f.windows[0];
  assert.deepEqual(child.popup({ url: 'https://sso.douyin.com/login' }), { action: 'deny' });
  rejectInitial(Object.assign(Error('ERR_ABORTED (-3) loading official page'), { code: 'ERR_ABORTED', errno: -3 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.destroyCount, 0); assert.equal(session.listenerCount('will-download'), 1);
  child.userClose(); const result = await pending; assert.equal(result.closed, true); noLoginClaim(result);
});
