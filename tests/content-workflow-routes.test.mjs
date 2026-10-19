import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createWebRelay } from '../server/web-relay.mjs';
import { createModelStore, DEEPSEEK_ROUTES } from '../server/models.mjs';
import { createKnowledge, createContentDraft, updateKnowledge, updateContentBrief } from '../server/content-workflow.mjs';
import { confirmStrategy } from '../server/domain.mjs';
import { saveAccountCreationProfile } from '../server/account-creation.mjs';
import { removeWebSkillHistory } from '../server/web-skill-privacy.mjs';

const key = 'synthetic-content-workflow-fixture', vault = { status: () => ({ configured: true, supported: true }), getKey: async () => key };
const copy = { title: '办公喝茶的小场景', body: '整理桌面，再开始今天的记录。', prompt: '自然光下的茶桌，保持干净背景。', scenes: ['桌面', '茶杯', '收纳'] };
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
async function fixture(t, options = {}) {
  const store = createStore(':memory:'), models = createModelStore(), calls = [], behavior = {}; models.save(DEEPSEEK_ROUTES);
  store.mutate(state => {
    const p = state.projects[0]; p.brief.budgetUsd = 100; p.usage = [];
    state.accounts.push({ id: 'xhs-b', platform: 'xiaohongshu', name: '账号乙' });
    for (const [accountId, marker] of [['account-xhs', 'IDENTITY_A'], ['xhs-b', 'IDENTITY_B']]) saveAccountCreationProfile(state, accountId, { identityMarkdown: marker, identityFileName: '', presets: [], defaultPresetId: '', expectedRevision: 0 });
    p.corpus = [{ id: 'old-corpus', name: '办公喝茶旧语料', text: 'EXISTING_CORPUS 办公喝茶使用陶瓷杯。', enabled: true, purpose: 'product_facts', format: 'txt', importedAt: new Date().toISOString(), chunks: [{ index: 0, text: 'EXISTING_CORPUS 办公喝茶使用陶瓷杯。' }] }];
  });
  const app = createApp(store, { profileMode: true, modelStore: models, deepseekVault: vault, seedreamVault: vault, imageInspector: async () => ({ status: 'unavailable' }), fetcher: async (url, init) => {
    const request = JSON.parse(init.body); calls.push({ url, request });
    if (!url.includes('chat/completions')) return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }], usage: { generated_images: 1 } });
    const payload = JSON.parse(request.messages[1].content); calls.at(-1).payload = payload;
    if (behavior.model) return behavior.model(payload, request);
    return completion(payload.input ? { ...copy, summary: '基于已提供资料创作。', limitations: ['没有联网样本。'], evidence: [] } : copy);
  }, ...options });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const current = () => store.get().projects[0], base = `/api/projects/${current().id}`;
  const req = async (path, body, method = 'POST', extraHeaders = {}) => { const response = await fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  const draft = async extra => { const r = await req('/content-drafts', { requestId: randomUUID(), accountId: 'account-xhs', kind: 'image', requirement: '办公喝茶 DIRECT_REQUIREMENT', ...extra }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
  const knowledge = async extra => { const r = await req('/knowledge', { requestId: randomUUID(), kind: 'experience', title: '办公喝茶', text: 'KNOWLEDGE_A 办公喝茶建议短句', accountId: 'account-xhs', ...extra }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
  return { store, app, current, req, draft, knowledge, calls, behavior };
}

test('HTTP draft and knowledge requests are idempotent under concurrent submissions and edits reject old revisions', async t => {
  const f = await fixture(t), requestId = randomUUID(), input = { requestId, accountId: 'account-xhs', kind: 'image', requirement: '并发单篇要求' };
  const replies = await Promise.all([f.req('/content-drafts', input), f.req('/content-drafts', input)]);
  assert(replies.every(r => r.status === 200)); assert.equal(replies[0].body.result.id, replies[1].body.result.id);
  assert.equal(f.current().assets.filter(a => a.contentBrief).length, 1);
  const k = await f.knowledge(); const edits = await Promise.all([f.req(`/knowledge/${k.id}`, { expectedRevision: 1, text: '改动甲' }, 'PATCH'), f.req(`/knowledge/${k.id}`, { expectedRevision: 1, text: '改动乙' }, 'PATCH')]);
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const a = replies[0].body.result; assert.equal((await f.req(`/assets/${a.id}/brief`, { expectedRevision: 1, requirement: '更新要求' }, 'PUT')).status, 200);
  assert.equal((await f.req(`/assets/${a.id}/brief`, { expectedRevision: 1, requirement: '过时要求' }, 'PUT')).status, 409);
  const before = f.current().revision; assert.equal((await f.req('/knowledge/preview', { assetId: a.id })).status, 200); assert.equal(f.current().revision, before); assert.equal(f.calls.length, 0);
});

test('ordinary copy uses the direct asset account and current requirement plus saved knowledge and existing corpus', async t => {
  const f = await fixture(t), k = await f.knowledge(), a = await f.draft({ knowledgeIds: [k.id] });
  await f.knowledge({ accountId: 'xhs-b', text: 'OTHER_ACCOUNT_PRIVATE 办公喝茶' });
  f.store.mutate(state => { state.projects[0].creationSelections = { xiaohongshu: { accountId: 'xhs-b', presetId: '' } }; });
  const result = await f.req(`/assets/${a.id}/copy`, { expectedRevision: 1, instruction: '请写得自然' }); assert.equal(result.status, 200, JSON.stringify(result.body));
  const payload = f.calls[0].payload; assert.match(payload.requirement, /DIRECT_REQUIREMENT/); assert.equal(payload.accountContext.accounts[0].accountId, 'account-xhs'); assert.match(JSON.stringify(payload), /KNOWLEDGE_A|EXISTING_CORPUS/);
  assert(payload.corpusReferences.some(row => row.text.includes('EXISTING_CORPUS'))); assert(payload.knowledgeContext.entries.some(row => row.id === k.id)); assert.doesNotMatch(JSON.stringify(f.calls), /OTHER_ACCOUNT_PRIVATE|IDENTITY_B/);
  assert.equal(result.body.result.knowledgeContext.entries[0].id, k.id); assert.equal(result.body.result.contentBrief.accountId, 'account-xhs'); assert.equal(f.calls.length, 1);
});

test('editing knowledge during an ordinary request preserves the input snapshot and prevents overwriting the newer context', async t => {
  const f = await fixture(t), k = await f.knowledge(), a = await f.draft({ knowledgeIds: [k.id] });
  f.behavior.model = async payload => {
    assert.match(JSON.stringify(payload), /KNOWLEDGE_A/);
    f.store.mutate(state => updateKnowledge(state, state.projects[0], k.id, { expectedRevision: 1, text: 'NEXT_GENERATION_ONLY 办公喝茶' }));
    assert.doesNotMatch(JSON.stringify(payload), /NEXT_GENERATION_ONLY/); return completion(copy);
  };
  const result = await f.req(`/assets/${a.id}/copy`, { expectedRevision: 1 }); assert.equal(result.status, 409); assert.equal(f.calls.length, 1);
  assert.equal(f.current().assets.find(row => row.id === a.id).body, ''); assert.equal(f.current().usage.at(-1).status, 'completed');
});

test('assistant uses bound account, requirements, corpus and knowledge but still refuses memory-only scores', async t => {
  const f = await fixture(t), k = await f.knowledge(), a = await f.draft({ knowledgeIds: [k.id] });
  f.store.mutate(state => { state.projects[0].creationSelections = { xiaohongshu: { accountId: 'xhs-b', presetId: '' } }; });
  const input = { mode: 'create', assetId: a.id, expectedAssetRevision: a.revision, keyword: '办公喝茶', requestId: randomUUID(), confirmed: true };
  const result = await f.req('/xhs-assistant/runs', input); assert.equal(result.status, 200, JSON.stringify(result.body)); const run = result.body.result;
  assert.equal(run.stale, false); assert.equal(run.accountId, 'account-xhs'); assert.equal(run.knowledgeContext.entries[0].id, k.id);
  const payload = f.calls[0].payload; assert.match(payload.requirement, /DIRECT_REQUIREMENT/); assert(payload.corpusReferences.some(row => row.text.includes('EXISTING_CORPUS'))); assert.equal(payload.samples.length, 0);
  assert.match(f.calls[0].request.messages[0].content, /不是评分匹配样本/);
  const score = await f.req('/xhs-assistant/runs', { ...input, requestId: randomUUID(), mode: 'title-score', title: '办公喝茶' }); assert.equal(score.status, 400); assert.equal(f.calls.length, 1);
  const adopt = await f.req('/xhs-assistant/adopt', { runId: run.id, assetId: a.id, expectedRevision: a.revision, confirmed: true }); assert.equal(adopt.status, 200, JSON.stringify(adopt.body)); assert.equal(adopt.body.result.creationTrace.accounts[0].accountId, 'account-xhs');
});

test('cover routes accept direct Douyin images and keep bound-account knowledge in the actual image request', async t => {
  const f = await fixture(t); const account = f.store.get().accounts.find(a => a.platform === 'douyin'); assert(account);
  const k = await f.knowledge({ accountId: account.id, text: 'DOUYIN_SCENE_REFERENCE 办公喝茶' }), a = await f.draft({ accountId: account.id, knowledgeIds: [k.id] });
  const result = await f.req(`/assets/${a.id}/cover`, { expectedRevision: a.revision, confirmed: true }); assert.equal(result.status, 202, JSON.stringify(result.body));
  await f.app.locals.integrations.close(); assert.equal(f.calls.length, 1); assert.match(f.calls[0].request.prompt, /DOUYIN_SCENE_REFERENCE|DIRECT_REQUIREMENT/);
  const saved = f.current().assets.find(row => row.id === a.id); assert.equal(saved.aiCover.knowledgeContext.entries[0].id, k.id); assert.equal(saved.aiCover.accountContext.accounts[0].accountId, account.id);
});

test('the existing workspace password and client-origin guard protect every new mutation', async t => {
  const f = await fixture(t, { password: 'fixture-password' });
  for (const path of ['/content-drafts', '/knowledge', '/knowledge/preview']) assert.equal((await f.req(path, {})).status, 401);
  assert.equal((await f.req('/knowledge', {}, 'POST', { Origin: 'https://untrusted.example' })).status, 403); assert.equal(f.calls.length, 0);
});

test('independent relay rejects knowledge uploads, direct-draft generation and new local routes before any provider call', async t => {
  const store = createStore(':memory:'), state = store.get(), p = state.projects[0]; store.close();
  const k = createKnowledge(state, p, { kind: 'reference', title: '资料', text: 'PRIVATE_DATA' }), a = createContentDraft(state, p, { requestId: randomUUID(), accountId: 'account-xhs', kind: 'image', requirement: '本地要求', knowledgeIds: [k.id] });
  const root = express(), server = root.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`; let calls = 0;
  const app = createWebRelay({ publicOrigin: base, allowLocalHttp: true, workspaceOptions: { fetcher: async () => { calls++; throw new Error('unexpected'); } } }); root.use(app);
  t.after(async () => { await app.locals.close(); server.close(); server.closeAllConnections(); });
  const send = async (path, snapshot) => fetch(base + '/api/web/execute', { method: 'POST', headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, body: JSON.stringify({ path, method: 'POST', body: { expectedRevision: 1 }, state: snapshot, credentials: { deepseek: key }, routes: DEEPSEEK_ROUTES, authorizations: [] }) });
  assert.equal((await send(`/projects/${p.id}/assets/${a.id}/copy`, state)).status, 400);
  const minimized = structuredClone({ schemaVersion: state.schemaVersion, projects: [p], accounts: state.accounts, activities: state.activities }); removeWebSkillHistory(minimized);
  assert.equal((await send(`/projects/${p.id}/assets/${a.id}/copy`, minimized)).status, 400);
  assert.equal((await send(`/projects/${p.id}/knowledge`, minimized)).status, 404); assert.equal((await send(`/projects/${p.id}/content-drafts`, minimized)).status, 404); assert.equal(calls, 0);
  confirmStrategy(p, p.strategies.find(row => row.source !== 'direct').id);
  const old = p.assets.find(row => row.channel === 'xiaohongshu' && !row.contentBrief); updateContentBrief(state, p, old.id, { expectedRevision: old.revision, requirement: '旧素材的新增私人要求' });
  const oldSnapshot = structuredClone({ schemaVersion: state.schemaVersion, projects: [p], accounts: state.accounts, activities: state.activities }); removeWebSkillHistory(oldSnapshot);
  assert.equal(oldSnapshot.projects[0].assets.find(row => row.id === old.id).localContentOnly, true);
  assert.equal((await send(`/projects/${p.id}/assets/${old.id}/copy`, oldSnapshot)).status, 400); assert.equal(calls, 0);
});
