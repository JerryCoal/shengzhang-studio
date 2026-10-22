import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { installCreativeSkill, updateCreativeSkill } from '../server/creative-skills.mjs';
import { runWithActor } from '../server/request-actor.mjs';
const ownerId = 'media-owner', actor = { userId: ownerId, username: 'Media', role: 'admin' };
const as = work => runWithActor(actor, work), png = 'iVBORw0KGgo=';
async function until(predicate) { for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Synthetic job did not complete'); }
async function fixture(t, role = 'xiaohongshu-copy') {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 62), scope: 'work-media-isolated' }), preferences = createIntegrationPreferences(), calls = [];
  let failOnce = true, skill;
  const platform = role === 'douyin-script' ? 'douyin' : 'xiaohongshu';
  store.mutate(state => {
    state.accounts = [{ id: 'bound-account', platform, name: '固定测试账号' }];
    state.projects[0].brief.budgetUsd = 100; state.projects[0].usage = []; state.projects[0].imageData = ''; state.contentRules = [];
    skill = installCreativeSkill(state, { workflowId: 'cover', fileName: 'SKILL.md', text: '---\nname: image-only\ndescription: 合成图片规则\nversion: 1.0\n---\nSELECTED_IMAGE_SKILL_ONLY', confirmed: true, expectedRevision: 0 });
    state.skillSelections.cover = skill.id;
  });
  const projectId = store.get().projects[0].id;
  const app = createApp(store, {
    profileMode: true, workOwnerId: ownerId, authorizeWorkActor: value => [ownerId, 'other-owner'].includes(value.userId), integrationPreferences: preferences,
    seedreamVault: { status: () => ({ configured: true, supported: true, problem: '' }), getKey: async () => 'synthetic-seedream-key' },
    imageWatermarkInspector: async () => ({ status: 'not_detected', engine: 'synthetic', checkedAt: new Date().toISOString(), regions: [], message: '合成检查' }),
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
      const body = JSON.parse(init.body); calls.push(body);
      if (body.prompt.includes('FAIL-ONCE') && failOnce) { failOnce = false; return new Response('', { status: 400 }); }
      return Response.json({ data: [{ b64_json: png }], usage: { generated_images: 1 } });
    }, mcpFetcher: async () => { throw Error('External MCP is forbidden'); },
    workExecutors: {
      prepare({ state, project, node }) { return { ...node, modelRoute: { model: 'synthetic', provider: 'synthetic' }, estimateUSD: 0, permissions: [], account: state.accounts[0], briefSnapshot: structuredClone(project.brief) }; },
      async execute({ run }) { return { kind: run.node.role === 'douyin-script' ? 'script' : 'copy', title: '固定成果标题', body: '固定成果正文', structured: { prompt: '固定成果画面要求' } }; },
    },
  });
  const runtime = app.locals.workControl;
  const plan = as(() => runtime.createPlan(projectId, { goal: '合成图片工作', nodes: [{ id: 'content', title: '合成内容', role, accountId: 'bound-account', requirement: '按已保存成果生成图片', dependsOn: [], budgetUSD: 0 }], idempotencyKey: randomUUID() })).plan;
  const approved = await as(() => runtime.approvePlan(plan.id, { version: plan.version, idempotencyKey: randomUUID() }));
  const pending = approved.runs[0], dispatchQuote = as(() => runtime.estimateDispatch(pending.id, { expectedRevision: pending.revision, requirement: pending.node.requirement, model: pending.node.model, skillMode: 'default', skillIds: [] }));
  await as(() => runtime.approveDispatch(pending.id, { expectedRevision: pending.revision, quoteId: dispatchQuote.quoteId, budgetUSD: 0, idempotencyKey: randomUUID() }));
  await until(() => store.work.get('run', pending.id).status === 'succeeded');
  const artifact = as(() => runtime.taskDetail(approved.tasks[0].id)).artifacts[0];
  const target = as(() => runtime.prepareArtifactMedia(artifact.id, artifact.version));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await runtime.close(); await app.locals.integrations.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const req = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const path = id => `/projects/${projectId}/assets/${id}`;
  const slots = async (count = 2) => { const result = await req(path(target.assetId) + '/work-images', { count }); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.result.items; };
  const asset = id => store.get().projects[0].assets.find(value => value.id === id);
  const quote = async (id, patch = {}) => {
    const input = { expectedRevision: asset(id).revision, provider: 'seedream', model: preferences.get().seedream.model, skillId: '', prompt: '真实校园图片', query: '', style: 'natural', layout: 'top', textMode: 'title', watermark: false, ...patch };
    const result = await req(path(id) + '/cover-estimate', input); assert.equal(result.status, 200, JSON.stringify(result.data));
    return { ...input, approvalFingerprint: result.data.fingerprint, requestId: randomUUID(), confirmed: true };
  };
  return { store, runtime, req, slots, asset, quote, path, calls, skill, artifact, target, projectId, preferences };
}
for (const role of ['xiaohongshu-copy', 'douyin-script']) test(`${role} restores two independently bound image slots without calling any model`, async t => {
  const f = await fixture(t, role), before = structuredClone(f.asset(f.target.assetId));
  const items = await f.slots(); assert.equal(items.length, 2); assert.notEqual(items[0].id, items[1].id);
  assert.deepEqual(await f.slots(), items); assert.equal(f.calls.length, 0); assert.deepEqual(f.asset(f.target.assetId), before);
  for (const item of items) {
    const asset = f.asset(item.id); assert.equal(asset.kind, 'image'); assert.equal(asset.title, f.artifact.title); assert.equal(asset.body, f.artifact.body);
    assert.equal(asset.contentBrief.accountId, 'bound-account'); assert.equal(asset.workImageOrigin.artifactId, f.artifact.id); assert.equal(asset.workImageOrigin.artifactVersion, f.artifact.version);
  }
  const models = await f.req('/cover-models'); assert.equal(models.status, 200); assert.equal(models.data.models[0].provider, 'seedream');
  const quotes = await Promise.all(items.map(item => f.quote(item.id))); assert.equal(quotes.length, 2); assert.equal(f.calls.length, 0);
  assert.equal((await f.req(f.path(f.target.assetId) + '/work-images', { count: 5 })).status, 400);
});
test('each image explicitly selects its Skill and stale approval cannot send changed rules', async t => {
  const f = await fixture(t), [first, second] = await f.slots();
  const onlyDefaults = await f.quote(first.id), selected = await f.quote(second.id, { skillId: f.skill.id });
  const missingApproval = { ...selected }; delete missingApproval.approvalFingerprint;
  assert.equal((await f.req(f.path(second.id) + '/cover', missingApproval)).status, 400); assert.equal(f.calls.length, 0);
  assert.equal((await f.req(f.path(first.id) + '/cover', onlyDefaults)).status, 202);
  await until(() => f.asset(first.id).aiCover?.phase === 'ready'); assert(!f.calls[0].prompt.includes('SELECTED_IMAGE_SKILL_ONLY'));
  assert.equal(f.store.get().skillSelections.cover, f.skill.id);
  f.store.mutate(state => updateCreativeSkill(state, f.skill.id, { fileName: f.skill.sourceFile, text: f.skill.sourceText + '\nUPDATED_RULE', expectedRevision: state.skillsRevision }));
  assert.equal((await f.req(f.path(second.id) + '/cover', selected)).status, 409); assert.equal(f.calls.length, 1);
  const fresh = await f.quote(second.id, { skillId: f.skill.id }); assert.equal((await f.req(f.path(second.id) + '/cover', fresh)).status, 202);
  await until(() => f.asset(second.id).aiCover?.phase === 'ready'); assert.match(f.calls[1].prompt, /SELECTED_IMAGE_SKILL_ONLY/); assert.match(f.calls[1].prompt, /UPDATED_RULE/);
  assert.equal(f.asset(second.id).aiCover.skillTrace.user.id, f.skill.id);
});
test('replaying an image never resends it and retrying a failed sibling preserves success', async t => {
  const f = await fixture(t), [first, second] = await f.slots();
  const firstRequest = await f.quote(first.id), secondRequest = await f.quote(second.id, { prompt: 'FAIL-ONCE 真实校园第二张图片' });
  assert.equal((await f.req(f.path(first.id) + '/cover', firstRequest)).status, 202); assert.equal((await f.req(f.path(second.id) + '/cover', secondRequest)).status, 202);
  await until(() => f.asset(first.id).aiCover?.phase === 'ready' && f.asset(second.id).aiCover?.phase === 'failed');
  assert.equal(f.calls.length, 2); const success = structuredClone(f.asset(first.id).aiCover);
  assert.equal((await f.req(f.path(first.id) + '/cover', firstRequest)).status, 202); assert.equal(f.calls.length, 2);
  assert.equal((await f.req(f.path(first.id) + '/cover', { ...firstRequest, prompt: 'different' })).status, 409);
  const retry = await f.quote(second.id, { prompt: 'FAIL-ONCE 真实校园第二张图片' }); assert.equal((await f.req(f.path(second.id) + '/cover', retry)).status, 202);
  await until(() => f.asset(second.id).aiCover?.phase === 'ready'); assert.equal(f.calls.length, 3); assert.deepEqual(f.asset(first.id).aiCover, success);
  assert.deepEqual(await f.slots(), [first, second]); assert.equal(f.calls.length, 3);
  assert.equal((await f.req(f.path(second.id) + '/cover', secondRequest)).status, 202); assert.equal(f.calls.length, 3, 'historical request replay cannot charge again after a retry');
});
test('foreign ownership and changed accounts cannot prepare image slots', async t => {
  const f = await fixture(t), key = `${f.artifact.id}:${f.artifact.version}`, saved = f.store.work.get('artifact', key);
  f.store.work.put('artifact', { ...saved, ownerId: 'other-owner' }); assert.equal((await f.req(f.path(f.target.assetId) + '/work-images', { count: 2 })).status, 409);
  f.store.work.put('artifact', saved); f.store.mutate(state => { state.projects[0].assets.find(item => item.id === f.target.assetId).contentBrief.accountId = 'different-account'; });
  assert.equal((await f.req(f.path(f.target.assetId) + '/work-images', { count: 2 })).status, 409); assert.equal(f.calls.length, 0);
});
