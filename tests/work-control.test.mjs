import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createStore } from '../server/store.mjs';
import { createWorkControl, redactWorkDetail } from '../server/work-control.mjs';
import { createWorkExecutors } from '../server/work-executors.mjs';
import { createModelStore } from '../server/models.mjs';
import { runWithActor } from '../server/request-actor.mjs';

const alpha = { userId: 'member-alpha', username: 'Alpha', role: 'editor' };
const beta = { userId: 'member-beta', username: 'Beta', role: 'editor' };
const as = (actor, work) => runWithActor(actor, work);
const copyNode = (patch = {}) => ({ id: 'copy', title: '校园小红书图文', role: 'xiaohongshu-copy', accountId: 'xhs-a', requirement: '校园 AI 课堂的合成测试需求', dependsOn: [], budgetUSD: 0, ...patch });
const researchNode = (patch = {}) => ({ id: 'research', title: '抖音同类研究', role: 'douyin-research', accountId: '', connectionAccountId: 'dy-b', requirement: '研究已批准的课堂案例', dependsOn: [], budgetUSD: 0, ...patch });
const scriptNode = (patch = {}) => ({ id: 'script', title: '品牌抖音脚本', role: 'douyin-script', accountId: 'dy-b', requirement: '根据研究写脚本', dependsOn: ['research'], budgetUSD: 0, ...patch });
const resultFor = (run, body = `合成成果 ${run.node.id}`) => ({ kind: run.node.role === 'douyin-research' ? 'research' : run.node.role === 'douyin-script' ? 'script' : 'copy', title: run.node.title, body });
async function until(predicate, message) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await nextTurn(); }
  assert(predicate(), typeof message === 'function' ? message() : message || 'expected asynchronous condition');
}
function fixture(t, options = {}) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 71), scope: 'synthetic-control' });
  store.mutate(state => {
    state.accounts = [{ id: 'xhs-a', name: '校园号 A', platform: 'xiaohongshu', creationProfile: { revision: 1, identityMarkdown: '固定身份 A', identityFileName: '', presets: [], defaultPresetId: '' } }, { id: 'xhs-other', name: '其他号', platform: 'xiaohongshu' }, { id: 'dy-b', name: '品牌号 B', platform: 'douyin' }];
    state.projects[0].brief.budgetUsd = 100;
  });
  const projectId = store.get().projects[0].id, calls = [], pending = new Map(), allowed = new Set([alpha.userId, beta.userId]);
  const executors = {
    prepare({ state, node }) { return { ...structuredClone(node), modelRoute: { model: 'fake-model', provider: 'fake-provider' }, estimateUSD: 0, permissions: ['model:copy'], account: structuredClone(state.accounts.find(a => a.id === node.accountId) || null) }; },
    execute(context) {
      calls.push(context);
      if (options.execute) return options.execute(context);
      return new Promise((resolve, reject) => pending.set(context.run.id, { resolve, reject, context }));
    },
  };
  const runtime = createWorkControl({ store, executors, config: { authorizeWorkActor: actor => allowed.has(actor.userId) }, ...options.runtime });
  const plan = (nodes = [copyNode()], actor = alpha, key = `create-${crypto.randomUUID()}`) => as(actor, () => runtime.createPlan(projectId, { goal: '合成多账号计划', nodes, idempotencyKey: key }).plan);
  const approve = (value, actor = alpha, key = `approve-${crypto.randomUUID()}`) => as(actor, () => runtime.approvePlan(value.id, { version: value.version, budgetUSD: 0, idempotencyKey: key }));
  const settle = (runId, body) => { const item = pending.get(runId); assert(item, `run ${runId} was not dispatched`); pending.delete(runId); item.resolve(resultFor(item.context.run, body)); };
  t.after(async () => {
    const closing = runtime.close();
    for (const [runId, item] of pending) { pending.delete(runId); item.resolve(resultFor(item.context.run)); }
    await closing; store.close();
  });
  return { store, projectId, calls, pending, allowed, runtime, executors, plan, approve, settle, run: id => store.work.get('run', id) };
}

test('three approved tasks run independent work in parallel and bind the dependent script to one saved research version', async t => {
  const f = fixture(t), draft = f.plan([copyNode(), researchNode(), scriptNode()]);
  assert.equal(f.calls.length, 0); assert.equal(f.store.work.all('run').length, 0);
  const approval = await f.approve(draft), byNode = Object.fromEntries(approval.runs.map(run => [run.node.id, run.id]));
  await until(() => f.calls.length === 2); assert.deepEqual(new Set(f.calls.map(call => call.run.node.id)), new Set(['copy', 'research']));
  assert.equal(f.run(byNode.script).status, 'waiting_dependencies');
  f.settle(byNode.research, '研究版本一：三条有来源的观察');
  await until(() => f.calls.length === 3);
  const script = f.calls.find(call => call.run.node.id === 'script'); assert.equal(script.dependencies.length, 1);
  assert.equal(script.dependencies[0].version, 1); assert.equal(script.dependencies[0].body, '研究版本一：三条有来源的观察');
  assert.equal(f.run(byNode.copy).status, 'running');
  f.settle(byNode.script); f.settle(byNode.copy);
  await until(() => approval.runs.every(run => f.run(run.id).status === 'succeeded'), () => JSON.stringify(approval.runs.map(run => ({ status: f.run(run.id).status, error: f.run(run.id).error }))));
  assert.equal(f.store.work.all('notification').length, 3);
  for (const run of approval.runs) {
    const final = f.run(run.id), artifact = f.store.work.get('artifact', `${final.artifact.id}:${final.artifact.version}`);
    assert(artifact?.body); assert.equal(f.store.work.all('notification').find(n => n.target.runId === run.id).target.artifactVersion, 1);
    assert.deepEqual(f.store.work.events(run.id).map(e => e.sequence), Array.from({ length: f.store.work.cursor(run.id) }, (_, index) => index + 1));
  }
});

test('plan creation and concurrent approval are idempotent while the same client keys remain isolated between members', async t => {
  const f = fixture(t), draft = f.plan([copyNode()], alpha, 'same-create-key');
  assert.equal(f.plan([copyNode()], alpha, 'same-create-key').id, draft.id);
  assert.throws(() => f.plan([copyNode({ requirement: 'changed' })], alpha, 'same-create-key'), /内容发生变化/);
  const other = f.plan([copyNode()], beta, 'same-create-key'); assert.notEqual(other.id, draft.id);
  const [first, repeated] = await Promise.all([f.approve(draft, alpha, 'same-approval-key'), f.approve(draft, alpha, 'same-approval-key')]);
  assert.deepEqual(first.runs.map(run => run.id), repeated.runs.map(run => run.id));
  await f.approve(other, beta, 'same-approval-key'); await until(() => f.calls.length === 2);
  assert.equal(f.store.work.all('run').length, 2);
  assert.throws(() => as(beta, () => f.runtime.taskDetail(first.tasks[0].id)), error => error.status === 404);
});

test('approval freezes account identity and model input despite later account selection and profile changes', async t => {
  const f = fixture(t), approved = await f.approve(f.plan()); await until(() => f.calls.length === 1);
  f.store.mutate(state => { state.activeCreationAccounts = { xiaohongshu: 'xhs-other' }; state.accounts[0].name = '新名称'; state.accounts[0].creationProfile.identityMarkdown = '已改变的身份'; });
  const call = f.calls[0]; assert.equal(call.run.node.accountId, 'xhs-a'); assert.equal(call.input.account.name, '校园号 A'); assert.equal(call.input.account.creationProfile.identityMarkdown, '固定身份 A');
  f.settle(approved.runs[0].id); await until(() => f.run(approved.runs[0].id).status === 'succeeded');
  const artifact = as(alpha, () => f.runtime.taskDetail(approved.tasks[0].id)).artifacts[0]; assert.equal(artifact.accountId, 'xhs-a');
  const legacy = f.store.get().projects[0].assets.find(asset => asset.id === artifact.legacy.assetId); assert.equal(legacy.contentBrief.accountId, 'xhs-a');
});

test('revoked queued members do not dispatch while another member finishes independently', async t => {
  const f = fixture(t, { runtime: { concurrency: 1 } }), one = await f.approve(f.plan()); await until(() => f.calls.length === 1);
  const two = await f.approve(f.plan([copyNode({ id: 'beta-copy' })], beta), beta); f.allowed.delete(beta.userId);
  f.settle(one.runs[0].id); await until(() => f.run(two.runs[0].id).status === 'waiting_user');
  assert.equal(f.calls.length, 1); assert.equal(f.run(one.runs[0].id).status, 'succeeded');
  assert.throws(() => as(beta, () => f.runtime.taskDetail(two.tasks[0].id)), error => error.status === 404);
});

test('unknown external outcomes retain the attempt and never auto-retry or accept an untrue not-sent reconciliation', async t => {
  const f = fixture(t, { execute: async ({ markSent }) => { markSent({ provider: 'fake', externalRequestId: 'synthetic-receipt' }); throw new Error('connection lost after dispatch'); } });
  const approved = await f.approve(f.plan()), runId = approved.runs[0].id;
  await until(() => f.run(runId).status === 'needs_reconciliation'); await f.runtime.tick(); f.runtime.recover();
  assert.equal(f.calls.length, 1); const run = f.run(runId); assert(run.sent); assert(run.attempts[0].sentAt);
  for (const command of ['retry', 'cancel']) assert.throws(() => as(alpha, () => f.runtime.commands(runId, { command, expectedRevision: run.revision, idempotencyKey: `unknown-${command}` })), error => error.status === 409);
  assert.throws(() => as(alpha, () => f.runtime.commands(runId, { command: 'reconcile', resolution: 'not_sent', expectedRevision: run.revision, idempotencyKey: 'unknown-not-sent' })), /不能声明未发送/);
  const kept = as(alpha, () => f.runtime.commands(runId, { command: 'reconcile', resolution: 'keep_unknown', expectedRevision: run.revision, idempotencyKey: 'unknown-keep-result' }));
  assert.equal(kept.run.status, 'needs_reconciliation'); assert.equal(f.calls.length, 1);
});

test('explicit retry advances the task head and a fresh key cannot retry the same historical run twice', async t => {
  let count = 0;
  const f = fixture(t, { execute: async ({ run }) => { if (++count === 1) throw Object.assign(Error('synthetic validation rejected before dispatch'), { noCharge: true }); return resultFor(run); } });
  const approved = await f.approve(f.plan()), originalId = approved.runs[0].id;
  await until(() => f.run(originalId).status === 'failed');
  const body = { command: 'retry', expectedRevision: f.run(originalId).revision, idempotencyKey: 'retry-original-once' };
  const retried = as(alpha, () => f.runtime.commands(originalId, body)); assert.notEqual(retried.run.id, originalId);
  assert.equal(as(alpha, () => f.runtime.commands(originalId, body)).run.id, retried.run.id);
  assert.throws(() => as(alpha, () => f.runtime.commands(originalId, { ...body, idempotencyKey: 'retry-original-again' })), /后继|最新|旧记录/);
  await until(() => f.run(retried.run.id).status === 'succeeded');
  assert.equal(f.calls.length, 2); assert.equal(f.store.work.all('run').length, 2);
  assert.equal(f.store.work.get('task', approved.tasks[0].id).latestRunId, retried.run.id);
});

test('real executor retry cannot spend beyond its original plan after an unknown billed attempt', async t => {
  const f = fixture(t); let requests = 0;
  const config = { apiKey: 'synthetic-budget-only-key', modelStore: createModelStore(), authorizeWorkActor: actor => actor.userId === alpha.userId,
    workFetcher: async url => { assert.equal(String(url), 'https://api.openai.com/v1/responses'); requests++; throw Error('synthetic response lost after send'); } };
  Object.assign(f.executors, createWorkExecutors({ store: f.store, config }));
  const node = copyNode({ model: 'gpt-5.4-mini', budgetUSD: 1 }), state = f.store.get();
  const estimate = f.executors.prepare({ state, project: state.projects[0], node }).estimateUSD; assert(estimate > 0);
  node.budgetUSD = estimate; const draft = f.plan([node]);
  const approved = await as(alpha, () => f.runtime.approvePlan(draft.id, { version: draft.version, budgetUSD: estimate, idempotencyKey: 'budget-initial-approval' }));
  const originalId = approved.runs[0].id; await until(() => f.run(originalId).status === 'needs_reconciliation');
  assert.equal(requests, 1); assert.equal(f.store.get().projects[0].usage.at(-1).status, 'uncertain');
  const reconciled = as(alpha, () => f.runtime.commands(originalId, { command: 'reconcile', resolution: 'confirmed_failed', expectedRevision: f.run(originalId).revision, idempotencyKey: 'budget-confirm-original-failed' })).run;
  const retry = as(alpha, () => f.runtime.commands(originalId, { command: 'retry', expectedRevision: reconciled.revision, idempotencyKey: 'budget-explicit-retry' })).run;
  await until(() => f.run(retry.id).status === 'failed', () => JSON.stringify(f.run(retry.id)));
  const stopped = f.run(retry.id); assert.match(stopped.error, /累计批准额度/); assert.equal(stopped.sent, false); assert.equal(stopped.attempts[0].sentAt, undefined);
  assert.equal(requests, 1, 'the real provider transport must not be called for the over-budget retry');
  const usage = f.store.get().projects[0].usage.filter(row => [originalId, retry.id].includes(row.runId));
  assert.equal(usage.length, 2); assert.equal(usage[0].status, 'uncertain'); assert.equal(usage[0].amountUsd, estimate);
  assert.equal(usage[1].status, 'failed'); assert.equal(usage[1].amountUsd, 0, 'only the definitely unsent retry reservation is released');
  assert.equal(usage.reduce((sum, row) => sum + row.amountUsd, 0), estimate);
});

for (const priorStatus of ['running', 'completed', 'uncertain', 'failed']) test(`plan cumulative guard includes ${priorStatus} ledger cost before dispatch`, async t => {
  let sends = 0;
  const f = fixture(t, { execute: async ({ run, markSent }) => {
    const previousId = `historical-${priorStatus}`;
    f.store.work.put('run', { ...run, id: previousId, status: 'failed' });
    f.store.mutate(state => { state.projects[0].usage.push({ id: `${previousId}-usage`, runId: previousId, status: priorStatus, amountUsd: 0.6 }, { id: 'new-reservation', runId: run.id, status: 'running', amountUsd: 0.6 }); });
    try { markSent({ provider: 'fake', usageId: 'new-reservation' }); sends++; return resultFor(run); }
    catch (error) { assert.equal(error.noCharge, true); f.store.mutate(state => { Object.assign(state.projects[0].usage.find(row => row.id === 'new-reservation'), { amountUsd: 0, status: 'failed' }); }); throw error; }
  } });
  const draft = f.plan([copyNode({ budgetUSD: 1 })]), approval = await as(alpha, () => f.runtime.approvePlan(draft.id, { version: draft.version, budgetUSD: 1, idempotencyKey: `budget-${priorStatus}-approval` })), runId = approval.runs[0].id;
  await until(() => f.run(runId).status === 'failed'); assert.match(f.run(runId).error, /累计批准额度/); assert.equal(f.run(runId).sent, undefined);
  assert.equal(sends, 0); assert.equal(f.store.work.events(runId).filter(row => row.type === 'invocation.sent').length, 0);
});

test('plan cumulative guard excludes other owners, plans, versions and separately approved planning cost', async t => {
  let sends = 0;
  const f = fixture(t, { execute: async ({ run, markSent }) => {
    const others = [
      { id: 'other-owner', ownerId: beta.userId }, { id: 'other-plan', planId: 'another-plan' },
      { id: 'other-version', planVersion: run.planVersion + 1 }, { id: 'planning-only', kind: 'planning' },
    ];
    for (const other of others) f.store.work.put('run', { ...run, ...other, status: 'succeeded' });
    f.store.mutate(state => { state.projects[0].usage.push(...others.map(other => ({ id: `${other.id}-usage`, runId: other.id, status: 'uncertain', amountUsd: 10 })), { id: 'own-reservation', runId: run.id, status: 'running', amountUsd: 0.6 }); });
    markSent({ provider: 'fake', usageId: 'own-reservation' }); sends++;
    f.store.mutate(state => { state.projects[0].usage.find(row => row.id === 'own-reservation').status = 'completed'; }); return resultFor(run);
  } });
  const draft = f.plan([copyNode({ budgetUSD: 1 })]), approval = await as(alpha, () => f.runtime.approvePlan(draft.id, { version: draft.version, budgetUSD: 1, idempotencyKey: 'budget-scoped-approval' })), runId = approval.runs[0].id;
  await until(() => f.run(runId).status === 'succeeded', () => JSON.stringify(f.run(runId))); assert.equal(sends, 1);
});

test('a disabled provider persists a bounded wait and moves to pause instead of waiting automatically forever', async t => {
  const f = fixture(t, { runtime: { config: { authorizeWorkActor: actor => actor.userId === alpha.userId, workProviderLimits: { 'fake-provider': 0 } } } });
  const approved = await f.approve(f.plan()), runId = approved.runs[0].id;
  await until(() => !!f.run(runId).wait);
  const first = f.run(runId); assert.equal(first.status, 'queued'); assert.equal(first.wait.code, 'WORK_RATE_GATE');
  assert(first.wait.nextEligibleAt > first.wait.firstWaitAt); assert(first.wait.deadlineAt > first.wait.nextEligibleAt); assert(first.wait.deadlineAt - first.wait.firstWaitAt <= 120000);
  await f.runtime.tick(); assert.deepEqual(f.run(runId).wait, first.wait, 'polling does not extend the wait deadline or consume an attempt');
  const past = Date.now() - 1000; first.wait = { ...first.wait, firstWaitAt: past - 10000, nextEligibleAt: past - 500, deadlineAt: past }; f.store.work.put('run', first);
  await f.runtime.tick(); const stopped = f.run(runId); assert.equal(stopped.status, 'paused'); assert.match(stopped.waitReason, /时限|时间变化/);
  assert.equal(stopped.sent, undefined); assert.equal(stopped.attempts.length, 0); assert.equal(f.calls.length, 0);
  assert.equal(f.store.work.all('notification').length, 1);
});

test('pre-dispatch provider waiting never skips the dependency gate after the provider opens', async t => {
  const config = { authorizeWorkActor: actor => actor.userId === alpha.userId, workProviderLimits: { 'fake-provider': 0 } };
  const f = fixture(t, { runtime: { config } }), approved = await f.approve(f.plan([copyNode(), scriptNode({ dependsOn: ['copy'] })]));
  const ids = Object.fromEntries(approved.runs.map(run => [run.node.id, run.id]));
  await until(() => !!f.run(ids.copy).wait);
  assert.equal(f.run(ids.script).status, 'waiting_dependencies');
  config.workProviderLimits['fake-provider'] = 2;
  for (const row of approved.runs) { const run = f.run(row.id); if (run.wait) { run.wait.firstWaitAt -= 1000; run.wait.nextEligibleAt = Date.now() - 1; f.store.work.put('run', run); } }
  await f.runtime.tick(); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].run.node.id, 'copy'); assert.equal(f.run(ids.script).status, 'waiting_dependencies');
  f.settle(ids.copy, '上游交付的固定正文'); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].dependencies[0].body, '上游交付的固定正文'); f.settle(ids.script);
  await until(() => f.run(ids.script).status === 'succeeded');
});

test('events redact secrets and private reasoning while preserving ordered factual execution activity', async t => {
  const f = fixture(t, { execute: async ({ run, emit, markSent }) => {
    emit('skill.loaded', 'Loaded approved rule', { skillId: 'skill-a', apiKey: 'private-key', cookie: 'private-cookie', prompt: 'PRIVATE_PROMPT', reasoning: 'PRIVATE_REASONING', nested: { authorization: 'private-auth', safe: 'summary' } });
    markSent({ provider: 'fake', url: 'https://service.test?token=PRIVATE_TOKEN', detail: 'Bearer PRIVATE_BEARER_VALUE', externalRequestId: 'receipt-one' });
    return resultFor(run);
  } });
  const approved = await f.approve(f.plan()); await until(() => f.run(approved.runs[0].id).status === 'succeeded');
  const events = f.store.work.events(approved.runs[0].id), serialized = JSON.stringify(events);
  for (const secret of ['private-key', 'private-cookie', 'PRIVATE_PROMPT', 'PRIVATE_REASONING', 'private-auth', 'PRIVATE_TOKEN', 'PRIVATE_BEARER_VALUE']) assert(!serialized.includes(secret), secret);
  assert(serialized.includes('skill-a')); assert(serialized.includes('receipt-one'));
  assert.deepEqual(redactWorkDetail({ safe: 'allowed', instructions: 'hidden', rawResponse: 'hidden' }), { safe: 'allowed' });
});

test('changed plan versions reuse unrelated completed runs and rerun only the changed dependency chain', async t => {
  const f = fixture(t, { execute: async ({ run }) => resultFor(run) });
  const draft = f.plan([copyNode(), researchNode(), scriptNode()]), first = await f.approve(draft);
  await until(() => first.runs.every(run => f.run(run.id).status === 'succeeded'));
  const next = as(alpha, () => f.runtime.updatePlan(draft.id, { expectedVersion: 1, goal: '只调整研究问题', nodes: [copyNode(), researchNode({ requirement: '新增研究问题' }), scriptNode()] }).plan);
  assert.equal(next.version, 2); assert.equal(next.status, 'draft'); assert.equal(f.calls.length, 3);
  assert.equal(next.versions[0].status, 'approved');
  const second = await f.approve(next);
  await until(() => second.runs.every(run => f.run(run.id).status === 'succeeded'));
  const old = Object.fromEntries(first.runs.map(run => [run.node.id, run.id])), current = Object.fromEntries(second.runs.map(run => [run.node.id, run.id]));
  assert.equal(current.copy, old.copy); assert.notEqual(current.research, old.research); assert.notEqual(current.script, old.script); assert.equal(f.calls.length, 5);
  assert.equal(f.run(old.research).planVersion, 1); assert.equal(f.run(current.research).planVersion, 2);
});

test('late generated results become immutable candidates instead of overwriting a user-edited artifact head', async t => {
  const f = fixture(t), draft = f.plan(), first = await f.approve(draft); await until(() => f.calls.length === 1);
  f.settle(first.runs[0].id, '初版正文'); await until(() => f.run(first.runs[0].id).status === 'succeeded');
  const original = as(alpha, () => f.runtime.taskDetail(first.tasks[0].id)).artifacts[0];
  const planTwo = as(alpha, () => f.runtime.updatePlan(draft.id, { expectedVersion: 1, goal: '重新写作', nodes: [copyNode({ requirement: '第二次写作的批准需求' })] }).plan);
  const second = await f.approve(planTwo); await until(() => f.calls.length === 2);
  const edit = as(alpha, () => f.runtime.editArtifact(original.id, 1, { title: '人工编辑标题', body: '用户正在使用的编辑正文', expectedHeadVersion: 1, idempotencyKey: 'manual-edit-version-two' })).artifact;
  assert.equal(edit.version, 2);
  assert.throws(() => as(alpha, () => f.runtime.editArtifact(original.id, 1, { title: '旧编辑', body: '不能覆盖', expectedHeadVersion: 1, idempotencyKey: 'stale-editor-write' })), /另一处更新/);
  f.settle(second.runs[0].id, '迟到的第二次生成正文'); await until(() => f.run(second.runs[0].id).status === 'waiting_user');
  const detail = as(alpha, () => f.runtime.taskDetail(first.tasks[0].id)); assert.deepEqual(detail.artifacts.map(a => a.version), [3, 2, 1]);
  assert.equal(detail.artifacts[0].candidate, true); assert.equal(f.store.work.get('artifact-head', original.id).version, 2); assert.equal(detail.artifacts[1].body, '用户正在使用的编辑正文');
  assert.equal(f.run(first.runs[0].id).artifact.version, 1);
});

test('legacy journal checkpoints migrate once as untrusted evidence and do not dispatch work', async t => {
  const f = fixture(t);
  f.store.mutate(state => { state.taskJournal = [{ id: 'old-checkpoint', projectId: f.projectId, accountId: 'xhs-a', label: '旧前端任务', status: 'running', startedAt: Date.now() }]; });
  as(alpha, () => f.runtime.migrateLegacy()); as(alpha, () => f.runtime.migrateLegacy()); await f.runtime.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.store.work.all('run').length, 1);
  const run = f.store.work.all('run')[0]; assert.equal(run.source, 'legacy-checkpoint'); assert.equal(run.status, 'needs_reconciliation');
  assert.equal(f.store.work.events(run.id).length, 1); assert.equal(f.store.get().taskJournal[0].status, 'running');
});

test('invalid dependency graphs and mismatched accounts fail before any execution or persistent approval', t => {
  const f = fixture(t);
  assert.throws(() => f.plan([copyNode({ dependsOn: ['copy'] })]), /循环/);
  assert.throws(() => f.plan([scriptNode()]), /不存在/);
  assert.throws(() => f.plan([copyNode({ accountId: 'dy-b' })]), /平台不匹配/);
  assert.throws(() => f.plan([copyNode({ accountId: '' })]), /目标账号/);
  assert.equal(f.store.work.all('plan').length, 0); assert.equal(f.calls.length, 0);
});

test('revocation during a running preflight is rechecked at the next external dispatch boundary', async t => {
  const f = fixture(t), approved = await f.approve(f.plan()); await until(() => f.calls.length === 1);
  f.allowed.delete(alpha.userId);
  assert.throws(() => f.calls[0].markSent({ provider: 'fake', externalRequestId: 'must-not-dispatch' }), error => error.status === 403);
  assert.equal(!!f.run(approved.runs[0].id).sent, false);
});

test('legacy editor provenance uses the approved frozen account profile instead of a later profile edit', async t => {
  const f = fixture(t), approved = await f.approve(f.plan()); await until(() => f.calls.length === 1);
  f.store.mutate(state => { state.accounts[0].creationProfile.identityMarkdown = 'LATER_PROFILE_NOT_USED_FOR_GENERATION'; state.accounts[0].creationProfile.revision++; });
  f.settle(approved.runs[0].id); await until(() => f.run(approved.runs[0].id).status === 'succeeded');
  const artifact = as(alpha, () => f.runtime.taskDetail(approved.tasks[0].id)).artifacts[0];
  const legacy = f.store.get().projects[0].assets.find(asset => asset.id === artifact.legacy.assetId);
  assert.equal(legacy.creationTrace.accounts[0].identityMarkdown, '固定身份 A');
});

test('an outbox save fault rolls back completion and explicit receipt recovery saves once without another external request', async t => {
  const f = fixture(t, { execute: async ({ run, markSent }) => { markSent({ provider: 'fake', externalRequestId: 'received-once' }); return resultFor(run, '已收到的唯一外部结果'); } });
  const put = f.store.work.put.bind(f.store.work), beforeAssets = f.store.get().projects[0].assets.length; let failOnce = true;
  f.store.work.put = (kind, value) => { if (kind === 'notification' && value.type === 'completed' && failOnce) { failOnce = false; throw new Error('synthetic-outbox-save-fault'); } return put(kind, value); };
  const approved = await f.approve(f.plan()), runId = approved.runs[0].id;
  await until(() => f.run(runId).status === 'needs_reconciliation');
  assert.equal(f.store.work.all('artifact').length, 0); assert.equal(f.store.get().projects[0].assets.length, beforeAssets);
  assert.equal(f.run(runId).checkpoint.type, 'result_ready'); assert.equal(f.calls.length, 1);
  assert(!f.store.work.events(runId).some(event => event.type === 'artifact.saved'));
  const result = as(alpha, () => f.runtime.commands(runId, { command: 'reconcile', resolution: 'save_receipt', expectedRevision: f.run(runId).revision, idempotencyKey: 'save-known-receipt' }));
  assert.equal(result.run.status, 'succeeded'); assert.equal(f.calls.length, 1); assert.equal(f.store.work.all('artifact').length, 1);
  assert.equal(f.store.get().projects[0].assets.length, beforeAssets + 1);
  assert.equal(f.store.work.all('notification').filter(item => item.type === 'completed').length, 1);
});

test('cancel during an external request preserves its later receipt as a candidate without cancelling unrelated tasks', async t => {
  const f = fixture(t), approved = await f.approve(f.plan([copyNode(), researchNode()])); await until(() => f.calls.length === 2);
  const copy = approved.runs.find(run => run.node.id === 'copy'), research = approved.runs.find(run => run.node.id === 'research');
  f.calls.find(call => call.run.id === copy.id).markSent({ provider: 'fake', externalRequestId: 'late-after-cancel' });
  const stopped = as(alpha, () => f.runtime.commands(copy.id, { command: 'cancel', expectedRevision: f.run(copy.id).revision, idempotencyKey: 'cancel-one-only' }));
  assert.equal(stopped.run.status, 'running'); assert.equal(stopped.run.requestedAction, 'cancel');
  f.settle(copy.id); f.settle(research.id); await until(() => f.run(copy.id).status === 'cancelled' && f.run(research.id).status === 'succeeded');
  const artifact = as(alpha, () => f.runtime.taskDetail(copy.taskId)).artifacts[0]; assert.equal(artifact.candidate, true); assert.equal(f.store.work.get('artifact-head', copy.taskId).version, 0);
});

test('a second scheduler respects the live lease and cannot claim the same external execution', async t => {
  const f = fixture(t), approved = await f.approve(f.plan()); await until(() => f.calls.length === 1);
  const original = f.run(approved.runs[0].id), second = createWorkControl({ store: f.store, executors: f.executors });
  try { second.recover(); await second.tick(); assert.equal(f.calls.length, 1); assert.equal(f.run(original.id).lease.token, original.lease.token); }
  finally { await second.close(); }
});

test('restart recovery separates unsent interruption, unknown sent calls and an already received result', async t => {
  const f = fixture(t, { runtime: { autoStart: false } });
  const approved = await f.approve(f.plan([copyNode(), researchNode(), scriptNode({ dependsOn: [] })]));
  for (const [index, saved] of approved.runs.entries()) {
    const run = f.run(saved.id); run.status = 'running'; run.sent = index !== 0; run.attemptId = `synthetic-attempt-${index}`;
    run.attempts = [{ id: run.attemptId, sentAt: index !== 0 ? '2026-10-20T00:00:00Z' : undefined }];
    run.lease = { workerId: 'terminated-worker', token: `old-fence-${index}`, expiresAt: 1 };
    if (index === 2) run.checkpoint = { type: 'result_ready', result: resultFor(run, 'crash-before-save-result') };
    f.store.work.put('run', run);
  }
  f.runtime.recover(); f.runtime.recover();
  assert.deepEqual(approved.runs.map(run => f.run(run.id).status), ['paused', 'needs_reconciliation', 'succeeded']);
  assert.equal(f.calls.length, 0); assert.equal(f.store.work.all('artifact').length, 1);
  assert.equal(f.store.work.all('notification').filter(item => item.type === 'completed').length, 1);
  assert.equal(f.store.work.events(approved.runs[2].id).filter(event => event.type === 'artifact.saved').length, 1);
});

test('credential-shaped token fields never enter activity details or nested receipt data', () => {
  const output = redactWorkDetail({ accessToken: 'ACCESS_TOKEN_PRIVATE', refresh_token: 'REFRESH_TOKEN_PRIVATE', bearerToken: 'BEARER_TOKEN_PRIVATE', sessionToken: 'SESSION_TOKEN_PRIVATE', headers: { 'X-Api-Key': 'CUSTOM_HEADER_PRIVATE', Authorization: 'Bearer hidden' }, externalRequestId: 'safe-request-id' });
  const serialized = JSON.stringify(output);
  for (const secret of ['ACCESS_TOKEN_PRIVATE', 'REFRESH_TOKEN_PRIVATE', 'BEARER_TOKEN_PRIVATE', 'SESSION_TOKEN_PRIVATE', 'CUSTOM_HEADER_PRIVATE']) assert(!serialized.includes(secret), secret);
  assert(serialized.includes('safe-request-id'));
});
