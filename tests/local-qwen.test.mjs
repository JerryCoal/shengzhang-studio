import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, STAGES } from '../server/models.mjs';
import { localQwenBase, localQwenConnectionSchema, defaultLocalQwen } from '../server/local-qwen-connection.mjs';
import { createLocalQwenTransport, LOCAL_QWEN_BASE, verifyLocalQwen } from '../server/local-qwen.mjs';
import { removeWebSkillHistory } from '../server/web-skill-privacy.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';

const connection = { enabled: true, engine: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' };
const localRoutes = Object.fromEntries(STAGES.map(stage => [stage.id, 'local-qwen']));
const strategy = { title: '真实场景', core: '依据产品资料', direction: '展示实际体验', prompt: '保持产品事实' };
const complete = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
function vault() { let value = ''; return { status: () => ({ supported: true, configured: !!value, suffix: value.slice(-4), problem: '' }), save: async next => { value = next; }, remove: () => { value = ''; }, getKey: async () => value }; }
async function fixture(t, fetcher, extra = {}) {
  const store = createStore(':memory:'), modelStore = createModelStore(), localQwenVault = vault(), qwenVault = vault();
  const app = createApp(store, { modelStore, localQwenVault, qwenVault, fetcher: async () => { throw Error('Unexpected external request'); }, localQwenFetcher: fetcher, ...extra });
  const host = express();
  // Production uses authenticated sessions; this identity injection is test-only.
  host.use((req, _res, next) => { if (extra.teamMode && req.get('X-Test-Role')) req.teamUser = { userId: 'test-user', role: req.get('X-Test-Role') }; next(); });
  host.use(app); const server = host.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, method = 'GET', body, headers = {}) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; };
  return { req, store, modelStore, localQwenVault, qwenVault, path: `/projects/${store.get().projects[0].id}/strategies` };
}

test('local Qwen accepts only explicit loopback origins and rejects alternate spellings, cloud names and unknown fields', () => {
  assert.equal(defaultLocalQwen.enabled, false);
  assert.equal(localQwenBase('http://localhost:11434/v1/'), connection.baseUrl);
  assert.equal(localQwenBase('http://[::1]:8000/v1'), 'http://[::1]:8000/v1');
  for (const baseUrl of ['http://127.0.0.1/v1', 'http://127.0.0.1:80/v1', 'http://127.0.0.1:65536/v1', 'http://127.0.0.2:8000/v1', 'http://2130706433:8000/v1', 'http://0x7f000001:8000/v1', 'http://127.1:8000/v1', 'http://127.0.0.1:08000/v1', 'http://192.168.0.1:8000/v1', 'https://127.0.0.1:8000/v1', 'http://evil.test:8000/v1', 'http://127.0.0.1:8000/v1?x=1', 'http://127.0.0.1:8000/v1#x', 'http://user@127.0.0.1:8000/v1', 'http://127.0.0.1:8000/proxy/v1', 'http://127.0.0.1:8000/a/../v1', 'http://[::ffff:127.0.0.1]:8000/v1']) assert.throws(() => localQwenConnectionSchema.parse({ ...connection, baseUrl }), undefined, baseUrl);
  for (const model of ['', 'qwen3:cloud', 'qwen 3', '../model']) assert.throws(() => localQwenConnectionSchema.parse({ ...connection, model }));
  assert.throws(() => localQwenConnectionSchema.parse({ ...connection, apiKey: 'never-in-state' }));
});

test('local Qwen saves without requests, keys stay separate, and only a manual models check probes the service', async t => {
  const calls = [];
  const f = await fixture(t, async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ id: connection.model }] }); });
  const before = (await f.req('/settings')).data;
  assert.equal(before.providers['local-qwen'].configured, false); assert.deepEqual(before.providers['local-qwen'].localConnection, defaultLocalQwen);
  await f.qwenVault.save('official-qwen-only-key');
  assert.equal((await f.req('/settings/providers/local-qwen/connection', 'PUT', connection)).status, 200);
  const key = 'local-fixture-secret';
  assert.equal((await f.req('/settings/providers/local-qwen/credential', 'PUT', { apiKey: key })).status, 200); assert.equal(calls.length, 0);
  assert.equal((await f.req('/settings/providers/local-qwen/credential/check', 'POST')).status, 200); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${connection.baseUrl}/models`); assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined); assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`); assert.equal(calls[0].init.redirect, 'error');
  for (const path of ['/state', '/settings', '/backup']) assert(!JSON.stringify((await f.req(path)).data).includes(key));
  await f.req('/settings/providers/local-qwen/credential', 'DELETE'); assert.equal(await f.qwenVault.getKey(), 'official-qwen-only-key'); assert.equal((await f.req('/settings')).data.providers['local-qwen'].configured, true, 'keyless local service remains usable');
});

test('local Qwen generation uses the configured actual model without cloud fallback or a mandatory API key', async t => {
  const calls = [];
  const f = await fixture(t, async (url, init) => { calls.push({ url, init }); return complete(strategy); });
  f.modelStore.save(localRoutes);
  assert.equal((await f.req(f.path, 'POST', { mode: 'openai' })).status, 400); assert.equal(calls.length, 0);
  await f.req('/settings/providers/local-qwen/connection', 'PUT', connection);
  const result = await f.req(f.path, 'POST', { mode: 'openai' }); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.result.source, 'local-qwen');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, `${connection.baseUrl}/chat/completions`); assert.equal(calls[0].init.headers.Authorization, undefined); assert.equal(body.model, connection.model); assert.equal(body.stream, false); assert.equal(body.response_format.type, 'json_object'); assert(body.max_tokens > 0);
  assert.equal(f.store.get().projects[0].usage.at(-1).amountUsd, 0);
});

test('local Qwen rejects empty/missing models, redirects, provider errors and malformed output without leaking secrets', async t => {
  let output = () => Response.json({ data: [] });
  const f = await fixture(t, async () => output()); await f.req('/settings/providers/local-qwen/connection', 'PUT', connection);
  const path = '/settings/providers/local-qwen/credential/check';
  assert.equal((await f.req(path, 'POST')).status, 502);
  output = () => Response.json({ data: [{ id: 'different-model' }] }); assert.equal((await f.req(path, 'POST')).status, 400);
  for (const status of [302, 401, 403, 404, 429, 500]) { output = () => new Response('secret-test-message', { status, headers: { location: 'https://must-not-follow.test' } }); const result = await f.req(path, 'POST'); assert.equal(result.status, 502); assert(!JSON.stringify(result).includes('secret-test-message')); }
  output = () => { throw Error('secret-test-message'); }; assert(!JSON.stringify(await f.req(path, 'POST')).includes('secret-test-message'));
  f.modelStore.save(localRoutes); const count = f.store.get().projects[0].strategies.length;
  output = () => complete({ wrong: true }); assert.equal((await f.req(f.path, 'POST', { mode: 'openai' })).status, 502); assert.equal(f.store.get().projects[0].strategies.length, count);
});

test('local Qwen connection settings are administrator-only on team host; members can use host-local generation', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return complete(strategy); }, { teamMode: true, profileMode: true, authorizeCredentials: req => !!req.teamUser });
  const path = '/settings/providers/local-qwen/connection';
  assert.equal((await f.req(path, 'PUT', connection, { 'X-Test-Role': 'editor' })).status, 403);
  assert.equal((await f.req(path, 'PUT', connection, { 'X-Test-Role': 'admin' })).status, 200); assert.equal(calls, 0);
  assert.equal((await f.req('/settings/providers/local-qwen/credential/check', 'POST', undefined, { 'X-Test-Role': 'editor' })).status, 403);
  f.modelStore.save(localRoutes);
  assert.equal((await f.req(f.path, 'POST', { mode: 'openai' }, { 'X-Test-Role': 'editor' })).status, 200); assert.equal(calls, 1);
});

test('local Qwen cannot be enabled by relay-style authorization and is removed from shared snapshots', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return complete(strategy); }, { allowLocalModels: false, authorizeCredentials: () => true });
  f.store.mutate(state => { state.localQwenConnection = connection; }); f.modelStore.save(localRoutes);
  const settings = (await f.req('/settings')).data.providers['local-qwen']; assert.equal(settings.configured, false); assert.equal(settings.credential.local, false); assert.deepEqual(settings.localConnection, defaultLocalQwen);
  assert.equal((await f.req('/settings/providers/local-qwen/connection', 'PUT', connection)).status, 403);
  assert.equal((await f.req(f.path, 'POST', { mode: 'openai' })).status, 403); assert.equal(calls, 0);
  const state = f.store.get(), scrubbed = structuredClone(state); removeWebSkillHistory(scrubbed); assert.equal(scrubbed.localQwenConnection, undefined);
  const remote = structuredClone(scrubbed); remote.localQwenConnection = { ...connection, model: 'evil' }; assert.deepEqual(mergeRelayState(scrubbed, remote, state).localQwenConnection, connection);
});

test('native loopback transport handles empty-status responses, refuses redirects, and bounds output without crashing', async t => {
  let status = 204, calls = 0, huge = false;
  const server = createServer((_req, res) => { calls++; res.writeHead(status, { 'content-type': 'application/json', location: 'http://192.168.0.1:8000/v1/models' }); res.end(huge ? 'x'.repeat(2_000_001) : status === 200 ? JSON.stringify({ data: [{ id: connection.model }] }) : ''); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.close(); server.closeAllConnections(); });
  const config = { ...connection, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  const transport = createLocalQwenTransport(() => { throw Error('Unexpected fallback'); }, () => config);
  for (status of [204, 205, 304, 302]) await assert.rejects(verifyLocalQwen('', config, transport.fetch), error => error.status === 502);
  assert.equal(calls, 4, 'redirect was never followed');
  status = 200; assert.equal((await verifyLocalQwen('', config, transport.fetch)).models[0].available, true);
  huge = true; await assert.rejects(verifyLocalQwen('', config, transport.fetch), error => error.status === 502);
  await assert.rejects(transport.fetch(`${LOCAL_QWEN_BASE}/pull`, { method: 'POST' }), /不支持/); assert.equal(calls, 6);
  const blocked = createLocalQwenTransport(() => {}, () => config, { allowed: false }); await assert.rejects(blocked.fetch(`${LOCAL_QWEN_BASE}/models`, { method: 'GET' }), error => error.status === 403);
});
