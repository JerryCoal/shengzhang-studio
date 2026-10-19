import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { generateDeepSeek } from '../server/deepseek.mjs';
import { researchDefinition, researchInstructions } from '../server/research-ai.mjs';
import { cleanReferences, validateResearchAnalysis, selectedResearchContext } from '../server/research-data.mjs';

const fakeKey = 'isolated-research-reliability-not-a-real-key';
const providerUsage = { prompt_tokens: 100, completion_tokens: 150 };
const normalizedUsage = { input_tokens: 100, output_tokens: 150 };
const discovery = { timeRange: 'month', sortBy: 'favorites', noteType: 'all', platform: 'xiaohongshu' };
const rawReference = () => ({ kind: 'xiaohongshu', title: '校园自习预约流程',
  url: 'https://www.xiaohongshu.com/explore/507f1f77bcf86cd799439011',
  text: '先预约座位。\n再选择安静区域。\nStudy together with a clear plan.\n完成后记录体验。',
  publishedAt: new Date(Date.now() - 86400000).toISOString(), collectedAt: new Date().toISOString(),
  dateBasis: 'platform-timestamp', sourceName: '小红书', noteType: 'image',
  metrics: { likes: 100, favorites: 20, comments: 5, shares: null } });
const reference = () => cleanReferences([rawReference()], { discovery }).references[0];
function analysis(ref, changes = {}, withAdvice = false) {
  return { id: 'steps-1', title: '预约步骤的清楚呈现', observation: '正文依次说明预约和选择区域。',
    hypothesis: '明确的步骤可能便于理解，仍需测试。', application: '用项目已确认的预约流程制作独立说明。',
    tags: ['自习预约步骤'], evidence: [{ referenceId: ref.id, quote: '先预约座位。\n再选择安静区域。' }],
    limitations: '只有现有摘录和一次互动快照，无法判断转化效果。',
    ...(withAdvice ? { growthAdvice: [{ focus: 'title', action: '测试问题式与步骤式两种标题。',
      reason: '可见原文按步骤说明预约，理解效果仍需验证。', validation: '保持正文和观察周期一致，比较收藏和评论，不计算缺少分母的比率。', referenceIds: [ref.id] }] } : {}), ...changes };
}
const response = (content, finishReason = 'stop') => Response.json({ choices: [{ finish_reason: finishReason,
  message: { role: 'assistant', content, reasoning_content: 'PRIVATE_REASONING_MUST_NOT_SURFACE' } }], usage: providerUsage });
const modelConfig = { apiKey: fakeKey, model: 'deepseek-flash', thinking: false, maxTokens: 8000 };

test('research provider schema states the local text, evidence and advice limits', () => {
  for (const kind of ['analysis', 'xhs-analysis']) {
    const schema = researchDefinition(kind).schema, fields = schema.properties.analyses.items.properties;
    assert.equal(schema.properties.analyses.maxItems, 6);
    for (const [field, max] of Object.entries({ id: 100, title: 180, observation: 1200, hypothesis: 1200, application: 1200, limitations: 1200 })) {
      assert.equal(fields[field].minLength, 1, `${kind}.${field} minimum`);
      assert.equal(fields[field].maxLength, max, `${kind}.${field} maximum`);
    }
    assert.equal(fields.tags.maxItems, 12);
    assert.equal(fields.tags.items.minLength, 1); assert.equal(fields.tags.items.maxLength, 50);
    assert.equal(fields.evidence.minItems, 1); assert.equal(fields.evidence.maxItems, 5);
    assert.equal(fields.evidence.items.properties.referenceId.maxLength, 160);
    assert.equal(fields.evidence.items.properties.quote.minLength, 1); assert.equal(fields.evidence.items.properties.quote.maxLength, 400);
    if (kind === 'xhs-analysis') {
      assert.equal(fields.growthAdvice.minItems, 1); assert.equal(fields.growthAdvice.maxItems, 6);
      const advice = fields.growthAdvice.items.properties;
      for (const name of ['action', 'reason', 'validation']) { assert.equal(advice[name].minLength, 1); assert.equal(advice[name].maxLength, 800); }
      assert.equal(advice.referenceIds.minItems, 1); assert.equal(advice.referenceIds.maxItems, 5);
      assert.equal(advice.referenceIds.items.minLength, 1); assert.equal(advice.referenceIds.items.maxLength, 160);
    }
  }
  const queries = researchDefinition('query').schema.properties.queries;
  assert.equal(queries.minItems, 1); assert.equal(queries.maxItems, 3);
  assert.equal(queries.items.minLength, 2); assert.equal(queries.items.maxLength, 100);
});

test('DeepSeek accepts plain JSON, one complete JSON fence and a BOM without another request', async () => {
  const ref = reference(), payload = { references: [ref] }, answer = { analyses: [analysis(ref)] }, json = JSON.stringify(answer);
  for (const content of [json, `\uFEFF${json}`, `\`\`\`json\n${json}\n\`\`\``, `\uFEFF \n\`\`\`json\n${json}\n\`\`\`\n`]) {
    let calls = 0;
    const result = await generateDeepSeek(payload, modelConfig, researchDefinition('analysis'), researchInstructions('analysis'), async (url, init) => {
      calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(init.headers.Authorization, `Bearer ${fakeKey}`);
      return response(content);
    });
    assert.equal(result.value.analyses.length, 1); assert.equal(calls, 1); assert.deepEqual(result.usage, normalizedUsage);
    assert.equal(result.value.analyses[0].evidence[0].quote, answer.analyses[0].evidence[0].quote);
  }
});

const failureCases = [
  { name: 'length-limited answer', kind: 'truncated', finishReason: 'length', content: '{"analyses":[' },
  { name: 'empty content', kind: 'empty', content: '' },
  { name: 'whitespace-only content', kind: 'empty', content: ' \n\t' },
  { name: 'provider-interrupted answer', kind: 'incomplete', finishReason: 'insufficient_system_resource', content: '{"analyses":[]}' },
  { name: 'truncated JSON despite stop', kind: 'json', content: '{"analyses":[' },
  { name: 'explanation before JSON', kind: 'json', content: '以下是分析：\n{"analyses":[]}' },
  { name: 'explanation after JSON fence', kind: 'json', content: '```json\n{"analyses":[]}\n```\n以上为分析。' },
  { name: 'schema-incomplete analysis', kind: 'schema', content: '{"analyses":[{"id":"a1"}]}' },
];
test('DeepSeek null envelope is an incomplete response without a retry or fabricated usage', async () => {
  let calls = 0;
  await assert.rejects(generateDeepSeek({}, modelConfig, researchDefinition('analysis'), researchInstructions('analysis'), async () => {
    calls++; return Response.json(null);
  }), error => { assert.equal(error.status, 502); assert.equal(error.outputKind, 'incomplete'); assert.equal(error.usage, null); return true; });
  assert.equal(calls, 1);
});
for (const scenario of failureCases) test(`DeepSeek reports ${scenario.name} with usage and never retries`, async () => {
  const ref = reference(); let calls = 0;
  await assert.rejects(generateDeepSeek({ references: [ref] }, modelConfig, researchDefinition('analysis'), researchInstructions('analysis'), async () => {
    calls++; return response(scenario.content, scenario.finishReason || 'stop');
  }), error => {
    assert.equal(error.status, 502); assert.equal(error.outputKind, scenario.kind); assert.deepEqual(error.usage, normalizedUsage);
    assert(!error.message.includes('PRIVATE_REASONING_MUST_NOT_SURFACE')); assert(!error.message.includes(fakeKey)); return true;
  });
  assert.equal(calls, 1);
});

test('DeepSeek preserves a distinct evidence failure and returned usage without retry', async () => {
  const ref = reference(), answer = { analyses: [analysis(ref, { evidence: [{ referenceId: ref.id, quote: '不存在的修改后原文' }] })] }; let calls = 0;
  await assert.rejects(generateDeepSeek({ references: [ref] }, modelConfig, researchDefinition('analysis'), researchInstructions('analysis'), async () => {
    calls++; return response(JSON.stringify(answer));
  }), error => { assert.equal(error.outputKind, 'evidence'); assert.deepEqual(error.usage, normalizedUsage); return true; });
  assert.equal(calls, 1);
});

test('fresh evidence recovers whitespace and one enclosing quote pair to exact source text without mutating input', () => {
  const ref = reference(), original = '先预约座位。\n再选择安静区域。';
  for (const quote of ['先预约座位。 再选择安静区域。', '先预约座位。\t  再选择安静区域。', '“先预约座位。 再选择安静区域。”', '"先预约座位。 再选择安静区域。"']) {
    const value = { analyses: [analysis(ref, { evidence: [{ referenceId: ref.id, quote }] })] }, before = structuredClone(value);
    const result = validateResearchAnalysis(value, { references: [ref] });
    assert.equal(result.analyses[0].evidence[0].quote, original); assert(ref.text.includes(result.analyses[0].evidence[0].quote));
    assert.deepEqual(value, before);
  }
});

test('evidence normalization does not allow changed words, removed word spacing, stitched text or cross-source references', () => {
  const ref = reference();
  for (const quote of ['先预订座位。 再选择安静区域。', 'Studytogether with a clear plan.', '先预约座位。 完成后记录体验。', '先预约座位。……完成后记录体验。', `${ref.title} ${ref.text.split('\n')[0]}`]) {
    assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, { evidence: [{ referenceId: ref.id, quote }] })] }, { references: [ref] }), error => error.researchOutputKind === 'evidence');
  }
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, { evidence: [{ referenceId: 'outside-request', quote: ref.title }] })] }, { references: [ref] }), error => error.researchOutputKind === 'evidence');
  assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, {}, true)] }, { references: [{ ...ref, kind: 'douyin' }], discovery }), error => error.researchOutputKind === 'evidence');
  const unrelatedAdvice = analysis(ref, {}, true); unrelatedAdvice.growthAdvice[0].referenceIds = ['outside-this-analysis'];
  assert.throws(() => validateResearchAnalysis({ analyses: [unrelatedAdvice] }, { references: [ref], discovery }), error => error.researchOutputKind === 'evidence');
});

test('research shape errors are categorized separately from evidence errors', () => {
  const ref = reference();
  for (const changes of [{ title: '' }, { title: '学'.repeat(181) }, { id: 'a'.repeat(101) }, { evidence: [] }, { evidence: Array.from({ length: 6 }, () => ({ referenceId: ref.id, quote: ref.title })) }]) {
    assert.throws(() => validateResearchAnalysis({ analyses: [analysis(ref, changes)] }, { references: [ref] }), error => error.status === 502 && error.researchOutputKind === 'schema');
  }
});

test('stored selections continue to require exact evidence after the fresh-output normalization', () => {
  const ref = reference(), analyses = validateResearchAnalysis({ analyses: [analysis(ref)] }, { references: [ref] }).analyses;
  const project = { id: 'stored-selection', brief: {}, research: { references: [ref], analyses, selectedIds: [analyses[0].id], acknowledgedIds: [analyses[0].id], revision: 1 } };
  assert.equal(selectedResearchContext(project).length, 1);
  for (const quote of ['先预约座位。 再选择安静区域。', '“先预约座位。\n再选择安静区域。”']) {
    const changed = structuredClone(project); changed.research.analyses[0].evidence[0].quote = quote;
    assert.deepEqual(selectedResearchContext(changed), [], 'stored edited evidence is not silently repaired at generation time');
  }
});

async function routeFixture(t) {
  const store = createStore(':memory:'), calls = [], behavior = { fail: false }, id = store.get().projects[0].id;
  store.mutate(state => { const p = state.projects[0]; p.brief.budgetUsd = 5; p.usage = []; });
  const app = createApp(store, { profileMode: true, deepseekVault: { status: () => ({ configured: true, supported: true }), getKey: async () => fakeKey },
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content); calls.push({ kind: 'deepseek', request });
      if (behavior.fail) return response('{"analyses":[', 'length');
      return response(JSON.stringify({ analyses: [analysis(payload.references[0], {}, true)] }));
    } });
  app.locals.integrations.mcpResearchStatus = async () => ({ configured: true, supported: true });
  app.locals.integrations.mcpResearchSearch = async (_req, args) => {
    args.assertActive(); calls.push({ kind: 'source' });
    return { items: [rawReference()], reports: [{ sourceId: 'xiaohongshu', name: '隔离测试来源', status: 'ok', count: 1, message: 'fixture only' }] };
  };
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const current = () => store.get().projects[0], base = `/api/projects/${id}/research`;
  async function req(path, body) {
    const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
  }
  const run = (reuseCollected = false) => req(base + '/run', { keywords: ['校园自习'], sources: ['xiaohongshu'], expectedRevision: current().research?.revision || 0, confirmed: true, discovery, reuseCollected });
  const cool = () => store.mutate(state => { state.projects[0].research.run.finishedAt = new Date(Date.now() - 20000).toISOString(); });
  return { calls, behavior, current, run, cool, req, base };
}

test('research route disables DeepSeek thinking and preserves previous selections without duplicate calls or fees after truncation', async t => {
  const f = await routeFixture(t), first = await f.run();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const initial = first.data.result;
  assert.deepEqual(f.calls.map(call => call.kind), ['source', 'deepseek']);
  assert.deepEqual(f.calls[1].request.thinking, { type: 'disabled' });
  assert.equal(f.calls[1].request.reasoning_effort, undefined);
  const chosen = await f.req(f.base + '/select', { expectedRevision: initial.revision, analysisIds: [initial.analyses[0].id], acknowledgedIds: initial.analyses[0].risk === 'review' ? [initial.analyses[0].id] : [], confirmed: true });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
  const selected = structuredClone(selectedResearchContext(f.current())); assert.equal(selected.length, 1);
  f.cool(); f.behavior.fail = true;
  const failed = await f.run(true);
  assert.equal(failed.status, 502); assert.deepEqual(f.calls.map(call => call.kind), ['source', 'deepseek', 'deepseek']);
  assert.deepEqual(selectedResearchContext(f.current()), selected); assert.equal(f.current().research.run.status, 'failed');
  assert.equal(f.current().usage.length, 2); assert.equal(f.current().usage[1].status, 'uncertain');
  assert.deepEqual(f.current().usage[1].tokens, normalizedUsage); assert.equal(f.current().usage[1].estimated, false);
  assert.equal((f.current().researchUsage || []).length, 0);
  f.cool(); f.behavior.fail = false;
  assert.equal((await f.run(true)).status, 200);
  assert.deepEqual(f.calls.map(call => call.kind), ['source', 'deepseek', 'deepseek', 'deepseek']);
  assert.equal(f.current().usage.length, 3, 'one ledger row per explicit model request');
});
