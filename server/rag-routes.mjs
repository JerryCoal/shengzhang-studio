import { z } from 'zod';
import * as d from './domain.mjs';
import { isLocalClient } from './ai-routes.mjs';
import { searchCorpus } from './workflow.mjs';
import { planIndex, buildIndex, retrieve, indexReady, estimateQueryCny } from './rag.mjs';

const BUDGET_CNY = 1;
const CONSENT_VERSION = 'qwen-rag-2026-10-14';
const spent = p => (p.ragPreviousCny || 0) + (p.ragUsage || []).reduce((n, u) => n + u.amountCny, 0);
const stamp = p => {
  let fingerprint;
  // Optional vectors must not invalidate legacy keyword-only corpora.
  if (p.ragEnabled) { try { fingerprint = planIndex(p).fingerprint; } catch { fingerprint = 'invalid-corpus'; } }
  return JSON.stringify([fingerprint, !!p.ragEnabled, p.ragIndex?.builtAt, p.ragConsent?.version, p.ragRevision || 0]);
};

// This adapter is intentionally unavailable to the stateless web relay and to
// unencrypted legacy workspaces. The profile store seals the entire index.
export function mountRagRoutes(app, store, config, { project, activeJobs }) {
  const available = req => config.profileMode === true && !config.authorizeCredentials && isLocalClient(req);
  const requireLocal = req => d.assert(available(req), 'Qwen 语义检索目前需要 Windows 版的本地加密工作区；当前继续使用关键词检索。', 403);
  const credential = () => config.qwenVault?.status() || {};
  async function key(req) {
    requireLocal(req);
    d.assert(config.getQwenConnection().ragSupported, '当前 Qwen 地域可用于文字生成；本版语义检索的模型和预算按北京地域核验，请切换为北京地域配套 API Key，或关闭语义检索使用本地关键词。尚未发送向量请求。');
    const status = credential();
    d.assert(status.configured && !status.problem, '请先在连接与设置中保存 Qwen 的北京地域 API 密钥，并开通 text-embedding-v4。');
    const value = await config.qwenVault.getKey();
    d.assert(value, 'Qwen 密钥不可用，请重新保存。');
    return value;
  }
  const status = (req, p) => ({ available: available(req), configured: available(req) && !!credential().configured && !credential().problem && config.getQwenConnection().ragSupported,
    region: config.getQwenConnection().region, connectionSupported: config.getQwenConnection().ragSupported,
    enabled: !!p.ragEnabled, ready: indexReady(p), plan: planIndex(p), builtAt: p.ragIndex?.builtAt || null,
    model: 'text-embedding-v4', dimensions: 512, usageCny: spent(p), budgetCny: BUDGET_CNY });

  async function charged(req, snapshot, operation, reservation, work, valid) {
    const apiKey = await key(req);
    d.assert(valid(project(store.get(), snapshot.id)), '语料或检索设置已修改，请刷新后再试。', 409);
    let jobId, reported = 0, tokens = 0, estimated = false, calls = 0, upstreamStatus = 'completed';
    store.mutate(state => {
      const p = project(state, snapshot.id);
      d.assert(spent(p) + reservation <= BUDGET_CNY + 1e-9, '本项目 Qwen 检索的 1 元实验预算已用完；请关闭语义检索继续使用本地关键词。');
      p.ragUsage ||= [];
      while (p.ragUsage.length >= 200) p.ragPreviousCny = (p.ragPreviousCny || 0) + p.ragUsage.shift().amountCny;
      jobId = d.id();
      p.ragUsage.push({ id: jobId, operation, model: 'text-embedding-v4', at: d.now(), status: 'running', amountCny: reservation, estimated: true, tokens: null, note: '请求中；按 UTF-8 字节上界预留，实际费用以百炼账单为准。' });
      d.touch(p);
    });
    const onUsage = usage => {
      calls++; reported += usage.amountCny; tokens += usage.tokens || 0; estimated ||= usage.estimated;
      if (usage.status === 'uncertain' || (usage.status === 'failed' && upstreamStatus === 'completed')) upstreamStatus = usage.status;
      store.mutate(state => {
        const p = project(state, snapshot.id), row = p.ragUsage.find(u => u.id === jobId);
        Object.assign(row, { reportedCny: reported, tokens, calls });
      });
      d.assert(spent(project(store.get(), snapshot.id)) - reservation + reported <= BUDGET_CNY + 1e-9, '返回用量超过本项目检索预算，已停止后续请求；请核对百炼账单。');
      d.assert(valid(project(store.get(), snapshot.id)), '请求期间语料或检索设置已修改，已停止后续请求；已发生用量保留。', 409);
    };
    try {
      const result = await work({ key: apiKey, fetcher: config.ragFetcher, onUsage });
      d.assert(valid(project(store.get(), snapshot.id)), '请求期间语料或检索设置已修改，请重新操作。', 409);
      finish('completed'); return result;
    } catch (error) { finish(calls && estimated ? 'uncertain' : 'failed'); throw error; }
    function finish(outcome) {
      store.mutate(state => {
        const p = project(state, snapshot.id), row = p.ragUsage.find(u => u.id === jobId);
        Object.assign(row, { status: upstreamStatus === 'uncertain' ? 'uncertain' : outcome === 'completed' ? upstreamStatus : outcome, amountCny: reported, estimated, tokens, calls,
          note: estimated ? '包含未返回有效用量的请求估算，请核对百炼账单。' : '按返回 token 与 0.5 元/百万 token 估算，实际费用以百炼账单为准。' });
        delete row.reportedCny; d.touch(p);
      });
    }
  }

  async function search(req, snapshot, query) {
    if (!snapshot.ragEnabled || !available(req) || snapshot.ragConsent?.version !== CONSENT_VERSION || !indexReady(snapshot)) {
      return { results: searchCorpus(snapshot, query), method: 'keyword', note: snapshot.ragEnabled ? '语义索引未就绪或当前环境不支持，使用本地关键词检索；未调用 Qwen。' : '本地关键词检索，未调用 Qwen。' };
    }
    if (!query.trim()) return { results: [], method: 'keyword', note: '请输入要检索的问题。' };
    if (!credential().configured || credential().problem || spent(snapshot) + estimateQueryCny(query) > BUDGET_CNY + 1e-9) {
      return { results: searchCorpus(snapshot, query), method: 'keyword', note: 'Qwen 密钥不可用或本项目 1 元检索预算不足，已使用本地关键词；未调用向量模型。' };
    }
    const original = stamp(snapshot);
    const output = await charged(req, snapshot, 'search', estimateQueryCny(query), options => retrieve(snapshot, query, options), p => stamp(p) === original);
    return { ...output, note: output.method === 'hybrid' ? '关键词与 Qwen 语义混合检索；排序分数不代表事实可信度。' : 'Qwen 检索未完成，已使用本地关键词。请检查 Qwen 连接，并在语料页及百炼控制台核对请求用量。' };
  }
  const path = '/api/projects/:id/corpus/rag';
  app.get(path, (req, res) => res.json(status(req, project(store.get(), req.params.id))));
  app.post(path, async (req, res) => {
    requireLocal(req);
    const input = z.object({ consent: z.literal(true), expectedFingerprint: z.string().min(1).max(128) }).strict().parse(req.body);
    d.assert(!activeJobs.has(req.params.id), '此项目正在处理任务，请等待完成。', 409);
    const snapshot = project(store.get(), req.params.id), plan = planIndex(snapshot);
    d.assert(plan.fingerprint === input.expectedFingerprint, '启用的语料已变化，请刷新费用和段落预览后再确认。', 409);
    d.assert(plan.chunksCount > 0 && plan.chunksCount <= 200, '请选择 1–200 段启用语料；可先停用暂时不用的文档。');
    const original = stamp(snapshot), valid = p => {
      try { return stamp(p) === original && planIndex(p).fingerprint === plan.fingerprint; } catch { return false; }
    };
    activeJobs.add(snapshot.id);
    try {
      const index = await charged(req, snapshot, 'index', plan.estimatedCny, options => buildIndex(snapshot, options), valid);
      store.mutate(state => {
        const p = project(state, snapshot.id);
        d.assert(valid(p), '语料已变化，未保存过期索引。', 409);
        p.ragIndex = index; p.ragEnabled = true; p.ragRevision = (p.ragRevision || 0) + 1;
        p.ragConsent = { version: CONSENT_VERSION, at: d.now(), fingerprint: plan.fingerprint };
        d.touch(p); d.activity(state, 'Qwen 语义检索已启用', `${plan.chunksCount} 段语料 · 本机保存索引`, p.id);
      });
      res.json({ result: status(req, project(store.get(), snapshot.id)), state: store.get() });
    } finally { activeJobs.delete(snapshot.id); }
  });
  app.patch(path, (req, res) => {
    requireLocal(req);
    const input = z.object({ enabled: z.boolean(), consent: z.literal(true).optional() }).strict().parse(req.body);
    store.mutate(state => {
      const p = project(state, req.params.id);
      if (input.enabled) {
        d.assert(config.getQwenConnection().ragSupported, '本版语义检索需要北京地域配套 API Key；当前地域可继续使用文字生成和本地关键词检索。');
        d.assert(input.consent === true && indexReady(p), '请先建立当前语料索引，并确认后续查询发送给阿里云。');
        p.ragConsent = { version: CONSENT_VERSION, at: d.now(), fingerprint: planIndex(p).fingerprint };
      }
      p.ragEnabled = input.enabled; p.ragRevision = (p.ragRevision || 0) + 1; d.touch(p);
    });
    res.json({ result: status(req, project(store.get(), req.params.id)), state: store.get() });
  });
  app.delete(path, (req, res) => {
    requireLocal(req);
    store.mutate(state => { const p = project(state, req.params.id); delete p.ragIndex; delete p.ragConsent; p.ragEnabled = false; p.ragRevision = (p.ragRevision || 0) + 1; d.touch(p); });
    res.json({ result: status(req, project(store.get(), req.params.id)), state: store.get() });
  });
  app.post('/api/projects/:id/corpus/search', async (req, res) => {
    const { query } = z.object({ query: z.string().trim().max(500) }).strict().parse(req.body);
    d.assert(!activeJobs.has(req.params.id), '此项目正在处理任务，请等待完成。', 409);
    activeJobs.add(req.params.id);
    try { res.json({ query, ...await search(req, project(store.get(), req.params.id), query) }); }
    finally { activeJobs.delete(req.params.id); }
  });
  return { search, stamp };
}
