import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createVault, dpapi } from '../server/vault.mjs';
import { createModelStore, DEFAULT_ROUTES } from '../server/models.mjs';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { isLocalClient } from '../server/ai-routes.mjs';

const secret = 'sk-test-only-never-a-real-key-1234567890';
const output = value => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 200 } });
const strategy = { title: '新策略', core: '真实事实', direction: '三种场景', prompt: '不编造产品信息' };
function directory(t) { const path = mkdtempSync(join(tmpdir(), 'studio-vault-test-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function testTransform() {
  const key = randomBytes(32);
  return async (action, bytes) => {
    if (action === 'protect') { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); }
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  };
}
async function fixture(t, options = {}) {
  const dir = directory(t), vault = createVault(join(dir, 'key.json'), { transform: testTransform(), supported: true });
  const modelStore = createModelStore(join(dir, 'models.json')), store = createStore(':memory:');
  const server = createApp(store, { vault, modelStore, ...options }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, method = 'GET', body, headers = {}) => { const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  return { req, store, vault, modelStore, dir, p: store.get().projects[0] };
}
test('Windows DPAPI survives vault reopen; plaintext is never persisted and tampering fails closed', { skip: process.platform !== 'win32' }, async t => {
  const file = join(directory(t), 'real-dpapi.json');
  const vault = createVault(file); await vault.save(secret);
  const raw = readFileSync(file, 'utf8'); assert.ok(!raw.includes(secret)); assert.ok(!raw.includes(Buffer.from(secret).toString('base64')));
  assert.equal(await createVault(file).getKey(), secret);
  const envelope = JSON.parse(raw); const cipher = Buffer.from(envelope.ciphertext, 'base64'); cipher[cipher.length - 1] ^= 1;
  await assert.rejects(dpapi('unprotect', cipher));
  vault.remove(); assert.equal(await vault.getKey(), ''); assert.equal(existsSync(file), false);
});
test('unsupported vault cannot write plaintext and encryption failure preserves old key', async t => {
  const file = join(directory(t), 'key.json');
  await assert.rejects(createVault(file, { supported: false }).save(secret)); assert.equal(existsSync(file), false);
  const transform = testTransform(), vault = createVault(file, { supported: true, transform }); await vault.save(secret);
  const failing = createVault(file, { supported: true, transform: async () => { throw new Error('encryption failed'); } }); await assert.rejects(failing.save('replacement'));
  assert.equal(await vault.getKey(), secret);
  writeFileSync(file, '{broken'); assert.ok(vault.status().problem); await assert.rejects(vault.getKey());
});
test('credential lifecycle hides key in every response and does not contact provider on save', async t => {
  let calls = 0; const { req, dir } = await fixture(t, { fetcher: () => { calls++; throw new Error('unexpected'); } });
  assert.equal((await req('/settings/credential', 'PUT', { apiKey: secret })).status, 200);
  for (const path of ['/settings', '/state', '/backup']) { const result = await req(path); assert.equal(result.status, 200); assert.ok(!JSON.stringify(result).includes(secret)); }
  assert.ok(!readFileSync(join(dir, 'key.json'), 'utf8').includes(secret));
  assert.equal((await req('/settings')).data.credential.suffix, '7890'); assert.equal(calls, 0);
  assert.equal((await req('/settings/credential', 'PUT', { apiKey: 'wrong' })).status, 400);
  assert.equal((await req('/settings/credential', 'PUT', { apiKey: secret, baseUrl: 'https://evil.test' })).status, 400);
  await req('/settings/credential', 'DELETE'); assert.equal((await req('/settings')).data.openaiConfigured, false); assert.equal(existsSync(join(dir, 'key.json')), false);
});
test('local credential endpoints reject remote origin, proxy and DNS rebinding contexts', async t => {
  const { req } = await fixture(t);
  for (const headers of [{ Origin: 'https://evil.test' }, { 'X-Forwarded-For': '203.0.113.1' }, { Origin: 'capacitor://localhost' }]) assert.equal((await req('/settings/credential', 'PUT', { apiKey: secret }, headers)).status, 403, JSON.stringify(headers));
  const fake = (address, host, origin) => ({ socket: { remoteAddress: address }, get: name => ({ Host: host, Origin: origin })[name] });
  assert.equal(isLocalClient(fake('192.168.1.4', '127.0.0.1:4318')), false); assert.equal(isLocalClient(fake('127.0.0.1', 'evil.test')), false); assert.equal(isLocalClient(fake('127.0.0.1', '127.0.0.1:4318')), true);
});
test('connection check uses fixed official host without generation, redacts provider errors', async t => {
  const calls = []; let rejected = false;
  const { req } = await fixture(t, { fetcher: async (url, init) => { calls.push([url, init]); if (rejected) throw new Error(`network leaked ${secret}`); return Response.json({ data: [{ id: 'gpt-5.4' }] }); } });
  await req('/settings/credential', 'PUT', { apiKey: secret });
  const check = await req('/settings/credential/check', 'POST'); assert.equal(check.status, 200); assert.ok(check.data.verification.models.some(m => !m.available));
  assert.equal(calls[0][0], 'https://api.openai.com/v1/models'); assert.equal(calls[0][1].method, 'GET'); assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].body, undefined);
  rejected = true; const failure = await req('/settings/credential/check', 'POST'); assert.equal(failure.status, 502); assert.ok(!JSON.stringify(failure).includes(secret)); assert.equal((await req('/settings')).data.verification, null);
});
test('per-stage selections persist, drive planning calls and preserve per-call pricing', async t => {
  let sent; const { req, dir, store, p } = await fixture(t, { apiKey: secret, fetcher: async (_, init) => { sent = JSON.parse(init.body); return output(strategy); } });
  const routes = { ...DEFAULT_ROUTES, planning: 'gpt-5.4-mini' };
  assert.equal((await req('/settings/models', 'PUT', { ...routes, copy: 'unknown-model' })).status, 400);
  assert.equal((await req('/settings/models', 'PUT', routes)).status, 200); assert.deepEqual(createModelStore(join(dir, 'models.json')).get(), routes);
  const generated = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai', stage: 'planning' }); assert.equal(generated.status, 200); assert.equal(sent.model, routes.planning);
  assert.equal(generated.data.result.stage, 'planning'); assert.equal(generated.data.result.model, routes.planning); assert.equal(store.get().projects[0].usage.at(-1).amountUsd, 0.000975);
});

test('quota rejection reaches settings safely, releases budget, and is not hidden by model-list success', async t => {
  let calls = 0;
  const { req, store, p } = await fixture(t, { apiKey: secret, fetcher: async url => {
    calls++;
    return url.endsWith('/models') ? Response.json({ data: [{ id: 'gpt-5.4' }] }) : Response.json({ error: { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: secret } }, { status: 429 });
  } });
  const result = await req(`/projects/${p.id}/strategies`, 'POST', { mode: 'openai' });
  assert.equal(result.status, 502); assert.equal(result.data.diagnostic.kind, 'billing'); assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(store.get().projects[0].usage.at(-1).amountUsd, 0);
  assert.equal(store.get().projects[0].usage.at(-1).status, 'failed'); assert.equal(calls, 1);
  const check = await req('/settings/credential/check', 'POST'); assert.equal(check.status, 200);
  const settings = (await req('/settings')).data; assert.ok(settings.verification); assert.equal(settings.apiDiagnostic.code, 'credit_balance_exhausted');
  assert.ok(!JSON.stringify(settings).includes(secret));
});
test('AI copy preserves a ready historical asset, regenerates scenes and respects strategy snapshot', async t => {
  let payload; const { req, p, store } = await fixture(t, { apiKey: secret, fetcher: async (_, init) => { const body = JSON.parse(init.body); assert.equal(body.model, 'gpt-5.4-mini'); payload = JSON.parse(body.input); return output({ title: '新文案', body: '新正文', prompt: '新要求', scenes: ['开场', '演示', '结束'] }); } });
  await req(`/projects/${p.id}/strategies/${p.strategies[0].id}/confirm`, 'POST'); const a = store.get().projects[0].assets[0];
  store.mutate(state => { const project = state.projects[0]; project.brief.facts = '后来改了资料'; project.assets[0].status = 'ready'; project.assets[0].mediaData = 'old-media'; });
  const result = await req(`/projects/${p.id}/assets/${a.id}/copy`, 'POST', { expectedRevision: a.revision }); assert.equal(result.status, 200); assert.equal(result.data.result.status, 'queued'); assert.equal(result.data.result.history[0].mediaData, 'old-media'); assert.equal(result.data.result.copyModel, 'gpt-5.4-mini'); assert.notEqual(payload.brief.facts, '后来改了资料');
  assert.deepEqual(result.data.result.scenes, ['开场', '演示', '结束']);
});
test('AI classification protects corrected comments; analysis validates evidence and usage', async t => {
  let invalid = false;
  const { req, p, store } = await fixture(t, { apiKey: secret, fetcher: async (_, init) => {
    const body = JSON.parse(init.body), payload = JSON.parse(body.input);
    if (body.text.format.name.endsWith('classification')) { assert.equal(body.model, 'gpt-5.4-nano'); assert.equal(payload.comments.length, 9); return output({ comments: payload.comments.map(c => ({ id: c.id, tags: ['使用疑问'], sentiment: 'neutral' })) }); }
    assert.equal(body.model, 'gpt-5.4-mini'); return output({ insights: [{ category: '使用疑问', title: '需要说明', observation: '有用户询问使用方式', recommendation: '增加操作示范，观察后续反馈', evidenceIds: [invalid ? 'invented' : payload.comments[0].id] }] });
  } });
  await req(`/projects/${p.id}/comments/sample`, 'POST'); const c = store.get().projects[0].comments[0];
  await req(`/projects/${p.id}/comments/${c.id}`, 'PATCH', { tags: ['价格顾虑'], sentiment: 'negative' });
  assert.equal((await req(`/projects/${p.id}/comments/classify`, 'POST')).status, 200);
  assert.deepEqual(store.get().projects[0].comments[0].tags, ['价格顾虑']); assert.equal(store.get().projects[0].comments[1].classificationModel, 'gpt-5.4-nano');
  const analysis = await req(`/projects/${p.id}/analysis`, 'POST', { mode: 'openai' }); assert.equal(analysis.status, 200); assert.equal(analysis.data.result[0].count, 1); assert.equal(analysis.data.result[0].sampleSize, 10);
  invalid = true; const count = store.get().projects[0].insights.length; const rejected = await req(`/projects/${p.id}/analysis`, 'POST', { mode: 'openai' }); assert.equal(rejected.status, 502); assert.equal(store.get().projects[0].insights.length, count); assert.equal(store.get().projects[0].usage.at(-1).amountUsd, 0.000975);
});
