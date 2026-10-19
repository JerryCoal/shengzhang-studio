import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canUseCredentials } from './ai-routes.mjs';
import { assert, touch, activity, id, now } from './domain.mjs';
import { classifyComment } from './comment-analysis.mjs';
import { importCapturedComments } from './comment-import.mjs';
import { saveMetricSnapshot } from './operating-data.mjs';
import { commentSource, sameCommentWork } from '../desktop/comment-source.mjs';
import { REDFOX_SOCIAL_OPERATIONS, redfoxSocialCapabilities } from './redfox-social-catalog.mjs';
import { redfoxXhsResearchPlan } from './redfox-research-plan.mjs';

const text = (value, max = 4000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0,max) : '';
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const capabilities = redfoxSocialCapabilities();
const price = operation => REDFOX_SOCIAL_OPERATIONS[operation].priceCny;
export function redfoxExactCount(value) {
  if (typeof value === 'string') {
    value = value.trim().replace(/(?:次观看|次播放|次阅读|次点赞|次分享|条评论| views?)$/i, '').trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
    value = Number(value.replaceAll(',',''));
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12 ? value : null;
}
export function redfoxDate(value, { domestic = false } = {}) {
  let time, dateBasis = 'redfox-publisher-time', dateNote = '';
  if (typeof value === 'number' && Number.isFinite(value)) time = value < 1e11 ? value * 1000 : value;
  else if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{10}(?:\d{3})?$/.test(raw)) time = Number(raw) * (raw.length === 10 ? 1000 : 1);
    else {
      let candidate = raw;
      if (domestic && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
        candidate = raw.replace(' ','T') + '+08:00'; dateBasis = 'redfox-publisher-time-assumed-Asia/Shanghai'; dateNote = '来源未提供时区，按中国标准时间（Asia/Shanghai，UTC+08:00）解释。';
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)) {
        const [year,month,day] = candidate.slice(0,10).split('-').map(Number);
        if (month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year,month,0)).getUTCDate()) time = Date.parse(candidate);
      }
    }
  }
  return Number.isFinite(time) && time >= 946684800000 && time <= Date.now() + 86400000
    ? { publishedAt:new Date(time).toISOString(), dateBasis, dateNote }
    : { publishedAt:'', dateBasis:'unknown', dateNote:text(value,120) ? `来源日期“${text(value,120)}”无法确定精确时区或时间，未用于近期分析。` : '来源未提供发布时间，未用采集时间代替。' };
}
function workURL(platform, itemId, value, handle, image) {
  assert(identifier(itemId), 'Redfox 返回的作品编号无效', 502);
  if (value) try { const work = commentSource(value); if (work.platform === platform && work.itemId === itemId) return work.canonical; } catch { /* construct only a documented canonical identifier */ }
  const url = platform === 'xiaohongshu' ? `https://www.xiaohongshu.com/explore/${itemId}` : platform === 'douyin' ? `https://www.douyin.com/video/${itemId}` : platform === 'youtube' ? `https://www.youtube.com/watch?v=${itemId}` : platform === 'instagram' ? `https://www.instagram.com/p/${itemId}/` : /^[A-Za-z0-9_.]{1,40}$/.test(handle || '') ? `https://www.tiktok.com/@${handle}/${image ? 'photo' : 'video'}/${itemId}` : '';
  const work = commentSource(url); assert(work.platform === platform && work.itemId === itemId, 'Redfox 返回的作品链接无法核对', 502); return work.canonical;
}
// Whitelist only public content and counters: no avatars, IP locations, cookies,
// signed media URLs, user profiles or provider instructions enter the workspace.
export function redfoxSocialItem(platform, input, { expectedId, sourceUrl, at = Date.now(), allowTitleFallback = true } = {}) {
  const value = object(input); let itemId, title, content, published, rawUrl, handle, noteType, stats;
  if (platform === 'douyin') {
    itemId = value.videoId; content = value.content; title = content; published = value.publishTime; rawUrl = value.opusUrl; noteType = String(value.videoType) === '68' ? 'image' : ['0','63'].includes(String(value.videoType)) ? 'video' : 'unknown';
    stats = {likes:value.likeCount,comments:value.commentCount,favorites:value.collectCount,shares:value.shareCount};
  } else if (platform === 'xiaohongshu') {
    itemId = value.workId; title = value.workTitle; content = value.workDesc; published = value.workPublishTime; rawUrl = value.workUrl; noteType = ['video','视频'].includes(value.workType) ? 'video' : ['normal','图文','image'].includes(value.workType) ? 'image' : 'unknown';
    stats = {views:value.workReadedCount,likes:value.workLikedCount,comments:value.workCommentsCount,favorites:value.workCollectedCount,shares:value.workSharedCount};
  } else if (platform === 'tiktok') {
    itemId = value.workId; title = value.content; content = value.content; published = value.publishTime; rawUrl = value.shareLink; handle = value.authorData?.userHandle; noteType = value.mediaType === 'photo' ? 'image' : value.mediaType === 'video' ? 'video' : 'unknown';
    stats = {views:value.statsData?.viewCount,likes:value.statsData?.likeCount,comments:value.statsData?.commentTotal,favorites:value.statsData?.favoriteCount,shares:value.statsData?.shareTotal};
  } else if (platform === 'youtube') {
    itemId = value.videoId; title = value.title; content = value.description; published = value.date || value.publishedTime; rawUrl = value.videoUrl; noteType = 'video';
    stats = {views:value.viewCount,likes:value.likeCount,comments:value.commentCount};
  } else if (platform === 'instagram') {
    itemId = value.code; title = value.captionText; content = value.captionText; published = value.takenAtDate || value.takenAt; noteType = value.isVideo === true || value.mediaType === 2 || value.mediaFormat === 'video' ? 'video' : value.isVideo === false || [1,8].includes(value.mediaType) || ['image','album'].includes(value.mediaFormat) ? 'image' : 'unknown';
    stats = {views:value.playCount,likes:value.likeCount,comments:value.commentCount,shares:value.shareCount};
  } else assert(false,'此平台暂不支持 Redfox 数据读取');
  assert(!expectedId || itemId === expectedId, 'Redfox 返回的作品与所选发布记录不一致', 502);
  const url = workURL(platform,itemId,sourceUrl || rawUrl,handle,noteType === 'image');
  const date = redfoxDate(published,{domestic:['douyin','xiaohongshu'].includes(platform)});
  return { kind:platform, platform, externalId:itemId, itemId, title:text(title,180) || text(content,180), text:text(content,12000) || (allowTitleFallback ? text(title,12000) : ''), url, sourceUrl:url, noteType,
    ...date, collectedAt:new Date(at).toISOString(), provider:'redfox', sourceName:'Redfox 公开数据', metrics:Object.fromEntries(['views','likes','comments','favorites','shares'].map(key=>[key,redfoxExactCount(stats[key])])) };
}
export function redfoxCommentRows(platform, input, expectedId, { limit = 50 } = {}) {
  const value = object(input), list = platform === 'xiaohongshu' || platform === 'tiktok' ? value.commentList : value.comments;
  assert(Array.isArray(list), 'Redfox 没有返回可识别的评论列表', 502);
  const rows = [], seen = new Set(); let bytes = 0;
  for (const raw of list.slice(0,1000)) {
    const value = object(raw), targetId = platform === 'xiaohongshu' ? value.noteId : platform === 'tiktok' ? value.workId : null;
    if (['xiaohongshu','tiktok'].includes(platform)) assert(targetId === expectedId,'Redfox 返回了其他作品的评论，已停止导入',502);
    const commentId = identifier(value.commentId), content = text(platform === 'instagram' ? value.text : value.content,4001);
    if (rows.length >= limit || !commentId || seen.has(commentId) || !content || content.length > 4000 || bytes + content.length > 120000) continue;
    const published = platform === 'xiaohongshu' ? value.createTime : platform === 'instagram' ? value.createdAt : platform === 'youtube' ? value.publishedTime : value.publishTime;
    const date = redfoxDate(published,{domestic:platform === 'xiaohongshu'}), likes = redfoxExactCount(platform === 'xiaohongshu' ? value.likeNum : value.likeCount);
    rows.push({text:content,platformCommentId:commentId,likes:likes !== null && likes <= 1e9 ? likes : null,timeLabel:text(published,100),isReply:false,...(date.publishedAt ? {commentAt:date.publishedAt} : {})});
    seen.add(commentId); bytes += content.length;
  }
  return rows;
}
const searchBody = (platform, query, discovery) => {
  if (platform === 'douyin') return {keyword:query,exactMatch:false,pageNum:1,pageSize:20};
  if (platform === 'xiaohongshu') return {keyword:query,offset:0,sortType:['week','month'].includes(discovery?.timeRange) ? '_2' : discovery?.sortBy === 'general' ? '_0' : '_4',exactMatch:false};
  if (platform === 'tiktok') return {keyword:query,offset:'0',count:'20',sortType:'0',publishTime:discovery?.timeRange === 'week' ? '7' : discovery?.timeRange === 'month' ? '30' : '0',region:'US'};
  if (platform === 'youtube') return {searchQuery:query};
  return {keyword:query};
};
const detailBody = (platform,itemId) => platform === 'douyin' || platform === 'youtube' ? {videoId:itemId} : platform === 'xiaohongshu' ? {workId:itemId} : platform === 'tiktok' ? {awemeId:itemId} : {codeOrUrl:itemId};
const commentsBody = (platform,itemId,limit) => platform === 'xiaohongshu' ? {opusId:itemId,dataNum:limit} : platform === 'tiktok' ? {aweme_id:itemId,cursor:0} : platform === 'youtube' ? {videoId:itemId,languageCode:'zh-CN',countryCode:'US',sortBy:'newest'} : {codeOrUrl:itemId,sortBy:'recent'};

async function researchXhs(request, { projectId, queries, at, assertActive, discovery, expanded }) {
  const plan = redfoxXhsResearchPlan(queries.length, expanded), reports = [], candidates = [], seen = new Set();
  const context = { projectId, platform: 'xiaohongshu' };
  const searchOperation = 'social.search.xiaohongshu', detailOperation = 'social.detail.xiaohongshu';
  const emptyStats = () => ({ rawCount: 0, normalizedCount: 0, invalidCount: 0, duplicateCount: 0, missingDateCount: 0, emptyContentCount: 0, searchRequests: 0, detailRequests: 0 });
  let stopped = false, searchRequests = 0, detailRequests = 0;
  const safeFailure = error => error?.redfoxSafe ? error.message : 'Redfox 读取未完成；已保留本轮此前取得的样本，没有重试或切换服务。';
  async function read(operation, body, report) {
    assertActive();
    if (operation === searchOperation) { searchRequests++; report.stats.searchRequests++; }
    else { detailRequests++; report.stats.detailRequests++; }
    try { return await request(operation, body, context); }
    finally { assertActive(); }
  }
  for (const query of queries) {
    const report = { sourceId: 'xiaohongshu', name: 'Redfox 公开数据', status: 'ok', count: 0, message: '', stats: emptyStats() };
    reports.push(report);
    for (let page = 0; page < plan.maxPagesPerKeyword; page++) {
      try {
        const result = await read(searchOperation, { ...searchBody('xiaohongshu', query, discovery), offset: page * 20 }, report);
        if (!Array.isArray(result?.list)) { report.stats.invalidCount++; throw Error('incompatible search response'); }
        const list = result.list.slice(0, 50); report.stats.rawCount += list.length;
        let fresh = 0;
        for (const raw of list) {
          let item;
          try { item = redfoxSocialItem('xiaohongshu', raw, { at, allowTitleFallback: false }); }
          catch { report.stats.invalidCount++; continue; }
          report.stats.normalizedCount++;
          if (seen.has(item.url)) { report.stats.duplicateCount++; continue; }
          seen.add(item.url); fresh++;
          candidates.push({ item, raw, report });
        }
        // A provider may ignore offset. Do not spend another call on an empty or
        // entirely repeated page, nor when it explicitly reports the final page.
        if (!list.length || !fresh || result.hasMore === false) break;
      } catch (error) {
        assertActive(); report.status = 'failed'; report.message = safeFailure(error); stopped = true; break;
      }
    }
    if (stopped) break;
  }
  const windowMs = discovery?.timeRange === 'all' ? Infinity : (discovery?.timeRange === 'month' ? 30 : 7) * 86400000;
  for (const candidate of candidates) {
    const { item, raw, report } = candidate;
    const published = Date.parse(item.publishedAt);
    const expired = Number.isFinite(published) && at - published > windowMs;
    if (stopped || detailRequests >= plan.maxDetails || expired || (item.text && item.publishedAt)) continue;
    try {
      const detail = await read(detailOperation, { workId: item.itemId }, report);
      // Check the detail object before merging; missing/wrong IDs must never be
      // filled from the search row, which could join evidence from two works.
      try { redfoxSocialItem('xiaohongshu', detail, { expectedId: item.itemId, at, allowTitleFallback: false }); }
      catch { report.stats.invalidCount++; throw Error('incompatible detail response'); }
      const merged = { ...raw };
      for (const [key, value] of Object.entries(detail)) if (value !== undefined && value !== null && value !== '') merged[key] = value;
      // Enrich missing evidence without replacing an already verified search
      // timestamp/body with an empty or less precise detail field.
      if (item.text) merged.workDesc = raw.workDesc;
      if (item.publishedAt) merged.workPublishTime = raw.workPublishTime;
      candidate.item = redfoxSocialItem('xiaohongshu', merged, { expectedId: item.itemId, at, allowTitleFallback: false });
    } catch (error) {
      assertActive(); report.status = 'failed'; report.message = safeFailure(error); stopped = true;
    }
  }
  const items = [], pendingReferences = [];
  for (const { item, report } of candidates) {
    if (!item.publishedAt) report.stats.missingDateCount++;
    if (!item.text) report.stats.emptyContentCount++;
    if (!item.publishedAt || !item.text) {
      const missing = [!item.publishedAt && '缺少可核对的精确发布时间', !item.text && '缺少可核对的正文'].filter(Boolean).join('；');
      pendingReferences.push({ title: item.title, url: item.url, reason: `${missing}，仅保留为线索，未用于分析。` });
      continue;
    }
    items.push(item); report.count++;
  }
  for (const report of reports) if (report.status === 'ok') {
    const s = report.stats;
    report.message = `已读取 ${s.searchRequests} 页样本${s.detailRequests ? `，另核对 ${s.detailRequests} 条详情` : ''}；不代表全平台热榜。${s.invalidCount ? ` ${s.invalidCount} 条格式无法核对。` : ''}${s.missingDateCount || s.emptyContentCount ? '缺少正文或精确日期的内容仅保留为线索。' : ''}`;
  }
  const estimatedCny = searchRequests * price(searchOperation) + detailRequests * price(detailOperation);
  return { items, reports, pendingReferences, cost: { requests: searchRequests + detailRequests, estimatedCny: Math.round(estimatedCny * 10000) / 10000 } };
}

export function mountRedfoxSocial(app, store, config, { project, activeJobs }) {
  const previews = new Map(), polling = new Set();
  const actorId = req => req.teamUser?.userId || config.getActor?.()?.userId || '';
  const local = req => assert(canUseCredentials(req,config), '请从已解锁的工作区读取公开数据',403);
  const ready = req => { local(req); assert(config.redfox?.enabled('data'),'请在连接设置启用 Redfox 数据读取'); };
  const context = target => ({projectId:target.projectId,accountId:target.accountId || undefined,platform:target.platform});
  function target(req) {
    const p = project(store.get(),req.params.id), pub = p.publications.find(item => item.id === req.params.publicationId);
    assert(pub?.status === 'published' && !pub.sample, '请先登记自己作品的真实发布结果');
    const work = commentSource(pub.url); assert(work.itemId && work.platform === pub.platform, '请在发布记录填写含作品编号的完整链接');
    return {projectId:p.id,publicationId:pub.id,accountId:pub.accountId || '',platform:work.platform,itemId:work.itemId,sourceUrl:work.canonical,actorId:actorId(req),publishedAt:pub.publishedAt || ''};
  }
  const sameTarget = (a,b) => ['projectId','publicationId','accountId','platform','itemId','actorId','publishedAt'].every(key => a[key] === b[key]);
  const checkTarget = (req,snapshot) => assert(sameTarget(target(req),snapshot),'作品归属或发布记录已变化，请重新读取',409);
  function preview(snapshot, kind, value) {
    for (const [key,row] of previews) if (row.expires < Date.now()) previews.delete(key);
    while (previews.size >= 40) previews.delete(previews.keys().next().value);
    const previewId = randomUUID(), result = {...value,previewId,provider:'redfox',platform:snapshot.platform,itemId:snapshot.itemId,sourceUrl:snapshot.sourceUrl};
    previews.set(previewId,{...snapshot,kind,result,expires:Date.now()+30*60000}); return result;
  }
  function getPreview(req,input,kind) {
    local(req); const saved = previews.get(input.previewId);
    assert(saved && saved.kind === kind && saved.expires > Date.now() && sameTarget(saved,target(req)),'预览已过期、操作人或作品不匹配，请重新读取',409); return saved;
  }
  async function locked(req,work) {
    const pid = req.params.id; assert(!activeJobs.has(pid),'此项目正在执行任务，请等待完成',409); activeJobs.add(pid);
    try { return await work(); } finally { activeJobs.delete(pid); }
  }
  function researchStatus(req,{platform}) {
    const cap = capabilities.find(item => item.platform === platform), enabled = canUseCredentials(req,config) && !!config.redfox?.enabled('data'), configured = enabled && !!config.redfox.status().configured;
    return {provider:'redfox',enabled,configured,supported:!!cap?.search,accounts:[],costs:cap?.costs,note:configured ? 'Redfox 公开数据读取，不需要平台登录。默认每词一页；小红书明确开启补充采集后每词最多两页、全轮最多另读三条详情。YouTube 每词最多另读三条详情。' : enabled ? 'Redfox 数据读取已开启，但密钥不可用；请重新保存密钥。系统不会自动切换 MCP。' : '请在连接设置保存 Redfox 密钥并启用数据读取。'};
  }
  async function researchSearch(req,{projectId,platform,queries,at=Date.now(),assertActive=()=>{},discovery,redfoxXhsExpansion=false}) {
    ready(req); assert(capabilities.some(cap=>cap.platform===platform && cap.search),'此平台尚无 Redfox 搜索接口');
    assert(Array.isArray(queries) && queries.length > 0,'请提供搜索关键词');
    assert(typeof redfoxXhsExpansion === 'boolean','小红书补充采集选项无效');
    if (platform === 'xiaohongshu') {
      const selected = queries.slice(0,3);
      for (const query of selected) assert(typeof query === 'string' && query.trim() && query.length <= 150,'搜索关键词无效');
      return researchXhs((...args) => config.redfox.request(...args), { projectId, queries: [...new Set(selected.map(query => query.trim()))], at, assertActive, discovery, expanded: redfoxXhsExpansion });
    }
    const items=[],reports=[],pendingReferences=[],seen=new Set(); let requests=0;
    for (const query of queries.slice(0,3)) {
      assert(typeof query === 'string' && query.trim() && query.length <= 150,'搜索关键词无效'); assertActive();
      try {
      const operation=`social.search.${platform}`; requests++;
      const result = await config.redfox.request(operation,searchBody(platform,query,discovery),{projectId,platform}); assertActive();
      const list = platform==='tiktok' ? result : platform==='youtube' ? result?.videos : platform==='instagram' ? result?.items : result?.list;
      assert(Array.isArray(list),'Redfox 返回的搜索结果格式不兼容',502);
      let count=0,details=0;
      for (const raw of list.slice(0,50)) {
        let item;
        try { item=redfoxSocialItem(platform,raw,{at}); } catch { continue; }
        if (seen.has(item.url)) continue; seen.add(item.url);
        if (platform==='youtube' && !item.publishedAt && details<3) {
          assertActive(); requests++; details++; const data=await config.redfox.request(`social.detail.${platform}`,detailBody(platform,item.itemId),{projectId,platform}); assertActive();
          item=redfoxSocialItem(platform,data,{expectedId:item.itemId,at});
        }
        if (!item.publishedAt) { pendingReferences.push({title:item.title,url:item.url,reason:item.dateNote}); continue; }
        items.push(item); count++;
      }
      reports.push({sourceId:platform,name:'Redfox 公开数据',status:'ok',count,message:`已读取一页样本${details ? `，另核对 ${details} 条详情` : ''}；不代表全平台热榜。无精确日期内容仅保留为线索。`});
      } catch(error) {
        assertActive(); reports.push({sourceId:platform,name:'Redfox 公开数据',status:'failed',count:0,message:error.redfoxSafe ? error.message : 'Redfox 读取未完成；已保留本轮此前取得的样本，没有重试或切换服务。'});
        break;
      }
    }
    return {items,reports,pendingReferences,cost:{requests,estimatedCny:requests*price(`social.search.${platform}`)}};
  }
  const base='/api/projects/:id/publications/:publicationId/redfox';
  app.post(`${base}/detail`,async(req,res)=>{
    ready(req); z.object({confirmed:z.literal(true)}).strict().parse(req.body);
    await locked(req,async()=>{
      const snapshot=target(req), operation=`social.detail.${snapshot.platform}`;
      const data=await config.redfox.request(operation,detailBody(snapshot.platform,snapshot.itemId),context(snapshot)); checkTarget(req,snapshot);
      const result=redfoxSocialItem(snapshot.platform,data,{expectedId:snapshot.itemId,sourceUrl:snapshot.sourceUrl});
      res.json(preview(snapshot,'detail',{title:result.title,text:result.text,metrics:result.metrics,capturedAt:result.collectedAt,notice:'公开作品指标可能延迟更新；采集时间为本次读取时间。缺失或缩写的计数保持为空。保存指标不改变发布状态。',cost:{requests:1,estimatedCny:price(operation)}}));
    });
  });
  app.post(`${base}/detail/import`,(req,res)=>{
    const input=z.object({previewId:z.string().uuid(),confirmed:z.literal(true)}).strict().parse(req.body), saved=getPreview(req,input,'detail');
    assert(!activeJobs.has(req.params.id),'请等待当前项目任务结束',409);
    const result=store.mutate(state=>{const p=project(state,req.params.id), row=saveMetricSnapshot(p,{publicationId:saved.publicationId,capturedAt:saved.result.capturedAt,metrics:saved.result.metrics,source:'redfox',sourceUrl:saved.sourceUrl,confirmed:true,note:'Redfox 公开作品指标；缺失项未补零。'},Date.now,{verifiedProvider:'redfox'});touch(p);activity(state,'作品公开指标已保存',saved.platform,p.id);return row;});
    previews.delete(input.previewId);res.json({result,state:store.get()});
  });
  const commentResult = (snapshot,data,limit,cost) => preview(snapshot,'comments',{rows:redfoxCommentRows(snapshot.platform,data,snapshot.itemId,{limit}),mode:'page',limited:true,notice:'本次为部分公开评论，不含回复；请核对后勾选导入。评论作者资料不保存。',cost});
  const ownsJob = (job,snapshot) => ['projectId','publicationId','actorId'].every(key=>job[key]===snapshot[key]);
  const jobOf = (req,jobId,{allowChangedTarget=false}={}) => { const snapshot=target(req), p=project(store.get(),snapshot.projectId), job=(p.redfoxCommentJobs || []).find(row=>row.id===jobId); assert(job && (allowChangedTarget ? ownsJob(job,snapshot) : sameTarget(job,snapshot)),'采集任务不存在，或操作人、作品归属不匹配',409);return job; };
  function updateJob(snapshot,jobId,change) { store.mutate(state=>{const p=project(state,snapshot.projectId),job=p.redfoxCommentJobs?.find(row=>row.id===jobId);assert(job,'采集任务不存在',409);Object.assign(job,change);touch(p);}); }
  const pending = job => ({pending:true,jobId:job.id,provider:'redfox',status:job.status,cost:{requests:1,estimatedCny:.06},notice:'评论采集已提交。请稍后免费查询结果；查询不会再次提交收费任务。'});
  app.get(`${base}/comments/status`,(req,res)=>{
    local(req);const snapshot=target(req),p=project(store.get(),snapshot.projectId),last=[...(p.redfoxCommentJobs || [])].reverse().find(row=>ownsJob(row,snapshot));
    const job=last && ['pending','processing','submitting','uncertain','completed','failed'].includes(last.status) ? last : null;
    res.json(job ? {...pending(job),...(!sameTarget(job,snapshot) ? {notice:'此任务的作品归属已变化，不能继续导入；请核对并结束旧任务。'} : job.status==='uncertain' || job.status==='submitting' ? {notice:'上次提交结果未确认，没有自动重试；请先核对 Redfox 账单与任务。'} : {})} : {pending:false});
  });
  app.post(`${base}/comments`,async(req,res)=>{
    ready(req);const input=z.object({confirmed:z.literal(true),limit:z.number().int().min(1).max(200).default(50),includeReplies:z.literal(false).optional()}).strict().parse(req.body);
    await locked(req,async()=>{
      const snapshot=target(req);assert(capabilities.find(cap=>cap.platform===snapshot.platform)?.comments,'此平台的 Redfox 接口暂不提供评论读取');
      const operation=`social.comments.${snapshot.platform}`;
      if(snapshot.platform!=='xiaohongshu') {const data=await config.redfox.request(operation,commentsBody(snapshot.platform,snapshot.itemId,input.limit),context(snapshot));checkTarget(req,snapshot);return res.json(commentResult(snapshot,data,input.limit,{requests:1,estimatedCny:price(operation)}));}
      const existing=(project(store.get(),snapshot.projectId).redfoxCommentJobs || []).find(job=>job.publicationId===snapshot.publicationId && ['pending','processing','submitting','uncertain','completed'].includes(job.status));
      assert(!existing,'此作品已有未完成或结果未确认的评论采集，请查询已有任务，避免重复付费',409);
      const jobId=randomUUID();
      store.mutate(state=>{const p=project(state,snapshot.projectId);p.redfoxCommentJobs||=[];if(p.redfoxCommentJobs.length>=200)p.redfoxCommentJobs=p.redfoxCommentJobs.filter(job=>!['abandoned','imported','failed'].includes(job.status));assert(p.redfoxCommentJobs.length<200,'未结束的评论采集任务已达上限，请先核对并结束旧任务');p.redfoxCommentJobs.push({...snapshot,id:jobId,status:'submitting',limit:input.limit,createdAt:now()});touch(p);});
      try {
        const data=await config.redfox.request(operation,commentsBody(snapshot.platform,snapshot.itemId,input.limit),context(snapshot));
        assert(identifier(data?.taskId),'Redfox 未返回可核对的评论任务编号，请核对账单，勿重复提交',502);
        updateJob(snapshot,jobId,{providerTaskId:data.taskId,status:['pending','processing'].includes(data.status)?data.status:'pending'});checkTarget(req,snapshot);
        res.status(202).json(pending(jobOf(req,jobId)));
      } catch(error) {updateJob(snapshot,jobId,{status:'uncertain'});throw error;}
    });
  });
  app.post(`${base}/comments/status`,async(req,res)=>{
    ready(req);const input=z.object({jobId:z.string().uuid()}).strict().parse(req.body),job=structuredClone(jobOf(req,input.jobId));
    assert(identifier(job.providerTaskId),'上次提交未取得任务编号，请核对 Redfox 任务与账单，勿重复提交',409);
    assert(!polling.has(job.id),'此任务正在查询，请等待',409); polling.add(job.id);
    try {
      const data=await config.redfox.request('social.comments-result.xiaohongshu',{taskId:job.providerTaskId},context(job));checkTarget(req,job);
      assert(data?.taskId===job.providerTaskId,'Redfox 返回的任务编号不匹配',502);
      if (['pending','processing'].includes(data.status)) {updateJob(job,job.id,{status:data.status});return res.status(202).json({...pending({...job,status:data.status}),cost:{requests:1,estimatedCny:0}});}
      if (['failed','error','cancelled'].includes(data.status)) { updateJob(job,job.id,{status:'failed',completedAt:now()});assert(false,'Redfox 评论任务失败；没有重新提交，请核对控制台后决定是否重新采集',502); }
      assert(data.status==='completed','Redfox 评论任务状态无法确认，请核对控制台；不会自动重新提交',502);
      const result=commentResult(job,data,job.limit,{requests:1,estimatedCny:0});updateJob(job,job.id,{status:'completed',completedAt:now()});res.json({...result,jobId:job.id});
    } finally {polling.delete(job.id);}
  });
  app.post(`${base}/comments/reset`,(req,res)=>{
    local(req);const input=z.object({jobId:z.string().uuid(),confirmed:z.literal(true)}).strict().parse(req.body),job=jobOf(req,input.jobId,{allowChangedTarget:true});
    assert(!activeJobs.has(req.params.id) && !polling.has(job.id),'请等待当前读取请求结束后核对任务',409);
    updateJob(job,job.id,{status:'abandoned',completedAt:now()});res.json({pending:false,notice:'已结束本地跟踪；没有取消上游任务、退款或重新提交请求。'});
  });
  app.post(`${base}/comments/import`,(req,res)=>{
    const input=z.object({previewId:z.string().uuid(),confirmed:z.literal(true),indices:z.array(z.number().int().min(0).max(199)).min(1).max(200)}).strict().parse(req.body),saved=getPreview(req,input,'comments');
    assert(!activeJobs.has(req.params.id),'请等待当前项目任务结束',409);
    const rows=[...new Set(input.indices)].map(index=>saved.result.rows[index]);assert(rows.every(Boolean),'勾选评论编号无效');
    const result=store.mutate(state=>{const p=project(state,req.params.id),result=importCapturedComments(p,{source:'redfox',publicationId:saved.publicationId,sourceUrl:saved.sourceUrl,mode:'page',confirmed:true,rows},{assert,id,now,classify:classifyComment,touch,verifiedProvider:'redfox'});activity(state,'Redfox 评论已导入',`${result.added} 条新增评论`,p.id);return result;});
    if (saved.id) updateJob(saved,saved.id,{status:'imported',importedAt:now()});
    previews.delete(input.previewId);res.json({result,state:store.get()});
  });
  return {researchStatus,researchSearch,close(){previews.clear();polling.clear();}};
}
