import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { indexedDB } from 'fake-indexeddb';
import express from 'express';
import { once } from 'node:events';
import { createWebRelay } from '../server/web-relay.mjs';
import { GLM_BASE } from '../server/glm.mjs';
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
globalThis.indexedDB = indexedDB;
globalThis.window = Object.assign(new EventTarget(), { indexedDB, isSecureContext: true });
Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, _options, work) => work({ name: 'glm-test' }) } }, configurable: true });
const built = await build({ stdin: { contents: "export { webAPI } from './src/web-api.ts'; export * from './src/local-vault.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const client = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodeFetch = globalThis.fetch;

test('web GLM stays encrypted per user, relays only its own key, and records generated usage without exposing reasoning', async t => {
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`; globalThis.location = new URL(base);
  const envelopes = [], upstream = [], key = 'glm-browser-fixture-id.secret-1234567890';
  const relay = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher: async (url, init) => {
    assert.equal(url, `${GLM_BASE}/chat/completions`); assert.equal(init.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(init.body); upstream.push(body);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: body.model === 'glm-4.7-flash' ? 'OK' : JSON.stringify({ title: 'GLM 网页策略', core: '真实产品', direction: '展示使用', prompt: '坚持事实' }), reasoning_content: 'browser-private-reasoning' } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  } } }); root.use(relay);
  globalThis.fetch = async (url, init) => { assert.equal(url, '/api/web/execute'); envelopes.push(JSON.parse(init.body)); return nodeFetch(base + url, init); };
  t.after(async () => { globalThis.fetch = nodeFetch; client.lockLocalWorkspace(); const stopped = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await relay.locals.close(); await stopped; });
  await client.registerLocal('glm-local-a', 'glm-browser-password-a');
  assert.equal((await client.webAPI('/integrations')).imageProvider, 'seedream');
  await client.webAPI('/settings/credential', 'PUT', { apiKey: 'sk-openai-unrelated-fixture-1234567890' });
  await client.webAPI('/settings/providers/glm/credential', 'PUT', { apiKey: key }); assert.equal(envelopes.length, 0);
  await client.webAPI('/settings/providers/glm/credential/check', 'POST');
  assert.deepEqual(Object.keys(envelopes[0].credentials), ['glm']); assert.equal(upstream[0].model, 'glm-4.7-flash');
  let settings = await client.webAPI('/settings'); assert.equal(settings.providers.glm.verification.probe, 'free-generation');
  await client.webAPI('/settings/models', 'PUT', { ...settings.routes, strategy: 'glm-5.3' });
  let state = await client.webAPI('/state'); const project = state.projects[0];
  await client.webAPI(`/projects/${project.id}/strategies`, 'POST', { mode: 'openai' });
  state = await client.webAPI('/state'); assert.equal(state.projects[0].strategies.at(-1).source, 'glm'); assert(state.projects[0].usage.at(-1).amountUsd > 0);
  assert.deepEqual(Object.keys(envelopes.at(-1).credentials), ['glm']); assert.equal(upstream.at(-1).thinking.type, 'enabled');
  for (const path of ['/settings', '/state', '/backup']) { const value = JSON.stringify(await client.webAPI(path)); assert(!value.includes(key)); assert(!value.includes('browser-private-reasoning')); }
  client.lockLocalWorkspace(); await client.loginLocal('glm-local-a', 'glm-browser-password-a'); settings = await client.webAPI('/settings'); assert.equal(settings.providers.glm.configured, true); assert.equal(settings.routes.strategy, 'glm-5.3');
  await client.registerLocal('glm-local-b', 'glm-browser-password-b'); assert.equal((await client.webAPI('/settings')).providers.glm.configured, false);
  const calls = upstream.length; await assert.rejects(client.webAPI('/settings/providers/glm/credential/check', 'POST'), /GLM/); assert.equal(upstream.length, calls);
});
