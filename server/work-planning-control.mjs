import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { planningConversation } from './work-controller-history.mjs';

const now = () => new Date().toISOString();
const identifier = z.string().min(1).max(160);
const goal = z.string().trim().min(1).max(16000);
const key = z.string().min(8).max(160);
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status, noCharge: true }); };

// All writes share the control service's encrypted database transaction. This
// service can create only unapproved drafts, never business execution approval.
export function createPlanningControl({ db, planner, owner, actor, owned, project, once, authorizeRun, saveRun, event, notification, tick, prepareNodes, assertLease, nodeSchema, roles }) {
  // A model proposal may revise these fields only. Parsing through the complete
  // execution node schema would inject default budgets/Skills/model selections
  // and erase the user's saved execution settings during a partial merge.
  const proposalNodeSchema = nodeSchema.pick({ id: true, title: true, role: true, accountId: true, connectionAccountId: true, requirement: true, dependsOn: true }).strict();
  function estimate(projectId, body) {
    if (!planner) fail('当前部署未启用 AI 规划', 503);
    const data = z.object({ goal, accountIds: z.array(identifier).max(20).default([]), model: z.string().max(100).optional(), taskId: identifier.optional() }).strict().parse(body);
    project(projectId);
    let context, sourcePlan;
    if (data.taskId) {
      const task = owned('task', data.taskId);
      if (task.projectId !== projectId || !roles.includes(task.role)) fail('只能修订当前项目中的专业任务', 409);
      const plan = owned('plan', task.planId), version = plan.versions.find(item => item.version === plan.version), node = version.nodes.find(item => item.id === task.nodeId);
      if (!node || node.accountId !== task.accountId || node.role !== task.role) fail('当前计划中的任务归属已变化，请重新核对', 409);
      sourcePlan = { id: plan.id, version: plan.version, goal: version.goal, nodes: structuredClone(version.nodes), taskId: task.id };
      context = { existingPlan: { id: plan.id, version: plan.version, nodes: version.nodes }, currentTask: { nodeId: task.nodeId }, message: data.goal };
    }
    const input = planner.prepare({ projectId, goal: data.goal, accountIds: data.accountIds, ...(data.model ? { model: data.model } : {}), planningBudgetUSD: 0, ...(context ? { context } : { conversation: planningConversation(db, owner(), projectId, data.accountIds) }) });
    const quote = { id: randomUUID(), ownerId: owner(), projectId, input: structuredClone(input), sourcePlan, createdAt: now(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
    db.put('planning-quote', quote);
    return { quoteId: quote.id, estimateUSD: input.estimateUSD, model: input.modelRoute.model, label: input.modelRoute.label, expiresAt: quote.expiresAt, scope: 'planning-only' };
  }
  async function start(projectId, body) {
    if (!planner) fail('当前部署未启用 AI 规划', 503);
    const data = z.object({ quoteId: identifier, planningBudgetUSD: z.number().finite().min(0).max(100), idempotencyKey: key }).strict().parse(body);
    const quote = owned('planning-quote', data.quoteId);
    if (quote.projectId !== projectId) fail('规划估算不属于当前项目', 409);
    if (db.get('command', `${owner()}:planning:${data.idempotencyKey}`)) return once('planning', data.idempotencyKey, { projectId, ...data }, () => { throw Error('unreachable'); });
    if (quote.startedRunId) return { run: owned('run', quote.startedRunId), reused: true };
    if (Date.parse(quote.expiresAt) < Date.now()) fail('规划估算已过期，请重新核算', 409);
    if (data.planningBudgetUSD + 1e-9 < quote.input.estimateUSD) fail('单独批准的规划额度不足');
    const input = { ...structuredClone(quote.input), planningBudgetUSD: data.planningBudgetUSD, sourcePlan: quote.sourcePlan };
    const connection = await planner.prepareConnection({ actor: actor(), input });
    return once('planning', data.idempotencyKey, { projectId, ...data }, () => {
      const current = owned('planning-quote', quote.id);
      if (current.startedRunId) return { run: owned('run', current.startedRunId), reused: true };
      if (Date.parse(current.expiresAt) < Date.now()) fail('规划估算已过期，请重新核算', 409);
      if (current.sourcePlan && owned('plan', current.sourcePlan.id).version !== current.sourcePlan.version) fail('计划已变化，请重新核对修订范围', 409);
      project(projectId);
      const taskId = randomUUID(), runId = randomUUID(), node = { id: 'planning', title: current.sourcePlan ? 'AI 整理任务修订建议' : 'AI 总控计划草案', role: 'controller-planning', accountId: '', requirement: input.goal, dependsOn: [], budgetUSD: data.planningBudgetUSD };
      const run = { id: runId, kind: 'planning', ownerId: owner(), actor: actor(), taskId, projectId, node, input: { ...input, ...connection }, approval: { planningBudgetUSD: data.planningBudgetUSD, budgetUSD: data.planningBudgetUSD, permissions: ['model:planning'], at: now(), by: owner() }, status: 'queued', revision: 0, createdAt: now(), attempts: [], dependencyRuns: [], baseArtifactVersion: 0 };
      authorizeRun(run);
      db.put('task', { id: taskId, ownerId: owner(), projectId, title: node.title, accountId: '', accountName: '本轮所选账号', role: node.role, kind: 'planning', latestRunId: runId, status: run.status, createdAt: now(), updatedAt: now() });
      saveRun(run); db.put('planning-quote', { ...current, startedRunId: runId });
      event(run, 'planning.approved', '仅批准本次计划草拟费用；未授权执行后续任务', { planningBudgetUSD: data.planningBudgetUSD, model: input.modelRoute.model });
      queueMicrotask(() => void tick()); return { run };
    });
  }
  function applyProposal(run, result) {
    if (result.kind !== 'proposal') return;
    const source = run.input.sourcePlan;
    let plan = source ? owned('plan', source.id) : null;
    const detached = !!plan && plan.version !== source.version;
    const raw = source ? source.nodes.map(node => node.id === run.input.payload.context.currentTask.id ? { ...node, ...result.nodes[0] } : node) : result.nodes;
    const nodes = prepareNodes(run.projectId, raw);
    if (!plan || detached) plan = { id: randomUUID(), ownerId: run.ownerId, projectId: run.projectId, version: 0, versions: [], createdAt: now(), ...(detached ? { forkedFrom: { id: source.id, version: source.version }, warning: '原计划已变化；这是根据旧快照保存的独立建议，请逐项核对。' } : {}) };
    plan.version++;
    plan.versions.push({ version: plan.version, goal: source?.goal || result.goal, nodes, estimateUSD: nodes.reduce((sum, node) => sum + node.estimateUSD, 0), status: 'draft', planningMode: 'ai', planningRunId: run.id, planningCostUSD: result.usage?.amountUSD || 0, createdAt: now(), diff: source ? [{ nodeId: run.input.payload.context.currentTask.id, change: 'changed' }] : [] });
    db.put('plan', plan); run.planningPlanId = plan.id; run.planningPlanVersion = plan.version;
    event(run, 'planning.draft.saved', detached ? '原计划已变化，建议另存为独立草案；未执行任务' : '计划草案已保存，需另行批准才能执行任务', { planId: plan.id, version: plan.version, detached });
    return plan;
  }
  function save(runId, result, leaseToken, recovery = false) {
    return db.transaction(() => {
      let run = db.get('run', runId); if (!run) return;
      if (!recovery) run = assertLease(run, leaseToken);
      if (run.artifact) return db.get('artifact', `${run.artifact.id}:${run.artifact.version}`);
      const value = z.object({ kind: z.enum(['proposal', 'question']), goal, nodes: z.array(proposalNodeSchema).max(20), question: z.string().max(2000), usage: z.unknown().optional() }).strict().parse(result);
      if (value.kind === 'proposal' && (!value.nodes.length || value.question) || value.kind === 'question' && (value.nodes.length || !value.question)) fail('规划回执格式不完整', 409);
      const candidate = !!run.requestedAction;
      if (!candidate && value.kind === 'proposal') applyProposal(run, value);
      const artifact = { id: `${run.taskId}:1`, artifactId: run.taskId, version: 1, ownerId: run.ownerId, projectId: run.projectId, accountId: '', taskId: run.taskId, runId, title: value.kind === 'question' ? '需要补充的信息' : '待确认的计划草案', body: value.kind === 'question' ? value.question : value.nodes.map((node, index) => `${index + 1}. ${node.title}\n${node.requirement}\n账号：${node.accountId || node.connectionAccountId || '公共研究'}；依赖：${node.dependsOn.join('、') || '无'}`).join('\n\n'), kind: 'plan', structured: value, usage: value.usage, candidate, createdAt: now(), source: 'generated', dependencies: [] };
      db.put('artifact', artifact); db.put('artifact-head', { id: run.taskId, ownerId: run.ownerId, version: candidate ? 0 : 1, nextVersion: 1 });
      run.artifact = { id: run.taskId, version: 1 }; run.planningQuestion = value.kind === 'question' ? value.question : ''; run.usage = value.usage;
      run.status = run.requestedAction === 'cancel' ? 'cancelled' : run.requestedAction === 'pause' ? 'paused' : 'succeeded';
      run.waitReason = candidate ? '规划结果已保留，未写入执行计划；需明确采用' : value.kind === 'question' ? '请补充信息后重新核对规划费用' : '待确认计划已保存，尚未批准执行';
      run.finishedAt = now(); delete run.lease; saveRun(run);
      event(run, 'planning.saved', run.waitReason, { artifactId: run.taskId, version: 1, candidate });
      notification(run, candidate || value.kind === 'question' ? 'action' : 'completed', candidate ? '规划候选结果已保留' : value.kind === 'question' ? '总控需要补充信息' : '总控计划草案可核对', { id: run.taskId, version: 1 });
      return artifact;
    });
  }
  return { estimate, start, save, applyProposal };
}
