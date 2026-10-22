import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import express from 'express';
import { createStore } from '../server/store.mjs';
import { createWorkControl } from '../server/work-control.mjs';
import { runWithActor } from '../server/request-actor.mjs';

const actor = { userId: 'artifact-media-owner', username: 'Media owner', role: 'editor' };
const asOwner = callback => runWithActor(actor, callback);

async function fixture(t, role = 'xiaohongshu-copy') {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 23), scope: 'artifact-media-versions' });
  store.mutate(state => {
    state.accounts = [
      { id: 'xhs-fixed', name: '固定小红书账号', platform: 'xiaohongshu', creationProfile: { revision: 1, identityMarkdown: '最初批准的账号身份', identityFileName: '', presets: [], defaultPresetId: '' } },
      { id: 'dy-fixed', name: '固定抖音账号', platform: 'douyin' },
      { id: 'xhs-other', name: '其他小红书账号', platform: 'xiaohongshu' },
    ];
    state.projects[0].brief.budgetUsd = 100;
  });
  const projectId = store.get().projects[0].id, kind = role === 'douyin-research' ? 'research' : role === 'douyin-script' ? 'script' : 'copy';
  const calls = [];
  const runtime = createWorkControl({ store, config: { authorizeWorkActor: value => value.userId === actor.userId }, executors: {
    prepare({ node }) { return { ...structuredClone(node), modelRoute: { model: 'synthetic-model', provider: 'synthetic' }, estimateUSD: 0, permissions: ['model:copy'] }; },
    async execute({ run }) { calls.push(run.id); return { kind, title: run.node.title, body: '原始生成正文', structured: { prompt: '原始视觉构思', scenes: ['开头', '讲解', '结尾'] } }; },
  } });
  t.after(async () => { await runtime.close(); store.close(); });
  const node = { id: 'content', title: '合成测试内容', role, accountId: kind === 'research' ? '' : kind === 'script' ? 'dy-fixed' : 'xhs-fixed', connectionAccountId: kind === 'research' ? 'dy-fixed' : '', requirement: '本篇内容要求', dependsOn: [], budgetUSD: 0 };
  const plan = asOwner(() => runtime.createPlan(projectId, { goal: '生成可继续制作的内容', nodes: [node], idempotencyKey: randomUUID() }).plan);
  const approved = await asOwner(() => runtime.approvePlan(plan.id, { version: plan.version, budgetUSD: 0, idempotencyKey: randomUUID() }));
  const runId = approved.runs[0].id, pending = approved.runs[0];
  assert.equal(pending.status, 'pending_approval');
  const quote = asOwner(() => runtime.estimateDispatch(runId, { expectedRevision: pending.revision, requirement: node.requirement, model: 'synthetic-model', skillMode: 'default', skillIds: [] }));
  await asOwner(() => runtime.approveDispatch(runId, { expectedRevision: pending.revision, quoteId: quote.quoteId, budgetUSD: 0, idempotencyKey: randomUUID() }));
  for (let tries = 0; tries < 200 && store.work.get('run', runId).status !== 'succeeded'; tries++) await nextTurn();
  assert.equal(store.work.get('run', runId).status, 'succeeded', store.work.get('run', runId).error);
  const original = asOwner(() => runtime.taskDetail(approved.tasks[0].id)).artifacts[0];
  const edit = (version, patch = {}) => asOwner(() => runtime.editArtifact(original.id, version, { title: `人工编辑 V${version + 1}`, body: `人工正文 V${version + 1}`, expectedHeadVersion: version, idempotencyKey: randomUUID(), ...patch }).artifact);
  const media = (version = 1) => asOwner(() => runtime.prepareArtifactMedia(original.id, version));
  return { store, runtime, projectId, original, edit, media, calls, project: () => store.get().projects.find(item => item.id === projectId) };
}

for (const role of ['xiaohongshu-copy', 'douyin-script']) test(`${role} edited versions retain separate, account-bound media drafts and retries do not duplicate them`, async t => {
  const f = await fixture(t, role), oldAssetId = f.original.legacy.assetId;
  f.store.mutate(state => {
    const asset = state.projects[0].assets.find(item => item.id === oldAssetId);
    Object.assign(asset, { title: '原素材手动保存的标题', body: '原素材手动保存的正文', mediaData: 'data:image/png;base64,synthetic', mime: 'image/png', revision: asset.revision + 1 });
    state.activeCreationAccounts = { xiaohongshu: 'xhs-other' };
    state.accounts[0].creationProfile.identityMarkdown = '后来修改的身份';
    state.accounts[0].creationProfile.revision++;
  });
  const previousAsset = f.project().assets.find(item => item.id === oldAssetId), originalCount = f.project().assets.length;
  const key = randomUUID(), edited = f.edit(1, { idempotencyKey: key });
  assert(edited.legacy.assetId, 'an edited version must keep a continuation link to media production');
  assert.notEqual(edited.legacy.assetId, oldAssetId, 'new text cannot overwrite prior media work');
  assert.deepEqual(f.project().assets.find(item => item.id === oldAssetId), previousAsset);
  const media = f.project().assets.find(item => item.id === edited.legacy.assetId);
  assert.equal(media.title, edited.title); assert.equal(media.body, edited.body);
  assert.equal(media.kind, role === 'douyin-script' ? 'video' : 'image');
  assert.equal(media.contentBrief.accountId, role === 'douyin-script' ? 'dy-fixed' : 'xhs-fixed');
  assert.deepEqual(media.workOrigin, { taskId: edited.taskId, runId: edited.runId, artifactId: edited.id, artifactVersion: 2 });
  assert.equal(media.mediaData, ''); assert.equal(media.prompt, '原始视觉构思');
  if (role === 'xiaohongshu-copy') assert.equal(media.creationTrace.accounts[0].identityMarkdown, '最初批准的账号身份');
  else assert.deepEqual(media.scenes, ['开头', '讲解', '结尾']);
  assert.deepEqual(f.edit(1, { idempotencyKey: key }), edited);
  assert.equal(f.project().assets.length, originalCount + 1);
  const third = f.edit(2);
  assert.notEqual(third.legacy.assetId, edited.legacy.assetId);
  assert.equal(f.project().assets.length, originalCount + 2);
  assert.deepEqual(f.project().assets.find(item => item.id === edited.legacy.assetId), media);
  const requests = f.project().contentRequests.filter(item => [oldAssetId, edited.legacy.assetId, third.legacy.assetId].includes(item.resultId));
  assert.equal(new Set(requests.map(item => item.requestId)).size, 3, 'each version needs its own idempotent draft request');
  assert.throws(() => f.edit(1), /另一处更新/);
  assert.equal(f.project().assets.length, originalCount + 2);
});

test('failed edited-artifact persistence rolls back its media draft and can be retried once', async t => {
  const f = await fixture(t), originalAssets = f.project().assets, put = f.store.work.put;
  f.store.work.put = (kind, record) => {
    if (kind === 'artifact' && record.version === 2) throw Error('synthetic artifact persistence failure');
    return put(kind, record);
  };
  const key = randomUUID();
  try { assert.throws(() => f.edit(1, { idempotencyKey: key }), /synthetic artifact persistence failure/); }
  finally { f.store.work.put = put; }
  assert.deepEqual(f.project().assets, originalAssets);
  assert.equal(f.store.work.get('artifact-head', f.original.id).version, 1);
  const edited = f.edit(1, { idempotencyKey: key });
  assert.equal(f.project().assets.length, originalAssets.length + 1);
  assert.deepEqual(f.edit(1, { idempotencyKey: key }), edited);
  assert.equal(f.project().assets.length, originalAssets.length + 1);
});

test('research edits remain shared research and do not create image or video assets', async t => {
  const f = await fixture(t, 'douyin-research'), assets = f.project().assets;
  const edited = f.edit(1);
  assert.equal(edited.kind, 'research'); assert.equal(edited.legacy.assetId, undefined);
  assert.deepEqual(f.project().assets, assets);
});

test('old edited artifacts without a media link can continue through an idempotent HTTP request without generating media', async t => {
  const f = await fixture(t), originalAssets = f.project().assets, source = f.store.work.get('artifact', `${f.original.id}:1`);
  f.store.work.put('artifact', { ...source, id: `${f.original.id}:2`, version: 2, title: '旧版人工标题', body: '旧版人工正文', source: 'user', legacy: {} });
  f.store.work.put('artifact-head', { id: f.original.id, ownerId: actor.userId, version: 2, nextVersion: 2 });
  const app = express();
  app.use((req, res, next) => runWithActor(actor, next)); f.runtime.mount(app);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = () => fetch(`http://127.0.0.1:${server.address().port}/api/artifacts/${f.original.id}/versions/2/media-draft`, { method: 'POST' });
  const response = await request(); assert.equal(response.status, 200);
  const link = await response.json(); assert.equal(link.projectId, f.projectId); assert(link.assetId);
  const asset = f.project().assets.find(item => item.id === link.assetId);
  assert.equal(asset.title, '旧版人工标题'); assert.equal(asset.body, '旧版人工正文'); assert.equal(asset.contentBrief.accountId, 'xhs-fixed');
  assert.equal(asset.mediaData, ''); assert.equal(asset.workOrigin.artifactVersion, 2);
  assert.deepEqual(f.project().assets.filter(item => item.id !== link.assetId), originalAssets);
  assert.deepEqual(await (await request()).json(), link);
  assert.equal(f.project().assets.length, originalAssets.length + 1); assert.equal(f.calls.length, 1);
  assert.equal(f.store.work.all('run').length, 1); assert.equal(f.project().usage.length, 0);
});

test('continuation reads an existing draft or restores its missing link without overwriting media edits', async t => {
  const f = await fixture(t), assetId = f.original.legacy.assetId;
  f.store.mutate(state => { const asset = state.projects[0].assets.find(item => item.id === assetId); Object.assign(asset, { title: '用户已改素材标题', body: '用户已改素材正文', mediaData: 'data:image/png;base64,synthetic' }); });
  const assets = f.project().assets;
  assert.deepEqual(f.media(), { assetId, projectId: f.projectId });
  const source = f.store.work.get('artifact', `${f.original.id}:1`); source.legacy = {}; f.store.work.put('artifact', source);
  assert.deepEqual(f.media(), { assetId, projectId: f.projectId });
  assert.equal(f.store.work.get('artifact', `${f.original.id}:1`).legacy.assetId, assetId);
  assert.deepEqual(f.project().assets, assets); assert.equal(f.calls.length, 1);
});

test('explicit continuation recreates an already removed linked draft once', async t => {
  const f = await fixture(t), previousId = f.original.legacy.assetId;
  f.store.mutate(state => { state.projects[0].assets = state.projects[0].assets.filter(item => item.id !== previousId); });
  const count = f.project().assets.length, link = f.media();
  assert.notEqual(link.assetId, previousId); assert.equal(f.project().assets.length, count + 1);
  assert.deepEqual(f.media(), link); assert.equal(f.project().assets.length, count + 1);
});

test('media continuation rejects candidates, foreign owners, missing accounts and mismatched material links', async t => {
  const f = await fixture(t), originalAssets = f.project().assets, source = f.store.work.get('artifact', `${f.original.id}:1`);
  f.store.work.put('artifact', { ...source, candidate: true });
  assert.throws(() => f.media(), /先明确采用/);
  f.store.work.put('artifact', source);
  assert.throws(() => runWithActor({ ...actor, userId: 'foreign-member' }, () => f.runtime.prepareArtifactMedia(f.original.id, 1)), error => error.status === 404);
  f.store.mutate(state => { state.projects[0].assets.find(item => item.id === f.original.legacy.assetId).workOrigin.artifactVersion = 99; });
  assert.throws(() => f.media(), /版本或固定账号不一致/);
  f.store.mutate(state => { state.projects[0].assets = originalAssets; state.accounts = state.accounts.filter(item => item.id !== 'xhs-fixed'); });
  assert.throws(() => f.media(), /账号不存在/);
  assert.deepEqual(f.project().assets, originalAssets); assert.equal(f.calls.length, 1);
});

test('research artifacts cannot enter media production', async t => {
  const f = await fixture(t, 'douyin-research'), assets = f.project().assets;
  assert.throws(() => f.media(), /只有图文文案或视频脚本/);
  assert.deepEqual(f.project().assets, assets);
});
