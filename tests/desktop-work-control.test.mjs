import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

// These are source-contract tests and small pure-helper executions, not an
// Electron launch, an OS notification test, or renderer-crash acceptance.
const source = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const windows = readFileSync(new URL('../server/windows.mjs', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../src/pages/WorkControl.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function find(predicate) {
  let found;
  const visit = node => { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); };
  visit(ast); assert.ok(found, 'Expected desktop source contract was not found'); return found;
}
const declaration = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).initializer.getText(ast);
const handler = (method, channel) => find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.' + method && node.arguments[0]?.text === channel).arguments[1].getText(ast);
const functionText = name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);

test('desktop source helper accepts only the current main renderer at the exact local origin', () => {
  const body = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'trustedRenderer').getText(ast);
  const frame = { url: 'http://127.0.0.1:4319/#tasks' }, contents = { mainFrame: frame };
  const context = vm.createContext({ window: { webContents: contents }, website: 'http://127.0.0.1:4319', URL });
  vm.runInContext(body + '; globalThis.check = trustedRenderer;', context);
  assert.equal(context.check({ sender: contents, senderFrame: frame }), true);
  assert.equal(context.check({ sender: {}, senderFrame: frame }), false);
  assert.equal(context.check({ sender: contents, senderFrame: { url: frame.url } }), false);
  frame.url = 'https://127.0.0.1:4319/';
  assert.equal(context.check({ sender: contents, senderFrame: frame }), false);
  frame.url = 'http://127.0.0.1.example.test:4319/';
  assert.equal(context.check({ sender: contents, senderFrame: frame }), false);
  context.window = null;
  assert.equal(context.check({ sender: contents, senderFrame: frame }), false);
  assert.equal(context.check(undefined), false);
});

test('desktop legacy task-state bridge rejects untrusted senders and invalid counts', () => {
  const context = vm.createContext({ taskState: { active: 0, paused: 0 }, taskBridgeActive: false, trustedRenderer: event => event?.trusted === true });
  vm.runInContext('globalThis.update = ' + handler('on', 'studio:task-state'), context);
  context.update({ trusted: false }, { active: 7, paused: 2 });
  assert.equal(context.taskState.active, 0);
  context.update({ trusted: true }, { active: 3, paused: 1 });
  assert.equal(context.taskState.active, 3); assert.equal(context.taskBridgeActive, true);
  for (const value of [{ active: -1, paused: 0 }, { active: 257, paused: 0 }, { active: 1.5, paused: 0 }, { active: 1, paused: 2 }, { active: NaN, paused: 0 }]) context.update({ trusted: true }, value);
  assert.equal(context.taskState.active, 3);
  context.update({ trusted: true }, { active: 0, paused: 0, connected: false });
  assert.equal(context.taskBridgeActive, false);
});

test('desktop background counts remain independent from renderer-reported legacy counts', () => {
  const context = vm.createContext({ taskState: { active: 2, paused: 0 }, workProgress: new Map([['owner-a', { active: 3 }], ['owner-b', { active: 1 }]]) });
  vm.runInContext('const backendTaskCount = ' + declaration('backendTaskCount') + '; const totalTaskCount = ' + declaration('totalTaskCount') + '; globalThis.count = totalTaskCount;', context);
  assert.equal(context.count(), 6);
  context.taskState = { active: 0, paused: 0 };
  assert.equal(context.count(), 4);
  context.workProgress.set('owner-a', { active: 0 });
  assert.equal(context.count(), 1);
  assert.match(windows, /process\.send\(\{\s*event:\s*'work-progress'/);
  assert.match(source, /backend\.on\('message'/);
  assert.match(source, /message\?\.event === 'work-progress'/);
  assert.doesNotMatch(source, /ipcMain\.(?:on|handle)\('(?:studio:)?work-progress'/);
});

test('desktop notification bridge uses a server-authorized opaque ID and generic lock-screen text', () => {
  const notify = handler('handle', 'studio:work-notify');
  assert.match(notify, /trustedRenderer\(event\)/);
  assert.match(notify, /encodeURIComponent\(args\.notificationId\)/);
  assert.match(notify, /record\.id !== args\.notificationId/);
  assert.match(notify, /notificationId:\s*record\.id/);
  assert.doesNotMatch(notify, /args\.(?:title|body|url|taskId|artifactId|artifactVersion)/);
  assert.doesNotMatch(notify, /(?:title|body):\s*record\./);
  assert.match(frontend, /api<\{\s*notification:\s*WorkNotification\s*\}>\(/);
  assert.match(frontend, /destination\.artifactVersion/);
  assert.match(frontend, /isCurrent\(\)/);
});

test('desktop preload exposes bounded work actions rather than a generic IPC sender', () => {
  for (const name of ['notifyWork', 'onWorkNotification', 'onPrepareQuit', 'confirmTaskSave']) assert.ok(preload.includes(name));
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  assert.match(preload, /removeListener\('studio:work-notification'/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
});

test('desktop save acknowledgement is accepted only from the trusted main renderer', () => {
  const received = [], context = vm.createContext({ trustedRenderer: event => event?.trusted === true, resolveTaskSave: value => received.push(value) });
  vm.runInContext('globalThis.confirm = ' + handler('handle', 'studio:task-save-confirmed'), context);
  context.confirm({ trusted: false }, { saved: true });
  assert.deepEqual(received, []);
  context.confirm({ trusted: true }, { saved: 'true' });
  context.confirm({ trusted: true }, { saved: true });
  assert.deepEqual(received, [false, true]);
});

test('native notification helper confirms only show and fails closed on failed, close, throw or timeout', async () => {
  for (const outcome of ['show', 'failed', 'close', 'throw', 'timeout']) {
    let timer, cleared = false;
    const context = vm.createContext({ setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { cleared = true; } });
    vm.runInContext(functionText('nativeNotification') + ';globalThis.display = nativeNotification;', context);
    const notice = new EventEmitter();
    notice.show = () => { if (outcome === 'throw') throw Error('synthetic notification failure'); if (outcome !== 'timeout') notice.emit(outcome); };
    const result = context.display(notice);
    if (outcome === 'timeout') timer();
    assert.equal(await result, outcome === 'show');
    assert.equal(cleared, true);
    assert.equal(notice.listenerCount('show') + notice.listenerCount('failed') + notice.listenerCount('close'), 0);
  }
});

test('desktop notification delivery requires native show; failures can be retried and click sends no private target text', async () => {
  let outcome = 'failed', deliveries = 0, showedWindow = 0;
  const instances = [], sent = [];
  class SyntheticNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; instances.push(this); }
    show() { this.emit(outcome); }
    close() { this.emit('close'); }
  }
  const context = vm.createContext({
    trustedRenderer: event => event?.trusted === true, Notification: SyntheticNotification,
    launchEpoch: 0, rendererReady: true, workNotifications: new Map(), website: 'http://127.0.0.1:4319',
    AbortSignal, setTimeout, clearTimeout, showWindow: () => { showedWindow++; },
    window: { webContents: { send: (channel, value) => sent.push({ channel, ...value }) } },
    fetch: async (_url, options) => {
      if (options.method === 'POST') { deliveries++; assert.deepEqual(JSON.parse(options.body), { delivered: true }); return { ok: true }; }
      return { ok: true, json: async () => ({ notification: { id: 'notification-1', title: 'PRIVATE_TITLE', target: { taskId: 'PRIVATE_TASK' } } }) };
    },
  });
  vm.runInContext(functionText('nativeNotification') + ';globalThis.notify = ' + handler('handle', 'studio:work-notify'), context);
  const args = { notificationId: 'notification-1', sessionToken: 'SYNTHETIC_SESSION', sound: true };
  assert.equal((await context.notify({ trusted: false }, args)).delivered, false);
  assert.equal(instances.length, 0);
  assert.equal((await context.notify({ trusted: true }, args)).delivered, false);
  assert.equal(deliveries, 0); assert.equal(context.workNotifications.size, 0);
  outcome = 'show';
  assert.equal((await context.notify({ trusted: true }, args)).delivered, true);
  assert.equal(deliveries, 1); assert.equal(context.workNotifications.size, 1);
  assert.doesNotMatch(JSON.stringify(instances.at(-1).options), /PRIVATE|SYNTHETIC/);
  instances.at(-1).emit('click');
  assert.equal(showedWindow, 1);
  assert.deepEqual(sent, [{ channel: 'studio:work-notification', notificationId: 'notification-1' }]);
  context.launchEpoch++;
  instances.at(-1).emit('click');
  assert.equal(sent.length, 1, 'an old-login or old-renderer notice cannot route into the new session');
  instances.at(-1).close();
  assert.equal(context.workNotifications.size, 0);
});

test('renderer-crash handler retains backend counts and offers reload or background without quitting', async () => {
  const callback = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'window.webContents.on' && node.arguments[0]?.text === 'render-process-gone').arguments[1].getText(ast);
  let quit = 0, hidden = 0, reloaded = 0, prompt;
  const context = vm.createContext({ launchEpoch: 0, rendererReady: true, taskBridgeActive: true, taskState: { active: 1, paused: 0 }, resolveTaskSave: undefined, smoke: false, backendTaskCount: () => 3, report() {}, app: { quit() { quit++; } }, window: { isDestroyed: () => false, hide: () => { hidden++; } }, reloadWorkspace: () => { reloaded++; }, dialog: { showMessageBox: async options => { prompt = options; return { response: 1 }; } } });
  vm.runInContext('globalThis.crash = ' + callback, context);
  context.crash(); await Promise.resolve(); await Promise.resolve();
  assert.equal(quit, 0); assert.equal(hidden, 1); assert.equal(reloaded, 0);
  assert.equal(context.backendTaskCount(), 3); assert.equal(context.rendererReady, false);
  assert.match(prompt.message, /后台服务仍在运行/); assert.equal(prompt.defaultId, 0);
});

test('dead renderer quit warns about unconfirmed input, defaults to reload and exits only on explicit choice', async () => {
  for (const response of [0, 1, 2]) {
    let quit = 0, reload = 0, prompt;
    const context = vm.createContext({ rendererReady: false, quitApproved: false, dialog: { showMessageBox: async options => { prompt = options; return { response }; } }, reloadWorkspace: () => { reload++; }, app: { quit: () => { quit++; } } });
    vm.runInContext(functionText('saveBeforeQuit') + ';globalThis.save = saveBeforeQuit;', context);
    assert.equal(await context.save(), response === 1);
    assert.equal(quit, response === 1 ? 1 : 0); assert.equal(reload, response === 0 ? 1 : 0);
    assert.equal(context.quitApproved, response === 1);
    assert.match(prompt.message, /未保存输入无法确认/);
    assert.equal(prompt.defaultId, 0); assert.equal(prompt.cancelId, 2);
  }
});

test('a crashed renderer with zero backend tasks still reaches the explicit unsaved-input quit check', async () => {
  const callback = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'app.on' && node.arguments[0]?.text === 'before-quit').arguments[1].getText(ast);
  let prevented = 0, checked = 0;
  const context = vm.createContext({ smoke: false, quitApproved: false, totalTaskCount: () => 0, shutdownRequested: false, rendererReady: false, rendererCrashed: true, taskBridgeActive: false, window: { isDestroyed: () => false }, quitPrompt: false, saveBeforeQuit: async () => { checked++; } });
  vm.runInContext('globalThis.quit = ' + callback, context);
  context.quit({ preventDefault: () => { prevented++; } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(prevented, 1); assert.equal(checked, 1);
  assert.equal(context.quitPrompt, false);
});

test('backend progress IPC bounds owner identifiers and removes inactive owner entries', () => {
  const callback = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'backend.on' && node.arguments[0]?.text === 'message').arguments[1].getText(ast);
  const progress = new Map();
  const context = vm.createContext({ workProgress: progress, tray: { setToolTip() {} }, backendTaskCount: () => [...progress.values()].reduce((total, value) => total + value.active, 0) });
  vm.runInContext('globalThis.progress = ' + callback, context);
  for (const ownerId of ['', 'x'.repeat(161), null]) context.progress({ event: 'work-progress', ownerId, active: 4 });
  context.progress({ event: 'work-progress', ownerId: 'owner-a', active: NaN });
  assert.equal(progress.size, 0);
  context.progress({ event: 'work-progress', ownerId: 'owner-a', active: 4 });
  assert.equal(context.backendTaskCount(), 4);
  context.progress({ event: 'work-progress', ownerId: 'owner-a', active: 0, paused: 8 });
  assert.equal(progress.size, 0);
});
