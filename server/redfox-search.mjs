import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assert, now, touch } from './domain.mjs';
import { researchURL, researchText } from './research-sources.mjs';
import { enrichResearchPages } from './research-page-reader.mjs';
import { currentActor } from './request-actor.mjs';

export function redfoxWebReferences(data, at = Date.now()) {
  const pages = data?.result?.webPages;
  if (!Array.isArray(pages)) return [];
  return pages.slice(0, 24).flatMap(page => {
    const url = researchURL(page?.url), title = researchText(page?.title, 200);
    if (!url || !title) return [];
    const publishedAt = typeof page.publishTime === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(page.publishTime) && Number.isFinite(Date.parse(page.publishTime)) ? new Date(page.publishTime).toISOString() : null;
    return [{ kind: 'web', provider: 'redfox', title, url, text: researchText(page.snippet, 1200), publishedAt, collectedAt: new Date(at).toISOString(), dateBasis: 'redfox-search-metadata', sourceName: `Redfox · ${researchText(page.siteName, 80) || new URL(url).hostname}`, metrics: null }];
  });
}

// Only keywords leave this function. Kimi's generated answer is deliberately
// not evidence: returned source pages must pass the existing original-page reader.
export async function searchRedfoxWeb(store, config, { projectId, queries, assertActive = () => {}, at = Date.now() }) {
  assert(config.redfox?.enabled('search'), '请先开启 Redfox 联网搜索');
  const keywords = queries.map(value => String(value).trim().slice(0, 150)).filter(Boolean).slice(0, 8);
  assert(keywords.length, '请填写检索关键词');
  const fingerprint = createHash('sha256').update(JSON.stringify(keywords)).digest('hex');
  const project = () => { const p = store.get().projects.find(p => p.id === projectId); assert(p, '项目不存在', 404); return p; };
  let job = project().redfoxWebSearch;
  const update = value => store.mutate(state => { const p = state.projects.find(p => p.id === projectId); if (!p || p.redfoxWebSearch?.id !== job.id) return; Object.assign(p.redfoxWebSearch, value); touch(p); });
  // A process can exit after the provider accepted the request but before the
  // task ID was saved. Treat persisted submitting records as uncertain too.
  if (['uncertain', 'submitting'].includes(job?.status) && !job.taskId) throw Object.assign(new Error('上次 Redfox 搜索提交结果不明，请在 Redfox 控制台核对后，在连接设置解除搜索锁定。'), { status: 409 });
  if (job?.taskId && ['submitting', 'pending'].includes(job.status) && job.fingerprint !== fingerprint) throw Object.assign(new Error('此项目有未完成的 Redfox 搜索，请按原关键词继续查询结果后再更换关键词。'), { status: 409 });
  const reuse = job?.fingerprint === fingerprint && (job.taskId && ['submitting','pending'].includes(job.status) || job.status === 'completed' && at - Date.parse(job.completedAt) < 600000);
  if (!reuse) {
    job = { id: randomUUID(), fingerprint, status: 'submitting', createdAt: now(), initiatedBy: currentActor() ? { ...currentActor() } : null };
    store.mutate(state => { const p = state.projects.find(p => p.id === projectId); p.redfoxWebSearch = job; touch(p); });
    try {
      assertActive();
      const result = await config.redfox.request('search.submit', { inquiryText: `查找近七天与以下关键词有关的公开原始报道。列出可访问的原文链接和真实发布时间，不推测日期。关键词：${keywords.join('、')}` }, { projectId, stage: 'web-research' });
      assert(typeof result?.taskId === 'string' && /^[\w-]{1,200}$/.test(result.taskId), 'Redfox 未返回可查询的搜索任务编号', 502);
      job = { ...job, taskId: result.taskId, status: 'pending' }; update({ taskId: job.taskId, status: 'pending' });
    } catch (error) { update({ status: 'uncertain' }); throw error; }
  }
  let data = job.result;
  if (job.status !== 'completed') {
    const rounds = config.redfoxSearchPollRounds ?? 20;
    for (let i = 0; i < rounds; i++) {
      assertActive();
      data = await config.redfox.request('search.result', { taskId: job.taskId }, { projectId, taskId: job.taskId, initiatedBy: job.initiatedBy, stage: 'web-research-query' });
      // The current public response has no taskId field. If one is supplied,
      // never accept a different task's result; otherwise trust this fixed query.
      assert(data?.taskId === undefined || data.taskId === job.taskId, 'Redfox 返回的搜索任务编号不匹配', 502);
      if (data?.completed === true || data?.status === 'completed') {
        const webPages = redfoxWebReferences(data, at).map(page => ({ title: page.title, url: page.url, snippet: page.text, publishTime: page.publishedAt, siteName: page.sourceName.replace(/^Redfox · /, '') }));
        // Persist only bounded source clues, never the AI answer or arbitrary
        // upstream object fields. Original-page verification still runs below.
        data = { result: { webPages } };
        update({ status: 'completed', completedAt: now(), result: data }); break;
      }
      if (data?.failReason || ['failed','error','cancelled'].includes(data?.status)) { update({ status: 'failed' }); throw Object.assign(new Error('Redfox 联网搜索失败，请核对服务商任务记录；未自动重新提交。'), { status: 502 }); }
      if (i === rounds - 1) throw Object.assign(new Error('Redfox 搜索仍在处理。稍后用相同关键词再试，将继续查询原任务，不会重新提交。'), { status: 409 });
      await delay(config.redfoxSearchPollMs ?? 3000);
    }
  }
  assertActive();
  const candidates = redfoxWebReferences(data, at);
  const read = await enrichResearchPages(candidates, { fetcher: config.researchPageFetcher, resolver: config.researchPageResolver, at, assertActive });
  return { items: read.items, reports: [{ sourceId: 'web', name: 'Redfox · Kimi 联网搜索', status: 'ok', count: read.items.length, message: '已读取搜索结果中的原始网页。AI 搜索回答未作为证据；缺少可核对原文或日期的来源不会进入近七天分析。' }, ...read.reports], pendingReferences: candidates.filter(item => !read.items.some(found => found.url === item.url && found.publishedAt && found.text)).map(item => ({ title: item.title, url: item.url, reason: '尚未取得可核对的原文与明确发布时间' })) };
}
