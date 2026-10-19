import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { cleanReferences, researchOf, selectResearch, selectedResearchContext, validateResearchAnalysis } from '../server/research-data.mjs';

const day = 86400000, secret = 'PRIVATE_UPSTREAM_TOKEN_NEVER_EXPOSE';
const discovery = { platform: 'xiaohongshu', timeRange: 'week', sortBy: 'favorites', noteType: 'all' };
const candidate = (number, extra = {}) => ({ kind: 'xiaohongshu', externalId: String(number).padStart(24, 'a'), title: `校园自习步骤${number}`, text: `校园自习步骤${number}：选择时段、核对规则，并记录实际体验。`, publishedAt: new Date(Date.now() - day).toISOString(), collectedAt: new Date().toISOString(), dateBasis: 'platform-timestamp', sourceName: '小红书', metrics: { likes: 50, favorites: 20, comments: 3 }, ...extra });
const stats = extra => ({ rawCount: 0, normalizedCount: 0, invalidCount: 0, duplicateCount: 0, missingDateCount: 0, emptyContentCount: 0, searchRequests: 1, detailRequests: 0, ...extra });
const report = extra => ({ sourceId: 'xiaohongshu', name: 'Redfox 公开数据', status: 'ok', count: 0, message: '隔离测试来源报告', stats: stats(), ...extra });
const answer = ({ references }) => {
  const reference = references[0];
  return { analyses: [{ id: 'sample-analysis', title: '自习步骤表达', observation: '样本按步骤介绍参与方式。', hypothesis: '清楚的步骤可能便于理解，仍需验证。', application: '按项目已确认规则说明自习流程。', tags: ['校园自习步骤'], evidence: [{ referenceId: reference.id, quote: reference.text.slice(0, 20) }], limitations: '仅为本次样本，互动不能推断成交或因果。', growthAdvice: [{ focus: 'content', action: '尝试按实际流程组织内容。', reason: '样本使用具体步骤。', validation: '固定观察周期，记录自己账号的互动。', referenceIds: [reference.id] }] }] };
};

async function fixture(t) {
  const store = createStore(':memory:'), calls = [], behavior = { result: { items: [], reports: [report()], pendingReferences: [] } };
  store.mutate(state => {
    const project = state.projects[0]; project.usage = []; project.brief.budgetUsd = 5;
    project.trends = { settings: { blockTerms: ['屏蔽测试词'], genericTerms: [] } };
    const references = cleanReferences([candidate(999)], { discovery }).references;
    const analyses = validateResearchAnalysis(answer({ references }), { references, keywords: ['校园自习'], discovery }).analyses;
    project.research = { revision: 7, references, analyses, selectedIds: [], reports: [{ sourceId: 'xiaohongshu', name: '旧来源', status: 'ok', count: 1, message: '旧版没有精确统计' }], queries: ['校园自习'], keywords: ['校园自习'], pendingReferences: [{ title: '历史待核对', url: 'https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaa1', reason: '历史线索' }] };
    selectResearch(project, { expectedRevision: 7, analysisIds: analyses.map(row => row.id), acknowledgedIds: analyses.filter(row => row.risk === 'review').map(row => row.id), confirmed: true });
  });
  const app = createApp(store, { profileMode: true, deepseekVault: { status: () => ({ supported: true, configured: true }), getKey: async () => 'isolated-model-key' }, fetcher: async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.deepseek.com');
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content); calls.push({ kind: 'model', payload });
    const value = behavior.invalidEvidence ? { analyses: [] } : answer(payload);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 150 } });
  } });
  const collect = async (_req, args) => {
    args.assertActive(); calls.push({ kind: 'source', args });
    if (behavior.error) throw behavior.error;
    return structuredClone(behavior.result);
  };
  app.locals.integrations.redfoxResearchStatus = () => ({ configured: true, supported: true, enabled: behavior.redfoxEnabled !== false });
  app.locals.integrations.redfoxResearchSearch = collect;
  app.locals.integrations.mcpResearchStatus = async () => ({ configured: true, supported: true });
  app.locals.integrations.mcpResearchSearch = collect;
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); store.close(); });
  const current = () => store.get().projects[0], path = `/projects/${current().id}/research`;
  const req = async (suffix, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}${suffix}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const run = extra => req('/run', { keywords: ['校园自习'], sources: ['xiaohongshu'], expectedRevision: researchOf(current()).revision, confirmed: true, dataProvider: 'redfox', discovery, ...extra });
  const old = { references: current().research.references, analyses: current().research.analyses, selected: selectedResearchContext(current()), selectedIds: current().research.selectedIds };
  const assertPreservedWithoutAnalysis = () => {
    const research = current().research;
    assert.equal(research.run.status, 'failed'); assert.equal(research.summary.analysisCount, 0);
    assert.equal(calls.filter(call => call.kind === 'model').length, 0); assert.deepEqual(current().usage, []);
    assert.deepEqual(research.analyses, old.analyses); assert.deepEqual(research.selectedIds, old.selectedIds); assert.deepEqual(selectedResearchContext(current()), old.selected);
    for (const reference of old.references) assert.deepEqual(research.references.find(row => row.id === reference.id), reference);
    assert(!JSON.stringify(research).includes(secret));
  };
  return { store, calls, behavior, current, req, run, old, assertPreservedWithoutAnalysis };
}

test('HTTP status keeps legacy references and reports without inventing collection counters', async t => {
  const f = await fixture(t), response = await f.req('/status');
  assert.equal(response.status, 200); assert.equal(response.data.research.summary, undefined);
  assert.equal(response.data.research.reports[0].stats, undefined); assert.deepEqual(response.data.research.references, f.old.references);
  assert.deepEqual(f.calls, []);
});

test('HTTP no-evidence failures keep specific safe reasons, exact current counters and previous selections without model calls', async t => {
  const cases = [
    { name: 'source failure', error: Error(`upstream failed: ${secret}`), reason: /来源读取失败/, count: 0, pending: 0, coverage: 'unavailable' },
    { name: 'zero candidates', result: { items: [], reports: [report()] }, reason: /没有返回可用候选/, count: 0, pending: 0, coverage: 'complete' },
    { name: 'collector format rejection', result: { items: [], reports: [report({ stats: stats({ rawCount: 3, invalidCount: 3 }) })] }, reason: /格式或来源链接均未通过校验/, count: 0, pending: 0, coverage: 'complete' },
    { name: 'incomplete dates and content', result: { items: [], reports: [report({ stats: stats({ rawCount: 2, normalizedCount: 2, missingDateCount: 2, emptyContentCount: 1 }) })], pendingReferences: [1, 2].map(n => ({ title: `待核对${n}`, url: `https://www.xiaohongshu.com/explore/${String(n).padStart(24, 'b')}`, reason: '日期或正文不完整' })) }, reason: /发布时间或正文不完整/, count: 0, pending: 2, coverage: 'complete' },
    { name: 'all expired', result: { items: [candidate(1, { publishedAt: new Date(Date.now() - 20 * day).toISOString() })], reports: [report({ count: 1, stats: stats({ rawCount: 1, normalizedCount: 1 }) })] }, reason: /均超出所选时间范围/, count: 1, pending: 0, coverage: 'complete', excluded: 'expired' },
    { name: 'blocked by project rule', result: { items: [candidate(1, { text: '校园自习 屏蔽测试词 来源正文。' })], reports: [report({ count: 1, stats: stats({ rawCount: 1, normalizedCount: 1 }) })] }, reason: /被当前屏蔽词/, count: 1, pending: 0, coverage: 'complete', excluded: 'blocked' },
    { name: 'malformed standardized row', result: { items: [candidate(1, { text: 123 })], reports: [{ ...report({ count: 1 }), stats: undefined }] }, reason: /格式或来源链接均未通过校验/, count: 1, pending: 0, coverage: 'unavailable', excluded: 'invalid' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async t => {
    const f = await fixture(t); if (scenario.error) f.behavior.error = scenario.error; else f.behavior.result = scenario.result;
    const response = await f.run(), research = f.current().research, summary = research.summary;
    assert.equal(response.status, 400, JSON.stringify(response)); assert.match(response.data.error, scenario.reason); assert.match(research.run.error, scenario.reason);
    assert.equal(research.run.error, response.data.error); assert(!JSON.stringify(response).includes(secret));
    assert.equal(summary.candidateCount, scenario.count); assert.equal(summary.eligibleCount, 0); assert.equal(summary.pendingCount, scenario.pending); assert.equal(summary.collection.coverage, scenario.coverage);
    if (scenario.coverage === 'unavailable') assert.equal(summary.collection.rawCount, null);
    if (scenario.excluded) assert.equal(summary.excluded[scenario.excluded], 1);
    assert.equal(summary.runId, research.run.id); assert.equal(summary.mode, 'collected');
    assert.equal(f.calls[0].args.redfoxXhsExpansion, false, 'Older clients must not opt into paid expansion');
    f.assertPreservedWithoutAnalysis();
  });
});

test('partial collection failures retain reports and analyze only usable current candidates', async t => {
  const f = await fixture(t);
  f.behavior.result = { items: [candidate(1), candidate(2, { publishedAt: new Date(Date.now() - 20 * day).toISOString() })], reports: [report({ count: 2, stats: stats({ rawCount: 3, normalizedCount: 2, invalidCount: 1 }) }), report({ status: 'failed', message: '第二次来源读取未完成；没有重试。' })] };
  const response = await f.run(), research = f.current().research;
  assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(research.run.status, 'completed');
  assert.equal(f.calls.filter(call => call.kind === 'model').length, 1); assert.equal(f.calls.find(call => call.kind === 'model').payload.references.length, 1);
  assert.equal(research.summary.candidateCount, 2); assert.equal(research.summary.eligibleCount, 1); assert.equal(research.summary.analysisCount, 1); assert.equal(research.summary.failedSources, 1);
  assert.equal(research.summary.excluded.expired, 1); assert.equal(research.summary.collection.rawCount, 3); assert.equal(research.summary.collection.searchRequests, 2); assert.equal(research.summary.collection.coverage, 'complete');
  assert.equal(research.reports[1].status, 'failed'); assert.deepEqual(research.reports, f.behavior.result.reports);
  assert.equal(research.references.length, 1); assert.notEqual(research.references[0].id, f.old.references[0].id);
});

test('mixed reporting coverage and unrelated candidates remain distinguishable from legacy reference totals', async t => {
  const f = await fixture(t);
  f.behavior.result = { items: [candidate(1, { title: '天气记录', text: '今日晴天，风力较小。' })], reports: [report({ count: 1, stats: stats({ rawCount: 1, normalizedCount: 1 }) }), { sourceId: 'xiaohongshu', name: '无详细统计的来源', status: 'ok', count: 0, message: '没有精确上游计数' }] };
  const response = await f.run(), research = f.current().research;
  assert.equal(response.status, 400); assert.match(response.data.error, /未命中本次主题/); assert.match(research.run.error, /未命中本次主题/);
  assert.equal(research.summary.candidateCount, 1); assert.equal(research.summary.eligibleCount, 1); assert.equal(research.references.length, 2);
  assert.equal(research.summary.collection.coverage, 'partial'); assert.equal(research.summary.collection.reportCount, 1); assert.equal(research.summary.collection.rawCount, 1);
  f.assertPreservedWithoutAnalysis();
});

test('expansion is passed only after explicit authorization for a fresh Redfox Xiaohongshu discovery', async t => {
  const allowed = await fixture(t); assert.equal((await allowed.run({ redfoxXhsExpansion: true })).status, 400);
  assert.equal(allowed.calls.length, 1); assert.equal(allowed.calls[0].args.redfoxXhsExpansion, true); assert.equal(allowed.current().research.run.redfoxXhsExpansion, true);
  for (const input of [{ dataProvider: 'mcp' }, { reuseCollected: true }, { discovery: undefined }, { sources: ['douyin'], discovery: { ...discovery, platform: 'douyin' } }]) await t.test(JSON.stringify(input), async t => {
    const f = await fixture(t); const response = await f.run({ ...input, redfoxXhsExpansion: true });
    assert.equal(response.status, 400); assert.match(response.data.error, /扩展采集/); assert.deepEqual(f.calls, []); assert.equal(f.current().research.summary, undefined);
  });
  await t.test('automatic fallback to MCP cannot keep expansion enabled', async t => {
    const f = await fixture(t); f.behavior.redfoxEnabled = false;
    const response = await f.run({ dataProvider: undefined, redfoxXhsExpansion: true });
    assert.equal(response.status, 400); assert.match(response.data.error, /扩展采集/); assert.deepEqual(f.calls, []);
  });
});

test('reuse analyzes saved evidence without source requests or fabricated collection totals', async t => {
  const f = await fixture(t), response = await f.run({ reuseCollected: true }), research = f.current().research;
  assert.equal(response.status, 200, JSON.stringify(response)); assert.deepEqual(f.calls.map(call => call.kind), ['model']);
  assert.equal(research.summary.mode, 'reused'); assert.equal(research.summary.candidateCount, 1); assert.equal(research.summary.eligibleCount, 1); assert.equal(research.summary.analysisCount, 1);
  assert.equal(research.summary.pendingCount, 0); assert.equal(research.summary.collection.coverage, 'unavailable'); assert.equal(research.summary.collection.rawCount, null); assert.equal(research.summary.collection.searchRequests, null);
  assert.equal(research.pendingReferences.length, 1, 'Historical pending clues remain visible, but are not counted as this run collection');
});

test('a budget rejection after collection does not count evidence as sent to the model', async t => {
  const f = await fixture(t); f.store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  f.behavior.result = { items: [candidate(1)], reports: [report({ count: 1, stats: stats({ rawCount: 1, normalizedCount: 1 }) })] };
  const response = await f.run(); assert.equal(response.status, 400); assert.match(response.data.error, /预算不足/);
  assert.equal(f.current().research.summary.eligibleCount, 1); f.assertPreservedWithoutAnalysis();
});
