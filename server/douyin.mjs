import { disableAutomaticPublishing } from './manual-publishing.mjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import * as d from './domain.mjs';
import { canUseCredentials } from './ai-routes.mjs';
import { requestJSON, integrationError } from './integration-http.mjs';

const ORIGIN = 'https://open.douyin.com';
const field = z.string().trim().min(1).max(512);
const intervalSchema = z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]);
const syncDelay = pub => (pub.commentSync?.intervalMinutes || 15) * 60000;
const validShareUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && ['douyin.com', 'iesdouyin.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : ''; } catch { return ''; } };
export const douyinAppSchema = z.object({ clientKey: field.regex(/^[A-Za-z0-9_-]+$/), clientSecret: field, redirectUri: z.string().url().max(2048).refine(value => { const url = new URL(value); return !url.username && !url.password && !url.hash && !url.search && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))); }, '请填写平台注册的 HTTPS 回调地址（本地调试可填写 localhost）') }).strict();

export async function douyinRequest(path, { method = 'GET', token, query = {}, body, format = 'json' } = {}, fetcher) {
  d.assert(!['/video/upload/', '/video/create/'].includes(new URL(path, ORIGIN).pathname), '自动发布已关闭，请导出素材后在平台手动发布', 410);
  const url = new URL(path, ORIGIN); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const headers = token ? { 'access-token': token } : {};
  let payload;
  if (body) {
    if (format === 'form') { payload = new FormData(); for (const [k, v] of Object.entries(body)) payload.set(k, v); }
    else if (format === 'urlencoded') { payload = new URLSearchParams(body); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body instanceof FormData) payload = body;
    else { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  }
  const response = await requestJSON(url.href, { method, headers, ...(payload ? { body: payload } : {}), timeout: 45000 }, fetcher, '抖音');
  const data = response.data, code = Number(data?.error_code);
  if (!data || !Number.isFinite(code) || code !== 0) {
    const safeCode = Number.isSafeInteger(code) ? code : '未知';
    const authorization = [10008, 10010, 2190008, 2190010, 2190004].includes(code);
    throw integrationError(`抖音接口未成功（错误码 ${safeCode}）。${authorization ? '请重新授权账号。' : '请在开放平台检查权限、作品状态和调用配额。'}`, 502, { rejected: Number.isFinite(code), authorization });
  }
  return data;
}

export function importDouyinComments(p, pub, rows) {
  const schema = z.array(z.object({ comment_id: z.string().min(1).max(256), content: z.string().max(4000), create_time: z.number().nonnegative(), digg_count: z.number().int().nonnegative(), reply_comment_total: z.number().int().nonnegative().optional() })).max(100);
  const comments = schema.parse(rows); let added = 0, updated = 0;
  for (const row of comments) {
    const old = p.comments.find(c => c.publicationId === pub.id && c.platformCommentId === row.comment_id);
    const measured = { likes: row.digg_count, commentAt: new Date(row.create_time * 1000).toISOString(), replyCount: row.reply_comment_total || 0, lastSeenAt: d.now() };
    if (old) { Object.assign(old, measured); updated++; continue; }
    p.comments.push({ id: d.id(), publicationId: pub.id, strategyId: pub.strategyId, accountName: pub.accountName, platform: 'douyin', platformCommentId: row.comment_id, text: row.content, ...d.classify(row.content), ...measured, source: 'douyin-api', importedAt: d.now(), irrelevant: false, sample: false }); added++;
  }
  p.lastImportAt = d.now(); d.touch(p); return { added, updated };
}

export function mountDouyin(app, store, config, { project }) {
  const local = req => d.assert(canUseCredentials(req, config), '请从已解锁的工作区设置平台授权', 403);
  const vault = config.douyinVault, fetcher = config.fetcher || fetch, authorizations = config.authorizations || new Map(), locks = new Set();
  let secrets, secretQueue = Promise.resolve(), closed = false;
  const exclusive = work => { const next = secretQueue.then(work); secretQueue = next.catch(() => {}); return next; };
  const load = async () => { if (secrets) return secrets; const value = await vault?.getKey(); secrets = value ? JSON.parse(value) : { accounts: {} }; return secrets; };
  const persist = async value => { await vault.save(JSON.stringify(value)); secrets = value; };
  const update = (pid, pubid, cb) => store.mutate(state => { const p = project(state, pid), pub = p.publications.find(r => r.id === pubid); d.assert(pub, '发布记录不存在', 404); const result = cb(p, pub); d.touch(p); return result; });
  const paused = (accountId, message) => store.mutate(state => {
    const account = state.accounts.find(a => a.id === accountId); if (account) Object.assign(account, { connected: false, autoPublish: false, autoComments: false, note: message });
    for (const p of state.projects) for (const r of p.publications) if (r.accountId === accountId) { if (r.automation?.status === 'queued') { r.automation.status = 'blocked'; r.automation.error = message; } if (r.commentSync) { r.commentSync.enabled = false; r.commentSync.error = message; } }
  });
  const getToken = async (accountId, scopes, connectionId) => exclusive(async () => {
    const state = await load(), account = state.accounts[accountId];
    d.assert(account, '请先在设置页完成抖音账号授权');
    d.assert(!connectionId || account.connectionId === connectionId, '账号授权已更换，请重新检查发布账号并安排任务', 409);
    d.assert(scopes.every(scope => account.scopes.includes(scope)), `抖音授权缺少 ${scopes.join('、')}，请先申请权限并重新授权`, 403);
    if (account.expiresAt > Date.now() + 60000) return { ...account };
    if (account.refreshExpiresAt <= Date.now()) { paused(accountId, '抖音授权已过期，请重新授权'); throw integrationError('抖音授权已过期，请重新授权', 403, { authorization: true }); }
    try {
      const data = await douyinRequest('/oauth/refresh_token/', { method: 'POST', format: 'form', body: { client_key: state.clientKey, grant_type: 'refresh_token', refresh_token: account.refreshToken } }, fetcher);
      d.assert(typeof data.access_token === 'string' && Number(data.expires_in) > 0 && (!data.open_id || data.open_id === account.openId), '抖音刷新授权响应无效，请重新授权', 502);
      const next = structuredClone(state), fresh = next.accounts[accountId];
      Object.assign(fresh, { accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 });
      if (data.refresh_token) fresh.refreshToken = data.refresh_token;
      if (Number(data.refresh_expires_in) > 0) fresh.refreshExpiresAt = Date.now() + Number(data.refresh_expires_in) * 1000;
      if (data.scope) fresh.scopes = String(data.scope).split(',').map(s => s.trim());
      await persist(next); d.assert(scopes.every(scope => fresh.scopes.includes(scope)), '刷新后的授权缺少所需权限，请重新授权', 403);
      return { ...fresh };
    } catch { paused(accountId, '抖音授权刷新失败，请重新授权'); throw integrationError('抖音授权刷新失败，自动任务已暂停，请重新授权', 403, { authorization: true }); }
  });
  const status = async () => {
    const state = await load();
    return { configured: !!state.clientKey, redirectUri: state.redirectUri || '', clientKeySuffix: state.clientKey?.slice(-4) || '', accounts: Object.entries(state.accounts).map(([id, a]) => ({ id, scopes: a.scopes, expiresAt: a.expiresAt, refreshExpiresAt: a.refreshExpiresAt, connectionId: a.connectionId })), supported: !!vault?.status().supported };
  };
  app.put('/api/integrations/douyin', async (req, res) => {
    local(req); const input = douyinAppSchema.parse(req.body);
    d.assert(locks.size === 0, '平台操作正在执行，请稍后修改', 409);
    await exclusive(async () => { d.assert(vault?.status().supported, '此系统还没有安全凭证保险箱'); await persist({ ...input, accounts: {} }); authorizations.clear(); });
    for (const account of store.get().accounts.filter(a => a.platform === 'douyin')) paused(account.id, '应用凭证已更新，请重新授权');
    res.json(await status());
  });
  app.delete('/api/integrations/douyin', async (req, res) => {
    local(req); d.assert(locks.size === 0, '平台操作正在执行，请稍后解除连接', 409);
    await exclusive(async () => { vault?.remove(); secrets = { accounts: {} }; authorizations.clear(); });
    for (const account of store.get().accounts.filter(a => a.platform === 'douyin')) paused(account.id, '本机平台凭证已删除');
    res.json(await status());
  });
  app.post('/api/integrations/douyin/authorize', async (req, res) => {
    local(req); const { accountId, includeVideoList } = z.object({ accountId: z.string(), purpose: z.literal('comments').default('comments'), includeVideoList: z.boolean().default(false) }).strict().parse(req.body);
    d.assert(store.get().accounts.some(a => a.id === accountId && a.platform === 'douyin'), '请选择抖音账号');
    const settings = await load(); d.assert(settings.clientKey, '请先保存抖音应用凭证');
    for (const [key, ticket] of authorizations) if (ticket.expiresAt < Date.now() || ticket.accountId === accountId) authorizations.delete(key);
    const state = randomBytes(32).toString('base64url');
    authorizations.set(state, { accountId, expiresAt: Date.now() + 15 * 60000, redirectUri: settings.redirectUri });
    const scopes = ['video.data', 'item.comment', ...(includeVideoList ? ['video.list'] : [])];
    const url = new URL('/platform/oauth/connect/', ORIGIN); url.search = new URLSearchParams({ client_key: settings.clientKey, response_type: 'code', scope: scopes.join(','), redirect_uri: settings.redirectUri, state }).toString();
    res.json({ url: url.href, expiresAt: Date.now() + 15 * 60000 });
  });
  app.post('/api/integrations/douyin/complete', async (req, res) => {
    local(req); const { callbackUrl } = z.object({ callbackUrl: z.string().url().max(8192) }).strict().parse(req.body);
    const url = new URL(callbackUrl), state = url.searchParams.get('state'), code = url.searchParams.get('code'), ticket = authorizations.get(state);
    d.assert(ticket && ticket.expiresAt > Date.now(), '授权校验已过期或不匹配，请重新点击授权');
    const redirect = new URL(ticket.redirectUri);
    d.assert(url.origin === redirect.origin && url.pathname === redirect.pathname && !url.hash && !url.username && !url.password && url.searchParams.getAll('state').length === 1, '请粘贴本次授权结束后的完整回调地址');
    if (url.searchParams.has('error') || url.searchParams.has('errCode')) { authorizations.delete(state); throw integrationError('本次抖音授权未完成或被取消，请核对应用权限后重新连接。', 400); }
    d.assert(code && code.length <= 1024 && url.searchParams.getAll('code').length === 1, '授权地址缺少有效授权码，请重新连接');
    d.assert(!locks.size, '平台正在执行任务，请稍后完成新的授权', 409);
    authorizations.delete(state);
    const connection = await exclusive(async () => {
      const settings = await load();
      const data = await douyinRequest('/oauth/access_token/', { method: 'POST', format: 'urlencoded', body: { client_key: settings.clientKey, client_secret: settings.clientSecret, code, grant_type: 'authorization_code' } }, fetcher);
      d.assert(typeof data.access_token === 'string' && typeof data.refresh_token === 'string' && typeof data.open_id === 'string' && Number(data.expires_in) > 0 && Number(data.refresh_expires_in) > 0 && typeof data.scope === 'string', '抖音授权响应不完整，请重新授权', 502);
      const account = { accessToken: data.access_token, refreshToken: data.refresh_token, openId: data.open_id, scopes: data.scope.split(',').map(s => s.trim()), expiresAt: Date.now() + Number(data.expires_in) * 1000, refreshExpiresAt: Date.now() + Number(data.refresh_expires_in) * 1000, connectionId: d.id() };
      const next = structuredClone(settings); next.accounts[ticket.accountId] = account; await persist(next); return account;
    });
    paused(ticket.accountId, '账号重新授权后，请重新检查评论同步设置');
    store.mutate(state => { const account = state.accounts.find(a => a.id === ticket.accountId); Object.assign(account, { connected: true, autoPublish: false, autoComments: connection.scopes.includes('item.comment'), note: '已连接评论查询 · 发布始终由你在平台手动完成', connectionId: connection.connectionId }); });
    res.json(await status());
  });
  // Local callback landing page has no third-party resources, scripts, or logging of the code.
  app.get('/oauth/douyin/callback', (_req, res) => res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" }).type('html').send('<!doctype html><meta charset="utf-8"><title>返回生长工作台</title><h1>返回工作台完成授权</h1><p>请复制当前地址栏的完整地址，回到设置页粘贴到“授权后的回调地址”。</p>'));

  app.post('/api/integrations/douyin/videos', async (req, res) => {
    local(req);
    const { accountId, cursor } = z.object({ accountId: z.string(), cursor: z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d{1,20}$/)]).default(0) }).strict().parse(req.body);
    const account = await getToken(accountId, ['video.list']);
    const data = await douyinRequest('/video/list/', { token: account.accessToken, query: { open_id: account.openId, cursor, count: 20 } }, fetcher);
    d.assert(Array.isArray(data.list) && typeof data.has_more === 'boolean' && (typeof data.cursor === 'string' || Number.isSafeInteger(data.cursor)), '作品列表响应无效，请稍后重试', 502);
    d.assert(!data.has_more || String(data.cursor) !== String(cursor), '作品列表游标未推进，请稍后重试', 502);
    res.json({ list: data.list.filter(item => item.is_reviewed === true && item.video_status === 5 && typeof item.item_id === 'string' && validShareUrl(item.share_url)).map(item => ({ itemId: item.item_id, title: String(item.title || '未命名作品').slice(0, 200), url: validShareUrl(item.share_url), createTime: Number(item.create_time) || 0 })), cursor: data.cursor, hasMore: data.has_more });
  });

  // Old clients receive a clear refusal; no task or token request is created.
  app.post('/api/projects/:id/publications/:publicationId/automatic', (_req, res) => res.status(410).json({ error: 'v1.2.0 已关闭自动发布。请导出素材，在平台手动发布后登记作品链接。' }));
  app.post('/api/projects/:id/publications/:publicationId/stop-automatic', (req, res) => {
    local(req); store.mutate(disableAutomaticPublishing); res.json({ result: { stopped: true }, state: store.get() });
  });
  async function inspect(pid, pubid, account, itemId) {
    const data = await douyinRequest('/video/data/', { method: 'POST', token: account.accessToken, query: { open_id: account.openId }, body: { item_ids: [itemId] } }, fetcher);
    const item = data.list?.find(item => item.item_id === itemId);
    d.assert(item?.is_reviewed === true && item.video_status === 5, '平台尚未确认此作品已公开，请在抖音核对后重试');
    const url = validShareUrl(item.share_url); d.assert(url, '平台返回的作品链接暂不可用，请稍后查询', 502);
    update(pid, pubid, (_p, fresh) => {
      d.assert(fresh.status !== 'cancelled', '此发布记录已取消', 409);
      d.assert(!fresh.platformItemId || fresh.platformItemId === itemId, '此记录已关联其他作品', 409);
      Object.assign(fresh, { status: 'published', url, confirmationSource: 'douyin-api', publishedAt: fresh.publishedAt || d.now(), platformItemId: itemId, platformConnectionId: account.connectionId, manualReviewRequired: false });
    });
  }
  app.post('/api/projects/:id/publications/:publicationId/platform-status', async (req, res) => {
    local(req); const pub = project(store.get(), req.params.id).publications.find(r => r.id === req.params.publicationId);
    const itemId = pub?.platformItemId || pub?.automation?.itemId; d.assert(itemId, '没有平台作品编号可查询');
    const account = await getToken(pub.accountId, ['video.data']);
    await inspect(req.params.id, pub.id, account, itemId); res.json({ result: { checked: true }, state: store.get() });
  });
  // A known item id lets the user reconcile a lost create response without reposting.
  app.post('/api/projects/:id/publications/:publicationId/platform-item', async (req, res) => {
    local(req); const input = z.object({ itemId: z.string().trim().min(1).max(512), confirmed: z.literal(true) }).strict().parse(req.body);
    const pub = project(store.get(), req.params.id).publications.find(r => r.id === req.params.publicationId); d.assert(pub && pub.platform === 'douyin' && !pub.sample, '请选择自己的抖音作品');
    d.assert(!locks.has(`comments/${pub.id}`), '平台正在处理这条作品，请稍后关联', 409);
    d.assert(pub.status !== 'cancelled', '计划已取消，请重新安排');
    d.assert(!pub.platformItemId || pub.platformItemId === input.itemId, '已有作品关联不能更换，以免混合不同作品的评论', 409);
    const account = await getToken(pub.accountId, ['video.data']);
    await inspect(req.params.id, pub.id, account, input.itemId); res.json({ result: { linked: true }, state: store.get() });
  });

  async function sync(pid, pubid, automatic = false) {
    const lock = `comments/${pubid}`; d.assert(!locks.has(lock), '这条作品正在同步评论，请稍候', 409); locks.add(lock);
    try {
      const pub = project(store.get(), pid).publications.find(r => r.id === pubid);
      d.assert(pub?.status === 'published' && pub.platformItemId && !pub.sample, '请先通过平台确认或关联真实的抖音作品');
      const account = await getToken(pub.accountId, ['item.comment'], pub.platformConnectionId);
      let cursor = pub.commentSync?.cursor || 0, more = true, added = 0, updated = 0, pages = 0;
      const seen = new Set();
      while (more && pages < 10) {
        if (closed || (automatic && !project(store.get(), pid).publications.find(r => r.id === pubid)?.commentSync?.enabled)) break;
        const data = await douyinRequest('/item/comment/list/', { token: account.accessToken, query: { open_id: account.openId, item_id: pub.platformItemId, count: 20, cursor, sort_type: 'time' } }, fetcher);
        d.assert(Array.isArray(data.list) && data.list.length <= 20 && typeof data.has_more === 'boolean' && (Number.isSafeInteger(data.cursor) || (typeof data.cursor === 'string' && /^\d{1,20}$/.test(data.cursor))), '评论分页响应无效，原有评论保留', 502);
        const next = data.cursor; more = data.has_more;
        d.assert(!more || (String(next) !== String(cursor) && !seen.has(String(next))), '评论分页游标未推进，已停止本轮同步', 502); seen.add(String(next));
        update(pid, pubid, (p, fresh) => { const result = importDouyinComments(p, fresh, data.list); added += result.added; updated += result.updated; fresh.commentSync = { ...fresh.commentSync, cursor: more ? next : 0, partial: more, lastSyncAt: d.now(), error: '', failures: 0, lastAdded: added, lastUpdated: updated, nextSyncAt: Date.now() + (more ? 60000 : syncDelay(fresh)) }; });
        cursor = next; pages++;
      }
      return { added, updated, partial: more, pages };
    } catch (error) {
      update(pid, pubid, (_p, pub) => { const failures = (pub.commentSync?.failures || 0) + 1; pub.commentSync = { ...pub.commentSync, failures, error: error.status ? error.message : '评论同步未完成，已采集的原文保留。', nextSyncAt: Date.now() + 15 * 60000 }; if (error.authorization || [401, 403].includes(error.status) || failures >= 6) pub.commentSync.enabled = false; });
      throw error.status ? error : integrationError('评论同步未完成，已采集的原文保留。');
    } finally { locks.delete(lock); }
  }
  app.post('/api/projects/:id/publications/:publicationId/comments-sync', async (req, res) => { local(req); const result = await sync(req.params.id, req.params.publicationId); res.json({ result, state: store.get() }); });
  app.put('/api/projects/:id/publications/:publicationId/comments-sync', async (req, res) => {
    local(req); const { enabled, intervalMinutes } = z.object({ enabled: z.boolean(), intervalMinutes: intervalSchema.optional() }).strict().parse(req.body);
    const pub = project(store.get(), req.params.id).publications.find(r => r.id === req.params.publicationId);
    d.assert(pub?.status === 'published' && pub.platformItemId && !pub.sample, '请先关联平台中的真实作品');
    if (enabled) await getToken(pub.accountId, ['item.comment'], pub.platformConnectionId);
    update(req.params.id, pub.id, (_p, fresh) => { fresh.commentSync = { ...fresh.commentSync, enabled, intervalMinutes: intervalMinutes || fresh.commentSync?.intervalMinutes || 15, nextSyncAt: 0, error: '' }; });
    res.json({ result: { enabled }, state: store.get() });
  });
  return {
    status,
    recover() { store.mutate(disableAutomaticPublishing); },
    async tick() {
      if (closed) return;
      for (const p of store.get().projects) for (const r of p.publications) {
        if (r.status === 'published' && r.commentSync?.enabled && r.commentSync.nextSyncAt <= Date.now()) await sync(p.id, r.id, true).catch(() => {});
      }
    },
    close() { closed = true; },
  };
}
