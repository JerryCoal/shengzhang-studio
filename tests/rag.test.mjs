import test from 'node:test';
import assert from 'node:assert/strict';
import { planIndex, buildIndex, retrieve, indexReady, estimateQueryCny, estimateCny, RAG_MODEL, RAG_DIMENSIONS } from '../server/rag.mjs';
import { embedTexts, estimateTokens, QWEN_EMBEDDING_ENDPOINT } from '../server/qwen-embedding.mjs';

const KEY = 'test-only-no-network';
const vector = (axis = 0, value = 1) => Array.from({ length: 512 }, (_, i) => i === axis ? value : 0);
function project(count = 2) {
  return { id: 'project-a', ragEnabled: false, corpus: [{ id: 'doc-a', name: '校园活动说明', enabled: true, chunks: Array.from({ length: count }, (_, i) => ({ index: i + 1, text: i === 0 ? '参与校园活动需要在网页预约。' : `学习空间提供座位和饮水。段落${i + 1}` })) }] };
}
function mockEmbedding(options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const request = JSON.parse(init.body); calls.push({ url, init, request });
    assert.equal(url, QWEN_EMBEDDING_ENDPOINT);
    assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST'); assert(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(request.model, 'text-embedding-v4'); assert.equal(request.dimensions, 512);
    assert.equal(request.encoding_format, 'float'); assert(request.input.length <= 10);
    return options.response ? options.response(request, calls.length) : Response.json({ model: RAG_MODEL, data: request.input.map((text, index) => ({ index, embedding: options.vector ? options.vector(text) : vector(index % 2) })).reverse(), usage: { total_tokens: request.input.length * 11 } });
  };
  return { fetcher, calls };
}
async function indexed(input = project(), options = {}) {
  const mock = mockEmbedding(options);
  input.ragIndex = await buildIndex(input, { key: KEY, fetcher: mock.fetcher }); input.ragEnabled = true;
  return input;
}

test('plan is pure, estimates UTF-8 bytes in CNY and batches at ten; disabled documents never leave the device', async () => {
  const input = project(23); input.corpus.push({ id: 'disabled', name: 'PRIVATE_DISABLED', enabled: false, chunks: [{ index: 1, text: 'NEVER_SEND_DISABLED_TEXT' }] });
  const before = structuredClone(input), plan = planIndex(input), usage = [], mock = mockEmbedding();
  assert.equal(plan.chunksCount, 23); assert.equal(plan.changedCount, 23); assert.equal(plan.reusedCount, 0); assert.equal(plan.batches, 3); assert.equal(plan.withinLimit, true);
  const texts = input.corpus[0].chunks.map(c => `${input.corpus[0].name}\n${c.text}`);
  assert.equal(plan.estimatedTokens, texts.reduce((n, t) => n + Buffer.byteLength(t), 0));
  assert.equal(plan.estimatedCny, estimateCny(texts)); assert.equal(plan.estimatedCny, Number((plan.estimatedTokens * 0.5 / 1e6).toFixed(10)));
  const result = await buildIndex(input, { key: KEY, fetcher: mock.fetcher, onUsage: item => usage.push(item) });
  assert.deepEqual(mock.calls.map(c => c.request.input.length), [10, 10, 3]); assert.equal(usage.length, 3);
  assert(usage.every(u => u.status === 'completed' && !u.estimated && u.amountCny > 0));
  assert.equal(JSON.stringify(mock.calls).includes('NEVER_SEND_DISABLED_TEXT'), false);
  assert.deepEqual(input, before, 'build does not persist or enable retrieval');
  assert.equal(result.model, RAG_MODEL); assert.equal(result.dimensions, RAG_DIMENSIONS); assert.equal(result.entries.length, 23);
  assert.equal(JSON.stringify(result).includes('参与校园活动'), false, 'index never duplicates corpus text');
  assert.equal(JSON.stringify(result).includes('校园活动说明'), false);
  assert.equal(indexReady({ ...input, ragIndex: result }), true);
});

test('plan reports more than 200 chunks without throwing and build rejects before a request', async () => {
  const input = project(201), mock = mockEmbedding(), usage = [];
  const plan = planIndex(input);
  assert.equal(plan.chunksCount, 201); assert.equal(plan.tooLarge, true); assert.equal(plan.withinLimit, false);
  await assert.rejects(buildIndex(input, { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) }), /200/);
  assert.equal(mock.calls.length, 0); assert.equal(usage.length, 0);
  input.corpus[0].enabled = false;
  assert.equal(planIndex(input).chunksCount, 0);
  const empty = await buildIndex(input, { fetcher: mock.fetcher, onUsage: u => usage.push(u) });
  assert.deepEqual(empty.entries, []); assert.equal(mock.calls.length, 0);
});

test('unchanged entries are cloned and reused; rename and text changes require their own fresh vectors', async () => {
  const input = await indexed(), original = structuredClone(input), mock = mockEmbedding(), usage = [];
  const same = await buildIndex(input, { fetcher: mock.fetcher, onUsage: u => usage.push(u) });
  assert.equal(planIndex(input).changedCount, 0); assert.equal(mock.calls.length, 0); assert.equal(usage.length, 0);
  same.entries[0].vector[0] = 2; assert.deepEqual(input, original, 'returned vectors must not share mutable arrays');
  input.corpus[0].chunks[1].text = '修改后说明，提供校园活动时间。';
  assert.equal(indexReady(input), false); assert.equal(planIndex(input).changedCount, 1); assert.equal(planIndex(input).reusedCount, 1);
  input.ragIndex = await buildIndex(input, { key: KEY, fetcher: mock.fetcher }); assert.equal(mock.calls[0].request.input.length, 1);
  input.corpus[0].name = '改名后的资料'; assert.equal(planIndex(input).changedCount, 2);
});

test('deleted and disabled sources cannot be retrieved or reused across projects', async () => {
  const input = project(1); input.corpus.push({ id: 'doc-b', name: '饮水资料', enabled: true, chunks: [{ index: 1, text: '饮水区开放时间说明。' }] });
  await indexed(input); const originalIndex = structuredClone(input.ragIndex), mock = mockEmbedding();
  input.corpus[1].enabled = false;
  assert.equal(indexReady(input), false);
  let result = await retrieve(input, '饮水', { key: KEY, fetcher: mock.fetcher });
  assert.equal(result.method, 'keyword'); assert.deepEqual(result.results, []); assert.equal(mock.calls.length, 0);
  input.ragIndex = await buildIndex(input, { fetcher: mock.fetcher }); assert.equal(input.ragIndex.entries.length, 1); assert.equal(mock.calls.length, 0);
  input.corpus.splice(0, 1); result = await retrieve(input, '校园', { key: KEY, fetcher: mock.fetcher });
  assert.deepEqual(result.results, []); assert.equal(mock.calls.length, 0);
  const other = project(1); other.id = 'different-user-project'; other.ragIndex = originalIndex;
  assert.equal(indexReady(other), false); assert.equal(planIndex(other).reusedCount, 0);
});

test('hybrid ranking brings back a semantic match without keyword overlap and preserves reference coordinates', async () => {
  const input = project(); input.corpus[0].name = '产品说明'; input.corpus[0].chunks = [{ index: 1, text: '自习空间提供安静座位。' }, { index: 2, text: '手机应用支持在线缴费。' }];
  await indexed(input, { vector: text => text.includes('缴费') ? vector(1) : vector(0) });
  const mock = mockEmbedding({ vector: () => vector(1) }), usage = [];
  const result = await retrieve(input, '怎么付钱', { key: KEY, fetcher: mock.fetcher, limit: 1, onUsage: u => usage.push(u) });
  assert.equal(result.method, 'hybrid'); assert.equal(mock.calls.length, 1); assert.equal(usage.length, 1);
  assert.deepEqual(mock.calls[0].request.input, ['怎么付钱']);
  assert.deepEqual(Object.keys(result.results[0]).sort(), ['chunk', 'documentId', 'name', 'score', 'text']);
  assert.equal(result.results[0].chunk, 2); assert.equal(result.results[0].documentId, 'doc-a'); assert.equal(result.results[0].text, '手机应用支持在线缴费。');
  assert(result.results[0].score > 0); assert(!JSON.stringify(result).includes('confidence'));
});

test('disabled, missing, stale, corrupt and unconfigured index fall back locally without paid requests', async () => {
  const complete = await indexed(), mock = mockEmbedding(), usage = [];
  for (const mutate of [p => { p.ragEnabled = false; }, p => { delete p.ragIndex; }, p => { p.corpus[0].name += '改名'; }, p => { p.ragIndex.entries[0].vector = vector().slice(1); }, p => { p.ragIndex.entries[0].vector[0] = Infinity; }, p => { p.ragIndex.entries.push(structuredClone(p.ragIndex.entries[0])); }, p => { p.ragIndex.fingerprint = 'wrong'; }]) {
    const input = structuredClone(complete); mutate(input);
    const result = await retrieve(input, '校园预约', { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) });
    assert.equal(result.method, 'keyword'); assert(result.results.length > 0);
  }
  const noKey = await retrieve(complete, '校园预约', { fetcher: mock.fetcher }); assert.equal(noKey.reason, 'missing-key');
  const empty = await retrieve(complete, '  ', { key: KEY, fetcher: mock.fetcher }); assert.deepEqual(empty.results, []);
  assert.equal(mock.calls.length, 0); assert.equal(usage.length, 0);
});

test('query normalization and preflight estimate match exactly what is sent; no global query cache', async () => {
  const input = await indexed(), mock = mockEmbedding(); const query = `  校园${'活动'.repeat(300)}`;
  assert.equal(estimateQueryCny(query), estimateCny(query.slice(0, 500).trim()));
  await retrieve(input, query, { key: KEY, fetcher: mock.fetcher }); await retrieve(input, query, { key: KEY, fetcher: mock.fetcher });
  assert.equal(mock.calls.length, 2); assert.deepEqual(mock.calls[0].request.input, [query.slice(0, 500).trim()]);
});

test('HTTP refusals record zero; network/408/5xx failures reserve only this attempted batch and never retry', async () => {
  for (const status of [400, 401, 403, 404, 429, 408, 500]) {
    const input = project(11), before = structuredClone(input), mock = mockEmbedding({ response: () => new Response('UPSTREAM_SECRET_BODY', { status }) }), usage = [];
    await assert.rejects(buildIndex(input, { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) }), error => error.status === 502 && !error.message.includes('UPSTREAM_SECRET_BODY') && !error.message.includes(KEY));
    assert.equal(mock.calls.length, 1); assert.equal(usage.length, 1); assert.deepEqual(input, before);
    if (status < 500 && status !== 408) assert.deepEqual(usage[0], { tokens: 0, estimated: false, amountCny: 0, status: 'failed' });
    else { assert.equal(usage[0].status, 'uncertain'); assert(usage[0].amountCny > 0); assert(usage[0].amountCny < planIndex(input).estimatedCny); }
  }
  const usage = []; let requests = 0;
  await assert.rejects(embedTexts(['文字'], { key: KEY, fetcher: async () => { requests++; throw Error(`SECRET_${KEY}`); }, onUsage: u => usage.push(u) }), error => !error.message.includes(KEY));
  assert.equal(requests, 1); assert.deepEqual(usage, [{ tokens: null, estimated: true, amountCny: estimateCny('文字'), status: 'uncertain' }]);
});

test('malformed vectors, duplicate and missing indices, zero vectors and wrong model are rejected with known usage retained', async () => {
  const malformed = [
    [{ index: 0, embedding: vector().slice(1) }], [{ index: -1, embedding: vector() }], [{ embedding: vector() }],
    [{ index: 0, embedding: Array(512).fill(0) }], [{ index: 0, embedding: Array(512).fill('1') }], [{ index: 0, embedding: Array(512).fill(null) }],
    [], [{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }],
  ];
  for (const data of malformed) {
    const usage = [], mock = mockEmbedding({ response: () => Response.json({ data, usage: { total_tokens: 9 } }) });
    await assert.rejects(embedTexts(['文字'], { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) }), /向量/);
    assert.deepEqual(usage, [{ tokens: 9, estimated: false, amountCny: 0.0000045, status: 'failed' }]); assert.equal(mock.calls.length, 1);
  }
  const bad = mockEmbedding({ response: () => Response.json({ model: 'other-model', data: [{ index: 0, embedding: vector() }], usage: { total_tokens: 3 } }) });
  await assert.rejects(embedTexts(['文字'], { key: KEY, fetcher: bad.fetcher }), /模型不匹配/);
});

test('missing or invalid usage uses the conservative estimate and valid prompt_tokens is accepted', async () => {
  for (const usageValue of [undefined, { total_tokens: -1 }, { total_tokens: '8' }, { total_tokens: 1.5 }]) {
    const usage = [], mock = mockEmbedding({ response: () => Response.json({ data: [{ index: 0, embedding: vector() }], usage: usageValue }) });
    await embedTexts(['校园🙂'], { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) });
    assert.deepEqual(usage, [{ tokens: null, estimated: true, amountCny: estimateCny('校园🙂'), status: 'completed' }]);
  }
  assert.equal(estimateTokens('校园🙂'), 10);
  const mock = mockEmbedding({ response: () => Response.json({ data: [{ index: 0, embedding: vector() }], usage: { prompt_tokens: 4 } }) });
  assert.equal((await embedTexts(['文字'], { key: KEY, fetcher: mock.fetcher })).usage.tokens, 4);
});

test('response size limits cover content-length and streamed bodies, without exposing body contents', async () => {
  for (const response of [() => new Response('PRIVATE', { headers: { 'content-length': '4000001' } }), () => new Response('x'.repeat(4_000_001))]) {
    const usage = [], mock = mockEmbedding({ response });
    await assert.rejects(embedTexts(['文字'], { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) }), error => /大小限制/.test(error.message) && !error.message.includes('PRIVATE'));
    assert.equal(usage.length, 1); assert.equal(usage[0].status, 'uncertain'); assert.equal(mock.calls.length, 1);
  }
});

test('local validation blocks invalid input before a request or usage callback', async () => {
  const mock = mockEmbedding(), usage = [];
  for (const texts of [[], Array(11).fill('文字'), [''], ['a'.repeat(8193)], [17]]) await assert.rejects(embedTexts(texts, { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) }), e => e.status === 400);
  await assert.rejects(embedTexts(['文字'], { key: 'bad\r\nkey', fetcher: mock.fetcher, onUsage: u => usage.push(u) }), e => e.status === 400);
  const input = project(1); input.corpus[0].chunks[0].text = '中'.repeat(3000);
  assert.equal(planIndex(input).withinLimit, false); assert.equal(planIndex(input).invalidChunksCount, 1);
  await assert.rejects(buildIndex(input, { key: KEY, fetcher: mock.fetcher }), /过长/);
  assert.equal(mock.calls.length, 0); assert.equal(usage.length, 0);
});

test('query upstream failure falls back with usage, while ledger conflicts propagate once and stop later batches', async () => {
  const input = await indexed(), mock = mockEmbedding({ response: () => new Response('NO_PRIVATE_ERRORS', { status: 503 }) }), usage = [];
  const result = await retrieve(input, '校园预约', { key: KEY, fetcher: mock.fetcher, onUsage: u => usage.push(u) });
  assert.equal(result.method, 'keyword'); assert.equal(result.reason, 'query-failed'); assert.equal(usage.length, 1); assert.equal(mock.calls.length, 1);
  const good = mockEmbedding(); let callbacks = 0; const conflict = Object.assign(Error('project changed'), { status: 409 });
  await assert.rejects(retrieve(input, '校园预约', { key: KEY, fetcher: good.fetcher, onUsage: () => { callbacks++; throw conflict; } }), error => error === conflict);
  assert.equal(callbacks, 1);
  await assert.rejects(buildIndex(project(23), { key: KEY, fetcher: good.fetcher, onUsage: () => { callbacks++; throw conflict; } }), error => error === conflict);
  assert.equal(callbacks, 2); assert.equal(good.calls.length, 2, 'no second index batch after callback conflict');
});

test('in-flight source deletion cannot return stale semantic passages', async () => {
  const input = await indexed(), mock = mockEmbedding({ response: request => { input.corpus[0].enabled = false; return Response.json({ data: request.input.map((_, index) => ({ index, embedding: vector() })), usage: { total_tokens: 5 } }); } });
  const result = await retrieve(input, '校园预约', { key: KEY, fetcher: mock.fetcher });
  assert.equal(result.method, 'keyword'); assert.equal(result.reason, 'stale-index'); assert.deepEqual(result.results, []);
});

test('corpus changes between indexing batches stop before another request, and disabling during retrieval takes effect', async () => {
  const input = project(23), mock = mockEmbedding(); let callbacks = 0;
  await assert.rejects(buildIndex(input, { key: KEY, fetcher: mock.fetcher, onUsage: () => { callbacks++; input.corpus[0].enabled = false; } }), error => error.status === 409);
  assert.equal(mock.calls.length, 1); assert.equal(callbacks, 1); assert.equal(input.ragIndex, undefined);
  const ready = await indexed(), queryMock = mockEmbedding();
  const result = await retrieve(ready, '校园预约', { key: KEY, fetcher: queryMock.fetcher, onUsage: () => { ready.ragEnabled = false; } });
  assert.equal(result.reason, 'disabled'); assert.equal(result.method, 'keyword'); assert.equal(queryMock.calls.length, 1);
});
