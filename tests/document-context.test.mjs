import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { newProject, confirmStrategy, editStrategy } from '../server/domain.mjs';
import { importCorpus, changeCorpus, searchCorpus } from '../server/workflow.mjs';
import { planIndex } from '../server/rag.mjs';
import { createModelStore, stageConfig, DEFAULT_ROUTES } from '../server/models.mjs';
import { generateStage } from '../server/ai.mjs';
import { documentContextPayload, validateDocumentContext, saveDocumentContextCandidate, adoptDocumentContext, adoptedDocumentContext, documentContextCurrent, documentStyleReferences } from '../server/document-context.mjs';

const quote = '预约需要提前一天办理，修改时间须联系客服。';
const styleText = '先说具体场景，再写两句短句。我的旧产品售价999元，这只是文风样本。';
const strategyOutput = { title: '预约前先了解条件', core: '说明预约步骤', direction: '写清预约条件', prompt: '仅按已确认事实说明预约。' };
const copyOutput = { title: '预约说明', body: '预约需要提前一天办理。', prompt: '展示预约步骤', scenes: ['说明条件', '预约步骤', '核对结果'] };
function projectFixture() {
  const p = newProject({ name: '资料卡测试', brand: '合成品牌', product: '预约工具', type: 'launch', goal: '了解预约条件', audience: '预约用户', sellingPoints: '预约流程清楚', facts: '提供预约服务。', requirements: '不虚构事实', channels: ['xiaohongshu'], deadline: '2026-11-01', budgetUsd: 100 });
  const fact = importCorpus(p, { name: '预约规则', text: quote, format: 'docx', extraction: { parser: 'docling', sourceName: 'synthetic.docx', blocks: [{ id: 'block-1', kind: 'paragraph', text: quote, page: 2, heading: '预约条件' }], warnings: [], metadata: { version: 'test' } } });
  const style = importCorpus(p, { name: '表达样本', text: styleText, purpose: 'style_sample' });
  const unused = importCorpus(p, { name: '未选资料', text: 'PRIVATE_UNSELECTED_SENTINEL：不应发送给提炼模型。' });
  return { p, fact, style, unused };
}
const resultFor = payload => ({ items: [{ kind: 'fact', text: '提前一天预约，改期需联系客服。', evidence: [{ documentId: payload.documents.find(doc => doc.chunks.some(chunk => chunk.text.includes(quote))).id, chunk: 1, quote }] }], missing: ['价格与取消条件待补充。'] });
const withStyle = payload => ({ ...resultFor(payload), items: [...resultFor(payload).items, { kind: 'style_note', text: '用具体场景开头，采用短句。', evidence: [{ documentId: payload.documents.find(doc => doc.purpose === 'style_sample').id, chunk: 1, quote: '先说具体场景，再写两句短句。' }] }] });
function prepareCard(p, fact) {
  const payload = documentContextPayload(p, [fact.id]);
  return saveDocumentContextCandidate(p, resultFor(payload), 'gpt-5.4', payload);
}
function adopt(p, card) { return adoptDocumentContext(p, { candidateId: card.id, expectedRevision: p.documentContext.revision, itemIds: card.items.map(item => item.id), confirmed: true }); }

async function fixture(t, options = {}) {
  const data = projectFixture(), store = createStore(':memory:', { key: Buffer.alloc(32, 71), scope: 'synthetic-doc-context' }), calls = [];
  store.mutate(state => { state.projects = [data.p]; state.contentRules = [{ id: 'proof-do-not-edit', term: '预约', replacement: '改动证据', action: 'replace', enabled: true }]; });
  const app = createApp(store, { profileMode: options.profileMode ?? true, apiKey: 'test-only-no-network', ...(options.config || {}), fetcher: async (url, init) => {
    const request = JSON.parse(init.body), input = JSON.parse(request.input);
    calls.push({ input, request, url });
    await options.onRequest?.({ store, input });
    const value = options.output ? options.output(input) : input.documents ? resultFor(input) : input.task ? copyOutput : strategyOutput;
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${data.p.id}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  return { ...data, store, calls, req, current: () => store.get().projects[0] };
}

test('document purposes preserve legacy defaults and structured provenance while styles never enter factual retrieval', () => {
  const { p, fact, style } = projectFixture();
  assert.equal(fact.purpose, 'product_facts');
  assert.equal(fact.chunks[0].page, 2); assert.equal(fact.chunks[0].heading, '预约条件');
  assert.equal(searchCorpus(p, '旧产品售价999元').some(row => row.documentId === style.id), false);
  assert.equal(planIndex(p).chunksCount, 2);
  assert.deepEqual(documentStyleReferences(p), []);
  assert.throws(() => importCorpus(p, { name: '错误定位', text: '真实正文', extraction: { parser: 'simple', sourceName: 'a.txt', blocks: [{ id: 'x', kind: 'paragraph', text: '另一个文件的正文' }], warnings: [], metadata: {} } }), /定位与当前正文不一致/);
});

test('document evidence must quote the selected document and obey its purpose', () => {
  const { p, fact, style } = projectFixture(), payload = documentContextPayload(p, [fact.id]);
  for (const alter of [item => { item.evidence[0].quote = '不存在的引用内容'; }, item => { item.evidence[0].documentId = style.id; }, item => { item.evidence[0].chunk = 99; }, item => { item.kind = 'style_note'; }]) {
    const output = resultFor(payload); alter(output.items[0]); assert.throws(() => validateDocumentContext(output, payload), /引用|用途/);
  }
  const stylePayload = documentContextPayload(p, [style.id]);
  assert.throws(() => validateDocumentContext({ items: [{ kind: 'price_terms', text: '本产品999元', evidence: [{ documentId: style.id, chunk: 1, quote: '我的旧产品售价999元' }] }], missing: [] }, stylePayload), /文风样本不能成为产品事实/);
  const valid = { items: [{ kind: 'style_note', text: '以场景开头，使用短句。', evidence: [{ documentId: style.id, chunk: 1, quote: '先说具体场景，再写两句短句。' }] }], missing: [] };
  assert.deepEqual(validateDocumentContext(valid, stylePayload), valid);
});

test('adoption is explicit, selective and invalidated by source changes without destroying the record', () => {
  const { p, fact } = projectFixture(), card = prepareCard(p, fact);
  assert.equal(adoptedDocumentContext(p), null);
  assert.throws(() => adoptDocumentContext(p, { candidateId: card.id, expectedRevision: 0, itemIds: [card.items[0].id], confirmed: true }), /已更新/);
  assert.throws(() => adoptDocumentContext(p, { candidateId: card.id, expectedRevision: 1, itemIds: ['fake'], confirmed: true }), /条目无效/);
  adopt(p, card); assert.equal(adoptedDocumentContext(p).items[0].evidence[0].quote, quote);
  const saved = structuredClone(p.documentContext.adopted);
  changeCorpus(p, fact.id, { purpose: 'style_sample' }, 'PATCH');
  assert.equal(adoptedDocumentContext(p), null); assert.deepEqual(p.documentContext.adopted, saved);
  assert.equal(documentContextCurrent(p, card), false);
  assert.throws(() => adopt(p, card), /来源文档已变化/);
});

test('oversized document selection is rejected without silently omitting the tail', () => {
  const { p } = projectFixture(), doc = importCorpus(p, { name: '长资料', text: '合成文档'.repeat(7000) });
  assert.throws(() => documentContextPayload(p, [doc.id]), /24,000/);
  assert.throws(() => documentContextPayload(p, [doc.id, doc.id]), /重复选择/);
});

test('style samples are sent only after their specific style note is adopted, never from enabled documents alone', () => {
  const { p, fact, style } = projectFixture();
  assert.deepEqual(documentStyleReferences(p), []);
  const payload = documentContextPayload(p, [fact.id, style.id]);
  const card = saveDocumentContextCandidate(p, withStyle(payload), 'gpt-5.4', payload);
  assert.deepEqual(documentStyleReferences(p), [], 'a generated candidate is not consent to use samples');
  adoptDocumentContext(p, { candidateId: card.id, expectedRevision: p.documentContext.revision, itemIds: [card.items[0].id], confirmed: true });
  assert.deepEqual(documentStyleReferences(p), [], 'adopting facts does not adopt style');
  adoptDocumentContext(p, { candidateId: card.id, expectedRevision: p.documentContext.revision, itemIds: [card.items[1].id], confirmed: true });
  assert.deepEqual(documentStyleReferences(p).map(doc => doc.documentId), [style.id]);
  assert.equal(documentStyleReferences(p)[0].text, styleText);
  importCorpus(p, { name: '未选中文风', text: '另一个范文，不应发送。', purpose: 'style_sample' });
  assert.deepEqual(documentStyleReferences(p).map(doc => doc.documentId), [style.id]);
  changeCorpus(p, style.id, { enabled: false }, 'PATCH'); assert.deepEqual(documentStyleReferences(p), []);
});

for (const provider of ['openai', 'deepseek', 'qwen']) test(`${provider} document extraction reuses the strategy model without changing old route settings`, async () => {
  const { p, fact } = projectFixture(), payload = documentContextPayload(p, [fact.id]), model = { openai: 'gpt-5.4', deepseek: 'deepseek-v4-pro', qwen: 'qwen-plus' }[provider];
  const routes = { ...DEFAULT_ROUTES, strategy: model }, route = stageConfig('document-context', routes), modelStore = createModelStore();
  assert.deepEqual(modelStore.save(routes), routes); assert.equal(route.id, 'document-context'); assert.equal(route.model, model); assert.equal(route.provider, provider);
  let count = 0;
  const output = await generateStage(payload, { ...route, apiKey: 'test-only' }, async (_url, init) => {
    count++; const request = JSON.parse(init.body), instructions = request.instructions || request.messages[0].content;
    assert.match(instructions, /项目资料提炼/); assert.doesNotMatch(instructions, /# 中文自然表达/);
    const text = JSON.stringify(resultFor(payload));
    return provider === 'openai' ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 20 } }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
  });
  assert.equal(count, 1); assert.equal(output.value.items[0].evidence[0].quote, quote);
});

test('HTTP extraction sends only selected sources, saves a candidate and records one charge without altering evidence', async t => {
  const f = await fixture(t), response = await f.req('/corpus/context', { documentIds: [f.fact.id], confirmed: true });
  assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(f.calls.length, 1);
  const sent = f.calls[0].input; assert.deepEqual(sent.documents.map(doc => doc.id), [f.fact.id]); assert.doesNotMatch(JSON.stringify(sent), /PRIVATE_UNSELECTED|旧产品售价/);
  assert.equal(response.data.result.items[0].evidence[0].quote, quote); assert.equal(response.data.result.items[0].evidence[0].page, 2);
  assert.equal(f.current().documentContext.adopted, undefined);
  const usage = f.current().usage.at(-1); assert.equal(usage.stage, 'document-context'); assert.equal(usage.status, 'completed'); assert.equal(usage.skillVersions[0].id, 'document-context'); assert(usage.amountUsd > 0);
  const status = await f.req('/corpus/context', undefined, 'GET'); assert.equal(status.data.candidateCurrent, true);
});

test('HTTP adoption feeds new strategies; confirmed strategy snapshots survive later card/style changes', async t => {
  const f = await fixture(t, { output: input => input.documents ? withStyle(input) : input.task ? copyOutput : strategyOutput });
  const generated = await f.req('/corpus/context', { documentIds: [f.fact.id, f.style.id], confirmed: true });
  const card = generated.data.result;
  const accepted = await f.req('/corpus/context/adopt', { candidateId: card.id, expectedRevision: f.current().documentContext.revision, itemIds: card.items.map(item => item.id), confirmed: true });
  assert.equal(accepted.status, 200);
  const strategyResponse = await f.req('/strategies', { mode: 'openai' }); assert.equal(strategyResponse.status, 200, JSON.stringify(strategyResponse.data));
  const sent = f.calls.at(-1).input, snapshot = structuredClone(sent.adoptedDocumentContext);
  assert.equal(snapshot.items[0].evidence[0].quote, quote); assert.equal(sent.styleReferences[0].text, styleText);
  assert.equal(sent.corpusReferences.some(row => row.documentId === f.style.id), false);
  const strategyId = strategyResponse.data.result.id;
  f.store.mutate(state => { const p = state.projects[0]; confirmStrategy(p, strategyId, []); p.corpus.find(doc => doc.id === f.style.id).text = '后来更换的风格'; p.corpus.find(doc => doc.id === f.fact.id).enabled = false; });
  const p = f.current(), asset = p.assets[0];
  const copy = await f.req(`/assets/${asset.id}/copy`, { expectedRevision: asset.revision }); assert.equal(copy.status, 200, JSON.stringify(copy.data));
  assert.deepEqual(f.calls.at(-1).input.adoptedDocumentContext, snapshot); assert.equal(f.calls.at(-1).input.styleReferences[0].text, styleText);
  assert.deepEqual(f.current().strategies.find(s => s.id === strategyId).documentContextSnapshot, snapshot);
  const manual = editStrategy(p, strategyId, strategyOutput, []); assert.deepEqual(manual.documentContextSnapshot, snapshot);
});

test('in-flight source change preserves old candidate, charges once and rejects the stale result', async t => {
  let changed = false;
  const f = await fixture(t, { onRequest: ({ store, input }) => { if (input.documents && !changed) { changed = true; store.mutate(state => { state.projects[0].corpus[0].name = '新的来源名称'; }); } } });
  f.store.mutate(state => { prepareCard(state.projects[0], state.projects[0].corpus[0]); });
  const before = f.current().documentContext.candidate;
  const response = await f.req('/corpus/context', { documentIds: [f.fact.id], confirmed: true });
  assert.equal(response.status, 409); assert.equal(f.calls.length, 1); assert.deepEqual(f.current().documentContext.candidate, before); assert.equal(f.current().usage.at(-1).status, 'completed');
});

test('invalid model evidence cannot replace a candidate and retains returned usage', async t => {
  const f = await fixture(t, { output: input => { const result = resultFor(input); result.items[0].evidence[0].quote = '编造的引用原文'; return result; } });
  const response = await f.req('/corpus/context', { documentIds: [f.fact.id], confirmed: true });
  assert.equal(response.status, 502); assert.equal(f.current().documentContext, undefined); assert.equal(f.calls.length, 1); assert.equal(f.current().usage.at(-1).amountUsd > 0, true);
});

test('budget and workspace restrictions reject before any provider call', async t => {
  const f = await fixture(t); f.store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  const response = await f.req('/corpus/context', { documentIds: [f.fact.id], confirmed: true }); assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
  const legacy = await fixture(t, { profileMode: false }); assert.equal((await legacy.req('/corpus/context', { documentIds: [legacy.fact.id], confirmed: true })).status, 403); assert.equal(legacy.calls.length, 0);
  const relay = await fixture(t, { config: { authorizeCredentials: () => true } }); assert.equal((await relay.req('/corpus/context', { documentIds: [relay.fact.id], confirmed: true })).status, 403); assert.equal(relay.calls.length, 0);
});
