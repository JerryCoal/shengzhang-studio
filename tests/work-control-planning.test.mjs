import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';
import { createKnowledge } from '../server/content-workflow.mjs';
import { installCreativeSkill } from '../server/creative-skills.mjs';

const ownerId = 'planning-control-owner';
const secret = 'SYNTHETIC_PLANNING_KEY_DO_NOT_EXPOSE';
const initial = () => ({ kind: 'proposal', goal: '为校园与品牌账号规划 AI 教育内容', question: '', nodes: [
  { id: 'copy', title: '校园 AI 教育图文', role: 'xiaohongshu-copy', accountId: 'xhs-a', connectionAccountId: '', requirement: '解释 AI 教师的辅助作用，不承诺教学效果', dependsOn: [] },
  { id: 'script', title: '品牌未来课堂脚本', role: 'douyin-script', accountId: 'dy-b', connectionAccountId: '', requirement: '用未来课堂问题引出教师核对过程', dependsOn: ['copy'] },
] });
const copy = { title: '未来课堂观察', body: '先明确学习问题，再请教师核对 AI 建议。这里仅呈现待审核文案。', prompt: '课堂场景构思，未生成图片。', scenes: ['提出问题', '教师核对', '保留讨论'] };
const response = (value, usage = { input_tokens: 150, output_tokens: 120 }) => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }], ...(usage ? { usage } : {}) });
function assertPublic(value) {
  const encoded = JSON.stringify(value);
  assert(!encoded.includes(secret));
  assert.doesNotMatch(encoded, /"(?:credentialFingerprint|connectionFingerprint|payload|apiKey|authorization|rawRequest|rawResponse)"\s*:/i);
}
async function until(predicate, describe) {
  const expires = Date.now() + 8000;
  while (Date.now() < expires) { const value = await predicate(); if (value) return value; await delay(5); }
  assert.fail(describe?.() || 'condition was not reached');
}

// createApp, planner, executor, encrypted work storage, admission and HTTP routes
// are real. All provider calls are injected and never reach an external server.
async function fixture(t, options = {}) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 71), scope: 'planning-http-integration' });
  let skillId, knowledgeId, allow = true, release;
  const gate = options.hold ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const modelCalls = [], businessCalls = [];
  store.mutate(state => {
    state.accounts = [{ id: 'xhs-a', name: '校园 A', platform: 'xiaohongshu' }, { id: 'dy-b', name: '品牌 B', platform: 'douyin', mcpAccountId: 'mock-reader' }];
    const project = state.projects[0]; project.brief.budgetUsd = 100; project.usage = []; state.contentRules = [];
    project.experiences = [{ id: 'selected-exp', active: true, insightId: 'shared', text: '先提出具体课堂问题。' }];
    knowledgeId = createKnowledge(state, project, { kind: 'reference', title: '课堂已核对事实', text: 'AI 仅作为辅助，教师负责核对。', accountId: 'xhs-a' }).id;
    skillId = installCreativeSkill(state, { fileName: 'SKILL.md', text: '---\nname: classroom-test\ndescription: 合成写作规则\nversion: 1.0.0\n---\n# classroom-test\n使用具体课堂问题开头，所有效果结论需要依据。', workflowId: 'copy-xiaohongshu', confirmed: true, expectedRevision: state.skillsRevision || 0 }).id;
  });
  const projectId = store.get().projects[0].id;
  const app = createApp(store, {
    workOwnerId: ownerId, authorizeWorkActor: actor => allow && actor.userId === ownerId,
    profileMode: true, apiKey: secret, modelStore: createModelStore(),
    glmVault: { status: () => ({ configured: true }), getKey: async () => secret },
    fetcher: async (url, init) => {
      const request = JSON.parse(init.body);
      if (String(url) === 'https://api.openai.com/v1/responses') {
        assert.equal(init.headers.Authorization, `Bearer ${secret}`);
        const payload = JSON.parse(request.input); assert(Array.isArray(payload.allowedAccounts), 'only controller planning uses this mock route');
        modelCalls.push({ request, payload }); await gate;
        if (options.unknown) throw Error('synthetic connection lost after dispatch');
        return response(options.output ? options.output(payload) : initial(), options.noUsage ? null : undefined);
      }
      assert.equal(String(url), 'https://open.bigmodel.cn/api/paas/v4/chat/completions', 'mock must never forward an unrecognized URL');
      const payload = JSON.parse(request.messages.find(row => row.role === 'user').content); businessCalls.push(payload);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(copy) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
    },
    mcpFetcher: async () => { assert.fail('planning is not authorized to read or publish through MCP'); },
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { release?.(); await app.locals.workControl.close(); await app.locals.integrations.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await result.json(); assertPublic(data); return { status: result.status, data };
  };
  const estimate = async (changes = {}) => {
    const result = await request(`/api/projects/${projectId}/planning/estimate`, { goal: '为校园 A 与品牌 B 规划 AI 教育图文和未来课堂脚本', accountIds: ['xhs-a', 'dy-b'], model: 'gpt-5.4-mini', ...changes });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
  };
  const start = async (quote, changes = {}) => request(`/api/projects/${projectId}/planning-runs`, { quoteId: quote.quoteId, planningBudgetUSD: 1, idempotencyKey: randomUUID(), ...changes });
  const run = id => store.work.get('run', id);
  const finished = id => until(() => ['succeeded', 'failed', 'paused', 'needs_reconciliation'].includes(run(id)?.status) && run(id), () => JSON.stringify(run(id)));
  const seedPlan = async () => {
    const nodes = initial().nodes.map((node, index) => ({ ...node, model: 'glm-4.7-flash', budgetUSD: index ? 0.27 : 0.42, ...(index ? {} : { knowledgeIds: [knowledgeId], experienceIds: ['selected-exp'], skillIds: [skillId] }) }));
    const created = await request(`/api/projects/${projectId}/work-plans`, { goal: '已确认的初始任务', nodes, idempotencyKey: randomUUID() });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const plan = created.data.plan;
    const approved = await request(`/api/work-plans/${plan.id}/approvals`, { version: plan.version, budgetUSD: 1, idempotencyKey: randomUUID() });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    await Promise.all(approved.data.runs.map(row => finished(row.id)));
    assert(approved.data.runs.every(row => run(row.id).status === 'succeeded'));
    return { plan: (await request(`/api/work-plans/${plan.id}`)).data.plan, task: approved.data.tasks.find(row => row.nodeId === 'copy') || approved.data.tasks[0], runs: approved.data.runs };
  };
  return { store, app, projectId, request, estimate, start, run, finished, modelCalls, businessCalls, seedPlan, release: () => release?.(), revoke: () => { allow = false; } };
}

test('real planning estimate, independent approval and concurrent replay produce only one unapproved plan', { timeout: 15000 }, async t => {
  const f = await fixture(t, { hold: true }), quote = await f.estimate();
  assert(quote.estimateUSD > 0); assert.equal(quote.scope, 'planning-only'); assert.equal(f.modelCalls.length, 0); assert.equal(f.store.work.all('run').length, 0);
  const idempotencyKey = randomUUID();
  const replies = await Promise.all([f.start(quote, { idempotencyKey }), f.start(quote, { idempotencyKey })]);
  assert(replies.every(result => result.status === 201)); assert.equal(replies[0].data.run.id, replies[1].data.run.id);
  const runId = replies[0].data.run.id; await until(() => f.modelCalls.length === 1);
  const running = f.run(runId); assert.equal(running.kind, 'planning'); assert.deepEqual(running.approval.permissions, ['model:planning']);
  assert.equal(running.approval.planningBudgetUSD, 1); assert.equal(running.input.planningBudgetUSD, 1); assert.equal(f.store.work.all('plan').length, 0);
  const reused = await f.start(quote); assert.equal(reused.status, 201); assert.equal(reused.data.run.id, runId);
  const changed = await f.start(quote, { idempotencyKey, planningBudgetUSD: 2 }); assert.equal(changed.status, 409);
  f.release(); assert.equal((await f.finished(runId)).status, 'succeeded');
  const detail = await f.request(`/api/planning-runs/${runId}`); assert.equal(detail.status, 200);
  assert.equal(detail.data.plan.status, 'draft'); assert.equal(detail.data.plan.planningMode, 'ai'); assert.equal(detail.data.plan.nodes.length, 2);
  assert(detail.data.plan.nodes.every(node => node.budgetUSD === 0));
  assert.equal(f.store.work.all('run').length, 1); assert.equal(f.store.work.all('task').length, 1); assert.equal(f.businessCalls.length, 0); assert.equal(f.modelCalls.length, 1);
  const task = (await f.request(`/api/tasks/${running.taskId}`)).data; assert.equal(task.artifacts[0].kind, 'plan'); assert.equal(task.artifacts[0].candidate, false);
  const usage = f.store.get().projects[0].usage; assert.equal(usage.length, 1); assert.equal(usage[0].planningRunId, runId); assert.equal(usage[0].runId, undefined); assert(usage[0].amountUsd > 0);
  assert.equal(detail.data.run.usage.settledUSD, usage[0].amountUsd);
});

test('planning quote is owner/project bound, expires once, and revoked members cannot start it', { timeout: 15000 }, async t => {
  const f = await fixture(t), quote = await f.estimate();
  const expired = f.store.work.get('planning-quote', quote.quoteId); expired.expiresAt = new Date(Date.now() - 1).toISOString(); f.store.work.put('planning-quote', expired);
  assert.equal((await f.start(quote)).status, 409);
  const foreign = await f.estimate(), record = f.store.work.get('planning-quote', foreign.quoteId); record.ownerId = 'another-user'; f.store.work.put('planning-quote', record);
  assert.equal((await f.start(foreign)).status, 404);
  const wrongProject = await f.estimate();
  assert.equal((await f.request('/api/projects/another-project/planning-runs', { quoteId: wrongProject.quoteId, planningBudgetUSD: 1, idempotencyKey: randomUUID() })).status, 409);
  const revoked = await f.estimate(); f.revoke(); assert.equal((await f.start(revoked)).status, 404);
  assert.equal(f.modelCalls.length, 0); assert.equal(f.store.work.all('run').length, 0); assert.equal(f.store.get().projects[0].usage.length, 0);
});

test('planning limit and project remaining budget both gate calls without borrowing business execution approval', { timeout: 15000 }, async t => {
  const f = await fixture(t), quote = await f.estimate();
  assert.equal((await f.start(quote, { planningBudgetUSD: 0 })).status, 400); assert.equal(f.store.work.all('run').length, 0);
  f.store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  const started = await f.start(quote); assert.equal(started.status, 201);
  const run = await f.finished(started.data.run.id); assert.equal(run.status, 'failed'); assert.match(run.error, /剩余预算/);
  assert.equal(run.sent, undefined); assert.equal(f.modelCalls.length, 0); assert.equal(f.store.get().projects[0].usage.length, 0);
});

test('a clarification answer saves a planning artifact but creates no business plan or business runs', { timeout: 15000 }, async t => {
  const f = await fixture(t, { output: () => ({ kind: 'question', goal: '需要确认目标', nodes: [], question: '这轮要面向教师还是学生？' }) }), quote = await f.estimate({ accountIds: [] });
  const started = await f.start(quote), run = await f.finished(started.data.run.id);
  assert.equal(run.status, 'succeeded'); assert.equal(f.store.work.all('plan').length, 0); assert.equal(f.store.work.all('run').length, 1);
  const detail = await f.request(`/api/planning-runs/${run.id}`); assert.equal(detail.data.question, '这轮要面向教师还是学生？'); assert.equal(detail.data.plan, undefined);
  assert.equal(f.businessCalls.length, 0); assert.deepEqual(f.modelCalls[0].payload.allowedAccounts, []);
});

test('pause after planning dispatch stores a candidate; only explicit adoption creates the draft', { timeout: 15000 }, async t => {
  const f = await fixture(t, { hold: true }), started = await f.start(await f.estimate()), runId = started.data.run.id;
  await until(() => f.modelCalls.length === 1);
  const paused = await f.request(`/api/task-runs/${runId}/commands`, { command: 'pause', expectedRevision: f.run(runId).revision, idempotencyKey: randomUUID() }); assert.equal(paused.status, 200);
  f.release(); const run = await f.finished(runId); assert.equal(run.status, 'paused'); assert.equal(f.store.work.all('plan').length, 0);
  const artifact = (await f.request(`/api/artifacts/${run.artifact.id}/versions/1`)).data.artifact; assert.equal(artifact.candidate, true); assert.equal(artifact.headVersion, 0);
  const idempotencyKey = randomUUID(), body = { expectedHeadVersion: 0, idempotencyKey };
  const adopted = await f.request(`/api/artifacts/${run.artifact.id}/versions/1/adopt`, body); assert.equal(adopted.status, 200, JSON.stringify(adopted.data));
  assert.equal(adopted.data.artifact.version, 2); assert.equal(adopted.data.run.status, 'succeeded');
  assert.equal((await f.request(`/api/artifacts/${run.artifact.id}/versions/1/adopt`, body)).status, 200);
  assert.equal(f.store.work.all('plan').length, 1); assert.equal(f.store.work.all('plan')[0].versions[0].status, 'draft');
  assert.equal(f.store.work.all('run').length, 1); assert.equal(f.modelCalls.length, 1); assert.equal(f.businessCalls.length, 0);
});

test('unknown planning completion holds its independent reservation and cannot be auto or casually retried', { timeout: 15000 }, async t => {
  const f = await fixture(t, { unknown: true }), quote = await f.estimate(), started = await f.start(quote), run = await f.finished(started.data.run.id);
  assert.equal(run.status, 'needs_reconciliation'); assert.equal(run.sent, true);
  await f.app.locals.workControl.tick(); await f.app.locals.workControl.tick();
  const retry = await f.request(`/api/task-runs/${run.id}/commands`, { command: 'retry', expectedRevision: run.revision, idempotencyKey: randomUUID() }); assert.equal(retry.status, 409);
  assert.equal(f.modelCalls.length, 1); assert.equal((await f.start(quote)).data.run.id, run.id); assert.equal(f.store.work.all('plan').length, 0);
  const usage = f.store.get().projects[0].usage[0]; assert.equal(usage.status, 'uncertain'); assert.equal(usage.amountUsd, quote.estimateUSD);
  assert.equal((await f.request(`/api/planning-runs/${run.id}`)).data.run.usage.unknownUSD, quote.estimateUSD);
});

test('partial AI revision preserves original per-task budget, model, knowledge, experience and Skills', { timeout: 15000 }, async t => {
  const f = await fixture(t, { output: payload => ({ kind: 'proposal', goal: payload.goal, question: '', nodes: [{ ...payload.context.currentTask, title: '新版课堂图文', requirement: '改为教师视角，保留已核对事实。' }] }) });
  const original = await f.seedPlan();
  f.store.work.put('message', { id: 'private-other-message', ownerId, taskId: original.runs[1].taskId, text: 'PRIVATE_OTHER_TASK_CHAT' });
  const quote = await f.estimate({ taskId: original.task.id, goal: '只把这条图文改成教师视角' }), started = await f.start(quote), run = await f.finished(started.data.run.id);
  assert.equal(run.status, 'succeeded', run.error);
  const plan = (await f.request(`/api/work-plans/${original.plan.id}`)).data.plan;
  assert.equal(plan.version, original.plan.version + 1); assert.equal(plan.status, 'draft'); assert.equal(f.store.work.all('plan').length, 1);
  const old = original.plan.nodes[0], revised = plan.nodes[0]; assert.equal(revised.requirement, '改为教师视角，保留已核对事实。');
  for (const field of ['budgetUSD', 'model', 'knowledgeIds', 'experienceIds', 'skillIds', 'accountId', 'role']) assert.deepEqual(revised[field], old[field], `partial revision must preserve ${field}`);
  assert.deepEqual(plan.nodes[1], original.plan.nodes[1]); assert.equal(f.businessCalls.length, 2); assert.equal(f.store.work.all('run').length, 3);
  const encoded = JSON.stringify(f.modelCalls[0].payload); assert(!encoded.includes('PRIVATE_OTHER_TASK_CHAT')); assert(!encoded.includes('selected-exp')); assert(!encoded.includes(old.skillIds[0]));
  assert.deepEqual(f.modelCalls[0].payload.context.currentTask.dependsOn, []);
});

test('revision based on an older plan forks a draft after in-flight user edits and never overwrites them', { timeout: 15000 }, async t => {
  const f = await fixture(t, { hold: true, output: payload => ({ kind: 'proposal', goal: payload.goal, question: '', nodes: [{ ...payload.context.currentTask, requirement: 'AI 基于旧快照的局部建议。' }] }) }), original = await f.seedPlan();
  const quote = await f.estimate({ taskId: original.task.id }), started = await f.start(quote); await until(() => f.modelCalls.length === 1);
  const changedNodes = original.plan.nodes.map(node => ({ ...node, ...(node.id === 'copy' ? { requirement: '用户在另一窗口修改的内容，不得覆盖。', budgetUSD: 0.88 } : {}) }));
  const changed = await f.request(`/api/work-plans/${original.plan.id}`, { expectedVersion: original.plan.version, goal: '用户新计划目标', nodes: changedNodes }, 'PATCH'); assert.equal(changed.status, 200);
  f.release(); const run = await f.finished(started.data.run.id); assert.equal(run.status, 'succeeded', run.error);
  const source = (await f.request(`/api/work-plans/${original.plan.id}`)).data.plan; assert.equal(source.goal, '用户新计划目标'); assert.equal(source.nodes[0].budgetUSD, 0.88); assert.equal(source.nodes[0].requirement, changedNodes[0].requirement);
  const fork = (await f.request(`/api/planning-runs/${run.id}`)).data.plan; assert.notEqual(fork.id, source.id); assert.deepEqual(fork.forkedFrom, { id: original.plan.id, version: original.plan.version }); assert.equal(fork.status, 'draft');
  assert.equal(fork.nodes[0].budgetUSD, original.plan.nodes[0].budgetUSD); assert.deepEqual(fork.nodes[0].skillIds, original.plan.nodes[0].skillIds);
  assert.equal(f.store.work.all('plan').length, 2); assert.equal(f.businessCalls.length, 2);
});

test('a source plan changed before planning confirmation invalidates its revision quote without spending', { timeout: 15000 }, async t => {
  const f = await fixture(t), original = await f.seedPlan(), quote = await f.estimate({ taskId: original.task.id });
  const changed = await f.request(`/api/work-plans/${original.plan.id}`, { expectedVersion: original.plan.version, goal: '重新核对', nodes: original.plan.nodes }, 'PATCH'); assert.equal(changed.status, 200);
  const rejected = await f.start(quote); assert.equal(rejected.status, 409); assert.equal(f.modelCalls.length, 0); assert.equal(f.store.work.all('run').length, 2);
});
