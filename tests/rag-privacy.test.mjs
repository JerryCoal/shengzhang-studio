import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import express from 'express';
import { createStore } from '../server/store.mjs';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { importCorpus } from '../server/workflow.mjs';
import { buildIndex, indexReady } from '../server/rag.mjs';
import { createWebRelay, allowedWebOperation } from '../server/web-relay.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { DEFAULT_ROUTES } from '../server/models.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const bundled = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { webPayload } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const ragFields = ['ragIndex', 'ragEnabled', 'ragConsent', 'ragUsage', 'ragPreviousCny', 'ragRevision'];
const privateMarker = 'PRIVATE_RAG_FIXTURE_ONLY_20261014';

function localMetadata() {
  return {
    ragIndex: { version: 1, model: 'text-embedding-v4', dimensions: 512, fingerprint: privateMarker, entries: [{ vector: [0.1357913579], hash: privateMarker }] },
    ragEnabled: true,
    ragConsent: { version: 'qwen-rag-2026-10-14', at: '2026-10-14T00:00:00Z', fingerprint: privateMarker },
    ragUsage: [{ id: 'private-rag-usage', operation: 'index', amountCny: 0.001, note: privateMarker }],
    ragPreviousCny: 0.05,
    ragRevision: 3,
  };
}

function workspace() {
  const state = seedState(), project = state.projects[0];
  confirmStrategy(project, project.strategies[0].id);
  importCorpus(project, { name: '测试产品说明', text: '测试产品可以预约学习时段。' });
  Object.assign(project, localMetadata());
  const asset = project.assets[0];
  const other = { ...structuredClone(project), id: 'other-local-project' };
  state.projects.push(other);
  return { state, project, asset };
}

test('RAG vectors and source text survive an encrypted restart; SQLite and WAL contain no plaintext', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-rag-private-'));
  const stores = new Set();
  t.after(() => {
    for (const store of stores) store.close();
    const insideTemp = relative(resolve(tmpdir()), resolve(directory));
    if (!insideTemp || insideTemp.startsWith('..') || isAbsolute(insideTemp)) throw new Error('Unexpected temporary cleanup path');
    rmSync(directory, { recursive: true, force: true });
  });
  const filename = join(directory, 'workspace.sqlite'), key = randomBytes(32), scope = 'fixture-user-alpha';
  const state = seedState(), project = state.projects[0];
  project.corpus = [];
  importCorpus(project, { name: privateMarker + '_document', text: privateMarker + '：预约仅在校内使用。' });
  let requests = 0;
  project.ragIndex = await buildIndex(project, { key: 'fake-test-only-embedding-key', fetcher: async (url, init) => {
    requests++;
    assert.equal(url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
    const request = JSON.parse(init.body);
    return Response.json({ model: 'text-embedding-v4', data: request.input.map((_, index) => ({ index, embedding: Array.from({ length: 512 }, (__, n) => (n + 1) / 512) })), usage: { total_tokens: 31 } });
  } });
  Object.assign(project, { ragEnabled: true, ragConsent: { version: 'qwen-rag-2026-10-14', fingerprint: project.ragIndex.fingerprint }, ragUsage: [{ id: 'usage-private', amountCny: 0.0000155, tokens: 31, status: 'completed' }], ragPreviousCny: 0.02, ragRevision: 1 });
  assert.equal(requests, 1);
  assert(indexReady(project));
  const saved = structuredClone(project);
  const open = options => { const store = createStore(filename, options); stores.add(store); return store; };
  const close = store => { store.close(); stores.delete(store); };
  const writer = open({ key, scope });
  writer.mutate(current => { current.projects = [project]; });
  assert(indexReady(writer.get().projects[0]));
  // Inspect while open as well, because SQLite writes the current transaction to WAL.
  const verifyFiles = () => {
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name));
      for (const forbidden of [privateMarker, 'ragIndex', 'text-embedding-v4', project.ragIndex.fingerprint, JSON.stringify(project.ragIndex.entries[0].vector)]) {
        assert(!bytes.includes(Buffer.from(forbidden)), `${name} exposed persisted RAG data`);
      }
      assert(!bytes.includes(key), `${name} exposed the encryption key`);
    }
  };
  verifyFiles(); close(writer); verifyFiles();
  for (const options of [{ key: randomBytes(32), scope }, { key, scope: 'fixture-user-beta' }]) {
    const wrong = open(options);
    assert.throws(() => wrong.get(), 'a different user key or scope must not decrypt the index');
    assert.throws(() => wrong.mutate(current => { current.projects = []; }), 'failed decryption must not overwrite the data');
    close(wrong);
  }
  const restarted = open({ key, scope });
  assert.deepEqual(restarted.get().projects[0], saved);
  assert(indexReady(restarted.get().projects[0]), 'a restarted index remains valid for the original project');
  assert.equal(requests, 1, 'reopening local storage must not trigger an embedding request');
  close(restarted); verifyFiles();
});

test('all web payload paths remove every local RAG field before early returns without changing source data', () => {
  const { state, project, asset } = workspace(), before = structuredClone(state);
  const base = `/projects/${project.id}`, assetBase = `${base}/assets/${asset.id}`;
  const paths = [
    ['/settings/credential/check'], ['/settings/providers/qwen/credential/check'],
    ['/settings/credential/check', 'missing-project'], ['/settings/credential/check', project.id],
    ['/tick', project.id], [base + '/trends/refresh', project.id], [base + '/strategies', project.id],
    [base + '/analysis', project.id], [base + '/comments/classify', project.id],
    [base + '/corpus/search', project.id], [base + '/corpus/rag', project.id],
    ...['copy', 'cover', 'cover-apply', 'cover-reset', 'keyframes', 'seedance', 'video-status', 'generation-reset'].map(suffix => [assetBase + '/' + suffix, project.id]),
    ...['platform-status', 'platform-item', 'comments-sync'].map(suffix => [base + '/publications/fixture/' + suffix, project.id]),
    ['/an-unknown-future-operation', project.id],
  ];
  for (const [path, projectId] of paths) {
    const payload = webPayload(state, path, {}, projectId), serialized = JSON.stringify(payload);
    for (const field of ragFields) assert(!serialized.includes(`"${field}"`), `${path} leaked ${field}`);
    assert(!serialized.includes(privateMarker), `${path} leaked the local index or ledger`);
    assert(!serialized.includes('other-local-project'));
  }
  const selected = webPayload(state, assetBase + '/copy', {}, project.id).projects[0];
  assert.equal(selected.assets[0].title, asset.title);
  assert.equal(selected.assets[0].revision, asset.revision);
  assert.deepEqual(state, before);
});

test('merging unrelated web results preserves the local-only RAG index, consent and accumulated budget', () => {
  const { state, project } = workspace();
  const base = webPayload(state, `/projects/${project.id}/strategies`, {}, project.id);
  const remote = structuredClone(base);
  remote.projects[0].strategies.push({ id: 'generated-on-relay', title: '新策略' });
  remote.projects[0].revision++;
  const current = structuredClone(state);
  current.projects[0].ragUsage.push({ id: 'new-local-usage', amountCny: 0.002, note: 'local concurrent operation' });
  current.projects[0].ragRevision++;
  const result = mergeRelayState(base, remote, current);
  for (const field of ragFields) assert.deepEqual(result.projects[0][field], current.projects[0][field]);
  assert.equal(result.projects[0].strategies.at(-1).id, 'generated-on-relay');
  assert.deepEqual(result.projects[1], current.projects[1]);
});

async function relayFixture(t) {
  let calls = 0;
  const root = express(), server = root.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher: async () => {
    calls++; return Response.json({ data: [{ id: 'qwen-plus' }, { id: 'qwen-flash' }] });
  } } });
  root.use(app);
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections(); await app.locals.close(); await closed;
  });
  return { calls: () => calls, async request(payload, endpoint = 'execute') {
    const response = await fetch(`${base}/api/web/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  } };
}

test('relay rejects every submitted project RAG field and local RAG routes before any upstream request', async t => {
  const relay = await relayFixture(t), state = seedState();
  const clean = { path: '/settings/providers/qwen/credential/check', method: 'POST', body: {}, state, credentials: { qwen: 'fake-qwen-test-only-key' }, routes: DEFAULT_ROUTES, authorizations: [] };
  for (const field of ragFields) for (const endpoint of ['execute', 'jobs']) {
    const request = structuredClone(clean);
    request.state.projects[0][field] = localMetadata()[field];
    const response = await relay.request(request, endpoint);
    assert.equal(response.status, 400, `${endpoint} accepted local ${field}`);
    assert(!JSON.stringify(response.body).includes(privateMarker), 'validation errors must not echo local index data');
  }
  assert.equal(relay.calls(), 0);
  const path = `/projects/${state.projects[0].id}/corpus/rag`;
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(allowedWebOperation(path, method), false);
  assert.equal((await relay.request({ ...clean, path })).status, 404);
  assert.equal(relay.calls(), 0);
  // Prove that rejections came from local-state validation rather than a broken relay fixture.
  const accepted = await relay.request(clean);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 200);
  assert.equal(relay.calls(), 1);
});
