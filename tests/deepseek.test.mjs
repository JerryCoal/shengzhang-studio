import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, DEEPSEEK_ROUTES, DEFAULT_ROUTES, stageConfig } from '../server/models.mjs';
import { createDeepSeekTransport, verifyDeepSeek } from '../server/deepseek.mjs';
import { estimateReservation, generateStage } from '../server/ai.mjs';
const key = 'sk-deepseek-tests-only-1234567890';
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value), reasoning_content: 'private reasoning not to persist' } }], usage: { prompt_tokens: 100, completion_tokens: 200 } });
function fakeVault() { let value = ''; return { status: () => ({ supported: true, configured: !!value, suffix: value.slice(-4), problem: '' }), getKey: async () => value, save: async v => { value = v; }, remove: () => { value = ''; } }; }
async function fixture(t, fetcher) {
  const store = createStore(':memory:'), modelStore = createModelStore(), vault = fakeVault(), deepseekVault = fakeVault();
  const app = createApp(store, { vault, deepseekVault, modelStore, fetcher }), server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeIdleConnections(); store.close(); });
  const req = async (path, method = 'GET', body, headers = {}) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() }; };
  return { req, store, modelStore, vault, deepseekVault, p: store.get().projects[0] };
}

test('DeepSeek credential lifecycle is independent; check reads only official models and sanitized balance', async t => {
  const calls = [];
  const { req, vault } = await fixture(t, async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/models') ? Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }) : Response.json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.25', granted_balance: key, other: key }] });
  });
  await vault.save('sk-openai-test-only-111111111111');
  const path = '/settings/providers/deepseek/credential';
  assert.equal((await req(path, 'PUT', { apiKey: key }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await req(path, 'PUT', { apiKey: key, baseUrl: 'https://evil.test' })).status, 400);
  assert.equal((await req(path, 'PUT', { apiKey: key })).status, 200); assert.equal(calls.length, 0);
  const check = await req(path + '/check', 'POST'); assert.equal(check.status, 200);
  assert.equal(check.data.providers.deepseek.verification.balance.items[0].total, '10.25');
  assert.deepEqual(calls.map(c => c.url), ['https://api.deepseek.com/models', 'https://api.deepseek.com/user/balance']);
  for (const call of calls) { assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.headers.Authorization, `Bearer ${key}`); assert.equal(call.init.body, undefined); }
  for (const url of ['/settings', '/backup', '/state']) assert(!JSON.stringify((await req(url)).data).includes(key));
  await req(path, 'DELETE'); const settings = (await req('/settings')).data;
  assert.equal(settings.providers.deepseek.configured, false); assert.equal(settings.openaiConfigured, true);
});

test('all five text stages use DeepSeek with corpus retrieval, validation and sensitive-word screening', async t => {
  const calls = [];
  const { req, store, modelStore, deepseekVault, p } = await fixture(t, async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(init.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content); calls.push(body);
    assert.equal(body.response_format.type, 'json_object'); assert.equal(body.stream, false); assert.match(body.messages[0].content, /json/);
    if (input.task) return completion({ title: '必须替换测试词', body: '真实便携信息', prompt: '镜头说明', scenes: ['开场', '演示', '结尾'] });
    if (input.comments && !input.brief) return completion({ comments: input.comments.map(c => ({ id: c.id, tags: ['使用疑问'], sentiment: 'neutral' })) });
    if (input.comments) return completion({ insights: [{ category: '使用疑问', title: '补充介绍', observation: '评论提出疑问', recommendation: '补充事实说明', evidenceIds: [input.comments[0].id] }] });
    assert.ok(input.corpusReferences.some(r => r.text.includes('露营轻量杯')));
    return completion({ title: '必须替换测试词', core: '真实事实', direction: '露营使用场景', prompt: '拍摄真实产品' });
  });
  await deepseekVault.save(key); modelStore.save(DEEPSEEK_ROUTES);
  await req('/content-rules', 'PUT', { expectedRevision: 0, rules: [{ id: 'ds-rule', term: '必须替换测试词', replacement: '克制表达', enabled: true }] });
  await req(`/projects/${p.id}/corpus`, 'POST', { name: '项目事实', text: '露营轻量杯适合随身携带。' });
  for (const stage of ['strategy', 'planning']) {
    const generated = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai', stage, query: '露营轻量杯' });
    assert.equal(generated.status, 200); assert.equal(generated.data.result.source, 'deepseek'); assert.equal(generated.data.result.title, '克制表达');
  }
  const strategy = store.get().projects[0].strategies.at(-1);
  await req(`/projects/${p.id}/strategies/${strategy.id}/confirm`, 'POST');
  const asset = store.get().projects[0].assets[0];
  const copy = await req(`/projects/${p.id}/assets/${asset.id}/copy`, 'POST', { expectedRevision: asset.revision });
  assert.equal(copy.status, 200); assert.equal(copy.data.result.title, '克制表达');
  await req(`/projects/${p.id}/comments/sample`, 'POST');
  assert.equal((await req(`/projects/${p.id}/comments/classify`, 'POST')).status, 200);
  const analysis = await req(`/projects/${p.id}/analysis`, 'POST', { mode: 'openai' }); assert.equal(analysis.status, 200); assert.equal(analysis.data.result[0].source, 'deepseek');
  assert.deepEqual(calls.map(c => c.thinking.type), ['enabled', 'enabled', 'disabled', 'disabled', 'enabled']);
  assert.deepEqual(calls.map(c => c.model), ['deepseek-v4-pro', 'deepseek-v4-pro', 'deepseek-flash', 'deepseek-flash', 'deepseek-flash']);
  const state = store.get(); assert.ok(state.projects[0].usage.every(u => u.amountUsd > 0)); assert.ok(!JSON.stringify(state).includes('private reasoning'));
  assert.equal(state.projects[0].usage.at(-1).amountUsd, 0.00027);
});

test('DeepSeek selection never falls back to an OpenAI key; model-specific budget blocks dispatch', async t => {
  let calls = 0; const { req, modelStore, vault, deepseekVault, store, p } = await fixture(t, async () => { calls++; return completion({}); });
  modelStore.save(DEEPSEEK_ROUTES); await vault.save('sk-openai-only-123456789012345');
  const missing = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' }); assert.equal(missing.status, 400); assert.match(missing.data.error, /DeepSeek/); assert.equal(calls, 0);
  await deepseekVault.save(key); store.mutate(s => { s.projects[0].brief.budgetUsd = 0; });
  assert.equal((await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' })).status, 400); assert.equal(calls, 0);
});

test('DeepSeek 402 releases reservation, 429 waits, and truncated JSON cannot overwrite existing copy', async t => {
  let status = 402, calls = 0;
  const { req, store, modelStore, deepseekVault, p } = await fixture(t, async () => { calls++; return status === 200 ? Response.json({ choices: [{ finish_reason: 'length', message: { content: '{broken' } }], usage: { prompt_tokens: 100, completion_tokens: 200 } }) : Response.json({ error: { message: key } }, { status, headers: { 'Retry-After': '60' } }); });
  modelStore.save(DEEPSEEK_ROUTES); await deepseekVault.save(key);
  const path = `/projects/${p.id}/strategies`, original = store.get().projects[0].strategies.length;
  const rejected = await req(path, 'POST', { mode: 'openai' }); assert.equal(rejected.data.diagnostic.code, 'insufficient_balance'); assert.ok(!JSON.stringify(rejected).includes(key)); assert.equal(store.get().projects[0].usage.at(-1).amountUsd, 0);
  status = 200; assert.equal((await req(path, 'POST', { mode: 'openai' })).status, 502); assert.equal(store.get().projects[0].strategies.length, original); assert.equal(store.get().projects[0].usage.at(-1).amountUsd, 0.000924);
  status = 429; await req(path, 'POST', { mode: 'openai' }); const before = calls;
  assert.equal((await req(path, 'POST', { mode: 'openai' })).status, 429); assert.equal(calls, before);
});

test('DeepSeek balance validates external fields and network errors never leak request secrets', async () => {
  const client = createDeepSeekTransport(async () => { throw new Error(key); });
  await assert.rejects(client.fetch('https://api.deepseek.com/models'), e => e.diagnostic.provider === 'deepseek' && !e.message.includes(key) && !e.noCharge);
  await assert.rejects(verifyDeepSeek(key, async url => Response.json(url.endsWith('/models') ? { data: [] } : { is_available: true, balance_infos: [{ currency: 'USD', total_balance: key }] })), /余额响应无效/);
  const config = { ...stageConfig('copy', DEEPSEEK_ROUTES), apiKey: key };
  assert.ok(estimateReservation({ text: 'test' }, config) > 0);
  await assert.rejects(generateStage({}, config, async () => completion({ title: 'empty response' })), /结果不完整/);
  assert.equal(stageConfig('strategy', DEFAULT_ROUTES).provider, 'openai');
});
