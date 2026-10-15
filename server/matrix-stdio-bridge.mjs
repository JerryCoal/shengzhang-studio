// A local transport bridge. It executes ONLY the operator's fixed configuration;
// HTTP callers cannot supply process commands, environment or filesystem paths.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, extname } from 'node:path';

const fail = (message, status = 400) => Object.assign(Error(message), { status });
export function validateMatrixBridgeConfig(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['command','args','cwd','env','token','port'].includes(key))) throw fail('MCP 桥接配置字段无效');
  if (typeof raw.command !== 'string' || !isAbsolute(raw.command) || /[\x00-\x1f]/.test(raw.command) || process.platform === 'win32' && extname(raw.command).toLowerCase() !== '.exe') throw fail('请配置本机可执行程序的绝对路径；Windows 不接受 cmd、bat 或 PowerShell 脚本');
  if (!Array.isArray(raw.args) || raw.args.length > 32 || raw.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || /\x00/.test(arg))) throw fail('启动参数格式无效');
  if (typeof raw.cwd !== 'string' || !isAbsolute(raw.cwd) || /[\x00-\x1f]/.test(raw.cwd)) throw fail('请配置服务工作目录的绝对路径');
  const env = raw.env ?? {};
  if (!env || Object.getPrototypeOf(env) !== Object.prototype || Object.keys(env).length > 50 || Object.entries(env).some(([key,value]) => !/^(?:BROWSER_MCP_|GOOGLE_|TOKEN_STORAGE_PATH$|IG_|TIKTOK_|YOUTUBE_)[A-Z0-9_]*$/.test(key) || typeof value !== 'string' || value.length > 16000 || value.includes('\0'))) throw fail('服务环境变量格式无效');
  const port = raw.port ?? 18120; if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail('桥接端口需为 1024～65535');
  const token = raw.token ?? ''; if (typeof token !== 'string' || token && (!/^[\x21-\x7e]{24,2048}$/.test(token))) throw fail('桥接令牌需为至少 24 位可见 ASCII 字符');
  return { command: raw.command, args: [...raw.args], cwd: raw.cwd, env: { ...env }, port, token };
}
function childEnvironment(extra) {
  const env = {}; for (const key of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOME','LANG','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, ...extra };
}
function equalSecret(a,b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
export async function startMatrixBridge(raw, { spawnProcess = spawn, requestTimeout = 300000, idleTimeout = 15 * 60000 } = {}) {
  const config = validateMatrixBridgeConfig(raw), sessions = new Map(); let stopped = false;
  function end(session) { if (session.closed) return; session.closed = true; clearTimeout(session.idle); sessions.delete(session.id); for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(fail('MCP 子进程已结束', 502)); } session.pending.clear(); session.child.stdin?.end(); session.child.kill(); }
  function touch(session) { clearTimeout(session.idle); session.idle = setTimeout(() => end(session), idleTimeout); session.idle.unref?.(); }
  function open() {
    if (sessions.size >= 4) throw fail('桥接会话数量已达上限', 429);
    const child = spawnProcess(config.command, config.args, { cwd: config.cwd, env: childEnvironment(config.env), shell: false, windowsHide: true, stdio: ['pipe','pipe','ignore'] });
    const session = { id: randomUUID(), child, pending: new Map(), buffer: '', closed: false, busy: false, idle: null };
    sessions.set(session.id, session); touch(session);
    child.on('error', () => end(session)); child.on('exit', () => end(session));
    child.stdout.setEncoding('utf8'); child.stdout.on('data', part => {
      if (session.closed) return; session.buffer += part;
      if (Buffer.byteLength(session.buffer) > 8_000_000) { end(session); return; }
      let newline;
      while ((newline = session.buffer.indexOf('\n')) >= 0) {
        const line = session.buffer.slice(0, newline).trim(); session.buffer = session.buffer.slice(newline + 1); if (!line) continue;
        let response; try { response = JSON.parse(line); } catch { end(session); return; }
        if (!response || response.jsonrpc !== '2.0') { end(session); return; }
        // Unsupported server-initiated sampling/elicitation cannot cause an AI
        // request or external action. Reply explicitly instead of deadlocking.
        if (response.method && response.id !== undefined) { child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: response.id, error:{ code:-32601, message:'Server-initiated requests are not supported by this local bridge' } }) + '\n'); continue; }
        const pending = session.pending.get(String(response.id));
        if (pending) { clearTimeout(pending.timer); session.pending.delete(String(response.id)); pending.resolve(response); }
      }
    });
    return session;
  }
  function request(session, body) {
    if (session.closed) throw fail('MCP 子进程未运行', 502); touch(session);
    const message = JSON.stringify(body) + '\n';
    if (body.id === undefined) { session.child.stdin.write(message); return Promise.resolve(null); }
    return new Promise((resolve,reject) => { const key = String(body.id); const timer = setTimeout(() => { session.pending.delete(key); reject(fail('MCP 操作超时；发布结果不明时先到平台核对，不要重试', 504)); end(session); }, requestTimeout); session.pending.set(key,{resolve,reject,timer}); session.child.stdin.write(message, error => { if (error) { clearTimeout(timer); session.pending.delete(key); reject(fail('MCP 子进程连接中断',502)); end(session); } }); });
  }
  const server = createServer(async (req,res) => {
    const send = (status, data) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(data === undefined ? undefined : JSON.stringify(data)); };
    let session, created = false;
    try {
      if (stopped || !['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)) throw fail('只接受本机连接',403);
      if (req.headers.origin || req.headers['sec-fetch-site']) throw fail('不接受网页直接调用本机 MCP',403);
      if (req.headers.host !== `127.0.0.1:${config.port}`) throw fail('本机 Host 不匹配',403);
      if (config.token && !equalSecret(req.headers.authorization || '',`Bearer ${config.token}`)) throw fail('MCP 访问令牌不正确',401);
      if (req.url !== '/mcp') throw fail('仅提供 /mcp 端点',404);
      const identifier = req.headers['mcp-session-id'];
      if (identifier !== undefined && (typeof identifier !== 'string' || !/^[a-f0-9-]{36}$/i.test(identifier))) throw fail('MCP 会话编号无效');
      if (req.method === 'DELETE') { if (identifier && sessions.has(identifier)) end(sessions.get(identifier)); send(204); return; }
      if (req.method !== 'POST') throw fail('此桥接使用 MCP JSON 请求',405);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('需要 JSON 请求',415);
      const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 1_000_000) throw fail('MCP 请求过大',413); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('JSON 请求无效'); }
      if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.id !== undefined && !['string','number'].includes(typeof body.id)) throw fail('MCP 请求结构无效');
      if (!['initialize','notifications/initialized','notifications/cancelled','tools/list','tools/call','ping'].includes(body.method)) { send(200,{jsonrpc:'2.0',id:body.id ?? null,error:{code:-32601,message:'Method not supported'}}); return; }
      if (body.method === 'initialize') { if (identifier) throw fail('不能重复初始化现有会话',409); session = open(); created = true; }
      else { session = sessions.get(identifier); if (!session) throw fail('MCP 会话已结束，请重新连接',404); }
      if (session.busy) throw fail('当前 MCP 会话正在执行操作',409); session.busy = true;
      try { const response = await request(session,body); if (created) res.setHeader('Mcp-Session-Id',session.id); send(response === null ? 202 : 200,response ?? undefined); }
      finally { session.busy = false; }
    } catch (error) { if (created && session) end(session); send(error.status || 502,{error:'本机 MCP 桥接操作未完成',message: [400,401,403,404,405,409,413,415,429,504].includes(error.status) ? error.message : '请检查本机服务配置、启动依赖与平台授权。上游原文未记录。'}); }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(config.port,'127.0.0.1',resolve); });
  return { endpoint:`http://127.0.0.1:${config.port}/mcp`, close: async () => { stopped = true; for (const session of sessions.values()) end(session); await new Promise(resolve => server.close(resolve)); } };
}
