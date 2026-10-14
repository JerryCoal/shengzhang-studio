const { spawn: spawnProcess, execFile } = require('node:child_process');
const { stat, realpath, mkdir } = require('node:fs/promises');
const { isAbsolute, extname, basename, join, resolve, relative, sep } = require('node:path');
const { connect } = require('node:net');
const { randomBytes } = require('node:crypto');

// Only the upstream HTTP launch modes are supported. No shell, commands from
// the renderer, downloads, credential discovery or unknown-process shutdown.
const PRESETS = {
  xiaohongshu: { port: 18060, label: '小红书', args: ['-port', '127.0.0.1:18060'] },
  douyin: { port: 18080, label: '抖音', args: ['--http', '--host', '127.0.0.1', '--port', '18080'] },
};
function validInput(platform, scope) {
  if (!Object.hasOwn(PRESETS, platform) || typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope)) throw Error('请重新登录工作台后选择对应平台');
}
function contained(root, child) { const name = relative(root, child); return name === '' || (name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name)); }
async function executablePath(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || /^\\\\/.test(input) || extname(input).toLowerCase() !== '.exe' || /[\0\r\n]/.test(input)) throw Error('请选择已下载到本机并解压的 MCP .exe 主程序，不能选择快捷方式、压缩包或网址');
  try { const actual = await realpath(input); if (extname(actual).toLowerCase() !== '.exe' || !(await stat(actual)).isFile()) throw Error(); return actual; }
  catch { throw Error('找不到所选 MCP 程序，请先解压下载文件，再重新选择 .exe 主程序'); }
}
function checkProgramChoice(platform, executable) {
  const name = basename(executable).toLowerCase();
  if (/^xiaohongshu-login(?:[-. (]|$)/.test(name)) throw Error('你选择的是小红书登录工具。请改选 xiaohongshu-mcp-windows-amd64.exe；启动后在工作台获取登录二维码。');
  if (platform === 'xiaohongshu' && /^douyin-publish-mcp(?:[-. (]|$)/.test(name)) throw Error('你选择的是抖音程序。请在小红书卡片选择 xiaohongshu-mcp-windows-amd64.exe。');
  if (platform === 'douyin' && /^xiaohongshu-mcp(?:[-. (]|$)/.test(name)) throw Error('你选择的是小红书程序。请在抖音卡片选择 douyin-publish-mcp.exe。');
}
async function privateDirectory(root, scope, platform) {
  await mkdir(root, { recursive: true, mode: 0o700 }); const rootReal = await realpath(root);
  const scoped = join(rootReal, scope); await mkdir(scoped, { recursive: true, mode: 0o700 }); const scopeReal = await realpath(scoped);
  if (!contained(rootReal, scopeReal)) throw Error('外部服务数据目录无效，请检查本地应用目录');
  const directory = join(scopeReal, platform); await mkdir(directory, { recursive: true, mode: 0o700 }); const actual = await realpath(directory);
  if (!contained(scopeReal, actual)) throw Error('外部服务数据目录无效，请检查本地应用目录');
  return actual;
}
function launcherEnvironment(source, platform, directory, token) {
  const env = {};
  // Carry only OS/runtime and network settings; never inherit the application's
  // AI keys, transport token, personal cookies or external tool account paths.
  const allowed = /^(?:systemroot|windir|comspec|path|pathext|temp|tmp|userprofile|localappdata|appdata|homedrive|homepath|programdata|programfiles(?:\(x86\))?|commonprogramfiles(?:\(x86\))?|number_of_processors|processor_architecture|os|http_proxy|https_proxy|all_proxy|ssl_cert_file|ssl_cert_dir)$/i;
  for (const [name, value] of Object.entries(source)) if (allowed.test(name) && typeof value === 'string') env[name] = value;
  env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1,::1';
  env.AUTH_TOKEN = token;
  if (platform === 'xiaohongshu') env.COOKIES_PATH = join(directory, 'cookies.json');
  else { env.DOUYIN_DATA_DIR = directory; env.DOUYIN_DEBUG = '0'; }
  return env;
}
function probeLocalPort(port, timeoutMs = 700, forReadiness = false) {
  return new Promise(resolveProbe => {
    const socket = connect({ host: '127.0.0.1', port }); let settled = false;
    const finish = value => { if (settled) return; settled = true; socket.destroy(); resolveProbe(value); };
    socket.setTimeout(timeoutMs); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(!forReadiness));
  });
}
function killOwnedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') { child.kill(); return Promise.resolve(); }
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return Promise.reject(Error('无法确认所启动服务的进程'));
  // /T includes the PyInstaller onefile child and browser children of this exact
  // process. No executable-name or port-based termination is ever performed.
  const tool = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe');
  return new Promise((accept, reject) => execFile(tool, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, encoding: 'utf8', maxBuffer: 65536 }, error => error && child.exitCode === null && child.signalCode === null ? reject(Error('服务尚未停止')) : accept()));
}

function createMCPLauncher({ dataRoot, spawn = spawnProcess, portProbe = probeLocalPort, validateExecutable = executablePath, ensureDirectory = privateDirectory, killChild = killOwnedChild, environment = process.env, startupTimeoutMs = 15000, stopTimeoutMs = 7000, readyTimeoutMs = 10000, pollIntervalMs = 200 } = {}) {
  if (typeof dataRoot !== 'string' || !isAbsolute(dataRoot)) throw Error('需要本机外部服务数据目录');
  if (!Number.isFinite(readyTimeoutMs) || readyTimeoutMs < 0 || readyTimeoutMs > 10000 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw Error('外部服务等待时间设置无效');
  const root = resolve(dataRoot), records = new Map(); let busy = false, epoch = 0, owner = '';
  const endpoint = platform => `http://127.0.0.1:${PRESETS[platform].port}/mcp`;
  const visible = (platform, scope) => {
    const item = records.get(platform), own = item?.scope === scope;
    return { platform, endpoint: endpoint(platform), status: own ? item.status : 'stopped', managed: !!(own && item.alive), ready: !!(own && item.alive && item.status === 'running'), note: own ? item.note : '尚未由工作台启动外部服务。' };
  };
  async function waitUntilListening(item, current) {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      current(); if (!item.alive) throw Error(item.note);
      const remaining = Math.max(1, deadline - Date.now()); let timer;
      const listening = await Promise.race([
        Promise.resolve().then(() => portProbe(PRESETS[item.platform].port, Math.min(700, remaining), true)).catch(() => false),
        new Promise(accept => { timer = setTimeout(() => accept(false), remaining); }),
      ]).finally(() => clearTimeout(timer));
      current(); if (!item.alive) throw Error(item.note);
      if (listening) {
        item.status = 'running'; item.note = '本机端口已就绪；请检查 MCP 连接，平台登录仍需单独完成。'; return true;
      }
      const delay = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
      if (delay) await new Promise(accept => setTimeout(accept, delay));
    }
    current(); if (!item.alive) throw Error(item.note);
    item.status = 'starting'; item.note = '外部程序仍在准备本机服务，已保留运行。首次启动可能需要准备浏览器，请稍候再点“检查连接”，无需重复启动。';
    return false;
  }
  async function stopRecord(item) {
    if (!item?.alive) return;
    if (item.stopping) return item.stopping;
    item.stopping = (async () => {
      item.status = 'stopping'; item.note = '正在停止工作台启动的外部服务。'; item.stopRequested = true;
      let finish, timer, onExit;
      const exited = new Promise(accept => { finish = accept; timer = setTimeout(() => accept(false), stopTimeoutMs); onExit = () => accept(true); item.child.once('exit', onExit); });
      try {
        await killChild(item.child);
        if (!item.alive) finish(true);
        if (!(await exited)) throw Error('未能确认服务已停止');
        item.token = '';
      } catch {
        item.status = 'failed'; item.note = '未能确认此服务已停止，请关闭对应的外部服务后再试。';
        throw Error(item.note);
      } finally { clearTimeout(timer); item.child.off('exit', onExit); item.stopping = null; }
    })();
    return item.stopping;
  }
  async function stopAll() {
    epoch++; owner = '';
    const stopped = await Promise.allSettled([...records.values()].map(stopRecord));
    if (stopped.some(result => result.status === 'rejected')) throw Error('部分由工作台启动的外部服务尚未确认停止，请手动关闭对应程序。');
    return { ok: true, note: '已停止由工作台启动的外部服务；其他程序未受影响。' };
  }
  async function start({ platform, exePath, scope } = {}) {
    validInput(platform, scope);
    if (busy) throw Error('另一项外部服务启动操作正在进行，请稍后再试');
    busy = true; let ticket = epoch, item;
    const current = () => { if (ticket !== epoch) throw Error('工作台登录或启动操作已变化，请重新操作'); };
    try {
      const executable = await validateExecutable(exePath); current();
      checkProgramChoice(platform, executable);
      if ((owner && owner !== scope) || [...records.values()].some(record => record.alive && record.scope !== scope)) { const transition = epoch + 1; await stopAll(); if (epoch !== transition) throw Error('工作台登录已变化，请重新操作'); ticket = transition; }
      current(); owner = scope;
      const previous = records.get(platform);
      if (previous?.alive) throw Error('此平台外部服务已由工作台启动，请检查连接；需要更换程序时先停止服务');
      if (await portProbe(PRESETS[platform].port)) throw Error(`${PRESETS[platform].label}本机端口 ${PRESETS[platform].port} 已被占用。请先检查已有服务，或自行关闭旧服务后再启动；工作台不会结束未知程序。`);
      current();
      const directory = await ensureDirectory(root, scope, platform); current();
      const token = randomBytes(32).toString('base64url');
      let child;
      try { child = spawn(executable, [...PRESETS[platform].args], { cwd: directory, env: launcherEnvironment(environment, platform, directory, token), windowsHide: true, shell: false, detached: false, stdio: 'ignore' }); }
      catch { throw Error('无法启动外部 MCP 服务，请重新选择已解压的主程序'); }
      item = { platform, scope, child, token, alive: true, spawned: false, status: 'starting', note: '程序已启动，正在准备本机服务；仍需检查连接并完成平台登录。', stopping: null, stopRequested: false };
      records.set(platform, item);
      child.once('spawn', () => { item.spawned = true; });
      child.once('exit', () => { item.alive = false; item.token = ''; item.status = item.stopRequested ? 'stopped' : 'failed'; item.note = item.stopRequested ? '工作台启动的外部服务已停止。' : '外部程序已退出，请检查是否选中了 MCP 主程序、依赖是否齐全，或重新下载官方仓库的 Windows 版本。'; });
      child.on('error', () => { if (!item.spawned) { item.alive = false; item.token = ''; } item.status = 'failed'; item.note = '所选服务未能完成操作，请检查程序是否已解压、Windows 安全提示及本机服务状态。'; });
      await new Promise((accept, reject) => {
        const timer = setTimeout(() => settle(false), startupTimeoutMs);
        const started = () => settle(true), failed = () => settle(false);
        function settle(ok) { clearTimeout(timer); child.off('spawn', started); child.off('error', failed); child.off('exit', failed); ok ? accept() : reject(Error('外部服务未能启动，请检查所选程序和 Windows 安全提示后重试')); }
        child.once('spawn', started); child.once('error', failed); child.once('exit', failed);
      });
      current();
      if (!item.alive) throw Error(item.note);
      const ready = await waitUntilListening(item, current);
      return { ok: true, ...visible(platform, scope), ready, apiKey: token };
    } catch (error) {
      if (item?.alive) await stopRecord(item).catch(() => {});
      // Spawn errors can contain executable paths and environment details.
      if (error?.code || !(error instanceof Error)) throw Error('无法启动外部 MCP 服务，请重新选择已解压的主程序');
      throw error;
    } finally { busy = false; }
  }
  async function status({ scope, platform } = {}) {
    validInput(platform || 'xiaohongshu', scope);
    const selected = platform ? [platform] : Object.keys(PRESETS);
    for (const name of selected) {
      const item = records.get(name);
      if (item?.scope === scope && item.alive && !item.stopping) {
        const listening = await portProbe(PRESETS[name].port, 700, true);
        if (item.alive && !item.stopping) { item.status = listening ? 'running' : 'starting'; item.note = listening ? '本机端口已就绪；请检查 MCP 连接，平台登录仍需单独完成。' : '进程仍在准备服务。首次运行可能需要准备浏览器；请稍候后检查连接。'; }
      }
    }
    return selected.map(name => visible(name, scope));
  }
  async function stop({ scope, platform } = {}) {
    validInput(platform, scope); const item = records.get(platform);
    if (item?.scope === scope) await stopRecord(item);
    return { ok: true, ...visible(platform, scope) };
  }
  return { start, status, stop, stopAll };
}
module.exports = { createMCPLauncher, probeLocalPort, launcherEnvironment };
