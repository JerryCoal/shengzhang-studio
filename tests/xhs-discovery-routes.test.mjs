import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { selectedResearchContext } from '../server/research-data.mjs';

const day = 86400000;
const discovery = { timeRange: 'month', sortBy: 'favorites', noteType: 'all' };
const fakeKey = 'isolated-xhs-discovery-deepseek-key';
function candidate(n, age, favorites = 20) {
  return { kind: 'xiaohongshu', externalId: String(n).padStart(24, 'a'), title: `校园自习预约方式${n}`, text: `校园自习预约方式${n}：先选择时间，再核对教室，完成后记录本次体验。`,
    publishedAt: new Date(Date.now() - age * day).toISOString(), collectedAt: new Date().toISOString(), dateBasis: 'platform-timestamp', sourceName: '小红书', metrics: { likes: 100, comments: 5, favorites, shares: null } };
}
function answer(payload) {
  const ref = payload.references[0];
  return { analyses: [{ id: 'first', title: '预约步骤的具体呈现', observation: '样本正文按步骤介绍预约。', hypothesis: '步骤明确可能帮助读者理解，需用内容试验验证。', application: '结合项目已有预约规则，制作流程说明。',
    tags: ['校园预约步骤'], evidence: [{ referenceId: ref.id, quote: ref.text.slice(0, 24) }], limitations: '可见互动为累计快照，没有曝光量，不能推断点击率或因果。',
    growthAdvice: [{ focus: 'title', action: '测试问题式和步骤式两种标题。', reason: '引用样本把具体步骤放在正文。', validation: '保持内容和观察周期一致，记录自己账号的点击与收藏表现；缺少曝光时仅比较互动数。', referenceIds: [ref.id] }] }] };
}
async function fixture(t, { configured = true } = {}) {
  const store = createStore(':memory:'), calls = [], behavior = {}, id = store.get().projects[0].id;
  store.mutate(state => { state.projects[0].brief.budgetUsd = 5; state.projects[0].usage = []; });
  const vault = { status: () => ({ configured, supported: true }), getKey: async () => fakeKey };
  const app = createApp(store, { profileMode: true, deepseekVault: vault, fetcher: async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.deepseek.com');
    assert.equal(init.headers.Authorization, `Bearer ${fakeKey}`);
    const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content);
    calls.push({ kind: 'deepseek', payload, request });
    if (behavior.failAI) return Response.json({ error: { message: 'fixture provider failure' } }, { status: 503 });
    const value = answer(payload);
    if (behavior.invalidEvidence) value.analyses[0].growthAdvice[0].referenceIds = ['unseen-source'];
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 150 } });
  } });
  app.locals.integrations.mcpResearchStatus = async () => ({ configured: true, supported: true, note: 'fixture search ready' });
  app.locals.integrations.mcpResearchSearch = async (_req, args) => {
    args.assertActive(); calls.push({ kind: 'mcp', args });
    const items = behavior.items ?? [candidate(1, 2, 5), candidate(2, 20, '1.2万'), candidate(3, 40, 4000), candidate(4, 4, null)];
    return { items, reports: [{ sourceId: 'xiaohongshu', name: '小红书 MCP', status: 'ok', count: items.length, message: 'fixture samples only' }] };
  };
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  async function req(path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  const current = () => store.get().projects[0], base = `/projects/${id}/research`;
  const run = (input = {}) => req(base + '/run', 'POST', { keywords: ['校园自习'], sources: ['xiaohongshu'], expectedRevision: current().research?.revision || 0, confirmed: true, discovery, ...input });
  const cool = () => store.mutate(state => { state.projects[0].research.run.finishedAt = new Date(Date.now() - 20000).toISOString(); });
  return { store, calls, behavior, req, current, base, run, cool };
}
function good(result) { assert.equal(result.status, 200, JSON.stringify(result)); return result.data.result; }

test('XHS discovery uses MCP then one DeepSeek call without another key, ranks real counts and carries advice into creation', async t => {
  const f = await fixture(t);
  const settings = (await f.req('/research/settings')).data;
  assert.equal(settings.deepseekConfigured, true); assert.equal(settings.models.xiaohongshuAnalysis, 'deepseek-flash');
  const result = good(await f.run());
  assert.deepEqual(f.calls.map(c => c.kind), ['mcp','deepseek']);
  assert.deepEqual(f.calls[0].args.discovery, discovery);
  assert.deepEqual(f.calls[0].args.queries, ['校园自习']);
  assert.equal(f.calls[1].request.model, 'deepseek-flash');
  assert.deepEqual(f.calls[1].payload.discovery, discovery);
  assert.equal(result.references.length, 3); assert.equal(result.references[0].metrics.favorites.value, 12000);
  assert.equal(result.references[0].metrics.favorites.approximate, true);
  assert.equal(result.references.at(-1).metrics.favorites.value, null);
  assert.equal(result.retrieval.method, 'sample-interaction');
  assert.deepEqual(result.analyses[0].discovery, discovery);
  assert.equal(f.current().usage.length, 1); assert.equal(f.current().usage[0].stage, 'research_analysis');
  assert.equal(f.current().usage[0].status, 'completed'); assert.equal(f.current().usage[0].estimated, false);
  assert.equal((f.current().researchUsage || []).length, 0);
  assert.equal(selectedResearchContext(f.current()).length, 0);
  good(await f.req(f.base + '/select', 'POST', { expectedRevision: result.revision, analysisIds: [result.analyses[0].id], acknowledgedIds: result.analyses[0].risk === 'review' ? [result.analyses[0].id] : [], confirmed: true }));
  assert.equal(selectedResearchContext(f.current())[0].growthAdvice.length, 1);
  for (const path of ['/state','/backup','/research/settings']) assert(!JSON.stringify((await f.req(path)).data).includes(fakeKey));
});

test('XHS discovery reuses older references with a selected Pro model without another MCP or planning request', async t => {
  const f = await fixture(t); f.behavior.items = [candidate(9, 400, 500)];
  good(await f.run({ discovery: { ...discovery, timeRange: 'all' } })); f.cool();
  const before = f.calls.length;
  const result = good(await f.run({ discovery: { ...discovery, timeRange: 'all' }, reuseCollected: true, analysisModel: 'deepseek-v4-pro' }));
  assert.deepEqual(f.calls.slice(before).map(c => c.kind), ['deepseek']);
  assert.equal(result.run.analysisModel, 'deepseek-v4-pro');
  assert.equal(result.references.length, 1);
});

test('missing DeepSeek credentials and invalid modes stop before source collection or charge', async t => {
  const f = await fixture(t, { configured: false });
  assert.equal((await f.run()).status, 400);
  for (const input of [ { sources: ['rss'] }, { analysisModel: 'qwen-plus' }, { useSemantic: true }, { keywords: ['一','二','三','四'] }, { discovery: { ...discovery, timeRange: 'year' } } ]) assert.equal((await f.run(input)).status, 400);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.current().usage, []);
});

test('no matching dated posts do not call DeepSeek; failed analysis preserves previous selections and records actual usage', async t => {
  const f = await fixture(t); const initial = good(await f.run());
  good(await f.req(f.base + '/select', 'POST', { expectedRevision: initial.revision, analysisIds: [initial.analyses[0].id], acknowledgedIds: initial.analyses[0].risk === 'review' ? [initial.analyses[0].id] : [], confirmed: true }));
  const selected = selectedResearchContext(f.current()); f.cool();
  f.behavior.items = [candidate(5, 70, 600)]; const before = f.calls.length;
  assert.equal((await f.run()).status, 400);
  assert.deepEqual(f.calls.slice(before).map(c => c.kind), ['mcp']);
  assert.deepEqual(selectedResearchContext(f.current()), selected);
  f.cool(); f.behavior.items = [candidate(6, 6, 800)]; f.behavior.invalidEvidence = true;
  assert.equal((await f.run()).status, 502);
  assert.deepEqual(selectedResearchContext(f.current()), selected);
  assert.equal(f.current().research.run.status, 'failed');
  assert.equal(f.current().usage.length, 2);
  assert(f.current().usage[1].amountUsd > 0);
});
