import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { indexedDB } from 'fake-indexeddb';
import express from 'express';
import { seedState } from '../server/domain.mjs';
import { appearanceOf, saveAppearance } from '../server/appearance.mjs';
import { normalizeWorkflow } from '../server/workflow.mjs';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { createWebRelay, allowedWebOperation } from '../server/web-relay.mjs';
import { DEFAULT_ROUTES } from '../server/models.mjs';

const defaults = { fontScale: 1, emphasize: false };
const enlarged = { fontScale: 1.375, emphasize: true };
const invalid = [null, {}, { fontScale: 1 }, { emphasize: true }, { fontScale: '1.25', emphasize: true }, { fontScale: 2, emphasize: false }, { fontScale: 1, emphasize: 'false' }, { ...defaults, mode: 'openai' }];
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
globalThis.indexedDB = indexedDB;
globalThis.window = Object.assign(new EventTarget(), { indexedDB, isSecureContext: true });
const bundled = await build({ stdin: { contents: "export { localAPI } from './src/local-api.ts'; export { webAPI } from './src/web-api.ts'; export { webPayload } from './src/web-payload.ts'; export * from './src/local-vault.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const client = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('older workspaces receive safe display defaults while unrelated data remains intact', () => {
  const state = seedState(); state.legacyExtension = { unknown: 'keep this old data' };
  const original = structuredClone(state);
  assert.deepEqual(appearanceOf(state), defaults);
  normalizeWorkflow(state);
  assert.deepEqual(state.appearance, defaults);
  assert.deepEqual(state.legacyExtension, original.legacyExtension);
  state.appearance = { fontScale: 900, emphasize: 'true' };
  assert.deepEqual(normalizeWorkflow(state).appearance, defaults);
  const before = structuredClone(state);
  for (const input of invalid) {
    assert.throws(() => saveAppearance(state, input));
    assert.deepEqual(state, before);
  }
  for (const fontScale of [1, 1.125, 1.25, 1.375]) assert.deepEqual(saveAppearance(state, { fontScale, emphasize: true }), { fontScale, emphasize: true });
  const { appearance, ...rest } = state, { appearance: previous, ...expected } = before;
  assert.deepEqual(rest, expected);
});

test('desktop appearance API stays editable during AI work and never changes projects or model inputs', async t => {
  let enter, finish, sent;
  const entered = new Promise(resolve => { enter = resolve; }), completed = new Promise(resolve => { finish = resolve; });
  const store = createStore(':memory:');
  const server = createApp(store, { apiKey: 'fixture-only', fetcher: async (_url, init) => {
    sent = JSON.parse(init.body); enter(); await completed;
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: '测试策略', core: '测试核心', direction: '测试方向', prompt: '真实资料' }) }] }], usage: { input_tokens: 100, output_tokens: 80 } });
  } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { finish(); const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await closed; store.close(); });
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  assert.deepEqual((await request('/appearance')).data, defaults);
  store.mutate(state => { state.projects.push({ ...structuredClone(state.projects[0]), id: 'unrelated-project' }); state.legacyExtension = { fixture: 'keep' }; });
  let before = store.get();
  for (const input of invalid) { assert.equal((await request('/appearance', 'PUT', input)).status, 400); assert.deepEqual(store.get(), before); }
  assert.equal((await request('/appearance', 'PUT', enlarged)).status, 200);
  assert.deepEqual(store.get().projects, before.projects);
  const pending = request(`/projects/${before.projects[0].id}/strategies`, 'POST', { mode: 'openai' });
  await entered;
  before = store.get();
  const changed = await request('/appearance', 'PUT', { fontScale: 1.125, emphasize: false });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.data.state.projects, before.projects);
  assert.deepEqual(changed.data.state.legacyExtension, before.legacyExtension);
  assert.deepEqual(changed.data.state.activities, before.activities);
  assert.doesNotMatch(JSON.stringify(sent), /appearance|fontScale|emphasize/);
  finish(); assert.equal((await pending).status, 200);
  assert.deepEqual((await request('/appearance')).data, { fontScale: 1.125, emphasize: false });
  assert.deepEqual(store.get().projects[1], before.projects[1]);
});

test('browser preferences are per-user, encrypted, persistent, and available with a pending paid request', async t => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Appearance must remain local'); };
  t.after(() => { globalThis.fetch = originalFetch; client.lockLocalWorkspace(); });
  await client.registerLocal('外观测试甲', 'appearance-test-password-a');
  assert.deepEqual(await client.localAPI('/appearance', 'GET'), defaults);
  const before = await client.readLocalState();
  await client.webAPI('/appearance', 'PUT', enlarged);
  assert.deepEqual((await client.readLocalState()).projects, before.projects);
  assert.deepEqual((await client.webAPI('/backup')).appearance, enlarged);
  await client.changeLocalState(state => { state.webPrivate = { credentials: {}, pending: { id: 'pending-fixture', path: '/fixture', at: '2026-10-14T00:00:00Z' } }; });
  const pending = (await client.readLocalState()).webPrivate.pending;
  const changed = await client.webAPI('/appearance', 'PUT', { fontScale: 1.25, emphasize: true });
  assert.deepEqual(changed.result, { fontScale: 1.25, emphasize: true });
  assert.equal(changed.state.webPrivate, undefined);
  assert.deepEqual((await client.readLocalState()).webPrivate.pending, pending);
  for (const input of invalid) await assert.rejects(client.webAPI('/appearance', 'PUT', input));
  assert.equal(calls, 0);
  const saved = await new Promise((resolve, reject) => {
    const request = indexedDB.open('shengzhang-local-users-v1', 2);
    request.onsuccess = () => { const db = request.result, read = db.transaction('users').objectStore('users').get('外观测试甲'); read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error); };
    request.onerror = () => reject(request.error);
  });
  assert.doesNotMatch(new TextDecoder().decode(saved.ciphertext), /fontScale|emphasize/);
  client.lockLocalWorkspace(); await client.registerLocal('外观测试乙', 'appearance-test-password-b');
  assert.deepEqual(await client.webAPI('/appearance'), defaults);
  await client.localAPI('/appearance', 'PUT', { fontScale: 1.125, emphasize: false });
  client.lockLocalWorkspace(); await client.loginLocal('外观测试甲', 'appearance-test-password-a');
  assert.deepEqual(await client.webAPI('/appearance'), { fontScale: 1.25, emphasize: true });
  client.lockLocalWorkspace(); await client.loginLocal('外观测试乙', 'appearance-test-password-b');
  assert.deepEqual(await client.webAPI('/appearance'), { fontScale: 1.125, emphasize: false });
});

test('all relay payload branches omit appearance and merging AI results preserves a newer local choice', () => {
  const state = seedState(); state.appearance = enlarged;
  const before = structuredClone(state), id = state.projects[0].id;
  for (const [path, projectId] of [
    ['/settings/credential/check', undefined], ['/settings/credential/check', 'missing'],
    [`/projects/${id}/trends/refresh`, id], [`/projects/${id}/strategies`, id],
    [`/projects/${id}/analysis`, id], ['/tick', id],
  ]) {
    const base = client.webPayload(state, path, {}, projectId);
    assert.equal(Object.hasOwn(base, 'appearance'), false);
    assert.doesNotMatch(JSON.stringify(base), /fontScale|emphasize/);
    const current = structuredClone(state); current.appearance = defaults;
    const remote = structuredClone(base); remote.appearance = enlarged;
    assert.deepEqual(mergeRelayState(base, remote, current).appearance, defaults);
  }
  assert.deepEqual(state, before);
});

test('the relay rejects local appearance data and never exposes its preference routes', async t => {
  let calls = 0;
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const relay = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher: async () => { calls++; throw new Error('Should not reach provider'); } } });
  root.use(relay);
  t.after(async () => { const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await relay.locals.close(); await closed; });
  const state = seedState(); state.appearance = enlarged;
  const response = await fetch(base + '/api/web/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ path: '/settings/credential/check', method: 'POST', state, credentials: {}, routes: DEFAULT_ROUTES, authorizations: [] }) });
  assert.equal(response.status, 400); assert.equal(calls, 0);
  for (const method of ['GET', 'PUT', 'POST']) assert.equal(allowedWebOperation('/appearance', method), false);
});
