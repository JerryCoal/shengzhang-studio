import { z } from 'zod';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMCPClient, localMCPEndpoint, mcpValue } from './mcp-client.mjs';
import { isLocalClient } from './ai-routes.mjs';
import { assert, touch, importComments } from './domain.mjs';
import { updatePlatformDelivery } from './platform-delivery.mjs';
import { commentSource, sameCommentWork } from '../desktop/comment-source.mjs';
import creatorPayload from '../desktop/creator-payload.cjs';
import { researchQueries, researchAt, researchText } from './research-sources.mjs';
import { douyinMCPLogin, douyinMCPDraft, douyinMCPPlan } from './douyin-mcp-adapter.mjs';

const platformSchema = z.enum(['xiaohongshu', 'douyin']);
const configSchema = z.object({ mode: z.enum(['builtin', 'external']), endpoint: z.string().max(300).optional(), apiKey: z.string().max(2048).regex(/^[\x21-\x7e]*$/).optional(), clearKey: z.boolean().optional() }).strict();
const commentOptions = z.object({ sourceUrl: z.string().max(8192).optional(), limit: z.number().int().min(1).max(1000).default(200), includeReplies: z.boolean().default(false) }).strict();
const discoveryOptions = z.object({ timeRange: z.enum(['week', 'month', 'all']), sortBy: z.enum(['general', 'likes', 'favorites', 'comments']), noteType: z.enum(['all', 'image', 'video']) }).strict();
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(v) ? v : undefined;
const count = v => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1e9 ? Number(v) : null;
function researchCount(value, preserveCompactMetrics) {
  const exact = count(value);
  if (exact !== null || !preserveCompactMetrics || typeof value !== 'string' || value.length > 80) return exact;
  // Keep a bounded numeric display value, never arbitrary upstream text. The data
  // layer parses this while preserving its approximate flag and original label.
  const raw = value.trim(), normalized = raw.normalize('NFKC').replace(/[,，\s]/gu, '');
  return /^(\d+(?:\.\d+)?)(万|亿|w|k|m|b)?(\+)?$/iu.test(normalized) ? raw : null;
}

// Only the project's documented, bounded response fields are read. User profiles and instructions are ignored.
export function xhsMCPComments(value, work, { limit = 200, includeReplies = false } = {}) {
  const envelope = value?.feed_id ? value : value?.data?.feed_id ? value.data : null;
  assert(envelope?.feed_id === work.itemId, 'MCP 返回的笔记编号与所选作品不一致', 502);
  const detail = envelope.data;
  assert(detail?.note?.noteId === work.itemId, 'MCP 返回的笔记详情无法核对', 502);
  assert(Array.isArray(detail.comments?.list), 'MCP 没有返回可识别的评论列表，请检查服务版本', 502);
  const rows = [], seen = new Set(); let textBytes = 0, skipped = 0;
  function add(comment, parent) {
    const identifier = id(comment?.id), text = comment?.content;
    if (rows.length >= limit || !identifier || seen.has(identifier) || typeof text !== 'string' || !text.trim() || text.length > 4000 || textBytes + text.length > 120000) { skipped++; return; }
    if (comment.noteId && comment.noteId !== work.itemId) { skipped++; return; }
    const raw = comment.createTime, millis = typeof raw === 'number' ? raw * (raw < 1e12 ? 1000 : 1) : 0;
    const date = millis >= 946684800000 && millis <= Date.now() + 86400000 ? new Date(millis).toISOString() : '';
    rows.push({ text: text.trim(), platformCommentId: identifier, likes: count(comment.likeCount), isReply: !!parent, timeLabel: date, ...(date ? { commentAt: date } : {}), ...(parent ? { parentCommentId: parent } : {}) });
    seen.add(identifier); textBytes += text.length;
  }
  for (const comment of detail.comments.list.slice(0, 1000)) {
    add(comment);
    if (includeReplies && id(comment?.id) && Array.isArray(comment.subComments)) for (const reply of comment.subComments.slice(0, 1000)) add(reply, comment.id);
  }
  return { rows, skipped, sourceUrl: work.canonical, platform: 'xiaohongshu', mode: 'page', includeReplies, limited: true, notice: '只返回本次 MCP 实际加载的评论，不代表平台全部评论。昵称与用户资料未导入。' };
}
export function toolAvailable(tools, name, supplied = []) {
  const tool = Array.isArray(tools) ? tools.find(t => t?.name === name) : null;
  const required = tool?.inputSchema?.required ?? [];
  return !!tool && tool.inputSchema?.type === 'object' && Array.isArray(required) && required.every(key => typeof key === 'string' && supplied.includes(key));
}
export function xhsLoginState(result) {
  const texts = Array.isArray(result?.content) ? result.content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text) : [];
  if (texts.some(t => /^❌ 未登录(?:\r?\n|$)/u.test(t))) return 'not-logged-in';
  if (texts.some(t => /^✅ 已登录(?:\r?\n|$)/u.test(t) || t.trim() === '你当前已处于登录状态')) return 'logged-in';
  return 'unknown';
}
function capabilities(tools, mode, platform) {
  if (mode === 'external' && platform === 'douyin') return {
    image: toolAvailable(tools,'douyin_publish_note',['account','images','title','note','tags','confirm','plan_id']),
    video: toolAvailable(tools,'douyin_publish_video',['account','file','title','description','tags','confirm','plan_id']),
    comments:false, search:false,
    login:toolAvailable(tools,'douyin_account_login',['account','headed','wait_seconds','force']),
    loginStatus:toolAvailable(tools,'douyin_account_status',['account']),
  };
  return mode === 'builtin' ? { image: toolAvailable(tools, 'studio_publish', ['platform','sessionToken','projectId','publicationId','title','body','mime','mediaData']), video: toolAvailable(tools, 'studio_publish', ['platform','sessionToken','projectId','publicationId','title','body','mime','mediaData']), comments: toolAvailable(tools, 'studio_comments', ['url','sessionToken','limit','includeReplies']), login: false, search: false }
    : { image: toolAvailable(tools, 'publish_content', ['title','content','images','tags']), video: toolAvailable(tools, 'publish_with_video', ['title','content','video','tags']), comments: toolAvailable(tools, 'get_feed_detail', ['feed_id','xsec_token','load_all_comments','limit','click_more_replies','reply_limit','scroll_speed']), login: toolAvailable(tools, 'get_login_qrcode'), loginStatus: toolAvailable(tools, 'check_login_status'), search: toolAvailable(tools, 'search_feeds', ['keyword','filters']) && toolAvailable(tools, 'get_feed_detail', ['feed_id','xsec_token','load_all_comments']) && toolAvailable(tools, 'check_login_status') };
}

// Official upstream contracts checked 2026-10-14:
// https://github.com/xpzouying/xiaohongshu-mcp/blob/main/mcp_server.go
// https://github.com/xpzouying/xiaohongshu-mcp/blob/main/xiaohongshu/types.go
// Detail replies include initial comments; these are never retained or further loaded for research.
export function xhsMCPResearchItem(value, feedId, { at, token = '', secrets = [], preserveCompactMetrics = false } = {}) {
  const envelope = value?.feed_id ? value : value?.data?.feed_id ? value.data : null;
  assert(envelope?.feed_id === feedId && /^[a-f0-9]{24}$/i.test(feedId), '小红书候选作品编号无法核对', 502);
  const note = envelope.data?.note;
  assert(note?.noteId === feedId, '小红书候选详情与作品编号不一致', 502);
  const privateValues = [token, ...secrets];
  const title = researchText(note.title, 240, privateValues);
  assert(title, '小红书候选未返回标题', 502);
  const rawTime = note.time, millis = typeof rawTime === 'number' && Number.isFinite(rawTime) ? rawTime * (rawTime < 1e12 ? 1000 : 1) : NaN;
  const publishedAt = Number.isFinite(millis) && millis >= 946684800000 && millis <= 8640000000000000 ? new Date(millis).toISOString() : '';
  const info = note.interactInfo;
  const noteType = note.type === 'normal' ? 'image' : note.type === 'video' ? 'video' : 'unknown';
  return { kind: 'xiaohongshu', externalId: feedId, noteType, title, url: `https://www.xiaohongshu.com/explore/${feedId}`, text: researchText(note.desc, 1600, privateValues), publishedAt, dateBasis: 'platform-timestamp', sourceName: '小红书', collectedAt: researchAt(at), metrics: { likes: researchCount(info?.likedCount, preserveCompactMetrics), comments: researchCount(info?.commentCount, preserveCompactMetrics), favorites: researchCount(info?.collectedCount, preserveCompactMetrics), shares: researchCount(info?.sharedCount, preserveCompactMetrics) } };
}
export function mountMCPPlatforms(app, store, config, { project, activeJobs }) {
  const locks = new Set(), checks = new Map(), previews = new Map();
  const local = req => assert(isLocalClient(req), 'MCP 仅在本机完整版中使用；不会把本机服务暴露给网站后端', 403);
  async function connection(platform) {
    const vault = config.mcpVaults?.[platform];
    if (!vault?.status().configured) return { mode: 'builtin', endpoint: '' };
    const saved = JSON.parse(await vault.getKey());
    if (saved.mode === 'external') localMCPEndpoint(saved.endpoint);
    return saved;
  }
  async function status(platform) {
    const saved = await connection(platform), builtinAvailable = !!config.desktopMCP?.endpoint;
    return { platform, mode: saved.mode, endpoint: saved.mode === 'external' ? saved.endpoint : '', tokenConfigured: !!saved.apiKey, builtinAvailable, editable: !!config.mcpVaults?.[platform]?.status().supported, ...(checks.get(platform) || {}), connected: !!checks.get(platform)?.checkedAt };
  }
  async function connected(platform, work) {
    assert(!locks.has(platform), '该平台正在执行 MCP 任务，请先完成当前操作', 409); locks.add(platform);
    let client;
    try {
      const saved = await connection(platform), builtin = saved.mode === 'builtin';
      assert(!builtin || config.desktopMCP?.endpoint, '内置 MCP 需要新版 Windows 桌面端；小红书也可连接本机的外部 MCP 服务');
      client = createMCPClient({ endpoint: builtin ? config.desktopMCP.endpoint : saved.endpoint, token: builtin ? config.desktopMCP.token : saved.apiKey || '', ...(config.mcpFetcher ? { fetcher: config.mcpFetcher } : {}), timeout: builtin ? 65 * 60000 : 5 * 60000 });
      checks.delete(platform);
      const tools = await client.connect(), available = capabilities(tools, saved.mode, platform);
      assert(Object.values(available).some(Boolean), `服务已响应，但没有兼容的${platform === 'douyin' ? '抖音' : '小红书'}工具。请核对平台和项目；不能把小红书服务地址填到抖音。`, 502);
      checks.set(platform, { checkedAt: new Date().toISOString(), capabilities: available, toolCount: tools.length });
      return await work(client, saved.mode, available);
    } finally { await client?.close(); locks.delete(platform); }
  }
  const researchReport = (status, count, message) => ({ sourceId: 'xiaohongshu', name: '小红书 MCP', status, count, message });
  async function researchStatus(req) {
    local(req);
    const saved = await connection('xiaohongshu'), cached = checks.get('xiaohongshu');
    const supported = saved.mode === 'external' && (!cached?.capabilities || cached.capabilities.search === true);
    return { configured: saved.mode === 'external' && !!saved.endpoint, supported, checked: !!cached?.checkedAt, note: saved.mode !== 'external' ? '近期笔记搜索需要本机外部小红书 MCP；内置抖音助手不支持热点搜索。' : !cached?.checkedAt ? '已配置本机外部小红书 MCP，采集时会检查搜索能力和登录状态。' : supported ? '已发现兼容搜索工具，采集时仍会核对登录状态。' : '所连接服务没有兼容的近期笔记搜索工具，请核对版本。' };
  }
  async function researchSearch(req, { queries, at, assertActive, discovery } = {}) {
    local(req);
    const options = discovery === undefined ? null : discoveryOptions.parse(discovery);
    const selected = researchQueries(queries, options ? 3 : 2), collectedAt = researchAt(at), items = [], reports = [], seen = new Set();
    // Upstream supports day/week/half-year/all, but no calendar-month filter.
    // Month candidates are fetched using half-year and verified locally later.
    const filters = options ? { publish_time: { week: '一周内', month: '半年内', all: '不限' }[options.timeRange], sort_by: { general: '综合', likes: '最多点赞', favorites: '最多收藏', comments: '最多评论' }[options.sortBy], note_type: { all: '不限', image: '图文', video: '视频' }[options.noteType] } : { publish_time: '一周内', sort_by: '最多收藏' };
    const scopeNote = options ? `本次使用“${filters.sort_by}”搜索、${filters.note_type}类型，每词最多核对 4 篇详情；仅代表本次关键词样本，不是全站榜单。${options.timeRange === 'month' ? '平台先按半年内搜索，工作台随后按详情发布时间筛选近 30 天。' : options.timeRange === 'all' ? '本轮不限制笔记发布时间，历史笔记不代表近期热点。' : '工作台会再次核对近七天的详情发布时间。'}` : '';
    let inactiveError;
    const active = async () => { try { if (assertActive) await assertActive(); } catch (error) { inactiveError = error; throw error; } };
    await active();
    if (!selected.length) return { items, reports: [researchReport('skipped', 0, '没有可用搜索词，本次未调用小红书 MCP。')] };
    const saved = await connection('xiaohongshu');
    if (saved.mode !== 'external') return { items, reports: [researchReport('skipped', 0, '近期笔记搜索需要本机外部小红书 MCP；内置小红书和抖音助手尚不支持热点搜索。')] };
    try {
      await connected('xiaohongshu', async (client, mode, caps) => {
        await active();
        if (mode !== 'external' || !caps.search) { reports.push(researchReport('skipped', 0, '当前 MCP 缺少兼容的搜索、详情或登录检查工具，请核对服务版本。')); return; }
        const login = xhsLoginState(await client.call('check_login_status', {}));
        await active();
        if (login !== 'logged-in') { reports.push(researchReport('skipped', 0, '请先在账号设置中完成小红书 MCP 扫码登录；不会绕过平台验证。')); return; }
        for (const query of selected) {
          await active();
          let feeds;
          try {
            const result = mcpValue(await client.call('search_feeds', { keyword: query, filters }));
            feeds = result?.feeds || result?.data?.feeds;
            assert(Array.isArray(feeds), '搜索列表无法读取', 502);
          } catch { reports.push(researchReport('failed', 0, '本次小红书搜索未完成，请核对服务登录与平台页面；已有候选仍保留。')); continue; }
          await active();
          let added = 0, failed = 0;
          for (const feed of feeds.slice(0, 4)) {
            await active();
            const feedId = typeof feed?.id === 'string' && /^[a-f0-9]{24}$/i.test(feed.id) ? feed.id : '';
            const token = typeof feed?.xsecToken === 'string' && feed.xsecToken.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(feed.xsecToken) ? feed.xsecToken : '';
            if (!feedId || !token || seen.has(feedId)) { if (!feedId || !token) failed++; continue; }
            seen.add(feedId);
            try {
              const value = mcpValue(await client.call('get_feed_detail', { feed_id: feedId, xsec_token: token, load_all_comments: false }));
              items.push(xhsMCPResearchItem(value, feedId, { at: collectedAt, token, secrets: [saved.apiKey], preserveCompactMetrics: !!options })); added++;
            } catch { failed++; }
            await active();
          }
          reports.push(researchReport(failed && !added ? 'failed' : 'ok', added, (failed ? `取得 ${added} 条小红书候选，另有 ${failed} 条详情未能核对；成功结果仍保留。` : `取得 ${added} 条小红书候选，已读取详情发布时间与可用互动数；这是关键词样本，不是全站热榜。`) + scopeNote));
        }
      });
    } catch (error) {
      if (inactiveError === error) throw error;
      reports.push(researchReport('failed', 0, error?.status === 409 ? '小红书 MCP 正在执行其他任务，本次搜索未启动。' : '未能完成本机小红书 MCP 采集，请检查服务与登录状态；不会自动重试。'));
    }
    return { items, reports };
  }
  app.get('/api/mcp/settings', async (req, res) => { local(req); res.json({ platforms: await Promise.all(['xiaohongshu', 'douyin'].map(status)) }); });
  app.put('/api/mcp/:platform', async (req, res) => {
    local(req); const platform = platformSchema.parse(req.params.platform), data = configSchema.parse(req.body);
    assert(!locks.has(platform), 'MCP 任务尚未结束，不能更改连接', 409); locks.add(platform);
    try {
      const vault = config.mcpVaults?.[platform]; assert(vault?.status().supported, '当前系统尚未提供安全保险箱');
      const old = await connection(platform);
      const endpoint = data.mode === 'external' ? localMCPEndpoint(data.endpoint) : '';
      // A saved access token never silently moves to a different server.
      const apiKey = data.clearKey ? '' : data.apiKey || (endpoint === old.endpoint ? old.apiKey || '' : '');
      await vault.save(JSON.stringify({ mode: data.mode, endpoint, ...(data.mode === 'external' ? { apiKey } : {}) })); checks.delete(platform);
      res.json(await status(platform));
    } finally { locks.delete(platform); }
  });
  app.post('/api/mcp/:platform/check', async (req, res) => { local(req); const platform = platformSchema.parse(req.params.platform); await connected(platform, async () => {}); res.json(await status(platform)); });
  app.post('/api/mcp/:platform/login-status', async (req, res) => {
    local(req); const platform = platformSchema.parse(req.params.platform);
    const result = await connected(platform, async (client, mode, caps) => {
      assert(mode === 'external' && caps.loginStatus, '请在官方页面助手中核对实际登录账号');
      const loginState = platform === 'douyin' ? douyinMCPLogin(await client.call('douyin_account_status', {account:'main'})) : xhsLoginState(await client.call('check_login_status', {}));
      return { loginState, checkedAt: new Date().toISOString(), note: loginState === 'logged-in' ? 'MCP 报告已登录，发布前仍需核对该服务当前使用的账号。' : loginState === 'not-logged-in' ? `尚未登录，请获取二维码并使用${platform === 'douyin' ? '抖音' : '小红书'} App 扫码。` : '暂不能识别登录状态，请在 MCP 官方登录窗口核对。' };
    }); res.json(result);
  });
  app.post('/api/mcp/:platform/login', async (req, res) => {
    local(req); const platform = platformSchema.parse(req.params.platform);
    const result = await connected(platform, async (client, mode, caps) => {
      assert(mode === 'external' && caps.login, '内置连接请在发布或评论窗口中登录官方平台');
      if (platform === 'douyin') {
        const value = await client.call('douyin_account_login',{account:'main',headed:true,wait_seconds:2,force:false});
        const image=value.content?.find(c=>c.type==='image'&&['image/png','image/jpeg'].includes(c.mimeType)&&typeof c.data==='string'&&c.data.length<=4_000_000&&/^[A-Za-z0-9+/=]+$/.test(c.data));
        return { ...(image?{image:`data:${image.mimeType};base64,${image.data}`} : {}), loginState:'unknown', note:'抖音 MCP 已启动或继续登录流程。请在弹出的官方浏览器窗口扫码；首次使用可能先安装配套驱动。完成后点击“检查平台登录状态”。' };
      }
      const value = await client.call('get_login_qrcode', {});
      if (xhsLoginState(value) === 'logged-in') return { loginState: 'logged-in', note: 'MCP 报告已经登录，无需重复扫码。发布前请核对实际账号。' };
      const image = value.content?.find(c => c.type === 'image' && ['image/png','image/jpeg'].includes(c.mimeType) && typeof c.data === 'string' && c.data.length <= 2_000_000 && /^[A-Za-z0-9+/=]+$/.test(c.data));
      assert(image, '未收到可用登录二维码；若已登录可直接开始读取评论');
      return { image: `data:${image.mimeType};base64,${image.data}`, note: '使用小红书 App 扫码。二维码由本机 MCP 提供；登录状态由该服务单独保存。' };
    }); res.json(result);
  });
  app.post('/api/projects/:id/publications/:publicationId/mcp/publish', async (req, res) => {
    local(req);
    const data = z.object({ confirmed: z.literal(true), expectedRevision: z.number().int(), title: z.string().trim().min(1).max(100), body: z.string().max(4000) }).strict().parse(req.body);
    assert(!activeJobs.has(req.params.id), '项目还有任务进行中', 409); activeJobs.add(req.params.id);
    try {
      const p = project(store.get(), req.params.id), pub = p.publications.find(p => p.id === req.params.publicationId);
      assert(pub && !pub.sample && ['scheduled','exported'].includes(pub.status) && !pub.manualReviewRequired, '请选择真实的待发布内容');
      assert(pub.assetRevision === data.expectedRevision, '发布素材已更新，请重新打开', 409);
      assert(!pub.delivery || pub.delivery.phase === 'reset', '这条内容已尝试提交，请先核对平台结果，不能重复投送', 409);
      const draft = { platform: pub.platform, title: data.title, body: data.body, mime: pub.mime, mediaData: pub.mediaData };
      creatorPayload.validateDraft(draft);
      const result = await connected(pub.platform, async (client, mode, caps) => {
        assert(pub.mime.startsWith('image/') ? caps.image : caps.video, '所连接 MCP 没有兼容的素材发布工具，请检查服务版本');
        if (mode === 'builtin') {
          const response = mcpValue(await client.call('studio_publish', { ...draft, projectId: p.id, publicationId: pub.id, sessionToken: (req.get('Authorization') || '').replace(/^Bearer /, '') }));
          assert(response && !response.error, response?.error ? '内置助手未完成，请检查官方页面和待办状态' : 'MCP 响应无法识别', 502);
          return { cancelled: !!response.cancelled, attempted: !!response.attempted, note: response.receipt ? '平台已返回回执，请核对审核状态后登记发布结果。' : response.attempted ? '已尝试提交，请在官方作品列表核对。不会自动重复发布。' : '本次尚未提交，可检查草稿后继续。' };
        }
        const staged = await creatorPayload.stageDraft(draft, config.mcpTempRoot || tmpdir());
        const attemptId = randomUUID();
        try {
          if (pub.platform === 'douyin') {
            const request=douyinMCPDraft(draft,staged.file);
            // The user has reviewed title/body/media and explicitly confirmed this route.
            // Upstream also requires a local preflight plan tied to the exact same parameters.
            const plan=douyinMCPPlan(await client.call(request.name,{...request.args,confirm:false}));
            store.mutate(state=>{const current=project(state,p.id);updatePlatformDelivery(current,pub.id,{action:'start',platform:pub.platform,attemptId,title:draft.title,body:draft.body});touch(current);});
            await client.call(request.name,{...request.args,plan_id:plan,confirm:true});
            return {attempted:true,note:'抖音 MCP 已返回。请在官方作品列表核对是否提交并登记链接；未取得作品编号时保留重试锁，不自动重复发布。'};
          }
          store.mutate(state => { const current = project(state, p.id); updatePlatformDelivery(current, pub.id, { action: 'start', platform: pub.platform, attemptId, title: draft.title, body: draft.body }); touch(current); });
          const image = pub.mime.startsWith('image/');
          const response = mcpValue(await client.call(image ? 'publish_content' : 'publish_with_video', { title: draft.title, content: draft.body, ...(image ? { images: [staged.file] } : { video: staged.file }), tags: [] }));
          const candidate = response?.note_id || response?.noteId || response?.feed_id || response?.data?.note_id;
          if (typeof candidate === 'string' && /^[a-f0-9]{24}$/i.test(candidate)) store.mutate(state => { const current = project(state, p.id); updatePlatformDelivery(current, pub.id, { action: 'receipt', attemptId, url: `https://www.xiaohongshu.com/explore/${candidate}` }); touch(current); });
          return { attempted: true, note: 'MCP 调用已返回，请核对平台作品列表并登记真实链接；未取得作品编号时保留重试锁。' };
        } finally { await staged.dispose(); }
      });
      res.json({ result, state: store.get() });
    } finally { activeJobs.delete(req.params.id); }
  });
  app.post('/api/projects/:id/publications/:publicationId/mcp/comments', async (req, res) => {
    local(req); const data = commentOptions.parse(req.body);
    const p = project(store.get(), req.params.id), pub = p.publications.find(p => p.id === req.params.publicationId);
    assert(pub?.status === 'published' && !pub.sample, '请先登记自己作品的真实发布链接');
    const expected = commentSource(pub.url), work = commentSource(data.sourceUrl || pub.url);
    assert(sameCommentWork(expected, work) && work.platform === pub.platform, '采集链接与所选作品不一致');
    const result = await connected(pub.platform, async (client, mode, caps) => {
      assert(caps.comments, pub.platform==='douyin'&&mode==='external' ? '当前抖音外部 MCP 支持发布，但未提供评论工具。请在账号设置切换为“应用自带页面助手”，登录后再读取自己的作品评论。' : '此 MCP 没有兼容的评论读取工具');
      if (mode === 'builtin') {
        const value = mcpValue(await client.call('studio_comments', { url: work.url, limit: data.limit, includeReplies: data.includeReplies, sessionToken: (req.get('Authorization') || '').replace(/^Bearer /, '') }));
        assert(value && !value.error, '内置评论采集未完成，请核对登录和页面', 502);
        return value;
      }
      const token = new URL(work.url).searchParams.get('xsec_token');
      assert(token && token.length <= 2048, '这个 MCP 需要带 xsec_token 的完整小红书分享链接，请从官方作品页重新复制；不用提供 Cookie。');
      const value = mcpValue(await client.call('get_feed_detail', { feed_id: work.itemId, xsec_token: token, load_all_comments: true, limit: data.limit, click_more_replies: data.includeReplies, reply_limit: data.limit, scroll_speed: 'normal' }));
      return xhsMCPComments(value, work, data);
    });
    if (result.cancelled) return res.json({ cancelled: true });
    assert(Array.isArray(result.rows) && result.sourceUrl && sameCommentWork(work, commentSource(result.sourceUrl)), '未读取到所选作品的评论，请检查登录和作品链接');
    if (!result.rows.length) return res.json({ rows: [], previewId: '', notice: '本次未读取到评论。作品可能尚无评论，或平台未加载内容；可以核对官方页面后重新获取。' });
    const safe = { rows: result.rows.slice(0, data.limit), sourceUrl: work.canonical, mode: 'page', includeReplies: data.includeReplies, limited: true, notice: typeof result.notice === 'string' ? result.notice.slice(0, 500) : '本次读取为部分评论，导入前请核对。' };
    for (const [key, item] of previews) if (item.expires < Date.now()) previews.delete(key);
    while (previews.size >= 10) previews.delete(previews.keys().next().value);
    const previewId = randomUUID(); previews.set(previewId, { ...safe, projectId: p.id, publicationId: pub.id, expires: Date.now() + 30 * 60000 });
    res.json({ ...safe, previewId });
  });
  app.post('/api/projects/:id/publications/:publicationId/mcp/comments/import', (req, res) => {
    local(req); const data = z.object({ previewId: z.string().uuid(), confirmed: z.literal(true), indices: z.array(z.number().int().min(0).max(999)).min(1).max(1000) }).strict().parse(req.body);
    const preview = previews.get(data.previewId);
    assert(preview && preview.expires > Date.now() && preview.projectId === req.params.id && preview.publicationId === req.params.publicationId, '预览已过期或作品不匹配，请重新采集', 409);
    const rows = [...new Set(data.indices)].map(i => preview.rows[i]); assert(rows.every(Boolean), '勾选评论编号无效');
    const result = store.mutate(state => { const p = project(state, req.params.id); return importComments(p, { source: 'mcp', publicationId: req.params.publicationId, sourceUrl: preview.sourceUrl, mode: 'page', confirmed: true, rows }); });
    previews.delete(data.previewId); res.json({ result, state: store.get() });
  });
  return { researchSearch, researchStatus, close() { previews.clear(); checks.clear(); } };
}
