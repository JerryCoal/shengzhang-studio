import { fork, spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { request } from 'node:https';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.STUDIO_TEAM_DATA_DIR || 'data/team');
const runDirectory = resolve(directory, 'run');
const lock = resolve(runDirectory, 'supervisor.lock');
const statePath = resolve(runDirectory, 'status.json');
const requestPath = resolve(runDirectory, 'stop.request');
const token = randomBytes(32).toString('hex');
const handles = [];
const state = { pid: process.pid, executable: process.execPath, token, status: 'starting', origin: process.env.STUDIO_TEAM_ORIGIN, startedAt: new Date().toISOString() };
const save = () => { writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2)); renameSync(`${statePath}.tmp`, statePath); };
const fd = openSync(lock, 'wx');
writeFileSync(fd, String(process.pid)); closeSync(fd);
let backend, caddy, stopping = false, finished = false, timer;
const healthController = new AbortController();
async function waitForHTTPS() {
  const target = new URL(process.env.STUDIO_TEAM_ORIGIN);
  const rootCertificate = resolve(directory, 'caddy/pki/authorities/local/root.crt');
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    if (existsSync(rootCertificate)) {
      const ok = await new Promise(accept => {
        const req = request({ hostname: '127.0.0.1', port: target.port || 443, path: '/api/health', servername: target.hostname, ca: readFileSync(rootCertificate), headers: { Host: target.host }, signal: healthController.signal, timeout: 1500 }, res => { res.resume(); accept(res.statusCode === 200); });
        req.on('error', () => accept(false)); req.on('timeout', () => { req.destroy(); accept(false); }); req.end();
      });
      if (ok && !stopping && !finished) { state.status = 'running'; save(); return; }
    }
    if (stopping || finished) return;
    await new Promise(accept => setTimeout(accept, 250));
  }
  if (!stopping) { state.failure = 'HTTPS 入口未通过启动检查，请检查端口、地址和 caddy.stderr.log。'; shutdown(); }
}
function logFile(name) { const fd = openSync(resolve(directory, 'logs', name), 'a'); handles.push(fd); return fd; }
function complete(code = 0) {
  if (finished) return; finished = true;
  healthController.abort();
  clearInterval(timer);
  caddy?.kill();
  state.status = code ? 'failed' : 'stopped'; state.finishedAt = new Date().toISOString(); save();
  try { unlinkSync(lock); } catch {}
  try { unlinkSync(requestPath); } catch {}
  for (const fd of handles) try { closeSync(fd); } catch {}
  process.exitCode = code;
}
function shutdown() {
  if (stopping) return; stopping = true;
  healthController.abort();
  state.status = 'stopping'; save();
  if (backend?.connected) backend.send({ event: 'shutdown' });
  else complete();
}
try {
  backend = fork(resolve(root, 'server/team.mjs'), [], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', logFile('backend.stdout.log'), logFile('backend.stderr.log'), 'ipc'] });
  state.backendPid = backend.pid; save();
  backend.on('message', message => {
    if (message?.event !== 'ready' || caddy || stopping) return;
    caddy = spawn(process.env.STUDIO_TEAM_CADDY_EXE, ['run', '--config', resolve(root, 'config/Caddyfile.team'), '--adapter', 'caddyfile'], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', logFile('caddy.stdout.log'), logFile('caddy.stderr.log')] });
    state.caddyPid = caddy.pid; save(); void waitForHTTPS();
    caddy.on('error', () => { state.failure = 'HTTPS 服务无法启动，请检查 caddy.stderr.log。'; shutdown(); process.exitCode = 1; });
    caddy.on('exit', code => { if (!stopping) { state.failure = `HTTPS 服务意外退出 (${code})，请检查日志。`; shutdown(); process.exitCode = 1; } });
  });
  backend.on('error', () => { state.failure = '后端无法启动，请检查 backend.stderr.log。'; complete(1); });
  backend.on('exit', code => { if (!stopping) state.failure = `后端意外退出 (${code})，请检查日志。`; complete(stopping && !state.failure ? 0 : (code || 1)); });
  timer = setInterval(() => {
    if (!existsSync(requestPath)) return;
    try { if (readFileSync(requestPath, 'utf8').trim() === token) shutdown(); } catch {}
  }, 250);
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch (error) { state.failure = error.code || '启动未完成'; complete(1); }
