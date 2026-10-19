import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import express from 'express';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { webSkillWorkflowId } from '../server/web-skill-routing.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';
import { createWebRelay } from '../server/web-relay.mjs';
import { DEFAULT_ROUTES } from '../server/models.mjs';
import { hasWebSkillHistory, removeWebSkillHistory } from '../server/web-skill-privacy.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const built = await build({ stdin: { contents: "export { webPayload } from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { webPayload } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function fixture() {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  const a = p.assets[0], path = `/projects/${p.id}/assets/${a.id}`;
  state.installedSkills = [{ id: 'private-id', instructions: 'PRIVATE_CATALOG', sourceText: 'PRIVATE_CATALOG' }];
  state.skillSelections = { analysis: 'private-id', 'copy-instagram': 'private-id' }; state.skillsRevision = 9;
  state.briefImports = [{ input: { text: 'PRIVATE_BRIEF_IMPORT' }, baseline: { facts: 'PRIVATE_BRIEF_BASELINE' }, usage: { note: 'PRIVATE_BRIEF_BILLING' } }];
  const recipe = { prompt: 'PRIVATE_MEDIA_RECIPE', creativeSkill: { instructions: 'PRIVATE_RULE' }, userSkillVersions: [{ id: 'private-id' }], skillTrace: { user: { instructions: 'PRIVATE_TRACE' } } };
  a.aiCover = { id: 'cover-private', assetRevision: a.revision, input: { prompt: '用户要求' }, ...structuredClone(recipe), promptVersion: 'v1', skillVersions: [] };
  a.aiProduction = { id: 'production-private', assetRevision: a.revision, phase: 'frames', recipe: structuredClone(recipe), frames: [{ id: 'frame-private', role: 'first_frame', prompt: '用户首帧要求', model: 'model', mediaData: 'image-data', recipe: structuredClone(recipe) }] };
  p.usage.push({ id: 'existing-usage', stage: 'cover', model: 'model', at: '2026-10-16T00:00:00Z', amountUsd: 1, skillTrace: { user: { instructions: 'PRIVATE_USAGE_TRACE' } }, userSkillVersions: [{ id: 'private-id' }] });
  return { state, p, a, path };
}

test('edited defaults block only their web AI step and snapshots never leave or overwrite the local workspace', () => {
  const { state, p, path } = fixture();
  state.builtinSkillOverrides = { strategy: { 'marketing-strategy': { instructions: 'PRIVATE_DEFAULT_RULE', baseVersion: '1', revision: 1, updatedAt: new Date().toISOString() } } };
  p.assets[0].history = [{ builtinSkills: [{ instructions: 'PRIVATE_FROZEN_DEFAULT' }] }];
  assert.throws(() => webPayload(state, `/projects/${p.id}/strategies`, { mode: 'openai' }, p.id), /修改后的默认 Skills/);
  const base = webPayload(state, path + '/cover', {}, p.id);
  assert(!JSON.stringify(base).includes('PRIVATE_')); assert.equal(base.builtinSkillOverrides, undefined);
  const remote = structuredClone(base); remote.builtinSkillOverrides = { strategy: { injected: true } };
  assert.deepEqual(mergeRelayState(base, remote, state).builtinSkillOverrides, state.builtinSkillOverrides);
  assert.doesNotThrow(() => webPayload(state, `/projects/${p.id}/strategies`, { mode: 'demo' }, p.id));
});

test('web operations remove selections, brief imports and old flattened or nested media recipes without parsing an unused catalog', () => {
  const { state, p, a, path } = fixture(), before = structuredClone(state);
  for (const endpoint of ['/settings/credential/check', `/projects/${p.id}/trends/refresh`, `/projects/${p.id}/strategies`, path + '/copy', path + '/cover', path + '/keyframes', path + '/seedance', path + '/video-status', '/tick']) {
    const payload = webPayload(state, endpoint, {}, p.id);
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_|skillSelections|briefImports|creativeSkill|userSkillVersions|skillTrace|"recipe"/);
    assert.equal(payload.skillsRevision, undefined); assert.equal(payload.installedSkills, undefined);
  }
  const projected = webPayload(state, path + '/video-status', {}, p.id).projects[0].assets[0];
  assert.equal(projected.aiProduction.frames[0].prompt, a.aiProduction.frames[0].prompt, 'ordinary user frame directions remain usable');
  assert.equal(projected.aiCover.input.prompt, '用户要求');
  assert.deepEqual(state, before);
});

test('a selected custom rule stops the matching web AI request explicitly; unrelated and non-AI operations remain available', () => {
  const { state, p, a, path } = fixture();
  const cases = [
    [`/projects/${p.id}/strategies`, { mode: 'openai' }, 'strategy'],
    [`/projects/${p.id}/strategies`, { mode: 'openai', stage: 'planning' }, 'planning'],
    [`/projects/${p.id}/comments/classify`, {}, 'classification'],
    [`/projects/${p.id}/analysis`, { mode: 'openai' }, 'analysis'],
    [path + '/copy', {}, `copy-${a.channel}`],
    [path + '/copy', { reviewOnly: true }, 'word-review'],
    [path + '/copy', { reviewOnly: true, reviewMode: 'semantic' }, 'price-semantic'],
    [path + '/cover', {}, 'cover'],
    [path + '/keyframes', { role: 'first_frame' }, 'first_frame'],
    [path + '/keyframes', { role: 'last_frame' }, 'last_frame'],
    [path + '/seedance', {}, 'video'],
  ];
  for (const [endpoint, body, workflowId] of cases) {
    state.skillSelections = { [workflowId]: 'private-id' };
    assert.equal(webSkillWorkflowId(state, endpoint, body), workflowId);
    assert.throws(() => webPayload(state, endpoint, body, p.id), /网页版尚未启用自装规则传输/);
    state.skillSelections = { 'research-analysis': 'private-id' };
    assert.doesNotThrow(() => webPayload(state, endpoint, body, p.id));
  }
  state.skillSelections = Object.fromEntries(cases.map(([, , id]) => [id, 'private-id']));
  for (const [endpoint, body] of [['/settings/credential/check', {}], [`/projects/${p.id}/trends/refresh`, {}], [path + '/video-status', {}], ['/tick', {}], [`/projects/${p.id}/strategies`, { mode: 'demo' }], [`/projects/${p.id}/analysis`, { mode: 'demo' }]]) {
    assert.equal(webSkillWorkflowId(state, endpoint, body), null);
    assert.doesNotThrow(() => webPayload(state, endpoint, body, p.id));
  }
});

test('merge restores exact local media and usage snapshots but preserves new generated recipes and all local preferences', () => {
  const { state, p, a, path } = fixture(), before = structuredClone(state);
  const base = webPayload(state, path + '/cover', {}, p.id), remote = structuredClone(base);
  const changed = remote.projects[0].assets[0]; changed.error = '等待核对';
  remote.projects[0].usage[0].amountUsd = 2;
  remote.installedSkills = [{ id: 'remote-injection' }]; remote.skillSelections = { analysis: 'remote-injection' }; remote.skillsRevision = 999; remote.briefImports = ['remote-injection'];
  const merged = mergeRelayState(base, remote, state), result = merged.projects[0].assets[0];
  assert.equal(result.error, '等待核对'); assert.deepEqual(result.aiCover, a.aiCover); assert.deepEqual(result.aiProduction, a.aiProduction);
  assert.equal(merged.projects[0].usage[0].amountUsd, 2); assert.deepEqual(merged.projects[0].usage[0].skillTrace, p.usage[0].skillTrace);
  for (const key of ['installedSkills', 'skillsRevision', 'skillSelections', 'briefImports']) assert.deepEqual(merged[key], state[key]);
  const newRecipe = { prompt: 'NEW_GENERATED_RECIPE', creativeSkill: null };
  changed.aiProduction.recipe = newRecipe;
  changed.aiCover.prompt = 'NEW_COVER_PROMPT'; changed.aiCover.promptVersion = 'v2';
  const newer = mergeRelayState(base, remote, state).projects[0].assets[0];
  assert.deepEqual(newer.aiProduction.recipe, newRecipe); assert.equal(newer.aiCover.prompt, 'NEW_COVER_PROMPT');
  assert.deepEqual(state, before);
});

test('media recipes are not restored onto a different cover job, frame identity or edited reference', () => {
  const { state, p, path } = fixture(), base = webPayload(state, path + '/cover', {}, p.id), remote = structuredClone(base);
  const changed = remote.projects[0].assets[0];
  changed.aiCover.id = 'another-cover'; changed.aiProduction.frames[0].prompt = '不同帧方向';
  const result = mergeRelayState(base, remote, state).projects[0].assets[0];
  assert.equal(result.aiCover.prompt, undefined); assert.equal(result.aiProduction.frames[0].recipe, undefined);
});

test('Redfox assistant results and adopted cover plans are recursively scrubbed from web payloads without mutating local history', () => {
  const { state, p, a, path } = fixture();
  p.xhsAssistant = { results: [{ id: 'result-private', input: { topic: 'PRIVATE_XHS_INPUT' }, result: { title: 'PRIVATE_XHS_RESULT' } }] };
  a.xhsCoverPlan = { id: 'plan-private', resultId: 'result-private', prompt: 'PRIVATE_XHS_COVER_PLAN' };
  a.history = [{ revision: a.revision - 1, xhsAssistant: { nested: 'PRIVATE_XHS_HISTORY' }, xhsCoverPlan: { prompt: 'PRIVATE_XHS_HISTORY_COVER' } }];
  state.activities.unshift({ id: 'nested-private', metadata: [{ xhsAssistant: { result: 'PRIVATE_XHS_ACTIVITY' } }, { xhsCoverPlan: { prompt: 'PRIVATE_XHS_ACTIVITY_COVER' } }] });
  const before = structuredClone(state);
  assert.equal(hasWebSkillHistory({ history: [{ xhsAssistant: {} }] }), true);
  assert.equal(hasWebSkillHistory({ metadata: { rows: [{ xhsCoverPlan: {} }] } }), true);
  const cleaned = structuredClone(state); removeWebSkillHistory(cleaned);
  assert.equal(hasWebSkillHistory(cleaned), false);
  assert.doesNotMatch(JSON.stringify(cleaned), /xhsAssistant|xhsCoverPlan|PRIVATE_XHS/);
  for (const endpoint of ['/settings/credential/check', path + '/cover', path + '/video-status', '/tick']) {
    const payload = webPayload(state, endpoint, {}, p.id);
    assert.doesNotMatch(JSON.stringify(payload), /xhsAssistant|xhsCoverPlan|PRIVATE_XHS/);
    assert.equal(hasWebSkillHistory(payload), false);
  }
  assert.deepEqual(state, before);
});

test('web merge restores an adopted XHS cover plan only for the exact local asset revision and content', () => {
  const { state, p, a, path } = fixture();
  p.xhsAssistant = { results: [{ id: 'local-result', input: { topic: 'PRIVATE_LOCAL_TOPIC' }, result: { title: 'PRIVATE_LOCAL_RESULT' } }] };
  a.xhsCoverPlan = { id: 'local-plan', resultId: 'local-result', prompt: 'PRIVATE_LOCAL_PLAN' };
  const base = webPayload(state, path + '/cover', {}, p.id), remote = structuredClone(base);
  remote.projects[0].assets[0].error = '需要重新选择图片';
  const merged = mergeRelayState(base, remote, state);
  assert.deepEqual(merged.projects[0].xhsAssistant, p.xhsAssistant);
  assert.deepEqual(merged.projects[0].assets[0].xhsCoverPlan, a.xhsCoverPlan);
  assert.equal(merged.projects[0].assets[0].error, '需要重新选择图片');
  for (const change of [{ revision: a.revision + 1 }, { title: '新标题' }, { body: '新正文' }]) {
    const changed = structuredClone(base); Object.assign(changed.projects[0].assets[0], change);
    const result = mergeRelayState(base, changed, state).projects[0].assets[0];
    assert.equal(result.xhsCoverPlan, undefined, JSON.stringify(change));
  }
  const otherAsset = structuredClone(base), addedAsset = structuredClone(otherAsset.projects[0].assets[0]);
  addedAsset.id = 'different-asset'; otherAsset.projects[0].assets.push(addedAsset);
  assert.equal(mergeRelayState(base, otherAsset, state).projects[0].assets.find(item => item.id === addedAsset.id).xhsCoverPlan, undefined);
  const otherProject = structuredClone(base), addedProject = structuredClone(otherProject.projects[0]);
  addedProject.id = 'different-project'; otherProject.projects.push(addedProject);
  const different = mergeRelayState(base, otherProject, state).projects.find(item => item.id === addedProject.id);
  assert.equal(different.xhsAssistant, undefined); assert.equal(different.assets[0].xhsCoverPlan, undefined);
  assert.equal(a.xhsCoverPlan.prompt, 'PRIVATE_LOCAL_PLAN', 'merging does not mutate the original local plan');
});

test('web merge keeps a newer local XHS plan and assistant history when an unrelated response returns', () => {
  const { state, p, a, path } = fixture();
  p.xhsAssistant = { results: [{ id: 'result-before' }] };
  a.xhsCoverPlan = { id: 'plan-before', prompt: 'PRIVATE_BEFORE' };
  const base = webPayload(state, path + '/video-status', {}, p.id), remote = structuredClone(base);
  remote.projects[0].assets[0].error = '远端状态更新';
  p.xhsAssistant.results.push({ id: 'result-after', result: { summary: 'PRIVATE_AFTER' } });
  a.xhsCoverPlan = { id: 'plan-after', prompt: 'PRIVATE_AFTER' };
  const result = mergeRelayState(base, remote, state).projects[0];
  assert.deepEqual(result.xhsAssistant, p.xhsAssistant);
  assert.deepEqual(result.assets[0].xhsCoverPlan, a.xhsCoverPlan);
  assert.equal(result.assets[0].error, '远端状态更新');
});

test('relay-supplied XHS assistant and cover records cannot replace local history or enter a different asset revision', () => {
  const { state, p, a, path } = fixture();
  p.xhsAssistant = { runs: [{ id: 'local-only-run', input: { topic: 'PRIVATE_LOCAL_ASSISTANT' } }] };
  a.xhsCoverPlan = { runId: 'local-only-run', prompt: 'PRIVATE_LOCAL_PLAN', appliedRevision: a.revision };
  const before = structuredClone(state), base = webPayload(state, path + '/video-status', {}, p.id), remote = structuredClone(base);
  // Neither the base snapshot nor a remote response is an authority for these
  // fields; a relay may legitimately return a new image recipe, but not an XHS
  // assistant result that was never sent to it.
  base.projects[0].xhsAssistant = { runs: [{ id: 'INJECTED_BASE_ASSISTANT' }] };
  base.projects[0].assets[0].xhsCoverPlan = { prompt: 'INJECTED_BASE_PLAN' };
  remote.projects[0].xhsAssistant = { runs: [{ id: 'INJECTED_REMOTE_ASSISTANT' }] };
  remote.projects[0].assets[0].xhsCoverPlan = { prompt: 'INJECTED_REMOTE_PLAN' };
  remote.projects[0].assets[0].error = '远端更新普通状态';
  remote.projects[0].assets[0].metadata = [{ xhsAssistant: { token: 'INJECTED_NESTED_ASSISTANT' }, xhsCoverPlan: { prompt: 'INJECTED_NESTED_PLAN' }, harmless: 'retained' }];
  const merged = mergeRelayState(base, remote, state), result = merged.projects[0].assets[0];
  assert.deepEqual(merged.projects[0].xhsAssistant, p.xhsAssistant);
  assert.deepEqual(result.xhsCoverPlan, a.xhsCoverPlan);
  assert.equal(result.error, '远端更新普通状态'); assert.deepEqual(result.metadata, [{ harmless: 'retained' }]);
  assert.doesNotMatch(JSON.stringify(merged), /INJECTED_/);
  const newVersion = structuredClone(remote); newVersion.projects[0].assets[0].revision++;
  const changed = mergeRelayState(base, newVersion, state);
  assert.equal(changed.projects[0].assets[0].xhsCoverPlan, undefined);
  assert.deepEqual(changed.projects[0].xhsAssistant, p.xhsAssistant);
  const addedProject = structuredClone(remote.projects[0]); addedProject.id = 'remote-new-project'; remote.projects.push(addedProject);
  const added = mergeRelayState(base, remote, state).projects.find(item => item.id === addedProject.id);
  assert.equal(added.xhsAssistant, undefined); assert.equal(added.assets[0].xhsCoverPlan, undefined);
  assert.doesNotMatch(JSON.stringify(added), /INJECTED_/);
  assert.deepEqual(state, before, 'return merging never changes the caller state in place');
});

test('relay rejects local private rules and history at every nesting level before any provider request or async job', async t => {
  let calls = 0;
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const app = createWebRelay({ publicOrigin: origin, allowLocalHttp: true, workspaceOptions: { fetcher: async () => { calls++; throw new Error('must not request'); } } }); root.use(app);
  t.after(async () => { await app.locals.close(); server.close(); server.closeAllConnections(); });
  for (const privateEntry of [{ xhsAssistant: { results: [{ input: 'private' }] } }, { xhsCoverPlan: { prompt: 'private' } }, { builtinSkillOverrides: { strategy: { instructions: 'private' } } }, { builtinSkills: [{ instructions: 'private' }] }, { skillSelections: { analysis: 'private' } }, { briefImports: [{ text: 'private' }] }, { recipe: { prompt: 'private' } }, { prompt: 'private', promptVersion: 'v1' }, { creativeSkill: { instructions: 'private' } }, { skillTrace: {} }]) {
    const state = seedState(); state.projects[0].assets = [{ id: 'historical', history: [privateEntry] }];
    for (const endpoint of ['/api/web/execute', '/api/web/jobs']) {
      const response = await fetch(origin + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ path: '/settings/credential/check', method: 'POST', body: {}, state, credentials: {}, routes: DEFAULT_ROUTES, authorizations: [] }) });
      assert.equal(response.status, 400, JSON.stringify(privateEntry));
    }
  }
  assert.equal(calls, 0);
});
