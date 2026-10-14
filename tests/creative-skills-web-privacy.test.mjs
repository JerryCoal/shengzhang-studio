import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const built = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { webPayload } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const trace = label => ({ at: '2026-10-14T00:00:00.000Z', builtin: [{ id: 'base', version: '1.0.0', instructions: `private-builtin-${label}` }], user: { id: 'skill-local', name: 'Local only', version: '1.0.0', instructions: `private-user-${label}` } });
function fixture() {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  state.installedSkills = [{ id: 'skill-local', sourceText: 'private-installed-rules', instructions: 'private-installed-rules' }]; state.skillsRevision = 7;
  const a = p.assets[0]; a.status = 'ready'; a.mediaData = 'local-media'; a.mime = 'image/png'; a.skillTrace = trace('current');
  a.history = [{ title: 'Old title', body: 'Old body', revision: a.revision - 1, mediaData: 'old-media', mime: 'image/png', at: '2026-10-13T00:00:00.000Z', skillTrace: trace('history') }];
  return { state, p, a, path: `/projects/${p.id}/assets/${a.id}` };
}
function assertPrivateRulesOmitted(payload) {
  assert.equal(Object.hasOwn(payload, 'installedSkills'), false); assert.equal(Object.hasOwn(payload, 'skillsRevision'), false);
  assert.doesNotMatch(JSON.stringify(payload), /skillTrace|private-installed-rules|private-builtin-|private-user-/);
}

test('web payload omits installed rules and all trace snapshots, including early returns', () => {
  const { state, p, a, path } = fixture();
  // Metadata can exist on any workflow object, including nested cover history.
  p.strategies[0].skillTrace = trace('strategy');
  a.aiCover = { skillTrace: trace('cover'), history: [{ skillTrace: trace('cover-history') }] };
  const before = structuredClone(state);
  for (const [endpoint, projectId] of [
    ['/settings/credential/check', undefined], ['/settings/credential/check', 'missing'],
    [`/projects/${p.id}/trends/refresh`, p.id], [`/projects/${p.id}/strategies`, p.id],
    [path + '/copy', p.id], [path + '/cover', p.id], [path + '/keyframes', p.id],
    ['/tick', p.id], [`/projects/${p.id}/comments/classify`, p.id],
  ]) assertPrivateRulesOmitted(webPayload(state, endpoint, {}, projectId));
  assert.deepEqual(state, before, 'network minimization never mutates the local workspace');
  const projected = webPayload(state, path + '/cover', {}, p.id).projects[0].assets[0];
  assert.equal(projected.title, a.title); assert.equal(projected.revision, a.revision);
  assert.equal(projected.mediaData, a.mediaData); assert.equal(projected.history[0].body, a.history[0].body);
});

test('web copy blocks a selected custom Skill, while built-in copy and review-only remain available', () => {
  const { state, p, path } = fixture();
  assert.throws(() => webPayload(state, path + '/copy', { skillId: 'skill-local' }, p.id), /网页版尚未启用自装 Skills 联网生成/);
  assertPrivateRulesOmitted(webPayload(state, path + '/copy', { skillId: '' }, p.id));
  assertPrivateRulesOmitted(webPayload(state, path + '/copy', { skillId: 'skill-local', reviewOnly: true }, p.id));
});

test('unrelated web changes preserve local asset and history traces without merging the catalog', () => {
  const { state, p, a, path } = fixture(), before = structuredClone(state);
  const base = webPayload(state, path + '/cover', {}, p.id), remote = structuredClone(base);
  remote.projects[0].assets[0].error = 'remote operation result';
  remote.installedSkills = [{ id: 'not-local' }]; remote.skillsRevision = 999;
  const result = mergeRelayState(base, remote, state).projects[0].assets[0];
  assert.equal(result.error, 'remote operation result');
  assert.deepEqual(result.skillTrace, a.skillTrace); assert.deepEqual(result.history, a.history);
  const merged = mergeRelayState(base, remote, state);
  assert.deepEqual(merged.installedSkills, state.installedSkills); assert.equal(merged.skillsRevision, 7);
  assert.deepEqual(state, before);
  assertPrivateRulesOmitted(base);
});

test('new web copy history regains the previous local trace and keeps the newly returned trace', () => {
  const { state, p, a, path } = fixture();
  const base = webPayload(state, path + '/copy', {}, p.id), remote = structuredClone(base), changed = remote.projects[0].assets[0];
  changed.history.unshift({ title: a.title, body: a.body, revision: a.revision, mediaData: a.mediaData, mime: a.mime, at: '2026-10-14T01:00:00.000Z' });
  changed.title = 'New generated title'; changed.body = 'New generated body'; changed.revision++;
  changed.skillTrace = { at: '2026-10-14T01:00:00.000Z', builtin: [{ id: 'base', version: '1.1.0', instructions: 'New built-in rules' }], user: null };
  const result = mergeRelayState(base, remote, state).projects[0].assets[0];
  assert.equal(result.title, changed.title); assert.deepEqual(result.skillTrace, changed.skillTrace);
  assert.deepEqual(result.history[0].skillTrace, a.skillTrace);
  assert.deepEqual(result.history[1].skillTrace, a.history[0].skillTrace);
  assert.equal(remote.projects[0].assets[0].history[0].skillTrace, undefined, 'restoration does not change the network response');
});

test('local trace restoration cannot erase concurrent asset edit conflicts or match unrelated versions', () => {
  const { state, p, a, path } = fixture();
  const base = webPayload(state, path + '/copy', {}, p.id), remote = structuredClone(base), changed = remote.projects[0].assets[0];
  changed.title = 'Remote title'; changed.revision++;
  const current = structuredClone(state); current.projects[0].assets[0].title = 'Concurrent local title'; current.projects[0].assets[0].revision++;
  assert.throws(() => mergeRelayState(base, remote, current), /冲突/);
  const alteredHistory = structuredClone(base), history = alteredHistory.projects[0].assets[0].history[0];
  history.title = 'Different version despite same revision';
  const merged = mergeRelayState(base, alteredHistory, state);
  // A changed caption at the same revision cannot inherit an unrelated trace.
  assert.equal(merged.projects[0].assets[0].history[0].skillTrace, undefined);
  assert.deepEqual(a.skillTrace, state.projects[0].assets[0].skillTrace);
});
