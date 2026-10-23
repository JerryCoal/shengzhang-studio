import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, pbkdf2, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { createApp } from './app.mjs';
import { openTeamStorage } from './team-storage.mjs';
import { createModelStore } from './models.mjs';
import { createIntegrationPreferences } from './integrations.mjs';
import { currentActor, runWithActor } from './request-actor.mjs';
import { teamPermission } from './team-permissions.mjs';
import { activity } from './domain.mjs';
import { teamAuditLabel } from './team-audit.mjs';

const derive = promisify(pbkdf2);
const digest = value => createHash('sha256').update(value).digest();
const tokenHash = value => digest(value).toString('hex');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const SESSION_MS = 12 * 60 * 60 * 1000;
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const loginFields = z.object({ username: z.string().transform(value => value.normalize('NFKC').trim().toLowerCase()).pipe(z.string().regex(/^[\p{L}\p{N}_-]{2,32}$/u, '用户名需为 2–32 位文字、数字或下划线')), password: z.string().min(10, '密码至少 10 位').max(128) });
const roleField = z.enum(['admin', 'editor', 'publisher']);

export function teamOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请设置 STUDIO_TEAM_ORIGIN 为团队访问的 HTTPS 根地址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('团队地址须为 HTTPS 根地址；仅本机测试允许 HTTP');
  return url;
}

export async function createTeamApp(options) {
  const { dataDirectory, staticDirectory = resolve('dist'), workspaceName = '团队工作区' } = options;
  const origin = teamOrigin(options.publicOrigin);
  const storage = await openTeamStorage(options), { store, vault } = storage;
  const db = new DatabaseSync(resolve(dataDirectory, 'users.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt BLOB NOT NULL, verifier BLOB NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)');
  const usersCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const publicUser = user => ({ id: user.id, userId: user.id, username: user.username, role: user.role, disabled: !!user.disabled, createdAt: user.created_at });
  const listUsers = () => db.prepare('SELECT * FROM users ORDER BY created_at, username').all().map(publicUser);
  const setupFile = resolve(dataDirectory, 'setup.code');
  let setupCode = '';
  if (!usersCount()) {
    if (existsSync(setupFile)) setupCode = readFileSync(setupFile, 'utf8').trim();
    else { setupCode = randomBytes(24).toString('base64url'); writeFileSync(setupFile, setupCode, { flag: 'wx', mode: 0o600 }); }
    if (!/^[A-Za-z0-9_-]{32}$/.test(setupCode)) throw new Error('初始化码文件无效，请核对团队数据目录');
  } else if (existsSync(setupFile)) unlinkSync(setupFile);
  const sessions = new Map(), attempts = new Map();
  let authenticating = 0, active = 0, shuttingDown = false;
  const idle = [];
  const workspace = createApp(store, {
    ...options.workspaceOptions, teamMode: true, profileMode: true, workspaceName, staticDirectory,
    password: '', allowedOrigins: [origin.origin], getActor: currentActor,
    authorizeCredentials: req => !!req.teamUser,
    authorizeWorkActor: actor => { const member = actor?.userId && db.prepare('SELECT role, disabled FROM users WHERE id=?').get(actor.userId); return !!member && !member.disabled && member.role === actor.role; },
    vault: vault('openai'), deepseekVault: vault('deepseek'), qwenVault: vault('qwen'), glmVault: vault('glm'), localQwenVault: vault('local-qwen'), researchVault: vault('web-search'),
    redfoxVault: vault('redfox'), seedanceVault: vault('seedance'), seedreamVault: vault('seedream'), douyinVault: vault('douyin'), feishuVault: vault('feishu'),
    mcpVaults: Object.fromEntries(['xiaohongshu','douyin','tiktok','youtube','instagram'].map(platform => [platform, vault(`${platform}-mcp`)])),
    modelStore: createModelStore(resolve(dataDirectory, 'models.json')),
    integrationPreferences: createIntegrationPreferences(resolve(dataDirectory, 'integrations.json')),
  });
  workspace.set('trust proxy', 'loopback');
  // Interrupted requests retain reserved costs and cannot silently retry a paid job.
  store.mutate(state => {
    for (const p of state.projects) {
      if (p.research?.run?.status === 'running') { p.research.revision++; Object.assign(p.research.run, { status: 'failed', phase: 'failed', finishedAt: new Date().toISOString(), error: '主机上次运行中断，已保留资料和预留费用，请核对后重试。' }); }
      for (const usage of [...(p.usage || []), ...(p.ragUsage || [])]) if (usage.status === 'running' && !p.assets.some(a => a.aiProduction?.videoUsageId === usage.id && a.aiProduction?.taskId && a.aiProduction.phase === 'generating-video')) { usage.status = 'uncertain'; usage.note = '主机重启时任务未完成，已保留预留费用，请核对服务商账单。'; }
    }
  });
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    if (!loopback(req.socket.remoteAddress) || req.get('Host')?.toLowerCase() !== origin.host.toLowerCase()) return res.status(403).json({ error: '请通过配置的团队入口访问' });
    if (req.get('Origin') && req.get('Origin') !== origin.origin) return res.status(403).json({ error: '此来源未获允许' });
    if (shuttingDown) return res.status(503).json({ error: '团队主机正在停止，请稍后重新连接' });
    if (req.path.startsWith('/api') || req.path.startsWith('/downloads/')) res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api') && req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '32mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, authRequired: true, authMode: 'profiles', teamMode: true, localOnly: false, workspaceName, setupRequired: !usersCount(), version: '2.3.0' }));
  app.use('/api', (req, res, next) => req.get('X-Studio-Client') === 'studio-v1' ? next() : res.status(403).json({ error: '请从团队工作站访问' }));
  const keyOf = req => tokenHash((req.get('Authorization') || '').replace(/^Bearer /, ''));
  const sessionIdentity = req => {
    const saved = sessions.get(keyOf(req));
    if (!saved || saved.expiresAt <= Date.now()) throw failure('请重新登录团队工作区', 401);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(saved.userId);
    if (!user || user.disabled) { sessions.delete(keyOf(req)); throw failure('账号已停用，请联系管理员', 401); }
    return { userId: user.id, username: user.username, role: user.role };
  };
  const sessionData = actor => ({ ...actor, teamMode: true, workspaceName });
  const makeSession = user => {
    for (const [key, entry] of sessions) if (entry.expiresAt <= Date.now()) sessions.delete(key);
    if (sessions.size >= 10000) throw failure('在线会话过多，请稍后重试', 503);
    const token = randomBytes(32).toString('base64url');
    sessions.set(tokenHash(token), { userId: user.id, expiresAt: Date.now() + SESSION_MS });
    return { token, ...sessionData({ userId: user.id, username: user.username, role: user.role }) };
  };
  async function limited(req, work) {
    const address = req.ip;
    const previous = attempts.get(address), attempt = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60000 };
    if (attempt.count >= 15 || authenticating >= 4) throw failure('登录尝试过于频繁，请稍后重试', 429);
    if (attempts.size >= 10000 && !attempts.has(address)) throw failure('登录繁忙，请稍后重试', 429);
    attempt.count++; attempts.set(address, attempt); authenticating++;
    try { const result = await work(); attempts.delete(address); return result; } finally { authenticating--; }
  }
  async function insertUser(input, { initial = false } = {}) {
    const fields = loginFields.extend({ role: roleField }).parse(input);
    const salt = randomBytes(16), verifier = await derive(fields.password, salt, 600000, 32, 'sha256');
    try {
      if (shuttingDown) throw failure('主机正在停止，请稍后重试', 503);
      if (initial && usersCount()) throw failure('初始化已完成，请登录', 409);
      if (db.prepare('SELECT id FROM users WHERE username=?').get(fields.username)) throw failure('用户名已存在', 409);
      if (usersCount() >= 100) throw failure('团队最多保存 100 个成员');
      const user = { id: randomUUID(), username: fields.username, role: fields.role, created_at: new Date().toISOString() };
      db.prepare('INSERT INTO users(id,username,salt,verifier,role,created_at) VALUES(?,?,?,?,?,?)').run(user.id, user.username, salt, verifier, user.role, user.created_at);
      return user;
    } finally { verifier.fill(0); }
  }
  app.post('/api/team/setup', async (req, res) => {
    const result = await limited(req, async () => {
      if (usersCount()) throw failure('初始化已完成，请使用管理员分配的账号登录', 409);
      const supplied = typeof req.body?.setupCode === 'string' ? req.body.setupCode.trim() : '';
      if (!setupCode || !timingSafeEqual(digest(supplied), digest(setupCode))) throw failure('初始化码不正确，请在主机的数据目录查看 setup.code', 401);
      const user = await insertUser({ ...req.body, role: 'admin' }, { initial: true });
      setupCode = ''; if (existsSync(setupFile)) unlinkSync(setupFile);
      runWithActor({ userId: user.id, username: user.username, role: user.role }, () => store.mutate(state => activity(state, '团队已初始化', '管理员已创建，可以添加团队成员。')));
      return makeSession(user);
    });
    res.json(result);
  });
  app.post('/api/profiles/login', async (req, res) => {
    const result = await limited(req, async () => {
      const input = loginFields.parse(req.body), user = db.prepare('SELECT * FROM users WHERE username=?').get(input.username);
      const verifier = await derive(input.password, user?.salt || randomBytes(16), 600000, 32, 'sha256');
      try {
        if (!user || user.disabled || !timingSafeEqual(verifier, user.verifier)) throw failure('用户名或密码不正确，或账号已停用', 401);
        const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        if (!current || current.disabled || !timingSafeEqual(Buffer.from(current.salt), Buffer.from(user.salt)) || !timingSafeEqual(Buffer.from(current.verifier), Buffer.from(user.verifier))) throw failure('账号设置已更新，请使用最新密码重新登录', 401);
        return makeSession(current);
      } finally { verifier.fill(0); }
    });
    res.json(result);
  });
  app.get('/api/profiles/remembered', (_req, res) => res.json({ supported: false, users: [] }));
  app.all(['/api/profiles/register', '/api/profiles/quick', '/api/profiles/remembered/:id'], (_req, res) => res.status(403).json({ error: '团队成员由管理员添加，请使用自己的用户名和密码登录。' }));
  app.use('/api', (req, res, next) => {
    const actor = sessionIdentity(req); req.teamUser = actor;
    const problem = teamPermission(actor.role, req.method, req.originalUrl.split('?')[0]);
    if (problem) return res.status(403).json({ error: problem });
    active++; let released = false;
    const release = () => { if (released) return; released = true; if (--active === 0) for (const resolveIdle of idle.splice(0)) resolveIdle(); };
    res.once('finish', release); res.once('close', release);
    // Audit metadata deliberately excludes request bodies, passwords and model keys.
    const path = req.originalUrl.split('?')[0];
    res.once('finish', () => {
      if (res.statusCode >= 400 || ['GET','HEAD','OPTIONS'].includes(req.method) || path.endsWith('/logout')) return;
      runWithActor(actor, () => store.mutate(state => activity(state, teamAuditLabel(req.method, path), '操作已保存到团队工作区。', path.match(/^\/api\/projects\/([^/]+)/)?.[1])));
    });
    runWithActor(actor, next);
  });
  app.get('/api/profiles/session', (req, res) => res.json(sessionData(req.teamUser)));
  app.post(['/api/profiles/logout', '/api/logout'], (req, res) => { sessions.delete(keyOf(req)); res.json({ ok: true }); });
  app.get('/api/team/users', (req, res) => { if (req.teamUser.role !== 'admin') throw failure('只有管理员可以管理团队成员', 403); res.json({ users: listUsers() }); });
  app.post('/api/team/users', async (req, res) => { await limited(req, () => insertUser(req.body)); res.status(201).json({ users: listUsers() }); });
  app.patch('/api/team/users/:id', async (req, res) => {
    const input = z.object({ role: roleField.optional(), disabled: z.boolean().optional(), password: z.string().min(10).max(128).optional() }).strict().parse(req.body);
    const before = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!before) throw failure('成员不存在', 404);
    const salt = input.password ? randomBytes(16) : null;
    let verifier;
    try {
      if (salt) verifier = await limited(req, () => derive(input.password, salt, 600000, 32, 'sha256'));
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      const role = input.role ?? user.role, disabled = input.disabled === undefined ? user.disabled : Number(input.disabled);
      const administrators = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").get().n;
      if (user.role === 'admin' && !user.disabled && (role !== 'admin' || disabled) && administrators <= 1) throw failure('至少保留一个启用的管理员账号', 409);
      db.prepare('UPDATE users SET role=?,disabled=?,salt=?,verifier=? WHERE id=?').run(role, disabled, salt || user.salt, verifier || user.verifier, user.id);
      if (input.password || disabled || role !== user.role) for (const [key, entry] of sessions) if (entry.userId === user.id) sessions.delete(key);
      res.json({ users: listUsers() });
    } finally { verifier?.fill(0); }
  });
  // The shared workspace is owned by the service, never by the last logged-in
  // member. Logout does not stop another member's work or scheduled tasks.
  app.use(workspace);
  app.use((error, _req, res, _next) => res.status(error.status || (error instanceof z.ZodError ? 400 : error.type === 'entity.too.large' ? 413 : 500)).json({ error: error instanceof z.ZodError ? error.issues[0]?.message : error.status ? error.message : '团队服务暂时无法处理，请重试；原数据已保留。' }));
  const maintenance = setInterval(() => {
    for (const [key, entry] of sessions) if (entry.expiresAt <= Date.now()) sessions.delete(key);
    for (const [key, entry] of attempts) if (entry.until <= Date.now()) attempts.delete(key);
  }, 60000); maintenance.unref();
  workspace.locals.integrations.start();
  let closing;
  app.locals.close = () => closing ||= (async () => {
    shuttingDown = true; clearInterval(maintenance); sessions.clear();
    await workspace.locals.integrations.close();
    await workspace.locals.workControl?.close();
    while (authenticating) await new Promise(accept => setTimeout(accept, 25));
    if (active) await new Promise(accept => idle.push(accept));
    while (workspace.locals.activeJobs.size) await new Promise(accept => setTimeout(accept, 25));
    db.close(); storage.close();
  })();
  return app;
}
