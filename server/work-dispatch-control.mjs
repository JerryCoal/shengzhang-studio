import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(160);
const revision = z.number().int().positive();
const key = z.string().trim().min(8).max(160);
const choices = z.object({ expectedRevision: revision, requirement: z.string().trim().min(1).max(4000), model: z.string().trim().min(1).max(100), skillMode: z.enum(['default', 'selected']), skillIds: z.array(identifier).max(8).refine(values => new Set(values).size === values.length) }).strict();
const approval = z.object({ expectedRevision: revision, quoteId: identifier, budgetUSD: z.number().finite().min(0).max(1000), idempotencyKey: key }).strict();
const now = () => new Date().toISOString();
const fail = (message, status = 409) => { throw Object.assign(Error(message), { status, noCharge: true }); };
const workflowFor = run => run.node.role === 'douyin-research' ? 'research-analysis' : run.node.role === 'xiaohongshu-copy' ? 'copy-xiaohongshu' : 'copy-douyin';
const dependencyIdentity = rows => JSON.stringify(rows.map(({ taskId, runId, artifactId, version }) => ({ taskId, runId, artifactId, version })));

// Quotes capture the exact task, selected rules and adopted upstream versions.
// A plan confirmation never grants this service's task-only spending authority.
export function createDispatchControl({ db, store, executors, owner, actor, owned, project, once, authorizeRun, saveRun, event, tick, nodeSchema, prepareSnapshot }) {
  function pending(runId, expectedRevision) {
    const run = owned('run', runId), task = owned('task', run.taskId);
    if (run.kind === 'planning' || run.source === 'legacy-checkpoint') fail('此任务使用独立的确认流程');
    if (task.deletedAt || task.latestRunId !== run.id) fail('任务已删除或已有更新的运行，请查看当前任务');
    if (run.status !== 'pending_approval') fail('此任务不在待派工确认状态');
    if (expectedRevision !== undefined && run.revision !== expectedRevision) fail('任务已变化，请重新读取并核对派工卡');
    authorizeRun({ ...run, actor: actor() });
    return run;
  }
  function dependencies(run) {
    return (run.dependencyRuns || []).map(runId => {
      const original = owned('run', runId), task = owned('task', original.taskId);
      const latest = owned('run', task.latestRunId);
      const upstream = latest.planId === original.planId && latest.planVersion === original.planVersion && latest.node?.id === original.node?.id ? latest : original;
      if (upstream.projectId !== run.projectId || upstream.status !== 'succeeded' || !upstream.artifact) fail(`等待“${task.title}”完成并保存可采用成果，暂不派工`);
      const head = db.get('artifact-head', upstream.artifact.id), version = head?.version || upstream.artifact.version;
      const artifact = owned('artifact', `${upstream.artifact.id}:${version}`);
      if (artifact.candidate || artifact.taskId !== task.id || artifact.projectId !== run.projectId) fail(`“${task.title}”的成果尚未采用，请先核对`);
      const source = owned('run', artifact.runId);
      if (source.taskId !== task.id || source.projectId !== run.projectId || (artifact.accountId || '') !== (source.node?.accountId || '') || (artifact.accountId || '') !== (original.node.accountId || '') || (upstream.node.accountId || '') !== (original.node.accountId || '')) fail('前置成果与原任务的固定账号不一致，请核对');
      if (artifact.kind !== 'research' && artifact.accountId !== run.node.accountId) fail('不能把其他账号的创作成果作为本账号的输入，请先核对目标账号');
      if (artifact.kind === 'research' && source.node.role !== 'douyin-research') fail('前置研究成果的来源角色不一致，请核对');
      return { taskId: task.id, runId: source.id, projectId: artifact.projectId, accountId: artifact.accountId || '', artifactId: upstream.artifact.id, version, title: artifact.title, body: artifact.body, kind: artifact.kind };
    });
  }
  function describe(run) {
    if (run.kind === 'planning' || run.source === 'legacy-checkpoint') return { ready: false, reason: '使用独立确认流程' };
    const workflowId = workflowFor(run);
    if (run.status !== 'pending_approval') return { ready: false, reason: run.approval ? '本次派工已经确认' : '当前状态不能派工', workflowId };
    try { pending(run.id); const rows = dependencies(run); return { ready: true, reason: '请核对指令与 Skills，估算后确认本次派工', workflowId, dependencies: rows.map(({ body, ...metadata }) => metadata) }; }
    catch (error) { return { ready: false, reason: error.message, workflowId }; }
  }
  function estimate(runId, body) {
    const data = choices.parse(body), run = pending(runId, data.expectedRevision);
    if (data.skillMode === 'default' && data.skillIds.length || data.skillMode === 'selected' && !data.skillIds.length) fail('请选择至少一个 Skill，或明确使用默认规则', 400);
    const { expectedRevision, ...fields } = data, node = nodeSchema.parse({ ...run.node, ...fields });
    const bound = dependencies(run), snapshot = prepareSnapshot(run.projectId, node);
    const quote = { id: randomUUID(), ownerId: owner(), runId, taskId: run.taskId, projectId: run.projectId, revision: run.revision, node: { ...node, model: snapshot.modelRoute?.model || node.model, estimateUSD: snapshot.estimateUSD }, input: structuredClone(snapshot), dependencies: bound, createdAt: now(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
    db.put('dispatch-quote', quote);
    return { quoteId: quote.id, runId, revision: run.revision, estimateUSD: snapshot.estimateUSD, expiresAt: quote.expiresAt, skills: snapshot.skills || [], dependencies: bound.map(({ body, ...metadata }) => metadata), accountName: snapshot.accountName || owned('task', run.taskId).accountName || '', model: snapshot.modelRoute?.model || node.model, workflowId: workflowFor(run), scope: 'task-only' };
  }
  async function approve(runId, body) {
    const data = approval.parse(body), scope = `dispatch:${runId}`;
    if (db.get('command', `${owner()}:${scope}:${data.idempotencyKey}`)) return once(scope, data.idempotencyKey, data, () => { throw Error('unreachable'); });
    const quote = owned('dispatch-quote', data.quoteId);
    if (quote.runId !== runId || quote.revision !== data.expectedRevision) fail('派工估算与当前任务或版本不一致');
    if (quote.approvedAt) {
      if (quote.budgetUSD !== data.budgetUSD) fail('本次派工已经确认，不能重复更改批准额度');
      return { run: owned('run', runId), reused: true };
    }
    const before = pending(runId, data.expectedRevision);
    if (Date.parse(quote.expiresAt) < Date.now()) fail('派工估算已过期，请重新估算');
    if (data.budgetUSD + 1e-9 < quote.input.estimateUSD) fail('本次派工额度低于预估，请调整后确认', 400);
    if (dependencyIdentity(dependencies(before)) !== dependencyIdentity(quote.dependencies)) fail('前置成果已变化，请重新估算并核对版本');
    const connection = executors.prepareConnection ? await executors.prepareConnection({ actor: actor(), node: quote.node }) : {};
    if (quote.input.connectionAccountId && connection.connectionAccountId && connection.connectionAccountId !== quote.input.connectionAccountId) fail('研究读取账号已变化，请重新估算并确认');
    if (connection.credentialProvider && connection.credentialProvider !== quote.input.modelRoute?.provider) fail('模型服务已变化，请重新估算并确认');
    return once(scope, data.idempotencyKey, data, () => {
      const currentQuote = owned('dispatch-quote', quote.id);
      if (currentQuote.approvedAt) { if (currentQuote.budgetUSD !== data.budgetUSD) fail('本次派工已经确认，不能重复更改批准额度'); return { run: owned('run', runId), reused: true }; }
      const run = pending(runId, data.expectedRevision);
      if (Date.parse(currentQuote.expiresAt) < Date.now()) fail('派工估算已过期，请重新估算');
      if (dependencyIdentity(dependencies(run)) !== dependencyIdentity(currentQuote.dependencies)) fail('前置成果已变化，请重新估算并核对版本');
      project(run.projectId);
      run.node = { ...structuredClone(currentQuote.node), budgetUSD: data.budgetUSD };
      run.input = { ...structuredClone(currentQuote.input), ...connection, budgetUSD: data.budgetUSD };
      run.actor = actor(); run.dispatchMode = 'per-task';
      run.approval = { scope: 'task-only', quoteId: quote.id, budgetUSD: data.budgetUSD, permissions: run.input.permissions || [], skillMode: run.node.skillMode, skillIds: [...run.node.skillIds], at: now(), by: owner() };
      run.dependencies = structuredClone(currentQuote.dependencies);
      run.dependencyRuns = run.dependencies.map(item => item.runId);
      run.status = 'queued'; run.waitReason = '';
      saveRun(run); db.put('dispatch-quote', { ...currentQuote, approvedAt: now(), budgetUSD: data.budgetUSD });
      event(run, 'dispatch.approved', '已明确批准本次 Agent 派工，后续步骤仍需分别确认', { budgetUSD: data.budgetUSD, skills: run.input.skills, dependencies: run.dependencies.map(({ body, ...metadata }) => metadata), permissions: run.approval.permissions });
      queueMicrotask(() => void tick()); return { run };
    });
  }
  return { estimate, approve, describe };
}
