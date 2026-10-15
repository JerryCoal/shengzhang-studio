// Independently implemented adapters for reviewed public MCP tool contracts.
// Exact upstream revisions and setup instructions: docs/MATRIX-MCP-SETUP.md.
// Third-party text is data; no instructions or arbitrary tool names are executed.
import { assert } from './domain.mjs';
import { mcpValue } from './mcp-client.mjs';
import { researchAt, researchText, researchQueries } from './research-sources.mjs';
import { isIP } from 'node:net';

const LABELS = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', douyin: '抖音' };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value) ? value : '';
const exactCount = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12 ? Number(value) : null;
const list = value => Array.isArray(value) ? value : [];
const isoDate = value => {
  // Provider timestamps must include a timezone. Meta can return +0000 rather
  // than +00:00; both are accepted, but missing/invalid dates are not guessed.
  const parts = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!parts) return '';
  const [year,month,day,hour,minute,second] = parts.slice(1,7).map(Number), zone = parts[7].replace(':','');
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate() || hour > 23 || minute > 59 || second > 59 || zone !== 'Z' && (Number(zone.slice(1,3)) > 23 || Number(zone.slice(3,5)) > 59)) return '';
  const n = Date.parse(value);
  return Number.isFinite(n) && n >= 946684800000 && n <= Date.now() + 86400000 ? new Date(n).toISOString() : '';
};
const text = (value, max = 1600, secrets = []) => researchText(unfence(value), max, secrets);
function unfence(value) { return typeof value === 'string' ? value.replace(/^\[UNTRUSTED source: "instagram-user-content"\]\r?\n/, '').replace(/\r?\n\[\/UNTRUSTED\]$/, '') : ''; }
function scope(remoteAccount) { assert(remoteAccount === undefined || typeof remoteAccount === 'string' && remoteAccount.length <= 80 && !/[\x00-\x1f\x7f]/.test(remoteAccount), '服务内账号标识无效'); return remoteAccount ? { account: remoteAccount } : {}; }
export function matrixToolAvailable(tools, name, supplied = []) {
  const found = list(tools).find(tool => tool?.name === name), required = found?.inputSchema?.required ?? [];
  return !!found && found.inputSchema?.type === 'object' && Array.isArray(required) && required.every(key => typeof key === 'string' && supplied.includes(key));
}
export function matrixCapabilities(platform, tools) {
  const has = (name, fields = []) => matrixToolAvailable(tools, name, fields);
  const base = { image: false, video: false, comments: false, search: false, login: false, loginStatus: false, publishOptions: false, profile: false, adapter: '', notice: '' };
  if (platform === 'youtube') return { ...base, adapter: 'youtube-data-v3', video: has('youtube_videos_insert', ['title','description','filePath','privacyStatus','categoryId','tags']), comments: has('youtube_comment_threads_list', ['videoId','part','maxResults','order','pageToken']), search: has('youtube_search', ['q','type','maxResults','order','publishedAfter']) && has('youtube_videos_list', ['id','part','maxResults']), loginStatus: has('youtube_channels_list', ['mine','part','maxResults']), profile: has('youtube_channels_list', ['mine','part','maxResults']), notice: '使用 Google OAuth 授权；评论与关键词搜索调用 YouTube 官方接口并消耗配额。每个本机服务只连接一套频道授权。' };
  if (platform === 'instagram') return { ...base, adapter: 'instagram-graph', image: has('instagram_post_image', ['imageUrls','caption','apply','account']), video: has('instagram_post_reel', ['videoUrl','caption','apply','account']), comments: has('instagram_list_comments', ['mediaId','limit','after','fetchAll','account']) && has('instagram_list_media', ['limit','after','fetchAll','account']), search: has('instagram_search_hashtag', ['hashtag','account']) && has('instagram_get_hashtag_media', ['hashtagId','edge','limit','account']), loginStatus: has('instagram_get_account', ['account']), profile: has('instagram_get_account', ['account']), notice: '需要 Instagram 专业账号与 Meta 授权；话题发现为标签热门/近期样本，且该服务要求 Facebook Login 路线。发布素材须为平台可读取的 HTTPS URL。' };
  if (platform === 'tiktok') { const permission = has('get_creator_info',['account']) && has('get_profile',['account']); return { ...base, adapter: 'tiktok-official', image: permission && has('post_photos', ['photo_urls','title','description','privacy_level','confirm','account']), video: permission && has('post_video', ['video_url','title','privacy_level','confirm','account']), publishOptions: permission, loginStatus: has('get_profile', ['account']), profile: has('get_profile', ['account']), notice: '该开源服务使用 TikTok 官方授权，可读取自有账号并发布；没有全站关键词搜索或评论读取工具。不会将自有作品统计冒充全网热点。发布还需平台权限、审核与已验证的素材域名。' }; }
  if (platform === 'douyin') return { ...base, adapter: has('douyin_search', ['keyword','limit']) || has('douyin_comments', ['url','max_comments','time_budget_seconds']) ? 'browser-mcp-douyin' : '', comments: has('douyin_comments', ['url','max_comments','time_budget_seconds']), search: has('douyin_search', ['keyword','limit']) && has('douyin_video', ['url']), notice: 'browser-mcp 通过已登录的 Chrome 页面读取搜索与评论；其采集服务不提供发布工具。遇到登录或验证码时需在该浏览器操作。' };
  return base;
}

export function matrixWork(platform, raw) {
  let url; try { url = new URL(raw); } catch { assert(false, '请填写该作品的完整链接'); }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port, '作品链接必须为平台 HTTPS 链接');
  const host = url.hostname.toLowerCase(), path = url.pathname;
  let match, itemId, canonical;
  if (platform === 'youtube' && ['www.youtube.com','youtube.com','m.youtube.com','youtu.be'].includes(host)) {
    assert(url.searchParams.getAll('v').length <= 1, 'YouTube 链接含重复作品编号，请复制单一作品链接');
    itemId = host === 'youtu.be' ? path.slice(1) : path === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live)\/([\w-]{11})\/?$/.exec(path)?.[1];
    if (/^[\w-]{11}$/.test(itemId || '')) canonical = `https://www.youtube.com/watch?v=${itemId}`;
  } else if (platform === 'instagram' && ['www.instagram.com','instagram.com'].includes(host) && (match = /^\/(p|reel)\/([\w-]{1,64})\/?$/.exec(path))) { itemId = match[2]; canonical = `https://www.instagram.com/${match[1]}/${itemId}/`; }
  else if (platform === 'douyin' && ['www.douyin.com','douyin.com'].includes(host) && (match = /^\/(video|note)\/(\d{5,30})\/?$/.exec(path))) { itemId = match[2]; canonical = `https://www.douyin.com/${match[1]}/${itemId}`; }
  else if (platform === 'tiktok' && ['www.tiktok.com','tiktok.com'].includes(host) && (match = /^\/@([\w.-]{1,80})\/video\/(\d{5,30})\/?$/.exec(path))) { itemId = match[2]; canonical = `https://www.tiktok.com/@${match[1]}/video/${itemId}`; }
  assert(canonical, '暂不支持这个作品链接格式，请从对应平台复制完整作品地址');
  return { platform, itemId, canonical };
}
function sourceMeta({ accountId, accountName }) { return { ...(safeId(accountId) ? { sourceAccountId: accountId } : {}), ...(typeof accountName === 'string' ? { sourceAccountName: text(accountName, 80) } : {}) }; }
export function matrixResearchItem(platform, value, options = {}) {
  const { at, secrets = [], expectedId } = options;
  let externalId, title, body, publishedAt, url, noteType, metrics;
  if (platform === 'youtube') {
    externalId = value?.id; assert(/^[\w-]{11}$/.test(externalId || ''), 'YouTube 作品编号无法核对', 502);
    title = text(value.snippet?.title, 240, secrets); body = text(value.snippet?.description, 1600, secrets); publishedAt = isoDate(value.snippet?.publishedAt); url = `https://www.youtube.com/watch?v=${externalId}`; noteType = 'video';
    metrics = { views: exactCount(value.statistics?.viewCount), likes: exactCount(value.statistics?.likeCount), comments: exactCount(value.statistics?.commentCount), favorites: null, shares: null };
  } else if (platform === 'instagram') {
    externalId = safeId(value?.id); assert(externalId, 'Instagram 作品编号无法核对', 502); url = matrixWork('instagram', value.permalink).canonical;
    body = text(value.caption, 1600, secrets); title = text(value.caption, 180, secrets); publishedAt = isoDate(value.timestamp); noteType = value.media_type === 'VIDEO' ? 'video' : ['IMAGE','CAROUSEL_ALBUM'].includes(value.media_type) ? 'image' : 'unknown';
    metrics = { views: null, likes: exactCount(value.like_count), comments: exactCount(value.comments_count), favorites: null, shares: null };
  } else if (platform === 'douyin') {
    externalId = value?.aweme_id; assert(/^\d{5,30}$/.test(externalId || ''), '抖音作品编号无法核对', 502); const work = matrixWork('douyin', value.url); assert(work.itemId === externalId, '抖音作品链接与编号不一致', 502); url = work.canonical;
    body = text(value.description, 1600, secrets); title = text(value.description, 240, secrets); publishedAt = isoDate(value.published_at); noteType = /\/note\//.test(url) ? 'image' : 'video';
    // Browser MCP currently normalizes missing counters to 0. A zero is therefore
    // unknown here; treating it as verified would invent engagement-rate evidence.
    const reported = field => exactCount(value[field]) > 0 ? exactCount(value[field]) : null;
    metrics = { views: null, likes: reported('likes'), comments: reported('comments'), favorites: reported('collects'), shares: reported('shares') };
  } else assert(false, '这个平台尚无已核对的热点读取适配器');
  assert(!expectedId || externalId === expectedId, '详情与候选作品编号不一致', 502);
  assert(title && publishedAt, '作品标题或发布时间无法核对', 502);
  return { kind: platform, externalId, title, text: body, url, publishedAt, collectedAt: researchAt(at), dateBasis: 'platform-timestamp', sourceName: LABELS[platform], noteType, metrics, ...sourceMeta(options) };
}

export async function matrixCheckLogin({ platform, client, tools, remoteAccount }) {
  const caps = matrixCapabilities(platform, tools); assert(caps.loginStatus, '当前服务没有可核对的账号状态工具', 409);
  const result = mcpValue(await client.call(platform === 'youtube' ? 'youtube_channels_list' : platform === 'instagram' ? 'instagram_get_account' : 'get_profile', platform === 'youtube' ? { part: 'snippet', mine: true, maxResults: 1 } : scope(remoteAccount)));
  const identity = platform === 'youtube' ? safeId(result?.items?.[0]?.id) : platform === 'instagram' ? safeId(result?.id) : safeId(result?.open_id);
  assert(identity, '服务已响应，但账号身份无法核对，请完成服务侧 OAuth 授权', 502);
  return { loginState: 'logged-in', accountIdentity: identity, notice: '已核对服务当前授权的账号；平台授权失效时仍需重新登录。' };
}

export async function matrixPublishOptions({ platform, client, tools, remoteAccount }) {
  assert(platform === 'tiktok' && matrixCapabilities(platform,tools).publishOptions, '当前平台没有可读取的发布权限工具',409);
  const login = await matrixCheckLogin({ platform,client,tools,remoteAccount });
  const info = mcpValue(await client.call('get_creator_info',scope(remoteAccount)));
  const allowed = ['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'];
  assert(Array.isArray(info?.privacy_level_options) && info.privacy_level_options.length > 0 && info.privacy_level_options.every(item=>allowed.includes(item)), 'TikTok 未返回可用的可见范围，请核对发布权限和账号状态',502);
  assert(['comment_disabled','duet_disabled','stitch_disabled'].every(key=>typeof info[key] === 'boolean'), 'TikTok 未返回完整互动权限，本次无法准备发布',502);
  const nickname = text(info.creator_nickname,100), username = text(info.creator_username,100);
  assert(nickname && username, 'TikTok 未返回可核对的目标账号，请重新授权',502);
  const maximum = exactCount(info.max_video_post_duration_sec);
  return { platform, accountIdentity: login.accountIdentity, creatorNickname: nickname, creatorUsername: username, privacyOptions: [...new Set(info.privacy_level_options)], commentDisabled: info.comment_disabled, duetDisabled: info.duet_disabled, stitchDisabled: info.stitch_disabled, maxVideoDurationSeconds: maximum && maximum <= 86400 ? maximum : null, notice: '请自行选择可见范围和互动选项。未审核应用仅支持私密测试，且仍受账号及发布配额约束。' };
}

export async function matrixResearchSearch({ platform, client, tools, queries, at, discovery, accountId, accountName, remoteAccount, assertActive, secrets = [] }) {
  const name = `${LABELS[platform] || platform} MCP`, report = (status, count, message) => ({ sourceId: platform, name, status, count, message });
  const caps = matrixCapabilities(platform, tools), items = [], reports = [], selected = researchQueries(queries, 3), seen = new Set();
  if (!caps.search) return { items, reports: [report('skipped', 0, caps.notice || '当前服务未提供兼容的同话题搜索工具。')] };
  const active = async () => { if (assertActive) await assertActive(); }, collectedAt = researchAt(at), period = discovery?.timeRange === 'all' ? null : discovery?.timeRange === 'month' ? 30 : 7;
  const since = period ? new Date(Date.parse(collectedAt) - period * 86400000).toISOString() : null;
  for (const query of selected) {
    await active(); let count = 0, failed = 0;
    try {
      if (platform === 'youtube') {
        // Two independent rankings avoid turning keyword relevance into a claim
        // about traffic. Statistics always come from videos.list, not search cards.
        const ids = [];
        for (const order of ['relevance','viewCount']) { await active(); const found = mcpValue(await client.call('youtube_search', { q: query, type: 'video', maxResults: 6, order, ...(since ? { publishedAfter: since } : {}) })); assert(Array.isArray(found?.items), 'YouTube 搜索列表不可读', 502); for (const hit of found.items) if (/^[\w-]{11}$/.test(hit?.id?.videoId || '') && !ids.includes(hit.id.videoId)) ids.push(hit.id.videoId); }
        const chosen = ids.filter(id => !seen.has(id)).slice(0, 8);
        if (chosen.length) { await active(); const details = mcpValue(await client.call('youtube_videos_list', { id: chosen.join(','), part: 'snippet,statistics', maxResults: chosen.length })); assert(Array.isArray(details?.items), 'YouTube 详情列表不可读', 502); for (const detail of details.items) { if (!chosen.includes(detail?.id)) { failed++; continue; } try { const item = matrixResearchItem(platform, detail, { at: collectedAt, accountId, accountName, secrets, expectedId: detail.id }); if (!seen.has(item.externalId)) { items.push(item); seen.add(item.externalId); count++; } } catch { failed++; } } }
      } else if (platform === 'instagram') {
        const hashtag = query.trim().replace(/^#+/, ''); assert(/^[\p{L}\p{N}_]{1,150}$/u.test(hashtag), 'Instagram 需使用单个标签，不支持含空格的关键词组合');
        const found = mcpValue(await client.call('instagram_search_hashtag', { hashtag, ...scope(remoteAccount) })), hashtagId = list(found?.ids).find(safeId); assert(hashtagId, '没有取得可读取的标签编号', 502);
        for (const edge of ['top','recent']) { await active(); const result = mcpValue(await client.call('instagram_get_hashtag_media', { hashtagId, edge, limit: 8, ...scope(remoteAccount) })); assert(Array.isArray(result?.items), 'Instagram 标签列表不可读', 502); for (const raw of result.items.slice(0, 8)) { if (seen.has(raw?.id)) continue; try { const item = matrixResearchItem(platform, raw, { at: collectedAt, accountId, accountName, secrets }); items.push(item); seen.add(item.externalId); count++; } catch { failed++; } } }
      } else if (platform === 'douyin') {
        const result = mcpValue(await client.call('douyin_search', { keyword: query, limit: 12 })); assert(Array.isArray(result?.items), '抖音搜索列表不可读', 502);
        const chosen = result.items.filter(item => /^\d{5,30}$/.test(item?.aweme_id || '') && !seen.has(item.aweme_id)).slice(0, 12).sort((a,b) => (exactCount(b.likes) || 0) - (exactCount(a.likes) || 0)).slice(0, 6);
        for (const raw of chosen) { await active(); try { const work = matrixWork('douyin', raw.url); assert(work.itemId === raw.aweme_id, '候选链接不匹配', 502); const detail = mcpValue(await client.call('douyin_video', { url: work.canonical })); const item = matrixResearchItem(platform, detail, { at: collectedAt, accountId, accountName, secrets, expectedId: raw.aweme_id }); items.push(item); seen.add(item.externalId); count++; } catch { failed++; } }
      }
      await active(); reports.push(report(count ? 'ok' : failed ? 'failed' : 'ok', count, `读取 ${count} 条同话题样本${failed ? `，${failed} 条详情未通过核对` : ''}。${platform === 'youtube' ? '综合相关与播放量两路搜索，已核对官方统计；搜索消耗 API 配额。' : platform === 'instagram' ? '仅标签热门和近期样本，不是全站关键词榜单；未公开播放量不计为零。' : '按关键词取样并核对高点赞候选详情，平台未返回可验证的播放量。'}后续按实际时间和相关性筛选。`));
    } catch (error) { await active(); reports.push(report('failed', count, platform === 'instagram' && /含空格/.test(error.message) ? 'Instagram 请填写不含空格的单个话题标签。' : '本次平台搜索未完成，请检查服务登录、权限与版本；已取得的样本仍保留。')); }
  }
  return { items, reports };
}

export async function matrixComments({ platform, client, tools, work, limit = 200, includeReplies = false, accountId, accountName, remoteAccount, assertActive, secrets = [] }) {
  assert(matrixCapabilities(platform, tools).comments, matrixCapabilities(platform, tools).notice || '当前服务没有可用的评论读取工具', 409);
  const checkedWork = matrixWork(platform, work.canonical); assert(checkedWork.itemId === work.itemId, '作品编号与链接不一致', 409);
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 1000, '评论数量需为 1～1000');
  const rows = [], seen = new Set(); let bytes = 0, skipped = 0;
  const active = async () => { if (assertActive) await assertActive(); };
  function add(raw, parent) { const identifier = safeId(raw.id), body = text(raw.text, 4001, secrets); if (!identifier || !body || body.length > 4000 || seen.has(identifier) || rows.length >= limit || bytes + body.length > 120000) { skipped++; return; } const date = isoDate(raw.date); rows.push({ text: body, platformCommentId: identifier, likes: exactCount(raw.likes), isReply: !!parent, timeLabel: date, ...(date ? { commentAt: date } : {}), ...(parent ? { parentCommentId: parent } : {}) }); seen.add(identifier); bytes += body.length; }
  await active();
  if (platform === 'youtube') {
    let pageToken; const cursors = new Set();
    for (let page = 0; page < 10 && rows.length < limit; page++) { await active(); const result = mcpValue(await client.call('youtube_comment_threads_list', { videoId: work.itemId, part: includeReplies ? 'snippet,replies' : 'snippet', maxResults: Math.min(100, limit - rows.length), order: 'time', ...(pageToken ? { pageToken } : {}) })); assert(Array.isArray(result?.items), 'YouTube 评论列表无法读取', 502);
      for (const thread of result.items) { assert(thread?.snippet?.videoId === work.itemId, 'YouTube 返回其他作品的评论，已停止导入', 502); const top = thread.snippet?.topLevelComment, snippet = top?.snippet; add({ id: top?.id, text: snippet?.textOriginal ?? snippet?.textDisplay, date: snippet?.publishedAt, likes: snippet?.likeCount }); if (includeReplies) for (const reply of list(thread.replies?.comments).slice(0, 1000)) { if (reply?.snippet?.parentId !== top?.id) { skipped++; continue; } add({ id: reply.id, text: reply.snippet.textOriginal ?? reply.snippet.textDisplay, date: reply.snippet.publishedAt, likes: reply.snippet.likeCount }, top.id); } }
      pageToken = result.nextPageToken; if (!pageToken) break; assert(typeof pageToken === 'string' && pageToken.length <= 2000 && !cursors.has(pageToken), '评论分页异常，已停止采集', 502); cursors.add(pageToken);
    }
  } else if (platform === 'instagram') {
    // Public shortcodes are NOT Graph media IDs. Resolve against the connected
    // account's own media first; never guess an ID or collect another account.
    let after, mediaId; const cursors = new Set();
    for (let page = 0; page < 5 && !mediaId; page++) { await active(); const result = mcpValue(await client.call('instagram_list_media', { limit: 100, fetchAll: false, ...(after ? { after } : {}), ...scope(remoteAccount) })); assert(Array.isArray(result?.items), 'Instagram 自有作品列表不可读', 502); for (const row of result.items) { try { if (matrixWork('instagram', row.permalink).itemId === work.itemId && safeId(row.id)) { mediaId = row.id; break; } } catch {} } after = result.paging?.after; if (!after || mediaId) break; assert(typeof after === 'string' && after.length <= 2000 && !cursors.has(after), '作品列表分页异常', 502); cursors.add(after); }
    assert(mediaId, '在当前授权账号最近 500 条作品内未找到该链接，请核对服务内账号与作品归属', 409);
    after = undefined; cursors.clear();
    for (let page = 0; page < 10 && rows.length < limit; page++) { await active(); const result = mcpValue(await client.call('instagram_list_comments', { mediaId, limit: Math.min(100, limit - rows.length), fetchAll: false, ...(after ? { after } : {}), ...scope(remoteAccount) })); assert(Array.isArray(result?.items), 'Instagram 评论列表不可读', 502); for (const row of result.items) { add({ id: row.id, text: row.text, date: row.timestamp, likes: row.like_count }); if (includeReplies) for (const reply of list(row.replies).slice(0, 1000)) add({ id: reply.id, text: reply.text, date: reply.timestamp, likes: reply.like_count }, row.id); } after = result.paging?.after; if (!after) break; assert(typeof after === 'string' && after.length <= 2000 && !cursors.has(after), '评论分页异常', 502); cursors.add(after); }
  } else if (platform === 'douyin') {
    const result = mcpValue(await client.call('douyin_comments', { url: work.canonical, max_comments: limit, time_budget_seconds: 45 })); assert(result?.aweme_id === work.itemId && Array.isArray(result.items), '抖音评论来源无法核对', 502); for (const row of result.items) { const parent = safeId(row.parent_comment_id); if (parent && !includeReplies) continue; add({ id: row.comment_id, text: row.text, date: row.published_at, likes: exactCount(row.likes) > 0 ? row.likes : null }, parent); }
  }
  await active(); return { rows, skipped, sourceUrl: work.canonical, platform, mode: 'page', includeReplies, limited: true, ...sourceMeta({ accountId, accountName }), notice: '仅导入本次实际读取的评论；回复可能只含平台返回的第一页，不表示完整评论。昵称、头像、IP 位置等资料未导入。' };
}

function publicMediaUrl(raw) { let url; try { url = new URL(raw); } catch { assert(false, '请填写平台可读取的公开 HTTPS 素材地址'); } assert(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && url.hostname.includes('.') && !isIP(url.hostname.replace(/^\[|\]$/g,'')) && !/(?:^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname) && raw.length <= 2048, '素材地址须为公开 HTTPS 域名，不能使用本机、内网 IP 或带账号密码的 URL'); return url.href; }
// Pure plan only: the caller must bind this to a frozen draft/account and obtain
// explicit final confirmation. This function itself never calls a write tool.
export function matrixPublishPlan(platform, draft, file, options = {}) {
  const image = draft?.mime?.startsWith('image/'), video = draft?.mime?.startsWith('video/'); assert(image || video, '该素材类型无法提交到平台');
  const title = typeof draft.title === 'string' ? draft.title.trim() : '', body = typeof draft.body === 'string' ? draft.body : ''; assert(title, '请填写作品标题');
  if (platform === 'youtube') { assert(video && typeof file === 'string' && file.length > 0, 'YouTube 仅支持上传本机视频文件'); assert(['private','public','unlisted'].includes(options.privacy), '请明确选择 YouTube 可见范围'); assert(title.length <= 100 && body.length <= 5000, 'YouTube 标题最多 100 字符，描述最多 5000 字符'); return { tool: 'youtube_videos_insert', args: { title, description: body, filePath: file, privacyStatus: options.privacy, categoryId: '22' }, notice: `上传到 YouTube，可见范围：${options.privacy}；最终状态以平台返回为准。` }; }
  if (platform === 'instagram') { const url = publicMediaUrl(options.publicMediaUrl); assert((title + '\n\n' + body).length <= 2200, 'Instagram 标题与正文合计需在 2200 字符内'); return { tool: image ? 'instagram_post_image' : 'instagram_post_reel', args: { ...(image ? { imageUrls: [url] } : { videoUrl: url }), caption: `${title}\n\n${body}`, apply: true, ...scope(options.remoteAccount) }, notice: '确认后将向 Instagram 当前专业账号发布；公开素材链接会由 Meta 读取。' }; }
  if (platform === 'tiktok') {
    const url = publicMediaUrl(options.publicMediaUrl), privacy = options.privacy === 'private' ? 'SELF_ONLY' : options.privacy, creator = options.creatorOptions;
    assert(['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'].includes(privacy), '请从 TikTok 当前账号提供的选项中选择可见范围');
    assert(Array.isArray(creator?.privacyOptions) && creator.privacyOptions.includes(privacy), '需先读取 TikTok 当前账号的发布权限，再确认可见范围');
    assert(typeof options.brandOrganic === 'boolean' && typeof options.brandContent === 'boolean' && typeof options.aiGenerated === 'boolean', '请确认是否为自有品牌宣传、付费合作及 AI 生成内容');
    assert(typeof options.allowComments === 'boolean' && (!video || typeof options.allowDuet === 'boolean' && typeof options.allowStitch === 'boolean'), '请确认 TikTok 评论及视频互动选项');
    assert(typeof creator.commentDisabled === 'boolean' && (!video || typeof creator.duetDisabled === 'boolean' && typeof creator.stitchDisabled === 'boolean'), '需要使用本次读取的 TikTok 账号互动权限');
    assert(!options.allowComments || !creator.commentDisabled, '当前 TikTok 账号禁止评论');
    if (video) { assert(!options.allowDuet || !creator.duetDisabled, '当前 TikTok 账号禁止合拍'); assert(!options.allowStitch || !creator.stitchDisabled, '当前 TikTok 账号禁止拼接'); assert(Number.isFinite(options.durationSeconds) && options.durationSeconds > 0 && Number.isFinite(creator.maxVideoDurationSeconds) && options.durationSeconds <= creator.maxVideoDurationSeconds, '需核对视频时长且不能超过当前 TikTok 账号允许的长度'); }
    assert(options.musicConfirmed === true && (!options.brandContent || options.brandedContentConfirmed === true), '发布前请确认 TikTok 音乐使用说明及适用的商业内容政策');
    assert(!(options.brandContent && privacy === 'SELF_ONLY'), 'TikTok 付费合作内容不能选择仅自己可见');
    assert(image ? title.length <= 90 && body.length <= 4000 : (title + '\n\n' + body).length <= 2200, 'TikTok 标题或正文超过当前发布类型限制');
    return { tool: image ? 'post_photos' : 'post_video', args: { ...(image ? { photo_urls: [url], title, description: body } : { video_url: url, title: `${title}\n\n${body}`, disable_duet: !options.allowDuet, disable_stitch: !options.allowStitch }), disable_comment: !options.allowComments, privacy_level: privacy, brand_organic_toggle: options.brandOrganic, brand_content_toggle: options.brandContent, is_aigc: options.aiGenerated, confirm: true, ...scope(options.remoteAccount) }, notice: 'TikTok 须具备发布权限并验证素材域名；返回任务编号只代表已受理，仍需检查最终发布状态。' };
  }
  assert(false, '这个平台使用其他发布适配器');
}

export function matrixPublishReceipt(platform, result) {
  const value = mcpValue(result);
  if (platform === 'youtube' && /^[\w-]{11}$/.test(value?.id || '')) return { state: 'submitted', itemId: value.id, url: `https://www.youtube.com/watch?v=${value.id}`, message: 'YouTube 已返回视频编号；处理、审核及可见范围请到平台核对。' };
  if (platform === 'tiktok' && safeId(value?.publish_id)) return { state: 'pending', jobId: value.publish_id, message: 'TikTok 已受理，尚未确认最终发布。请查看平台结果，不要重复提交。' };
  if (platform === 'instagram' && value?.status === 'in_progress' && safeId(value?.resume_container_id)) return { state: 'pending', jobId: value.resume_container_id, message: 'Instagram 仍在处理素材；请在平台核对，不要直接重复发布。' };
  if (platform === 'instagram' && value?.status === 'published' && safeId(value?.media_id)) return { state: 'submitted', itemId: value.media_id, message: 'Instagram 已返回作品编号；请在平台核对显示结果。' };
  return { state: 'unknown', message: '平台未返回可核对的发布结果，请先到平台检查，不要直接重复提交。' };
}
