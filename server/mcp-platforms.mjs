import { z } from 'zod';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMCPClient, localMCPEndpoint, mcpValue } from './mcp-client.mjs';
import { isLocalClient } from './ai-routes.mjs';
import { assert, touch, importComments } from './domain.mjs';
import { updatePlatformDelivery } from './platform-delivery.mjs';
import { commentSource, sameCommentWork } from '../desktop/comment-source.mjs';
import creatorPayload from '../desktop/creator-payload.cjs';

const platformSchema = z.enum(['xiaohongshu', 'douyin']);
const configSchema = z.object({ mode: z.enum(['builtin', 'external']), endpoint: z.string().max(300).optional(), apiKey: z.string().max(2048).regex(/^[\x21-\x7e]*$/).optional(), clearKey: z.boolean().optional() }).strict();
const commentOptions = z.object({ sourceUrl: z.string().max(8192).optional(), limit: z.number().int().min(1).max(1000).default(200), includeReplies: z.boolean().default(false) }).strict();
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(v) ? v : undefined;
const count = v => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1e9 ? Number(v) : null;

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
function capabilities(tools, mode) {
  return mode === 'builtin' ? { image: toolAvailable(tools, 'studio_publish', ['platform','sessionToken','projectId','publicationId','title','body','mime','mediaData']), video: toolAvailable(tools, 'studio_publish', ['platform','sessionToken','projectId','publicationId','title','body','mime','mediaData']), comments: toolAvailable(tools, 'studio_comments', ['url','sessionToken','limit','includeReplies']), login: false }
    : { image: toolAvailable(tools, 'publish_content', ['title','content','images','tags']), video: toolAvailable(tools, 'publish_with_video', ['title','content','video','tags']), comments: toolAvailable(tools, 'get_feed_detail', ['feed_id','xsec_token','load_all_comments','limit','click_more_replies','reply_limit','scroll_speed']), login: toolAvailable(tools, 'get_login_qrcode') };
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
      assert(builtin || platform === 'xiaohongshu', '抖音请使用内置 MCP，外部适配器当前仅支持 xpzouying/xiaohongshu-mcp');
      client = createMCPClient({ endpoint: builtin ? config.desktopMCP.endpoint : saved.endpoint, token: builtin ? config.desktopMCP.token : saved.apiKey || '', fetcher: config.mcpFetcher || fetch, timeout: builtin ? 65 * 60000 : 5 * 60000 });
      const tools = await client.connect(), available = capabilities(tools, saved.mode);
      checks.set(platform, { checkedAt: new Date().toISOString(), capabilities: available, toolCount: tools.length });
      return await work(client, saved.mode, available);
    } finally { await client?.close(); locks.delete(platform); }
  }
  app.get('/api/mcp/settings', async (req, res) => { local(req); res.json({ platforms: await Promise.all(['xiaohongshu', 'douyin'].map(status)) }); });
  app.put('/api/mcp/:platform', async (req, res) => {
    local(req); const platform = platformSchema.parse(req.params.platform), data = configSchema.parse(req.body);
    assert(!locks.has(platform), 'MCP 任务尚未结束，不能更改连接', 409); locks.add(platform);
    try {
      const vault = config.mcpVaults?.[platform]; assert(vault?.status().supported, '当前系统尚未提供安全保险箱');
      assert(data.mode !== 'external' || platform === 'xiaohongshu', '抖音使用内置 MCP');
      const old = await connection(platform);
      const endpoint = data.mode === 'external' ? localMCPEndpoint(data.endpoint) : '';
      // A saved access token never silently moves to a different server.
      const apiKey = data.clearKey ? '' : data.apiKey || (endpoint === old.endpoint ? old.apiKey || '' : '');
      await vault.save(JSON.stringify({ mode: data.mode, endpoint, ...(data.mode === 'external' ? { apiKey } : {}) })); checks.delete(platform);
      res.json(await status(platform));
    } finally { locks.delete(platform); }
  });
  app.post('/api/mcp/:platform/check', async (req, res) => { local(req); const platform = platformSchema.parse(req.params.platform); await connected(platform, async () => {}); res.json(await status(platform)); });
  app.post('/api/mcp/:platform/login', async (req, res) => {
    local(req); const platform = platformSchema.parse(req.params.platform);
    const result = await connected(platform, async (client, mode, caps) => {
      assert(mode === 'external' && caps.login, '内置连接请在发布或评论窗口中登录官方平台');
      const value = await client.call('get_login_qrcode', {});
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
      assert(caps.comments, '此 MCP 没有兼容的评论读取工具');
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
    assert(Array.isArray(result.rows) && result.rows.length && result.sourceUrl && sameCommentWork(work, commentSource(result.sourceUrl)), '未读取到所选作品的评论，请检查登录和作品链接');
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
  return { close() { previews.clear(); checks.clear(); } };
}
