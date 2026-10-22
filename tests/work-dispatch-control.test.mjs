import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { createWorkControl } from '../server/work-control.mjs';
import { runWithActor } from '../server/request-actor.mjs';
const alpha = { userId: 'dispatch-alpha', role: 'editor' }, beta = { userId: 'dispatch-beta', role: 'editor' }, as = callback => runWithActor(alpha, callback);
const copy = (patch = {}) => ({ id: 'copy', title: '本次文案', role: 'xiaohongshu-copy', accountId: 'xhs-a', requirement: '原始任务指令', dependsOn: [], budgetUSD: 0, ...patch });
const research = () => ({ id: 'research', title: '本次研究', role: 'douyin-research', accountId: '', connectionAccountId: 'dy-a', requirement: '研究公开资料', dependsOn: [], budgetUSD: 0 });
function fixture(t, options = {}) {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 91), scope: 'synthetic-dispatch' });
  store.mutate(state => { state.accounts = [{ id: 'xhs-a', name: '账号甲', platform: 'xiaohongshu' }, { id: 'xhs-b', name: '账号乙', platform: 'xiaohongshu' }, { id: 'dy-a', name: '研究连接', platform: 'douyin' }]; });
  const projectId = store.get().projects[0].id, counts = { prepare: 0, connection: 0, execute: 0 }; let skillVersion = '1';
  const executors = {
    prepare({ node }) { counts.prepare++; return { ...structuredClone(node), projectId, modelRoute: { model: node.model || 'synthetic-model', provider: 'synthetic' }, estimateUSD: 0.2, permissions: ['model:copy'], skills: node.skillIds.map(id => ({ id, name: id, version: skillVersion })), payload: { requirement: node.requirement } }; },
    async prepareConnection(context) { counts.connection++; if (options.connection) return options.connection(context); return { credentialProvider: 'synthetic', credentialFingerprint: 'local-test-fingerprint' }; },
    async execute() { counts.execute++; throw Error('this contract fixture must not execute'); },
  };
  const runtime = createWorkControl({ store, executors, autoStart: false, config: { authorizeWorkActor: actor => [alpha.userId, beta.userId].includes(actor.userId) } });
  t.after(async () => { await runtime.close(); store.close(); });
  const create = (nodes = [copy()]) => as(() => runtime.createPlan(projectId, { goal: '逐次派工合同测试', nodes, idempotencyKey: crypto.randomUUID() }).plan);
  const stage = plan => as(() => runtime.approvePlan(plan.id, { version: plan.version, idempotencyKey: crypto.randomUUID() }));
  const get = id => store.work.get('run', id);
  const estimate = (id, patch = {}) => as(() => { const run = get(id); return runtime.estimateDispatch(id, { expectedRevision: run.revision, requirement: run.node.requirement, model: run.node.model, skillMode: 'default', skillIds: [], ...patch }); });
  const approve = (id, quote, patch = {}) => as(() => runtime.approveDispatch(id, { expectedRevision: quote.revision, quoteId: quote.quoteId, budgetUSD: 1, idempotencyKey: crypto.randomUUID(), ...patch }));
  const command = (id, name) => as(() => runtime.commands(id, { command: name, expectedRevision: get(id).revision, idempotencyKey: crypto.randomUUID() }).run);
  function complete(id) {
    const run = get(id), artifact = { id: run.taskId + ':1', artifactId: run.taskId, ownerId: run.ownerId, projectId, taskId: run.taskId, runId: id, accountId: run.node.accountId, version: 1, candidate: false, kind: run.node.role === 'douyin-research' ? 'research' : 'copy', title: '已保存成果', body: '用于合同测试的固定上游正文' };
    store.work.put('artifact', artifact); store.work.put('artifact-head', { id: run.taskId, ownerId: run.ownerId, version: 1, nextVersion: 1 }); store.work.put('run', { ...run, status: 'succeeded', artifact: { id: run.taskId, version: 1 } }); return artifact;
  }
  return { store, projectId, counts, runtime, create, stage, get, estimate, approve, command, complete, setSkillVersion: value => { skillVersion = value; } };
}
test('saving a plan grants no dispatch, credentials or spending authority', async t => {
  const f = fixture(t), plan = f.create([research(), copy({ dependsOn: ['research'] })]), before = f.counts.prepare;
  const saved = await f.stage(plan); await f.runtime.tick();
  assert(saved.runs.every(run => run.status === 'pending_approval' && run.input === null && run.approval === null));
  assert.equal(f.counts.prepare, before); assert.equal(f.counts.connection, 0); assert.equal(f.counts.execute, 0); assert.equal(saved.plan.approvalMode, 'per-task');
  assert.equal(as(() => f.runtime.describeDispatch(saved.runs[1])).ready, false); assert.throws(() => f.estimate(saved.runs[1].id), /等待/);
});
test('dispatch requires an explicit rule choice and freezes edited instructions and skill versions', async t => {
  const f = fixture(t), saved = await f.stage(f.create()), id = saved.runs[0].id;
  assert.throws(() => f.estimate(id, { skillMode: '' })); assert.throws(() => f.estimate(id, { skillMode: 'selected', skillIds: [] }), /请选择/); assert.throws(() => f.estimate(id, { skillMode: 'default', skillIds: ['skill-a'] }), /请选择/);
  const quote = f.estimate(id, { requirement: '用户修改后的本次指令', skillMode: 'selected', skillIds: ['skill-a'] }); f.setSkillVersion('2');
  const result = await f.approve(id, quote); assert.equal(result.run.status, 'queued'); assert.equal(result.run.node.requirement, '用户修改后的本次指令'); assert.equal(result.run.input.payload.requirement, result.run.node.requirement); assert.equal(result.run.input.skills[0].version, '1'); assert.equal(result.run.approval.scope, 'task-only'); assert.equal(f.counts.execute, 0);
});
test('completed dependencies prepare the next card but never approve it', async t => {
  const f = fixture(t), saved = await f.stage(f.create([research(), copy({ dependsOn: ['research'] })])), upstream = saved.runs[0].id, downstream = saved.runs[1].id;
  await f.approve(upstream, f.estimate(upstream)); const artifact = f.complete(upstream); await f.runtime.tick(); assert.equal(f.get(downstream).status, 'pending_approval');
  assert.equal(as(() => f.runtime.describeDispatch(f.get(downstream))).ready, true); const approved = await f.approve(downstream, f.estimate(downstream));
  assert.equal(approved.run.dependencies[0].artifactId, artifact.artifactId); assert.equal(approved.run.dependencies[0].projectId, f.projectId); assert.equal(approved.run.dependencies[0].accountId, ''); assert.equal(approved.run.dependencies[0].version, 1);
});
test('an adopted dependency changed after estimation invalidates that quote', async t => {
  const f = fixture(t), saved = await f.stage(f.create([research(), copy({ dependsOn: ['research'] })])), upstream = saved.runs[0].id, downstream = saved.runs[1].id;
  await f.approve(upstream, f.estimate(upstream)); const artifact = f.complete(upstream), quote = f.estimate(downstream);
  f.store.work.put('artifact', { ...artifact, id: artifact.artifactId + ':2', version: 2, body: '新的人工编辑版本' }); f.store.work.put('artifact-head', { id: artifact.artifactId, ownerId: alpha.userId, version: 2, nextVersion: 2 });
  await assert.rejects(f.approve(downstream, quote), /前置成果已变化/); assert.equal(f.get(downstream).status, 'pending_approval'); assert.equal(f.estimate(downstream).dependencies[0].version, 2);
});
test('cross-account content and forged research heads cannot cross the dispatch boundary', async t => {
  const f = fixture(t), saved = await f.stage(f.create([copy({ id: 'source', accountId: 'xhs-b' }), copy({ dependsOn: ['source'] })])), upstream = saved.runs[0].id, downstream = saved.runs[1].id;
  await f.approve(upstream, f.estimate(upstream)); const artifact = f.complete(upstream); assert.throws(() => f.estimate(downstream), /其他账号/);
  f.store.work.put('artifact', { ...artifact, kind: 'research' }); assert.throws(() => f.estimate(downstream), /来源角色/);
  f.store.work.put('artifact', { ...artifact, accountId: 'xhs-a' }); assert.throws(() => f.estimate(downstream), /固定账号/);
});
test('quotes are owner scoped, revision checked, expiring and budget bounded; repeat approval is harmless', async t => {
  const f = fixture(t), saved = await f.stage(f.create()), id = saved.runs[0].id, quote = f.estimate(id);
  assert.throws(() => runWithActor(beta, () => f.runtime.estimateDispatch(id, { expectedRevision: 1, requirement: 'foreign', model: 'synthetic-model', skillMode: 'default', skillIds: [] })), error => error.status === 404);
  await assert.rejects(f.approve(id, quote, { expectedRevision: quote.revision + 1 }), /版本不一致/);
  await assert.rejects(f.approve(id, quote, { budgetUSD: 0.1 }), /低于预估/); await assert.rejects(f.approve(id, quote, { budgetUSD: 1001 }));
  const persisted = f.store.work.get('dispatch-quote', quote.quoteId); f.store.work.put('dispatch-quote', { ...persisted, expiresAt: '2000-01-01T00:00:00Z' }); await assert.rejects(f.approve(id, quote), /过期/);
  const fresh = f.estimate(id), input = { idempotencyKey: 'repeat-explicit-dispatch', budgetUSD: 1000 };
  const [one, two] = await Promise.all([f.approve(id, fresh, input), f.approve(id, fresh, input)]); assert.equal(one.run.id, two.run.id); assert.equal(f.store.work.events(id).filter(event => event.type === 'dispatch.approved').length, 1);
  await assert.rejects(f.approve(id, fresh, { budgetUSD: 2 }), /更改批准额度/); assert.equal(f.store.work.all('run').length, 1);
});
test('cancellation during credential loading prevents deferred approval', async t => {
  let release; const f = fixture(t, { connection: () => new Promise(resolve => { release = resolve; }) });
  const saved = await f.stage(f.create()), id = saved.runs[0].id, approval = f.approve(id, f.estimate(id));
  assert.equal(typeof release, 'function'); f.command(id, 'cancel'); release({ credentialProvider: 'synthetic' });
  await assert.rejects(approval, /待派工确认|变化/); assert.equal(f.get(id).status, 'cancelled'); assert.equal(f.get(id).approval, null);
});
test('pause/resume cannot grant dispatch and retry requires fresh approval', async t => {
  const f = fixture(t), saved = await f.stage(f.create()), id = saved.runs[0].id;
  assert.equal(f.command(id, 'pause').status, 'paused'); assert.equal(f.command(id, 'resume').status, 'pending_approval');
  f.command(id, 'cancel'); const retry = f.command(id, 'retry'); assert.equal(retry.status, 'pending_approval'); assert.equal(retry.input, null); assert.equal(retry.approval, null); assert.equal(f.counts.connection, 0);
  await f.approve(retry.id, f.estimate(retry.id)); assert.equal(f.get(retry.id).status, 'queued'); assert.equal(f.get(id).status, 'cancelled');
});
test('an unchanged next plan retains its latest pending retry, while changed instructions replace it', async t => {
  const f = fixture(t), plan = f.create(), saved = await f.stage(plan), first = saved.runs[0].id; f.command(first, 'cancel'); const retry = f.command(first, 'retry');
  const same = as(() => f.runtime.updatePlan(plan.id, { expectedVersion: 1, goal: '更新计划说明', nodes: plan.nodes }).plan), retained = await f.stage(same);
  assert.equal(retained.runs[0].id, retry.id); assert.equal(f.get(retry.id).status, 'pending_approval');
  const changed = as(() => f.runtime.updatePlan(plan.id, { expectedVersion: 2, goal: '调整本次指令', nodes: [copy({ requirement: '真正变更的指令' })] }).plan), replaced = await f.stage(changed);
  assert.notEqual(replaced.runs[0].id, retry.id); assert.equal(f.get(retry.id).status, 'cancelled'); assert.equal(f.get(replaced.runs[0].id).status, 'pending_approval');
});
