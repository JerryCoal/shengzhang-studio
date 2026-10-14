import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';
import { createQwenTransport, QWEN_BASE } from '../server/qwen.mjs';
import { isQwenUrl, normalizeQwenKey, qwenConnection, QWEN_CONNECTION_OPTIONS } from '../server/qwen-connection.mjs';

const credentialPath = '/settings/providers/qwen/credential';
async function fixture(t, handler) {
  const store = createStore(':memory:'), modelStore = createModelStore(), calls = []; let saved = '';
  const vault = { status: () => ({ supported: true, configured: !!saved, suffix: saved.slice(-4) }), getKey: async () => saved, save: async value => { saved = value; }, remove: () => { saved = ''; } };
  const app = createApp(store, { profileMode: true, qwenVault: vault, modelStore, fetcher: async (url, init) => { calls.push({ url, init }); return handler ? handler(url, init) : Response.json({ data: [{ id: 'qwen-plus' }, { id: 'qwen-flash' }] }); } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const request = async (path, method = 'GET', body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; };
  return { app, store, calls, request, modelStore, saved: () => saved, projectId: store.get().projects[0].id };
}

test('Qwen saves opaque and longer API keys without guessing their prefix or sending a validation request', async t => {
  const f = await fixture(t), keys = ['new-format.fixture_key+test/0123456789==', 'sk-' + 'A'.repeat(800)];
  for (const key of keys) {
    const result = await f.request(credentialPath, 'PUT', { apiKey: `  Bearer "${key}"  ` });
    assert.equal(result.status, 200); assert.equal(f.saved(), key); assert.equal(f.calls.length, 0);
    for (const path of ['/settings', '/state', '/backup']) assert(!JSON.stringify((await f.request(path)).data).includes(key));
    const checked = await f.request(credentialPath + '/check', 'POST'); assert.equal(checked.status, 200);
    assert.equal(f.calls.pop().init.headers.Authorization, 'Bearer ' + key);
  }
});

test('Qwen format errors are specific and never destroy a previously saved key', async t => {
  const f = await fixture(t), key = 'fixture-preserved-only-key-123456';
  await f.request(credentialPath, 'PUT', { apiKey: key });
  for (const value of ['short', 'LTAIexampleaccesskey012345', 'sk-**************', 'https://example.com/my-api', 'valid-key-with\nnewline-123', '密钥123456789012345678901234', 'a'.repeat(4097)]) {
    const result = await f.request(credentialPath, 'PUT', { apiKey: value });
    assert.equal(result.status, 400); assert.equal(f.saved(), key); assert.equal(f.calls.length, 0); assert(!JSON.stringify(result).includes(key));
  }
  assert.match(normalizeQwenKey('sk-test-only-0123456789'), /^sk-/);
});

test('Qwen configured region and optional workspace route both model checks and actual text generation', async t => {
  const f = await fixture(t, (url, init) => url.endsWith('/models') ? Response.json({ data: [{ id: 'qwen-plus' }] }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '测试方向', core: '真实事实', direction: '场景描述', prompt: '保留产品事实' }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  f.modelStore.save({ ...f.modelStore.get(), strategy: 'qwen-plus' });
  for (const option of QWEN_CONNECTION_OPTIONS) {
    const connection = { region: option.id, workspaceId: option.requiresWorkspace ? 'llm-fixture' : '' };
    const saved = await f.request(credentialPath, 'PUT', { apiKey: 'fixture-region-only-0123456789', connection });
    assert.equal(saved.status, 200); assert.equal(saved.data.providers.qwen.connection.region, option.id);
    assert.equal((await f.request(credentialPath + '/check', 'POST')).status, 200);
    assert.equal(f.calls.at(-1).url, qwenConnection(connection).baseUrl + '/models');
    const generated = await f.request(`/projects/${f.projectId}/strategies`, 'POST', { mode: 'openai' });
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    assert.equal(f.calls.at(-1).url, qwenConnection(connection).baseUrl + '/chat/completions');
  }
  const connection = { region: 'cn-beijing', workspaceId: 'llm-my-workspace' };
  assert.equal((await f.request('/settings/providers/qwen/connection', 'PUT', connection)).status, 200);
  await f.request(credentialPath + '/check', 'POST');
  assert.equal(f.calls.at(-1).url, 'https://llm-my-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models');
});

test('Qwen connection rejects arbitrary hosts, URL-shaped workspace IDs and configuration during active jobs', async t => {
  const f = await fixture(t), path = '/settings/providers/qwen/connection';
  for (const input of [{ region: 'attacker.test' }, { region: 'cn-beijing', baseUrl: 'https://example.com' }, { region: 'cn-beijing', workspaceId: 'llm.test' }, { region: 'cn-beijing', workspaceId: 'sk-secret-test-only' }, { region: 'ap-northeast-1', workspaceId: '' }]) {
    assert.equal((await f.request(path, 'PUT', input)).status, 400);
  }
  f.app.locals.activeJobs.add('fixture-active');
  assert.equal((await f.request(path, 'PUT', { region: 'ap-southeast-1' })).status, 409);
  f.app.locals.activeJobs.clear();
  assert.equal(f.calls.length, 0);
  for (const url of ['https://dashscope.aliyuncs.com.attacker.test/compatible-mode/v1/models', 'https://sk-secret@dashscope.aliyuncs.com/compatible-mode/v1/models', 'http://dashscope.aliyuncs.com/compatible-mode/v1/models', 'https://dashscope.aliyuncs.com/compatible-mode/v1/models?key=value']) assert.equal(isQwenUrl(url), false);
});

test('Qwen distinguishes local format, regional authentication, balance and network errors without echoing upstream secrets', async () => {
  const secret = 'fixture-secret-never-return-123456789';
  for (const [status, code, expected] of [[401, 'InvalidApiKey', 'authentication'], [403, 'AccessDenied', 'permission'], [429, 'insufficient_quota', 'quota']]) {
    const transport = createQwenTransport(async () => Response.json({ error: { code, message: secret }, request_id: secret }, { status }), () => ({ region: 'ap-southeast-1', workspaceId: '' }));
    await assert.rejects(transport.fetch(QWEN_BASE + '/models'), error => {
      assert.equal(error.diagnostic.kind, expected); assert.equal(error.diagnostic.region, 'ap-southeast-1'); assert(!JSON.stringify(error.diagnostic).includes(secret));
      if (status === 401) assert.match(error.message, /新加坡.*地域.*Coding Plan/);
      return true;
    });
  }
  const network = createQwenTransport(async () => { throw Error(secret); });
  await assert.rejects(network.fetch(QWEN_BASE + '/models'), error => error.diagnostic.kind === 'network' && !error.message.includes(secret));
});

test('non-Beijing configuration cannot silently send RAG or research embeddings to Beijing', async t => {
  const f = await fixture(t);
  await f.request(credentialPath, 'PUT', { apiKey: 'fixture-nonbeijing-only-12345', connection: { region: 'ap-southeast-1', workspaceId: '' } });
  await f.request(`/projects/${f.projectId}/corpus`, 'POST', { name: '说明', text: '校园学习平台帮助用户寻找学习伙伴。' });
  const status = await f.request(`/projects/${f.projectId}/corpus/rag`);
  assert.equal(status.status, 200); assert.equal(status.data.configured, false); assert.equal(status.data.connectionSupported, false);
  const result = await f.request(`/projects/${f.projectId}/corpus/rag`, 'POST', { consent: true, expectedFingerprint: status.data.plan.fingerprint });
  assert.equal(result.status, 400); assert.match(result.data.error, /北京/); assert.equal(f.calls.length, 0);
  f.modelStore.save(Object.fromEntries(Object.keys(f.modelStore.get()).map(name => [name, 'qwen-plus'])));
  const research = await f.request(`/projects/${f.projectId}/research/run`, 'POST', { keywords: ['校园'], sources: ['rss'], expectedRevision: 0, confirmed: true, useSemantic: true });
  assert.equal(research.status, 400); assert.match(research.data.error, /北京/); assert.equal(f.calls.length, 0);
});
