import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';

const key = 'sk-rag-fixture-not-real';
const vector = (axis = 0) => Array.from({ length: 512 }, (_, i) => i === axis ? 1 : 0);
const embeddings = input => Response.json({ data: input.map((_, index) => ({ index, embedding: vector() })), usage: { total_tokens: input.length * 8 } });
const completion = input => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(input.task ? { title: '真实文案', body: '使用已提供的项目事实', prompt: '校园生活', scenes: ['开场', '产品', '邀请'] } : { title: '真实策略', core: '真实核心', direction: '真实方向', prompt: '真实制作要求' }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
async function fixture(t, overrides = {}) {
  const store = createStore(':memory:'), calls = [], modelStore = createModelStore();
  modelStore.save({ strategy: 'qwen-plus', planning: 'qwen-plus', copy: 'qwen-plus', classification: 'qwen-flash', analysis: 'qwen-plus' });
  const app = createApp(store, { profileMode: true, qwenVault: { status: () => ({ configured: true }), getKey: async () => key }, modelStore,
    fetcher: async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body }); return url.endsWith('/embeddings') ? embeddings(body.input) : completion(JSON.parse(body.messages[1].content)); }, ...overrides });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const id = store.get().projects[0].id, base = `/projects/${id}/corpus`;
  const importDoc = async (text = '结伴自习的学生可以相互督促。', name = '校园项目资料') => (await req(base, 'POST', { text, name })).data.result;
  const build = async () => { const plan = (await req(base + '/rag')).data.plan; return req(base + '/rag', 'POST', { consent: true, expectedFingerprint: plan.fingerprint }); };
  return { store, calls, app, req, id, base, importDoc, build, current: () => store.get().projects[0] };
}

test('RAG build requires explicit fresh consent, reuses vectors, and query does not upload corpus again', async t => {
  const f = await fixture(t); await f.importDoc(); const path = f.base + '/rag';
  assert.equal((await f.req(path, 'POST', {})).status, 400);
  assert.equal((await f.req(path, 'POST', { consent: true, expectedFingerprint: 'old' })).status, 409);
  assert.equal(f.calls.length, 0);
  const built = await f.build(); assert.equal(built.status, 200, JSON.stringify(built));
  assert.equal(built.data.result.ready, true); assert.equal(built.data.result.enabled, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.model, 'text-embedding-v4'); assert.equal(f.calls[0].body.dimensions, 512);
  assert(!JSON.stringify(f.current().ragIndex).includes('结伴自习'));
  assert.equal((await f.build()).status, 200); assert.equal(f.calls.length, 1, 'unchanged documents are not uploaded twice');
  const response = await f.req(f.base + '/search', 'POST', { query: '寻找学习伙伴' });
  assert.equal(response.status, 200); assert.equal(response.data.method, 'hybrid');
  assert.equal(response.data.results[0].name, '校园项目资料');
  assert.deepEqual(f.calls.at(-1).body.input, ['寻找学习伙伴']);
  assert(f.current().ragUsage.every(u => u.amountCny >= 0));
  assert.equal(f.current().usage.length, 0, 'CNY embeddings are separate from USD generation');
  assert(!JSON.stringify((await f.req('/state')).data).includes(key));
});

test('disabled, changed and deleted corpora cannot silently use stale semantic references', async t => {
  const f = await fixture(t); const doc = await f.importDoc(); await f.build(); const paid = f.calls.length;
  await f.req(f.base + '/rag', 'PATCH', { enabled: false });
  assert.equal((await f.req(f.base + '/search', 'POST', { query: '自习' })).data.method, 'keyword'); assert.equal(f.calls.length, paid);
  assert.equal((await f.req(f.base + '/rag', 'PATCH', { enabled: true })).status, 400);
  assert.equal((await f.req(f.base + '/rag', 'PATCH', { enabled: true, consent: true })).status, 200);
  await f.req(f.base + '/' + doc.id, 'PATCH', { enabled: false });
  const found = (await f.req(f.base + '/search', 'POST', { query: '自习' })).data;
  assert.equal(found.method, 'keyword'); assert.deepEqual(found.results, []); assert.equal(f.calls.length, paid);
  assert.equal((await f.req(f.base + '/rag')).data.ready, false);
  const spend = (await f.req(f.base + '/rag')).data.usageCny;
  await f.req(f.base + '/rag', 'DELETE');
  assert.equal((await f.req(f.base + '/rag')).data.usageCny, spend, 'deleting index cannot reset budget');
  assert.equal(f.current().corpus.length, 1);
});

test('semantic evidence reaches strategy, planning and copy with a single query embedding per generation', async t => {
  const f = await fixture(t); await f.importDoc(); await f.build();
  for (const stage of ['strategy', 'planning']) {
    const response = await f.req(`/projects/${f.id}/strategies`, 'POST', { mode: 'openai', stage, query: '寻找学习伙伴' });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.result.retrievalMethod, 'hybrid');
    assert.equal(response.data.result.corpusReferences[0].name, '校园项目资料');
  }
  const strategy = f.current().strategies.at(-1);
  await f.req(`/projects/${f.id}/strategies/${strategy.id}/confirm`, 'POST', {});
  const asset = f.current().assets[0];
  const copied = await f.req(`/projects/${f.id}/assets/${asset.id}/copy`, 'POST', { expectedRevision: asset.revision, instruction: '寻找学习伙伴' });
  assert.equal(copied.status, 200, JSON.stringify(copied)); assert.equal(copied.data.result.retrievalMethod, 'hybrid');
  assert.equal(f.calls.filter(c => c.url.endsWith('/embeddings')).length, 4, 'one build + three queries, stale checks must not re-embed');
  for (const c of f.calls.filter(c => c.url.endsWith('/chat/completions'))) assert.equal(JSON.parse(c.body.messages[1].content).corpusReferences[0].name, '校园项目资料');
});

test('first index cancellation invalidates the in-flight job and records the already sent batch', async t => {
  let f, calls = 0;
  f = await fixture(t, { fetcher: async (_url, init) => {
    calls++; const body = JSON.parse(init.body);
    assert.equal((await f.req(f.base + '/rag', 'DELETE')).status, 200);
    return embeddings(body.input);
  } });
  await f.importDoc(Array.from({ length: 15 }, (_, i) => `独立段落${i}校园事实`).join('\n\n'));
  const result = await f.build(); assert.equal(result.status, 409); assert.equal(calls, 1);
  assert.equal(f.current().ragIndex, undefined); assert.equal(f.current().ragEnabled, false);
  assert(f.current().ragUsage.at(-1).amountCny > 0); assert(!f.app.locals.activeJobs.size);
});

test('partial index failure preserves old corpus without committing a partial index or refunding successful calls', async t => {
  let calls = 0;
  const f = await fixture(t, { fetcher: async (_url, init) => ++calls === 1 ? embeddings(JSON.parse(init.body).input) : Response.json({ error: key }, { status: 429 }) });
  await f.importDoc(Array.from({ length: 15 }, (_, i) => `分段${i}原始校园内容`).join('\n\n'));
  const result = await f.build(); assert.equal(result.status, 502); assert(!JSON.stringify(result).includes(key));
  assert.equal(calls, 2); assert.equal(f.current().ragIndex, undefined); assert.equal(f.current().corpus.length, 1);
  assert.equal(f.current().ragUsage.at(-1).amountCny, 80 * 0.5 / 1e6); assert.equal(f.current().ragUsage.at(-1).status, 'failed');
});

test('request cannot pass the per-project CNY cap or the local encrypted workspace boundary', async t => {
  const f = await fixture(t); await f.importDoc();
  f.store.mutate(s => { s.projects[0].ragPreviousCny = 1; });
  assert.equal((await f.build()).status, 400); assert.equal(f.calls.length, 0);
  assert.equal((await f.req(f.base + '/rag', 'DELETE', undefined, { 'X-Forwarded-For': '203.0.113.1' })).status, 403);
  const legacy = await fixture(t, { profileMode: false }); await legacy.importDoc();
  assert.equal((await legacy.req(legacy.base + '/rag')).data.available, false); assert.equal((await legacy.build()).status, 403);
  const relay = await fixture(t, { authorizeCredentials: () => true }); await relay.importDoc();
  assert.equal((await relay.req(relay.base + '/rag')).data.available, false); assert.equal((await relay.build()).status, 403);
});

test('corpus changes during query stop generation before the chat model is charged', async t => {
  let f, modify = false, chats = 0;
  f = await fixture(t, { fetcher: async (url, init) => {
    const body = JSON.parse(init.body);
    if (!url.endsWith('/embeddings')) { chats++; return completion(JSON.parse(body.messages[1].content)); }
    if (modify) f.store.mutate(s => { s.projects[0].corpus[0].enabled = false; });
    return embeddings(body.input);
  } });
  await f.importDoc(); await f.build(); modify = true;
  const result = await f.req(`/projects/${f.id}/strategies`, 'POST', { mode: 'openai', query: '学习伙伴' });
  assert.equal(result.status, 409); assert.equal(chats, 0); assert.equal(f.current().usage.length, 0);
});

test('large corpus plan remains readable and can be reduced without issuing paid calls', async t => {
  const f = await fixture(t); await f.importDoc(Array.from({ length: 201 }, (_, i) => `段落${i}内容`).join('\n\n'));
  assert.equal((await f.req(f.base + '/rag')).data.plan.chunksCount, 201);
  assert.equal((await f.build()).status, 400); assert.equal(f.calls.length, 0);
});

test('failed semantic query explicitly falls back and retains uncertainty and fee estimate', async t => {
  let fail = false;
  const f = await fixture(t, { fetcher: async (_url, init) => { if (fail) throw Error(key); return embeddings(JSON.parse(init.body).input); } });
  await f.importDoc(); await f.build(); fail = true;
  const result = await f.req(f.base + '/search', 'POST', { query: '自习' });
  assert.equal(result.status, 200); assert.equal(result.data.method, 'keyword'); assert.match(result.data.note, /未完成/);
  const usage = f.current().ragUsage.at(-1);
  assert.equal(usage.status, 'uncertain'); assert.equal(usage.estimated, true); assert(usage.amountCny > 0);
  assert(!JSON.stringify(result).includes(key));
  f.store.mutate(s => { s.projects[0].ragPreviousCny = 1; });
  const next = await f.req(f.base + '/search', 'POST', { query: '自习' });
  assert.equal(next.data.method, 'keyword'); assert.match(next.data.note, /预算不足/);
  assert.equal(f.current().ragUsage.length, 2, 'exhausted budget cannot cause more calls');
});

test('unexpected upstream token charge stops later batches and records the reported amount', async t => {
  let calls = 0;
  const f = await fixture(t, { fetcher: async (_url, init) => { calls++; const input = JSON.parse(init.body).input; return Response.json({ data: input.map((_, index) => ({ index, embedding: vector() })), usage: { total_tokens: 3_000_000 } }); } });
  await f.importDoc(Array.from({ length: 15 }, (_, i) => `预算段落${i}`).join('\n\n'));
  const result = await f.build(); assert.equal(result.status, 400); assert.equal(calls, 1);
  assert.equal(f.current().ragUsage.at(-1).amountCny, 1.5); assert.equal(f.current().ragIndex, undefined);
});
