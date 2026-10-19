import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assert, now, touch, activity } from './domain.mjs';
import { canUseCredentials } from './ai-routes.mjs';
import { researchURL, researchText } from './research-sources.mjs';
import { trendsOf } from './trends.mjs';

const chinaDate = timestamp => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
export function normalizeRedfoxHotspots(data) {
  const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return (Array.isArray(data) ? data : []).slice(0, 10).flatMap(group => (Array.isArray(group.hotSpotList) ? group.hotSpotList : []).slice(0, 10).flatMap(row => {
    const title = researchText(row.title, 200), url = researchURL(row.url);
    if (!title || !url) return [];
    const raw = String(row.latestRankDate || row.firstRankTime || '');
    const rankedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw.replace(' ', 'T') + '+08:00')) ? new Date(raw.replace(' ', 'T') + '+08:00').toISOString() : null;
    return [{ id: createHash('sha256').update(url + title).digest('hex').slice(0, 20), keyword: researchText(group.keyword, 100), platform: researchText(row.platName, 80), title, url, rank: count(row.maxPosition), heat: count(row.maxHotScore), rankedAt }];
  }));
}
export function mountRedfoxTrends(app, store, config, { project, activeJobs }) {
  const running = new Set();
  app.post('/api/projects/:id/trends/redfox', async (req, res) => {
    assert(canUseCredentials(req, config), '请在已解锁的工作区读取 Redfox 热榜', 403);
    z.object({ confirmed: z.literal(true) }).strict().parse(req.body);
    assert(config.redfox?.enabled('data'), '请先在连接与设置开启 Redfox 数据读取');
    const pid = req.params.id, p = project(store.get(), pid);
    assert(!running.has(pid), '此项目正在读取热榜，请等待完成', 409);
    const previous = p.trends?.redfoxHotspots;
    assert(!previous || Date.now() - Date.parse(previous.collectedAt) >= 60000, '刚刚已获取热榜，请一分钟后再更新', 429);
    running.add(pid);
    try {
      const at = Date.now(), end = Math.floor(at / 3600000) * 3600000 - 1000;
      const data = await config.redfox.request('trends.list', { startDate: chinaDate(end - 86400000), endDate: chinaDate(end) }, { projectId: pid, stage: 'hotspots' });
      const result = { collectedAt: now(), items: normalizeRedfoxHotspots(data), note: 'Redfox 近一天聚合热点，小时级更新。排名与热度仅限对应平台；上榜时间按北京时间解释，不是作品发布时间。' };
      store.mutate(state => { const p = project(state, pid); p.trends = { ...trendsOf(p), redfoxHotspots: result }; touch(p); activity(state, 'Redfox 平台热榜已读取', `${result.items.length} 条平台榜单记录`, pid); });
      res.json({ result, state: store.get() });
    } finally { running.delete(pid); }
  });
  app.post('/api/projects/:id/research/redfox-search-reset', (req, res) => {
    assert(canUseCredentials(req, config), '请在已解锁的工作区处理搜索任务', 403);
    z.object({ confirmed: z.literal(true) }).strict().parse(req.body);
    assert(!activeJobs.has(req.params.id), '研究正在运行，请等待完成后处理任务', 409);
    const result = store.mutate(state => {
      const p = project(state, req.params.id), job = p.redfoxWebSearch;
      assert(job && ['submitting','pending','uncertain','failed'].includes(job.status), '当前没有需要解除锁定的搜索任务', 409);
      p.redfoxWebSearchHistory = [...(p.redfoxWebSearchHistory || []), { id: job.id, taskId: job.taskId || '', status: job.status, at: now() }].slice(-10);
      delete p.redfoxWebSearch; touch(p); activity(state, 'Redfox 搜索锁定已解除', '已核对服务商记录；再次研究将提交新任务并计费', p.id);
      return { reset: true };
    });
    res.json({ result, state: store.get() });
  });
}
