import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createTeamStore } from '../server/team-store.mjs';
import { runWithActor } from '../server/request-actor.mjs';
import { selectKnowledge, updateKnowledge } from '../server/content-workflow.mjs';
import { mountWorkExperienceRoutes } from '../server/work-experience.mjs';

const actors = { alpha: { userId: 'experience-alpha', role: 'editor' }, beta: { userId: 'experience-beta', role: 'editor' } };
const analysis = { title: '从课堂问题切入', application: '先讲具体课堂问题，再解释 AI 如何辅助。', limitations: '只基于当前样本，不能推断全平台或教学效果。', growthAdvice: [{ focus: 'opening', action: '先写一个真实课堂提问。', reason: '当前样本包含具体问题。', validation: '保留两个开头版本，按相同口径比较反馈。', referenceIds: ['public-ref'] }] };
const path = (id, action = 'experience-candidates', version = 1) => `/api/artifacts/${id}/versions/${version}/${action}`;
const body = patch => ({ requestId: randomUUID(), confirmed: true, scope: 'account', accountId: 'xhs-a', items: [{ title: '课堂提问开场', text: '先呈现真实的课堂问题；这是待验证的表达偏好。' }], ...patch });

async function fixture(t) {
  const base = createStore(':memory:', { key: Buffer.alloc(32, 83), scope: 'work-experience-test' }), store = createTeamStore(base), allowed = new Set(Object.values(actors).map(actor => actor.userId));
  base.mutate(state => { state.accounts = [{ id: 'xhs-a', name: '校园 A', platform: 'xiaohongshu' }, { id: 'dy-b', name: '品牌 B', platform: 'douyin' }]; state.projects[0].knowledge = []; state.projects[0].contentRequests = []; });
  const projectId = base.get().projects[0].id;
  function save(id, { owner = 'alpha', kind = 'research', accountId = '', source = 'generated', candidate = false, status = 'succeeded', structured = { analyses: [analysis] }, version = 1 } = {}) {
    const ownerId = actors[owner].userId, taskId = `${id}-task`, runId = `${id}-run`;
    base.work.put('task', { id: taskId, ownerId, projectId, accountId, latestRunId: runId });
    base.work.put('run', { id: runId, taskId, ownerId, projectId, status, node: { accountId }, input: { payload: 'PRIVATE_RAW_MODEL_INPUT', credentialFingerprint: 'PRIVATE_FINGERPRINT' } });
    base.work.put('artifact', { id: `${id}:${version}`, artifactId: id, version, ownerId, taskId, runId, projectId, accountId, kind, source, candidate, title: '已保存成果', body: '这里是正文，不代表经验已获验证。', structured: { ...structured, rawResponse: 'PRIVATE_RAW_RESPONSE' } });
    base.work.put('message', { id: `${id}-private-message`, ownerId, taskId, text: 'PRIVATE_TASK_CHAT_MUST_NOT_BE_READ' });
  }
  save('research'); save('copy', { kind: 'copy', accountId: 'xhs-a', structured: { review: { status: 'clean' }, body: '正文不能当作经验建议' } });
  save('foreign', { owner: 'beta' });
  let privateReads = 0, externalCalls = 0;
  const work = { ...store.work, get(kind, id) { if (kind === 'message') privateReads++; return store.work.get(kind, id); }, all(kind, ownerId) { if (kind === 'message') privateReads++; return store.work.all(kind, ownerId); } };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { const actor = actors[req.get('X-Test-Actor')]; if (!actor) return res.status(401).json({ error: 'Synthetic login required' }); runWithActor(actor, next); });
  const service = mountWorkExperienceRoutes({ app, store: { ...store, work }, config: { teamMode: true, authorizeWorkActor: actor => allowed.has(actor.userId), fetcher: () => { externalCalls++; throw Error('No external request allowed'); } } });
  app.use((error, _req, res, _next) => res.status(error.status || (error.name === 'ZodError' ? 400 : 500)).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); base.close(); });
  const req = async (url, data, actor = 'alpha') => { const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-Test-Actor': actor, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: response.status, data: await response.json() }; };
  return { base, store, work, service, save, req, projectId, allowed, project: () => base.get().projects[0], get privateReads() { return privateReads; }, get externalCalls() { return externalCalls; } };
}

test('candidate GET reads only owned saved suggestions, exposes limitations, and neither reads private chat nor spends', async t => {
  const f = await fixture(t), usage = structuredClone(f.project().usage), result = await f.req(path('research'));
  assert.equal(result.status, 200); assert.deepEqual(result.data.allowedScopes, ['project', 'account']); assert.equal(result.data.manualAllowed, true);
  assert.equal(result.data.candidates.length, 1); assert.match(result.data.candidates[0].text, /待验证建议|适用限制/); assert.match(result.data.candidates[0].text, /未验证/);
  assert.deepEqual(result.data.source, { projectId: f.projectId, taskId: 'research-task', runId: 'research-run', artifactId: 'research', artifactVersion: 1, kind: 'research', accountId: '', title: '已保存成果' });
  assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE_|credentialFingerprint|rawResponse/);
  assert.equal(f.privateReads, 0); assert.equal(f.externalCalls, 0); assert.deepEqual(f.project().usage, usage); assert.equal(f.project().knowledge.length, 0);
});

test('copy bodies and clean reviews are not fabricated experience candidates; an edited artifact does not reuse stale suggestions', async t => {
  const f = await fixture(t), result = await f.req(path('copy'));
  assert.deepEqual(result.data.candidates, []); assert.deepEqual(result.data.allowedScopes, ['account']);
  f.save('edited', { source: 'user' }); assert.deepEqual((await f.req(path('edited'))).data.candidates, []);
  f.save('explicit-copy', { kind: 'copy', accountId: 'xhs-a', structured: { experienceSuggestions: [{ title: '短句偏好', text: '把长句拆为三个可核对步骤。' }] } });
  assert.equal((await f.req(path('explicit-copy'))).data.candidates.length, 1);
});

test('foreign, revoked, unfinished, candidate and planning artifacts cannot supply or receive experience adoption', async t => {
  const f = await fixture(t);
  assert.equal((await f.req(path('foreign'))).status, 404); assert.equal((await f.req(path('foreign', 'experiences'), body())).status, 404);
  for (const [id, patch] of [['candidate', { candidate: true }], ['paused', { status: 'paused' }], ['plan', { kind: 'plan' }]]) {
    f.save(id, patch); assert.equal((await f.req(path(id))).status, 409); assert.equal((await f.req(path(id, 'experiences'), body())).status, 409);
  }
  f.allowed.delete(actors.alpha.userId); assert.equal((await f.req(path('research'))).status, 403); assert.equal((await f.req(path('research', 'experiences'), body())).status, 403);
  assert.equal(f.project().knowledge.length, 0);
});

test('adoption requires explicit confirmation, nonempty selection, known candidate ids and a strict bounded schema', async t => {
  const f = await fixture(t);
  for (const patch of [{ confirmed: false }, { items: [] }, { items: Array.from({ length: 9 }, (_, index) => ({ title: `条目${index}`, text: '待验证建议' })) }, { active: true }, { projectId: 'forged-project' }, { usage: { amountUsd: 0 } }, { items: [{ title: 'x', text: 'x'.repeat(12001) }] }]) {
    assert.equal((await f.req(path('research', 'experiences'), body(patch))).status, 400);
  }
  assert.equal((await f.req(path('research', 'experiences'), body({ items: [{ candidateId: 'not-saved-in-this-version', title: '伪造候选', text: '未经核对的候选' }] }))).status, 409);
  assert.equal((await f.req(path('research', 'experiences', 2), body())).status, 404);
  assert.equal(f.project().knowledge.length, 0); assert.equal(f.base.work.all('command').length, 0);
});

test('user-edited candidate adoption reuses the experience domain and retains exact immutable source provenance', async t => {
  const f = await fixture(t), candidate = (await f.req(path('research'))).data.candidates[0];
  const result = await f.req(path('research', 'experiences'), body({ accountId: 'dy-b', items: [{ candidateId: candidate.id, title: '用户核对后的标题', text: '先讲教师核对过程，再测试两个课堂问题开头。' }] }));
  assert.equal(result.status, 201); const entry = result.data.items[0]; assert.equal(entry.kind, 'experience'); assert.equal(entry.active, true); assert.equal(entry.accountId, 'dy-b'); assert.equal(entry.sourceType, 'work-artifact');
  assert.equal(entry.text, '先讲教师核对过程，再测试两个课堂问题开头。');
  assert.equal(entry.workSource.taskId, 'research-task'); assert.equal(entry.workSource.runId, 'research-run'); assert.equal(entry.workSource.artifactId, 'research'); assert.equal(entry.workSource.artifactVersion, 1);
  assert.equal(entry.workSource.projectId, f.projectId); assert.equal(entry.workSource.ownerId, actors.alpha.userId); assert.equal(entry.workSource.adoptedBy, actors.alpha.userId); assert.equal(entry.workSource.verification, 'unverified'); assert.equal(entry.workSource.edited, true); assert(Number.isFinite(Date.parse(entry.workSource.adoptedAt)));
  assert.equal(selectKnowledge(f.project(), { accountId: 'xhs-a', query: '课堂问题' }).entries.length, 0);
  assert.equal(selectKnowledge(f.project(), { accountId: 'dy-b', knowledgeIds: [entry.id], strict: true }).entries[0].id, entry.id);
  assert.equal(f.externalCalls, 0); assert.equal(f.privateReads, 0);
});

test('shared research is saved inactive until explicit activation and cannot silently influence all accounts', async t => {
  const f = await fixture(t), result = await f.req(path('research', 'experiences'), body({ scope: 'project', accountId: '' }));
  assert.equal(result.status, 201); const entry = result.data.items[0]; assert.equal(entry.accountId, ''); assert.equal(entry.active, false); assert.equal(entry.workSource.scope, 'project');
  for (const accountId of ['xhs-a', 'dy-b', '']) assert.equal(selectKnowledge(f.project(), { accountId, query: '课堂' }).entries.length, 0);
  f.base.mutate(state => updateKnowledge(state, state.projects[0], entry.id, { expectedRevision: entry.revision, active: true }));
  assert.equal(selectKnowledge(f.project(), { accountId: 'xhs-a', knowledgeIds: [entry.id], strict: true }).entries[0].id, entry.id);
});

test('account-specific copy experience cannot be promoted to shared scope or transferred to another account', async t => {
  const f = await fixture(t);
  assert.equal((await f.req(path('copy', 'experiences'), body({ scope: 'project', accountId: '' }))).status, 409);
  assert.equal((await f.req(path('copy', 'experiences'), body({ accountId: 'dy-b' }))).status, 409);
  assert.equal((await f.req(path('research', 'experiences'), body({ scope: 'project', accountId: 'xhs-a' }))).status, 400);
  assert.equal((await f.req(path('research', 'experiences'), body({ accountId: '' }))).status, 400);
  assert.equal((await f.req(path('research', 'experiences'), body({ accountId: 'deleted-account' }))).status, 409);
  const adopted = await f.req(path('copy', 'experiences'), body()); assert.equal(adopted.status, 201); assert.equal(adopted.data.items[0].workSource.artifactId, 'copy');
  assert.equal(f.project().knowledge.length, 1);
});

test('concurrent request replay and a new request key for identical adoption do not duplicate experience', async t => {
  const f = await fixture(t), input = body();
  const replies = await Promise.all([f.req(path('research', 'experiences'), input), f.req(path('research', 'experiences'), input)]);
  assert.deepEqual(replies.map(row => row.status).sort(), [200, 201]); assert.equal(replies[0].data.items[0].id, replies[1].data.items[0].id);
  const repeated = await f.req(path('research', 'experiences'), { ...input, requestId: randomUUID() }); assert.equal(repeated.status, 200); assert.equal(repeated.data.reused, true);
  assert.equal(f.project().knowledge.length, 1); assert.equal(f.project().contentRequests.length, 1);
  const changed = await f.req(path('research', 'experiences'), { ...input, items: [{ title: '更改内容', text: '该请求不能覆写上次确认内容。' }] }); assert.equal(changed.status, 409);
  assert.equal(f.project().knowledge.length, 1);
});

test('the same request UUID remains owner isolated and removed adopted records are not silently recreated', async t => {
  const f = await fixture(t), input = body(), first = await f.req(path('research', 'experiences'), input);
  const second = await f.req(path('foreign', 'experiences'), input, 'beta'); assert.equal(second.status, 201); assert.notEqual(first.data.items[0].id, second.data.items[0].id);
  assert.equal(f.project().contentRequests.length, 2); assert.notEqual(f.project().contentRequests[0].requestId, f.project().contentRequests[1].requestId);
  f.base.mutate(state => { state.projects[0].knowledge = state.projects[0].knowledge.filter(entry => entry.id !== first.data.items[0].id); });
  assert.equal((await f.req(path('research', 'experiences'), input)).status, 409); assert.equal(f.project().knowledge.length, 1);
});

test('replay cannot silently return an experience moved to a different account through the existing library editor', async t => {
  const f = await fixture(t), input = body(), saved = (await f.req(path('copy', 'experiences'), input)).data.items[0];
  f.base.mutate(state => updateKnowledge(state, state.projects[0], saved.id, { expectedRevision: saved.revision, accountId: 'dy-b' }));
  assert.equal((await f.req(path('copy', 'experiences'), input)).status, 409);
  assert.equal((await f.req(path('copy', 'experiences'), { ...input, requestId: randomUUID() })).status, 409);
  assert.equal(f.project().knowledge.length, 1);
});

test('batch capacity failure rolls back all knowledge, provenance and idempotency writes', async t => {
  const f = await fixture(t);
  f.base.mutate(state => { state.projects[0].knowledge = Array.from({ length: 299 }, (_, index) => ({ id: `existing-${index}`, kind: 'reference', title: '已有资料', text: '已有内容', accountId: '', revision: 1, active: false })); });
  const result = await f.req(path('research', 'experiences'), body({ items: [{ title: '第一条', text: '第一条待验证方法' }, { title: '第二条', text: '第二条待验证方法' }] }));
  assert.equal(result.status, 400); assert.equal(f.project().knowledge.length, 299); assert.equal(f.project().contentRequests.length, 0); assert.equal(f.base.work.all('command').length, 0);
});

test('idempotency storage failure rolls back domain writes and the same confirmed request can safely be retried', async t => {
  const f = await fixture(t), put = f.work.put, input = body();
  f.work.put = (kind, value) => { if (kind === 'command') throw Error('synthetic encrypted record write failure'); return put(kind, value); };
  assert.equal((await f.req(path('research', 'experiences'), input)).status, 500);
  assert.equal(f.project().knowledge.length, 0); assert.equal(f.project().contentRequests.length, 0); assert.equal(f.base.work.all('command').length, 0);
  f.work.put = put;
  assert.equal((await f.req(path('research', 'experiences'), input)).status, 201); assert.equal(f.project().knowledge.length, 1);
});

test('source project/task/run and account mismatches are rejected instead of adopting untraceable data', async t => {
  const f = await fixture(t), artifact = f.base.work.get('artifact', 'copy:1');
  f.base.work.put('artifact', { ...artifact, projectId: 'another-project' }); assert.equal((await f.req(path('copy'))).status, 409);
  f.base.work.put('artifact', { ...artifact, accountId: 'dy-b' }); assert.equal((await f.req(path('copy', 'experiences'), body({ accountId: 'dy-b' }))).status, 409);
  f.base.work.put('artifact', artifact); f.base.work.put('task', { ...f.base.work.get('task', artifact.taskId), ownerId: actors.beta.userId }); assert.equal((await f.req(path('copy'))).status, 409);
  assert.equal(f.project().knowledge.length, 0);
});
