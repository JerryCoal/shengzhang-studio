import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { parseAuthorization, matchCallback, allowedLoginPage, createDouyinAuthController } = createRequire(import.meta.url)('../desktop/douyin-auth.cjs');
const nonce = 'a'.repeat(43);
const redirect = 'https://callback.example.test/oauth/douyin';
const authorization = () => 'https://open.douyin.com/platform/oauth/connect/?' + new URLSearchParams({ client_key: 'fake-app', response_type: 'code', scope: 'video.create,video.data,item.comment', redirect_uri: redirect, state: nonce });

test('desktop authorization only accepts official OAuth requests and an exact, one-time-shaped callback', () => {
  const request = parseAuthorization(authorization());
  assert.equal(matchCallback(`${redirect}?state=${nonce}&code=fake-code`, request).callbackUrl, `${redirect}?state=${nonce}&code=fake-code`);
  assert.equal(matchCallback('https://callback.example.test.evil.test/oauth/douyin?state=' + nonce + '&code=code', request), null);
  assert.equal(matchCallback(redirect + '/other?state=' + nonce + '&code=code', request), null);
  for (const suffix of ['?state=wrong&code=code', `?state=${nonce}&state=${nonce}&code=code`, `?state=${nonce}&code=one&code=two`, `?state=${nonce}&code=code#unexpected`, `?state=${nonce}`]) assert.ok(matchCallback(redirect + suffix, request).error);
  for (const url of [authorization().replace('open.douyin.com', 'open.douyin.com.evil.test'), authorization().replace('https:', 'http:'), authorization().replace('/platform/oauth/connect/', '/other/'), authorization() + '&state=duplicate', authorization().replace(encodeURIComponent(redirect), encodeURIComponent('file:///private'))]) assert.throws(() => parseAuthorization(url));
  for (const url of ['https://passport.douyin.com/login', 'https://open.douyin.com/platform/oauth/connect/']) assert.equal(allowedLoginPage(url), true);
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://douyin.com.evil.test/', 'http://open.douyin.com/', 'https://user:password@open.douyin.com/']) assert.equal(allowedLoginPage(url), false);
});

function fakeController({ deferredLoad = false } = {}) {
  const windows = [], partitions = [];
  const session = { fromPartition(name, options) {
    const value = { name, options, webRequest: { onBeforeRequest(handler) { value.beforeRequest = handler; } }, setPermissionRequestHandler(handler) { value.permission = handler; }, setPermissionCheckHandler(handler) { value.permissionCheck = handler; }, async clearStorageData() { value.cleared = true; } };
    partitions.push(value); return value;
  } };
  class FakeWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = handler => { this.popup = handler; }; windows.push(this); }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadURL(url) { this.url = url; if (deferredLoad) return new Promise((_resolve, reject) => { this.rejectLoad = reject; }); }
    show() { this.shown = true; }
    setTitle(title) { this.title = title; }
  }
  return { controller: createDouyinAuthController({ BrowserWindow: FakeWindow, session, getParent: () => ({ id: 'trusted-parent' }) }), windows, partitions };
}
test('isolated desktop login intercepts callback before redirect network request, clears session and never gives remote page a preload', async () => {
  const { controller, windows, partitions } = fakeController();
  const pending = controller.open(authorization()); const authWindow = windows[0], partition = partitions[0];
  assert.equal(authWindow.options.webPreferences.nodeIntegration, false); assert.equal(authWindow.options.webPreferences.sandbox, true); assert.equal(authWindow.options.webPreferences.contextIsolation, true);
  assert.equal(authWindow.options.webPreferences.preload, undefined); assert.ok(!partition.name.startsWith('persist:')); assert.equal(partition.permissionCheck(), false);
  let decision;
  partition.beforeRequest({ resourceType: 'mainFrame', url: `${redirect}?state=${nonce}&code=private-test-code` }, value => { decision = value; });
  assert.deepEqual(decision, { cancel: true });
  assert.deepEqual(await pending, { callbackUrl: `${redirect}?state=${nonce}&code=private-test-code` });
  assert.ok(partition.cleared); assert.ok(authWindow.destroyed); assert.equal(partition.beforeRequest, null);
});
test('desktop login is cancellable and unrelated redirects never return authorization data', async () => {
  const { controller, partitions } = fakeController();
  const first = controller.open(authorization()); controller.cancel(); assert.deepEqual(await first, { cancelled: true });
  const next = controller.open(authorization()); let decision;
  partitions[1].beforeRequest({ resourceType: 'mainFrame', url: 'https://unrelated.example.test/login' }, result => { decision = result; });
  assert.equal(decision.cancel, true); assert.ok((await next).error); assert.ok(partitions[1].cleared);
});
test('intentional callback request cancellation cannot be mistaken for a failed login load', async () => {
  const { controller, windows, partitions } = fakeController({ deferredLoad: true });
  const result = controller.open(authorization());
  partitions[0].beforeRequest({ resourceType: 'mainFrame', url: `${redirect}?state=${nonce}&code=mock-code` }, () => windows[0].rejectLoad(new Error('ERR_ABORTED')));
  assert.equal((await result).callbackUrl, `${redirect}?state=${nonce}&code=mock-code`);
});
