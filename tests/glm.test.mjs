import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, STAGES, stageConfig } from '../server/models.mjs';
import { createGLMTransport, GLM_BASE } from '../server/glm.mjs';

const key = 'glm-fixture-1234567890.secret-1234567890';
const routes = Object.fromEntries(STAGES.map(stage => [stage.id, ['strategy', 'planning', 'analysis'].includes(stage.id) ? 'glm-5.3' : 'glm-5.3-flash']));
const strategy = { title: '真实场景', core: '依据产品资料', direction: '展示实际体验', prompt: '保持产品事实' };
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value), reasoning_content: 'private-reasoning-fixture' } }], usage: { prompt_tokens: 100, completion_tokens: 200 } });
function vault() { let value = ''; return { status: () => ({ supported: true, configured: !!value, suffix: value.slice(-4), problem: '' }), save: async next => { value = next; }, getKey: async () => value, remove: () => { value = ''; } }; }
async function fixture(t, fetcher) {
  const store = createStore(':memory:'), modelStore = createModelStore(), glmVault = vault(), openaiVault = vault();
  const app = createApp(store, { glmVault, vault: openaiVault, modelStore, fetcher });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, method = 'GET', body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; };
  return { req, store, modelStore, glmVault, openaiVault, project: store.get().projects[0] };
}
test('GLM saves independent credentials without contacting provider and probes only free model without project data', async t => {
  const calls = [];
  const f = await fixture(t, async (url, init) => { calls.push(JSON.parse(init.body)); assert.equal(url, `${GLM_BASE}/chat/completions`); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Bearer ${key}`); return Response.json({ choices: [{ message: { content: 'OK' } }] }); });
  await f.openaiVault.save('sk-openai-fixture-not-glm-1234567890');
  const path = '/settings/providers/glm/credential';
  assert.equal((await f.req(path, 'PUT', { apiKey: key, baseUrl: 'https://untrusted.test' })).status, 400);
  assert.equal((await f.req(path, 'PUT', { apiKey: key })).status, 200); assert.equal(calls.length, 0);
  const checked = await f.req(`${path}/check`, 'POST'); assert.equal(checked.status, 200);
  assert.equal(calls[0].model, 'glm-4.7-flash'); assert.equal(calls[0].max_tokens, 16); assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'Reply with OK only.' }]);
  assert.equal(checked.data.providers.glm.verification.models.find(m => m.model === 'glm-5.3').available, null);
  for (const route of ['/state', '/settings', '/backup']) assert(!JSON.stringify((await f.req(route)).data).includes(key));
  await f.req(path, 'DELETE'); assert.equal((await f.req('/settings')).data.providers.glm.configured, false); assert.equal((await f.req('/settings')).data.openaiConfigured, true);
});
test('GLM current models drive strategies, copy, classification and analysis with mandatory thinking and usage', async t => {
  const calls = [];
  const f = await fixture(t, async (url, init) => {
    assert.equal(url, `${GLM_BASE}/chat/completions`); assert.equal(init.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(init.body), payload = JSON.parse(body.messages[1].content); calls.push(body);
    assert.equal(body.thinking.type, 'enabled'); assert(['low', 'high'].includes(body.reasoning_effort)); assert.equal(body.response_format.type, 'json_object'); assert.equal(body.stream, false); assert(body.max_tokens >= 12000);
    if (payload.task) return completion({ title: '新标题', body: '真实介绍', prompt: '画面说明', scenes: ['开场', '演示', '结尾'] });
    if (payload.comments && !payload.brief) return completion({ comments: payload.comments.map(c => ({ id: c.id, tags: ['使用疑问'], sentiment: 'neutral', reason: '提问', evidence: c.text, needsReview: false })) });
    if (payload.comments) return completion({ insights: [{ category: '使用疑问', title: '补充使用说明', observation: '用户提问', recommendation: '下次演示使用过程', evidenceIds: [payload.comments[0].id] }] });
    return completion(strategy);
  });
  await f.glmVault.save(key); f.modelStore.save(routes);
  const base = `/projects/${f.project.id}`;
  for (const stage of ['strategy', 'planning']) { const result = await f.req(`${base}/strategies`, 'POST', { mode: 'openai', stage }); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.result.source, 'glm'); }
  const latest = f.store.get().projects[0].strategies.at(-1); await f.req(`${base}/strategies/${latest.id}/confirm`, 'POST');
  const asset = f.store.get().projects[0].assets[0]; assert.equal((await f.req(`${base}/assets/${asset.id}/copy`, 'POST', { expectedRevision: asset.revision })).status, 200);
  await f.req(`${base}/comments/sample`, 'POST'); assert.equal((await f.req(`${base}/comments/classify`, 'POST')).status, 200); assert.equal((await f.req(`${base}/analysis`, 'POST', { mode: 'openai' })).status, 200);
  assert.deepEqual(calls.map(c => c.model), ['glm-5.3', 'glm-5.3', 'glm-5.3-flash', 'glm-5.3-flash', 'glm-5.3']);
  assert(f.store.get().projects[0].usage.every(u => u.status === 'completed' && u.amountUsd > 0)); assert(!JSON.stringify(f.store.get()).includes('private-reasoning-fixture'));
});
test('GLM missing key never uses another provider; billing failures release reservation and truncation preserves content', async t => {
  let failed = true, calls = 0;
  const f = await fixture(t, async () => { calls++; return failed ? Response.json({ error: { code: '1113', message: key } }, { status: 429 }) : Response.json({ choices: [{ finish_reason: 'length', message: { content: '{incomplete' } }], usage: { prompt_tokens: 2, completion_tokens: 12 } }); });
  f.modelStore.save(routes); await f.openaiVault.save('sk-openai-only-fixture-1234567890');
  const path = `/projects/${f.project.id}/strategies`;
  assert.equal((await f.req(path, 'POST', { mode: 'openai' })).status, 400); assert.equal(calls, 0);
  await f.glmVault.save(key); const count = f.store.get().projects[0].strategies.length;
  const result = await f.req(path, 'POST', { mode: 'openai' }); assert.equal(result.status, 502); assert.equal(result.data.diagnostic.kind, 'billing'); assert(!JSON.stringify(result).includes(key)); assert.equal(f.store.get().projects[0].usage.at(-1).amountUsd, 0);
  failed = false; assert.equal((await f.req(path, 'POST', { mode: 'openai' })).status, 502); assert.equal(f.store.get().projects[0].strategies.length, count); assert.equal(f.store.get().projects[0].usage.at(-1).status, 'uncertain');
});
test('GLM distinguishes model permissions from rate limits and cooldown suppresses duplicate requests', async () => {
  let calls = 0, code = '1311';
  const transport = createGLMTransport(async () => { calls++; return Response.json({ error: { code, message: key } }, { status: 429, headers: { 'retry-after': '60' } }); });
  const invoke = () => transport.fetch(`${GLM_BASE}/chat/completions`, { body: JSON.stringify({ model: 'glm-5.3' }) });
  await assert.rejects(invoke(), e => e.diagnostic.kind === 'permission' && !e.message.includes(key));
  code = '1302'; await assert.rejects(invoke(), e => e.diagnostic.kind === 'rate_limit'); await assert.rejects(invoke(), e => e.status === 429 && e.noCharge); assert.equal(calls, 2);
  assert.equal(stageConfig('strategy', routes).maxTokens, 12000); assert(!JSON.stringify(transport.diagnostic()).includes(key));
});
