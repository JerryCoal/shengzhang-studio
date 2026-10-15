import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
const { createMCPLauncher, probeLocalPort, launcherEnvironment } = createRequire(import.meta.url)('../desktop/mcp-launcher.cjs');
const scopeA = 'a'.repeat(64), scopeB = 'b'.repeat(64);
function fakeChild(pid = 321) {
  const child = new EventEmitter(); Object.assign(child, { pid, exitCode: null, signalCode: null });
  child.stop = () => { child.exitCode = 0; child.emit('exit', 0, null); };
  return child;
}
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'studio-mcp-launch-test-')), exe = join(root, 'service fixture.exe'), calls = [], killed = [];
  writeFileSync(exe, 'synthetic exe; never executed');
  t.after(() => { if (!root.startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup path'); rmSync(root, { recursive: true, force: true }); });
  const launcher = createMCPLauncher({ dataRoot: join(root, 'data'), portProbe: async () => false, environment: { SystemRoot: 'C:/Windows', PATH: 'system-path', STUDIO_MCP_SECRET: 'must-not-inherit', OPENAI_API_KEY: 'must-not-inherit', DOYIN_COOKIE: 'must-not-inherit', DOUYIN_COOKIE: 'must-not-inherit', DOUYIN_COOKIE_FILE: 'old-personal-cookie-file', COOKIES_PATH: 'old-personal-xhs-cookie-file', HTTP_PROXY: 'http://127.0.0.1:7890' },
    spawn: (file, args, options) => { const child = fakeChild(320 + calls.length); calls.push({ file, args, options, child }); queueMicrotask(() => child.emit('spawn')); return child; }, killChild: async child => { killed.push(child); child.stop(); }, startupTimeoutMs: 100, stopTimeoutMs: 100, readyTimeoutMs: 0, pollIntervalMs: 2, ...overrides });
  t.after(() => launcher.stopAll());
  return { launcher, root, exe, calls, killed };
}

test('launcher uses confirmed exe arguments, local HTTP bindings, hidden execution and isolated account directories', async t => {
  const f = fixture(t);
  for (const platform of ['xiaohongshu', 'douyin']) {
    const result = await f.launcher.start({ platform, exePath: f.exe, scope: scopeA });
    const call = f.calls.at(-1), directory = join(f.root, 'data', scopeA, platform);
    assert.equal(call.file, f.exe); assert.deepEqual(call.args, platform === 'xiaohongshu' ? ['-port', '127.0.0.1:18060'] : ['--http', '--host', '127.0.0.1', '--port', '18080']);
    assert.equal(call.options.cwd, directory); assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true); assert.equal(call.options.detached, false); assert.equal(call.options.stdio, 'ignore');
    assert.match(result.apiKey, /^[A-Za-z0-9_-]{43}$/); assert.equal(call.options.env.AUTH_TOKEN, result.apiKey); assert.equal(result.status, 'starting');
    for (const name of ['STUDIO_MCP_SECRET', 'OPENAI_API_KEY', 'DOUYIN_COOKIE', 'DOUYIN_COOKIE_FILE']) assert.equal(call.options.env[name], undefined);
    assert.equal(call.options.env.HTTP_PROXY, 'http://127.0.0.1:7890'); assert.equal(call.options.env.NO_PROXY, 'localhost,127.0.0.1,::1');
    if (platform === 'xiaohongshu') assert.equal(call.options.env.COOKIES_PATH, join(directory, 'cookies.json')); else { assert.equal(call.options.env.COOKIES_PATH, undefined); assert.equal(call.options.env.DOUYIN_DATA_DIR, directory); }
    const shown = JSON.stringify(await f.launcher.status({ scope: scopeA })); assert(!shown.includes(result.apiKey)); assert(!shown.includes(f.exe)); assert(!shown.includes('pid'));
  }
});

test('occupied ports never trigger process execution or termination and unknown processes cannot be stopped', async t => {
  const f = fixture(t, { portProbe: async () => true });
  await assert.rejects(f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA }), /18080.*占用/);
  assert.equal(f.calls.length, 0); assert.equal(f.killed.length, 0);
  await f.launcher.stop({ platform: 'douyin', scope: scopeA }); await f.launcher.stopAll(); assert.equal(f.killed.length, 0);
});

test('paths must be local absolute exe files, profile identifiers cannot escape data directories', async t => {
  const f = fixture(t);
  for (const path of ['relative.exe', 'https://example.com/tool.exe', join(f.root, 'archive.zip'), join(f.root, 'missing.exe'), '\\server\share\tool.exe']) await assert.rejects(f.launcher.start({ platform: 'douyin', exePath: path, scope: scopeA }));
  for (const scope of ['../data', '', 'a'.repeat(65), 'sk-secret']) await assert.rejects(f.launcher.start({ platform: 'douyin', exePath: f.exe, scope }));
  await assert.rejects(f.launcher.start({ platform: 'other', exePath: f.exe, scope: scopeA })); assert.equal(f.calls.length, 0);
});

test('choosing a known login helper or the other platform program fails before execution', async t => {
  const f = fixture(t);
  for (const [platform, filename, expected] of [
    ['xiaohongshu', 'xiaohongshu-login-windows-amd64.exe', /登录工具.*xiaohongshu-mcp-windows-amd64/],
    ['xiaohongshu', 'XIAOHONGSHU-LOGIN-WINDOWS-AMD64 (1).exe', /登录工具/],
    ['douyin', 'xiaohongshu-mcp-windows-amd64.exe', /小红书程序.*douyin-publish-mcp/],
    ['xiaohongshu', 'douyin-publish-mcp.exe', /抖音程序.*xiaohongshu-mcp/],
  ]) {
    const exePath = join(f.root, filename); writeFileSync(exePath, 'synthetic fixture; never executed');
    await assert.rejects(f.launcher.start({ platform, exePath, scope: scopeA }), expected);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.killed.length, 0);
  const valid = join(f.root, 'xiaohongshu-mcp-windows-amd64 (1).exe'); writeFileSync(valid, 'synthetic fixture; never executed');
  await f.launcher.start({ platform: 'xiaohongshu', exePath: valid, scope: scopeA });
  assert.equal(f.calls.length, 1);
});

test('changing profiles stops only owned children and never exposes previous profile status', async t => {
  const f = fixture(t); await f.launcher.start({ platform: 'xiaohongshu', exePath: f.exe, scope: scopeA });
  const otherView = await f.launcher.status({ scope: scopeB }); assert(otherView.every(item => item.managed === false && item.status === 'stopped'));
  await f.launcher.stop({ platform: 'xiaohongshu', scope: scopeB }); assert.equal(f.killed.length, 0);
  await f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeB }); assert.deepEqual(f.killed, [f.calls[0].child]);
  assert.equal((await f.launcher.status({ scope: scopeB, platform: 'douyin' }))[0].managed, true);
  await f.launcher.stopAll(); assert.equal(f.killed.length, 2);
});

test('start and status distinguish process startup, port readiness and unexpected exit without raw logs', async t => {
  let occupied = false; const f = fixture(t, { portProbe: async () => occupied });
  await f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA });
  assert.equal((await f.launcher.status({ scope: scopeA, platform: 'douyin' }))[0].status, 'starting');
  occupied = true; let state = (await f.launcher.status({ scope: scopeA, platform: 'douyin' }))[0]; assert.equal(state.status, 'running'); assert.match(state.note, /登录仍需单独/);
  await assert.rejects(f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA }), /已由工作台启动/);
  f.calls[0].child.stop(); state = (await f.launcher.status({ scope: scopeA, platform: 'douyin' }))[0]; assert.equal(state.status, 'failed'); assert.equal(state.managed, false); assert(!JSON.stringify(state).includes(f.exe));
});

test('logout cancels pending preparation before executing a selected program', async t => {
  let release, entered; const checking = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { validateExecutable: async file => { entered(); await new Promise(resolve => { release = resolve; }); return file; } });
  const starting = f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA }); await checking;
  await f.launcher.stopAll(); release(); await assert.rejects(starting, /登录.*变化/); assert.equal(f.calls.length, 0);
});

test('spawn failure and stop failure are safe and cannot report a still-running service as stopped', async t => {
  const first = fixture(t, { spawn: () => { throw Error('private absolute path and cookie marker'); } });
  await assert.rejects(first.launcher.start({ platform: 'douyin', exePath: first.exe, scope: scopeA }), error => !error.message.includes('private') && /无法启动/.test(error.message));
  let blocked = true;
  const second = fixture(t, { killChild: async child => { if (blocked) throw Error('private process details'); child.stop(); } });
  await second.launcher.start({ platform: 'douyin', exePath: second.exe, scope: scopeA });
  await assert.rejects(second.launcher.stop({ platform: 'douyin', scope: scopeA }), /未能确认/);
  assert.equal((await second.launcher.status({ scope: scopeA, platform: 'douyin' }))[0].managed, true);
  await assert.rejects(second.launcher.start({ platform: 'xiaohongshu', exePath: second.exe, scope: scopeB }), /尚未确认停止/);
  blocked = false; await second.launcher.stopAll();
});

test('asynchronous executable rejection and startup timeout do not leave a false running service', async t => {
  const broken = fixture(t, { spawn: () => { const child = fakeChild(); queueMicrotask(() => child.emit('error', Object.assign(Error('private filename'), { code: 'ENOENT' }))); return child; } });
  await assert.rejects(broken.launcher.start({ platform: 'douyin', exePath: broken.exe, scope: scopeA }), /未能启动/);
  assert.equal((await broken.launcher.status({ scope: scopeA, platform: 'douyin' }))[0].managed, false);
  let killed = false; const waiting = fixture(t, { spawn: () => fakeChild(), startupTimeoutMs: 10, killChild: async child => { killed = true; child.stop(); } });
  await assert.rejects(waiting.launcher.start({ platform: 'xiaohongshu', exePath: waiting.exe, scope: scopeA }), /未能启动/);
  assert.equal(killed, true); assert.equal((await waiting.launcher.status({ scope: scopeA, platform: 'xiaohongshu' }))[0].managed, false);
});

test('launcher waits for the local listener before returning ready without calling platform tools', async t => {
  let probes = 0;
  const f = fixture(t, { readyTimeoutMs: 100, pollIntervalMs: 2, portProbe: async (_port, _timeout, readiness) => { probes++; return readiness && probes >= 4; } });
  const result = await f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA });
  assert.equal(result.ready, true); assert.equal(result.status, 'running'); assert.match(result.note, /登录仍需单独/); assert.equal(probes, 4); assert.equal(f.killed.length, 0);
});

test('readiness timeout preserves the live service and authentication for a later check', async t => {
  const f = fixture(t, { readyTimeoutMs: 15, pollIntervalMs: 2 });
  const result = await f.launcher.start({ platform: 'xiaohongshu', exePath: f.exe, scope: scopeA });
  assert.equal(result.ok, true); assert.equal(result.ready, false); assert.equal(result.status, 'starting'); assert.equal(result.managed, true); assert.match(result.note, /稍候.*检查连接/); assert.equal(f.killed.length, 0);
  assert.equal(result.apiKey, f.calls[0].options.env.AUTH_TOKEN); assert.equal((await f.launcher.status({ scope: scopeA, platform: 'xiaohongshu' }))[0].managed, true);
});

test('logout during readiness polling cancels the result and stops only the owned process', async t => {
  let began; const checking = new Promise(accept => { began = accept; });
  const f = fixture(t, { readyTimeoutMs: 100, pollIntervalMs: 2, portProbe: async (_port, _timeout, readiness) => { if (readiness) began(); return false; } });
  const pending = f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA }); await checking;
  const rejected = assert.rejects(pending, /登录.*变化/); await f.launcher.stopAll(); await rejected;
  assert.equal(f.killed.length, 1); assert.equal((await f.launcher.status({ scope: scopeB, platform: 'douyin' }))[0].managed, false);
});

test('a program that exits while waiting for its port reports startup failure instead of ready', async t => {
  let child;
  const f = fixture(t, { readyTimeoutMs: 100, pollIntervalMs: 2, spawn: () => { child = fakeChild(); queueMicrotask(() => child.emit('spawn')); return child; }, portProbe: async (_port, _timeout, readiness) => { if (readiness) child.stop(); return false; } });
  await assert.rejects(f.launcher.start({ platform: 'douyin', exePath: f.exe, scope: scopeA }), /外部程序已退出/);
  const result = (await f.launcher.status({ scope: scopeA, platform: 'douyin' }))[0]; assert.equal(result.ready, false); assert.equal(result.managed, false); assert.equal(f.killed.length, 0);
});

test('local port probe observes a listener without making any HTTP or platform request', async t => {
  const server = createServer(socket => socket.end()); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
  t.after(() => server.close()); assert.equal(await probeLocalPort(port), true);
  await new Promise(resolve => server.close(resolve)); assert.equal(await probeLocalPort(port), false);
  const env = launcherEnvironment({ AUTH_TOKEN: 'old', DASHSCOPE_API_KEY: 'old', Path: 'runtime-path', HOME: 'private-home' }, 'douyin', 'profile-directory', 'new-token');
  assert.equal(env.AUTH_TOKEN, 'new-token'); assert.equal(env.Path, 'runtime-path'); assert.equal(env.DASHSCOPE_API_KEY, undefined); assert.equal(env.HOME, undefined);
});

test('separate platform accounts retain distinct directories, ports and existing login data across launcher restart',async t=>{
  const f=fixture(t),first=await f.launcher.start({platform:'xiaohongshu',scope:scopeA,exePath:f.exe,accountId:'default'});
  const legacyDirectory=f.calls[0].options.cwd,fixtureBytes='synthetic-session-marker-not-real-cookies';writeFileSync(join(legacyDirectory,'cookies.json'),fixtureBytes);
  const second=await f.launcher.start({platform:'xiaohongshu',scope:scopeA,exePath:f.exe,accountId:'campus'});const secondDirectory=f.calls[1].options.cwd;
  assert.notEqual(first.endpoint,second.endpoint);assert.notEqual(legacyDirectory,secondDirectory);assert.equal(secondDirectory,join(legacyDirectory,'accounts','campus'));
  assert.equal(f.calls[0].options.env.TEMP,join(legacyDirectory,'temp'));assert.equal(f.calls[1].options.env.COOKIES_PATH,join(secondDirectory,'cookies.json'));assert.equal(readFileSync(join(legacyDirectory,'cookies.json'),'utf8'),fixtureBytes);
  await f.launcher.stop({platform:'xiaohongshu',scope:scopeA,accountId:'campus'});assert.equal((await f.launcher.status({platform:'xiaohongshu',scope:scopeA,accountId:'default'}))[0].managed,true);
  await f.launcher.stopAll();const calls=[];const restarted=createMCPLauncher({dataRoot:join(f.root,'data'),portProbe:async()=>false,readyTimeoutMs:0,spawn:(file,args,options)=>{const child=fakeChild();calls.push({file,args,options,child});queueMicrotask(()=>child.emit('spawn'));return child;},killChild:async child=>child.stop()});t.after(()=>restarted.stopAll());
  const status=(await restarted.status({platform:'xiaohongshu',scope:scopeA}))[0];assert.equal(status.programSaved,true);assert.equal(status.loginDataPresent,true);assert.equal(status.managed,false);assert(!JSON.stringify(status).includes(f.exe));assert(!JSON.stringify(status).includes(fixtureBytes));
  const resumed=await restarted.start({platform:'xiaohongshu',scope:scopeA});assert.equal(calls[0].file,f.exe);assert.equal(calls[0].options.cwd,legacyDirectory);assert.equal(resumed.endpoint,first.endpoint);assert.equal(readFileSync(join(legacyDirectory,'cookies.json'),'utf8'),fixtureBytes);
  const resumedSecond=await restarted.start({platform:'xiaohongshu',scope:scopeA,accountId:'campus'});assert.equal(resumedSecond.endpoint,second.endpoint);assert.equal(calls[1].options.cwd,secondDirectory);
  for(const accountId of ['../other','A B','', 'x'.repeat(65)])await assert.rejects(restarted.start({platform:'xiaohongshu',scope:scopeA,accountId,exePath:f.exe}));
});

test('new account allocation reserves inactive saved ports and never borrows another user program',async t=>{
  const f=fixture(t);const old=await f.launcher.start({platform:'xiaohongshu',scope:scopeA,accountId:'one',exePath:f.exe});await f.launcher.stopAll();
  const launcher=createMCPLauncher({dataRoot:join(f.root,'data'),portProbe:async()=>false,readyTimeoutMs:0,spawn:()=>{const child=fakeChild();queueMicrotask(()=>child.emit('spawn'));return child;},killChild:async child=>child.stop()});t.after(()=>launcher.stopAll());
  const next=await launcher.start({platform:'xiaohongshu',scope:scopeA,accountId:'two',exePath:f.exe});assert.notEqual(next.endpoint,old.endpoint);
  const other=(await launcher.status({platform:'xiaohongshu',scope:scopeB,accountId:'one'}))[0];assert.equal(other.programSaved,false);assert.equal(other.loginDataPresent,false);await assert.rejects(launcher.start({platform:'xiaohongshu',scope:scopeB,accountId:'one'}),/请选择/);
});
