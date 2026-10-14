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
import { createWebRelay, allowedWebOperation } from '../server/web-relay.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { DEFAULT_ROUTES } from '../server/models.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const bundled = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { webPayload } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const marker = 'PRIVATE_RESEARCH_FIXTURE_ONLY_20261014';
const localFields = ['research', 'researchUsage', 'researchPreviousCny'];
const evidence = () => [{ analysisId: 'fixture-round-a1', title: marker, evidence: [{ referenceId: 'ref-fixture', quote: marker, url: 'https://news.example.net/fixture' }] }];
function workspace() {
  const state = seedState(), project = state.projects[0];
  confirmStrategy(project, project.strategies[0].id);
  Object.assign(project, {
    research: { revision: 2, queries: [marker], references: [{ id: 'ref-fixture', title: marker, text: marker }], analyses: evidence(), selectedIds: ['fixture-round-a1'], reports: [], ragIndex: { fingerprint: marker, entries: [{ vector: [0.012349876], hash: marker }] } },
    researchUsage: [{ operation: 'web', amountCny: .02, note: marker }], researchPreviousCny: .04,
  });
  const asset = project.assets[0];
  asset.status = 'ready'; asset.researchReferences = evidence();
  asset.history = [{ revision: asset.revision - 1, title: '之前的标题', body: '之前的正文', at: '2026-10-13T00:00:00Z', researchReferences: evidence() }];
  project.strategies[0].researchReferences = evidence();
  state.researchSettings = { reservationCny: .02, fixtureOnly: marker };
  state.projects.push({ ...structuredClone(project), id: 'other-private-project' });
  return { state, project, asset };
}

test('external research, separate vectors and ledger remain encrypted across restart and inaccessible to another user', t => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-research-private-')), filename = join(directory, 'research.sqlite');
  const key = randomBytes(32), scope = 'fixture-research-user', opened = new Set();
  const open = options => { const store = createStore(filename, options); opened.add(store); return store; };
  const close = store => { store.close(); opened.delete(store); };
  t.after(() => {
    for (const store of opened) store.close();
    const target = relative(resolve(tmpdir()), resolve(directory));
    if (!target || target.startsWith('..') || isAbsolute(target)) throw new Error('Unexpected cleanup directory');
    rmSync(directory, { recursive: true, force: true });
  });
  const { state } = workspace(), writer = open({ key, scope });
  writer.mutate(current => Object.assign(current, state));
  const expected = structuredClone(writer.get());
  const verifyFiles = () => {
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name));
      for (const value of [marker, 'researchUsage', 'fixture-round-a1', '[0.012349876]']) assert(!bytes.includes(Buffer.from(value)), `${name} contained unencrypted research`);
      assert(!bytes.includes(key), `${name} contained the user key`);
    }
  };
  verifyFiles(); close(writer); verifyFiles();
  for (const options of [{ key: randomBytes(32), scope }, { key, scope: 'another-fixture-user' }]) {
    const wrong = open(options); assert.throws(() => wrong.get()); assert.throws(() => wrong.mutate(current => { current.projects = []; })); close(wrong);
  }
  const reader = open({ key, scope }); assert.deepEqual(reader.get(), expected); close(reader); verifyFiles();
});

test('every web payload path strips research before early returns, including nested generation and history references', () => {
  const { state, project, asset } = workspace(), before = structuredClone(state);
  const base = `/projects/${project.id}`, assetBase = `${base}/assets/${asset.id}`;
  const cases = [
    ['/settings/credential/check'], ['/settings/providers/qwen/credential/check', 'missing-project'], ['/settings/credential/check', project.id],
    ['/tick', project.id], [base + '/trends/refresh', project.id], [base + '/strategies', project.id], [base + '/analysis', project.id], [base + '/comments/classify', project.id],
    [base + '/research/run', project.id], [base + '/corpus/search', project.id], ['/unknown-future-path', project.id],
    ...['copy', 'cover', 'cover-apply', 'cover-reset', 'keyframes', 'seedance', 'video-status', 'generation-reset'].map(suffix => [assetBase + '/' + suffix, project.id]),
    ...['platform-status', 'platform-item', 'comments-sync'].map(suffix => [base + '/publications/fixture/' + suffix, project.id]),
  ];
  for (const [path, projectId] of cases) {
    const payload = webPayload(state, path, {}, projectId), serialized = JSON.stringify(payload);
    for (const field of [...localFields, 'researchSettings', 'researchReferences']) assert(!serialized.includes(`"${field}"`), `${path} sent ${field}`);
    assert(!serialized.includes(marker)); assert(!serialized.includes('other-private-project'));
  }
  assert.deepEqual(state, before);
});

test('web merges retain the local library, budgets and old reference snapshots while accepting new copy history', () => {
  const { state, project, asset } = workspace(), path = `/projects/${project.id}/assets/${asset.id}/copy`;
  const base = webPayload(state, path, {}, project.id), remote = structuredClone(base), current = structuredClone(state);
  const changed = remote.projects[0].assets[0];
  changed.history.unshift({ title: changed.title, body: changed.body, revision: changed.revision, at: '2026-10-14T00:00:00Z' });
  changed.title = '网页新文案'; changed.body = '根据本次输入生成的正文。'; changed.revision++; changed.researchReferences = [];
  current.projects[0].researchUsage.push({ operation: 'query', amountCny: .001, note: marker });
  const merged = mergeRelayState(base, remote, current);
  for (const field of localFields) assert.deepEqual(merged.projects[0][field], current.projects[0][field]);
  assert.deepEqual(merged.researchSettings, current.researchSettings);
  const saved = merged.projects[0].assets[0];
  assert.equal(saved.title, changed.title); assert.deepEqual(saved.researchReferences, []);
  assert.deepEqual(saved.history[0].researchReferences, asset.researchReferences);
  assert.deepEqual(saved.history[1].researchReferences, asset.history[0].researchReferences);
  assert.deepEqual(merged.projects[0].strategies[0].researchReferences, project.strategies[0].researchReferences);
  assert.deepEqual(merged.projects[1], current.projects[1]);
  current.projects[0].assets[0].history[0].body = '用户同时修改的旧文案';
  assert.throws(() => mergeRelayState(base, remote, current), /冲突/, 'snapshot restoration must not bypass actual local edits');
});

test('relay rejects submitted local research fields and all research endpoints without upstream calls', async t => {
  let calls = 0;
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher: async () => { calls++; return Response.json({ data: [{ id: 'qwen-plus' }] }); } } });
  root.use(app);
  t.after(async () => { const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await app.locals.close(); await closed; });
  const request = async (value, endpoint = 'execute') => {
    const response = await fetch(`${base}/api/web/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  const state = seedState(); confirmStrategy(state.projects[0], state.projects[0].strategies[0].id);
  const clean = { path: '/settings/providers/qwen/credential/check', method: 'POST', body: {}, state, credentials: { qwen: 'fixture-qwen-only-key' }, routes: DEFAULT_ROUTES, authorizations: [] };
  const injectors = [
    ...localFields.map(field => value => { value.state.projects[0][field] = workspace().project[field]; }),
    value => { value.state.researchSettings = { reservationCny: .02, marker }; },
    value => { value.state.projects[0].assets[0].researchReferences = evidence(); },
    value => { value.state.projects[0].assets[0].history = [{ researchReferences: evidence() }]; },
    value => { value.state.projects[0].strategies[0].researchReferences = evidence(); },
  ];
  for (const inject of injectors) for (const endpoint of ['execute', 'jobs']) {
    const value = structuredClone(clean); inject(value);
    const result = await request(value, endpoint); assert.equal(result.status, 400); assert(!JSON.stringify(result.body).includes(marker));
  }
  assert.equal(calls, 0);
  const pid = state.projects[0].id;
  for (const path of ['/research/settings', ...['run', 'status', 'select'].map(operation => `/projects/${pid}/research/${operation}`)]) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(allowedWebOperation(path, method), false);
    assert.equal((await request({ ...clean, path })).status, 404);
  }
  assert.equal(calls, 0);
  const accepted = await request(clean); assert.equal(accepted.status, 200); assert.equal(accepted.body.status, 200); assert.equal(calls, 1);
});
