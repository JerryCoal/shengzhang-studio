import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { currentActor, runWithActor } from './request-actor.mjs';
import { MODELS } from './models.mjs';
import { createContentDraft } from './content-workflow.mjs';
import { rulesOf } from './workflow.mjs';
import { resolveAccountCreation } from './account-creation.mjs';
import { revisionReferenceSchema, readWorkRevision } from './work-revision.mjs';
import { createWorkChat } from './work-chat.mjs';
import { createPlanningControl } from './work-planning-control.mjs';
import { createDispatchControl } from './work-dispatch-control.mjs';
import { controllerHistory } from './work-controller-history.mjs';
import { providerAdmission, planWorkBackoff, workWaitStatus } from './work-scheduling.mjs';

export const WORK_ROLES = ['xiaohongshu-copy', 'douyin-research', 'douyin-script'];
export const WORK_STATES = ['pending_approval', 'waiting_dependencies', 'queued', 'running', 'waiting_user', 'paused', 'succeeded', 'failed', 'cancelled', 'needs_reconciliation'];
const finalStates = new Set(['succeeded', 'failed', 'cancelled']);
const identifier = z.string().min(1).max(160);
const text = max => z.string().trim().max(max);
const ids = z.array(identifier).max(30).default([]);
export const workNodeSchema = z.object({
  id: identifier, title: text(200).min(1), role: z.enum(WORK_ROLES), accountId: text(160).default(''),
  connectionAccountId: text(160).default(''), requirement: text(4000).min(1), dependsOn: z.array(identifier).max(12).default([]),
  knowledgeIds: z.array(identifier).max(8).default([]), experienceIds: z.array(identifier).max(8).default([]), skillIds: z.array(identifier).max(8).default([]), model: text(100).default(''),
  revisionSource: revisionReferenceSchema.optional(),
  skillMode: z.enum(['default', 'selected']).optional(), budgetUSD: z.number().finite().min(0).max(1000).default(0), estimateUSD: z.number().finite().min(0).optional(),
}).strict();
const goalSchema = text(16000).min(1);
const keySchema = text(160).min(8);
const now = () => new Date().toISOString();
const id = () => randomUUID();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, noCharge: true }); };
const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const clean = value => String(value ?? '').replace(/(?:Bearer\s+)[\w.\-+/=]+/gi, 'Bearer [已隐藏]').replace(/(?:sk-|sess-)[a-zA-Z0-9_-]{12,}/g, '[已隐藏]').replace(/([?&](?:access_token|token|key|secret|xsec_token|signature)=)[^\s&#]+/gi, '$1[已隐藏]').slice(0, 4000);
export function redactWorkDetail(value, depth = 0) {
  if (depth > 6) return '[省略]';
  if (typeof value === 'string') return clean(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map(item => redactWorkDetail(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).slice(0, 60).filter(([key]) => !/password|cookie|authorization|api.?key|secret|credential|(?:access|refresh|session|bearer)[_-]?token|^token$|raw(body|request|response)|prompt|instructions|reasoning|chain.of.thought/i.test(key)).map(([key, item]) => [key, redactWorkDetail(item, depth + 1)]));
}
function validateDag(nodes) {
  if (!nodes.length || nodes.length > 20) fail('一个计划需要 1–20 项任务');
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (byId.size !== nodes.length) fail('任务编号不可重复');
  const visited = new Set(), visiting = new Set();
  function visit(node) {
    if (visiting.has(node.id)) fail('任务依赖形成循环，请调整先后关系');
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) fail('依赖任务不存在');
      visit(byId.get(dependency));
    }
    visiting.delete(node.id); visited.add(node.id);
  }
  nodes.forEach(visit);
}
function accountFor(state, node) {
  const platform = node.role.startsWith('xiaohongshu') ? 'xiaohongshu' : 'douyin';
  if (node.role !== 'douyin-research' && !node.accountId) fail('请为创作任务指定目标账号');
  const account = state.accounts.find(account => account.id === node.accountId);
  if (node.accountId && (!account || account.platform !== platform)) fail('目标账号不存在或平台不匹配', 409);
  if (node.connectionAccountId) {
    const connection = state.accounts.find(account => account.id === node.connectionAccountId);
    if (!connection || connection.platform !== 'douyin') fail('研究采集账号不存在或平台不匹配', 409);
  }
  return account;
}
export function proposeWorkNodes(state, goal, accountIds = []) {
  const allowed = accountIds.length ? state.accounts.filter(account => accountIds.includes(account.id)) : state.accounts;
  if (accountIds.some(id => !state.accounts.some(account => account.id === id))) fail('所选账号已不存在，请重新选择', 409);
  const pick = platform => {
    const candidates = allowed.filter(account => account.platform === platform);
    const named = candidates.filter(account => goal.includes(account.name));
    if (named.length === 1) return named[0].id;
    if (candidates.length === 1) return candidates[0].id;
    fail(`请在账号选择中明确本轮${platform === 'xiaohongshu' ? '小红书' : '抖音'}目标；当前有 ${candidates.length} 个可选账号`);
  };
  const result = [];
  const xhs = /小红书|图文|笔记/i.test(goal), douyin = /抖音|短视频|脚本/i.test(goal), research = /研究|调研|热点|竞品|同类|参考|爆款/.test(goal);
  if (!xhs && !douyin) fail('请说明希望完成小红书图文、抖音研究或抖音脚本；需要哪些账号与成果？');
  if (xhs) result.push({ id: 'xiaohongshu-copy', title: '小红书文案与封面构思', role: 'xiaohongshu-copy', accountId: pick('xiaohongshu'), requirement: goal, dependsOn: [], budgetUSD: 0 });
  if (douyin && research) result.push({ id: 'douyin-research', title: '抖音同类内容研究', role: 'douyin-research', accountId: '', connectionAccountId: pick('douyin'), requirement: goal, dependsOn: [], budgetUSD: 0 });
  if (douyin && (!research || /脚本|创作|视频|再|之后|然后/.test(goal))) result.push({ id: 'douyin-script', title: '抖音视频脚本', role: 'douyin-script', accountId: pick('douyin'), requirement: goal, dependsOn: result.some(node => node.id === 'douyin-research') ? ['douyin-research'] : [], budgetUSD: 0 });
  return result.map(node => workNodeSchema.parse(node));
}

export function createWorkControl({ store, config = {}, executors, planner, activeJobs, concurrency = 3, providerConcurrency = 2, autoStart = true, leaseMs = 45000 }) {
  const db = store.work;
  if (!db) throw new Error('后台任务需要独立持久存储');
  const workerId = id(), active = new Map();
  let closing = false, ticking = false, lastOwner = '', timer;
  const actor = () => currentActor() || { userId: config.workOwnerId || 'personal', username: '', role: 'admin' };
  const owner = () => actor().userId;
  const memberAllowed = candidate => !config.authorizeWorkActor || config.authorizeWorkActor(candidate) === true;
  const owned = (kind, key) => {
    const row = db.get(kind, key);
    if (!row || row.ownerId !== owner() || !memberAllowed(actor())) fail('记录不存在或当前用户无权访问', 404);
    return row;
  };
  const project = projectId => { const value = store.get().projects.find(item => item.id === projectId); if (!value) fail('项目不存在', 404); return value; };
  function authorizeRun(run) {
    if (!memberAllowed(run.actor)) fail('任务所属成员已停用，不能继续派发', 403);
    const state = store.get();
    if (!state.projects.some(item => item.id === run.projectId)) fail('任务所属项目已不存在', 409);
    if (run.kind === 'planning') {
      for (const account of run.input.payload.allowedAccounts) if (!state.accounts.some(item => item.id === account.id && item.platform === account.platform)) fail('规划所选账号已变化，请重新确认', 409);
    } else accountFor(state, run.node);
    return true;
  }
  function assertPlanBudget(run) {
    // Controller planning has its own explicitly approved limit and ledger.
    // Business retries remain part of the original approved plan version, not
    // fresh spending authority merely because a new run id was allocated.
    if (run.kind === 'planning') return;
    if (run.dispatchMode === 'per-task') {
      if (run.approval?.scope !== 'task-only' || !Number.isFinite(run.approval.budgetUSD)) fail('本次派工尚未明确批准，未发送新请求', 409);
      let total = 0;
      for (const entry of project(run.projectId).usage || []) if (entry.runId === run.id) {
        if (!Number.isFinite(entry.amountUsd) || entry.amountUsd < 0) fail('本次派工用量异常，请核对后继续', 409);
        total += entry.amountUsd;
      }
      if (total > run.approval.budgetUSD + 1e-9) fail('本次费用预留已超过批准额度，未发送新请求', 409);
      return;
    }
    const plan = db.get('plan', run.planId), version = plan?.versions?.find(item => item.version === run.planVersion);
    if (!plan || plan.ownerId !== run.ownerId || plan.projectId !== run.projectId || version?.status !== 'approved' || !Number.isFinite(version.budgetUSD) || version.budgetUSD < 0) fail('原计划版本的批准额度已无法核对，未发送新请求', 409);
    const runIds = new Set(db.all('run', run.ownerId).filter(item => item.kind !== 'planning' && item.projectId === run.projectId && item.planId === run.planId && item.planVersion === run.planVersion).map(item => item.id));
    let total = 0;
    for (const entry of project(run.projectId).usage || []) {
      if (!runIds.has(entry.runId)) continue;
      if (!Number.isFinite(entry.amountUsd) || entry.amountUsd < 0) fail('原计划用量记录异常，请核对后再执行，未发送新请求', 409);
      // Do not drop failed-but-billed, running, or uncertain rows. The executor
      // has already saved this request's reservation before reaching this guard.
      total += entry.amountUsd;
    }
    if (total > version.budgetUSD + 1e-9) fail('本次预留与历史费用已超过该计划版本的累计批准额度；未发送新请求，请核对费用或另行确认新的计划版本', 409);
  }
  function event(run, type, summary, detail = {}) {
    return db.append({ id: id(), runId: run.id, taskId: run.taskId, attemptId: run.attemptId || '', type, summary: clean(summary), detail: redactWorkDetail(detail), at: now() });
  }
  function saveRun(run) {
    run.revision = (run.revision || 0) + 1; run.updatedAt = now(); db.put('run', run);
    const task = db.get('task', run.taskId);
    if (task?.latestRunId === run.id) db.put('task', { ...task, status: run.status, waitReason: run.waitReason || '', updatedAt: run.updatedAt });
    queueMicrotask(() => { if (closing) return; try { const rows = db.all('run'); config.onWorkProgress?.({ ownerId: config.workOwnerId || 'workspace', active: rows.filter(row => ['queued', 'running', 'waiting_dependencies'].includes(row.status)).length, paused: rows.filter(row => ['paused', 'needs_reconciliation', 'waiting_user'].includes(row.status)).length }); } catch { /* Progress delivery must not affect the transaction. */ } });
    return run;
  }
  function notification(run, type, title, artifact) {
    const key = `${run.id}:${type}:${artifact?.version || 0}`;
    if (db.get('notification', key)) return;
    db.put('notification', { id: key, ownerId: run.ownerId, type, title: clean(title), createdAt: now(), readAt: '', deliveryAttemptedAt: '', deliveredAt: '',
      target: { projectId: run.projectId, accountId: run.node.accountId, taskId: run.taskId, runId: run.id, ...(artifact ? { artifactId: artifact.id, artifactVersion: artifact.version } : {}) } });
  }
  function once(scope, key, input, callback) {
    keySchema.parse(key);
    const recordId = `${owner()}:${scope}:${key}`, old = db.get('command', recordId), fingerprint = digest(input);
    if (old) { if (old.fingerprint !== fingerprint) fail('重复请求的内容发生变化，请重新确认', 409); return old.result; }
    return db.transaction(() => { const result = callback(); db.put('command', { id: recordId, ownerId: owner(), fingerprint, result, at: now() }); return result; });
  }
  const readRevision = (projectId, node, taskId, reference, requireCurrent = true) => readWorkRevision({ db, owned, projectId, node, taskId, reference, requireCurrent });
  function prepareNodes(projectId, input) {
    const state = store.get(), p = project(projectId);
    const nodes = z.array(workNodeSchema).min(1).max(20).parse(input); validateDag(nodes);
    return nodes.map(node => {
      accountFor(state, node);
      const revisionSource = node.revisionSource ? readRevision(projectId, node, node.revisionSource.taskId, node.revisionSource, false) : null;
      const snapshot = executors.prepare({ state, project: p, node, revisionSource });
      if (!Number.isFinite(snapshot.estimateUSD) || snapshot.estimateUSD < 0) fail('无法核算任务额度，请检查模型配置');
      return { ...node, model: snapshot.modelRoute?.model || node.model, estimateUSD: snapshot.estimateUSD };
    });
  }
  function prepareSnapshot(projectId, node, taskId) {
    const state = store.get(), p = project(projectId), account = accountFor(state, node);
    const revisionSource = node.revisionSource ? readRevision(projectId, node, taskId, node.revisionSource) : null;
    const snapshot = executors.prepare({ state, project: p, node, revisionSource });
    if (!Number.isFinite(snapshot.estimateUSD) || snapshot.estimateUSD < 0) fail('无法核算任务额度，请检查模型配置');
    const accountProject = account ? { ...p, creationSelections: { ...p.creationSelections, [account.platform]: { accountId: account.id, presetId: p.creationSelections?.[account.platform]?.accountId === account.id ? p.creationSelections[account.platform].presetId || '' : '' } } } : p;
    const creationTrace = account ? resolveAccountCreation(state, accountProject, account.platform).accountContext : null;
    return { ...snapshot, creationTrace: structuredClone(creationTrace), briefSnapshot: structuredClone(p.brief) };
  }
  function planView(plan) {
    const version = plan.versions.find(version => version.version === plan.version);
    return { ...plan, ...version, id: plan.id, projectId: plan.projectId, ownerId: plan.ownerId, createdAt: plan.createdAt, versions: plan.versions };
  }
  const chat = createWorkChat({ db, owner, owned, project, once, state: () => store.get() });
  const planning = createPlanningControl({ chat, readRevision, db, planner, owner, actor, owned, project, once, authorizeRun, saveRun, event, notification, tick, prepareNodes, assertLease, nodeSchema: workNodeSchema, roles: WORK_ROLES });
  const dispatch = createDispatchControl({ readRevision, db, store, executors, owner, actor, owned, project, once, authorizeRun, saveRun, event, tick, nodeSchema: workNodeSchema, prepareSnapshot });
  const hasReceipt = run => ['result_ready', 'planning_result_ready'].includes(run.checkpoint?.type);
  const finishResult = (run, result, token, recovery = false) => run.kind === 'planning' ? planning.save(run.id, result, token, recovery) : saveResult(run.id, result, token, recovery);
  function createPlan(projectId, body) {
    const data = z.object({ goal: goalSchema, accountIds: ids, nodes: z.array(workNodeSchema).optional(), idempotencyKey: keySchema }).strict().parse(body);
    if (data.nodes?.some(node => node.revisionSource)) fail('修订来源只能由总控根据当前任务生成');
    return once('create-plan', data.idempotencyKey, { projectId, ...data }, () => {
      const nodes = prepareNodes(projectId, data.nodes || proposeWorkNodes(store.get(), data.goal, data.accountIds));
      const version = { version: 1, goal: data.goal, nodes, estimateUSD: nodes.reduce((sum, node) => sum + node.estimateUSD, 0), status: 'draft', planningMode: 'rules', planningCostUSD: 0, createdAt: now(), diff: [] };
      const plan = { id: id(), ownerId: owner(), projectId, version: 1, versions: [version], createdAt: now() };
      db.put('plan', plan); return { plan: planView(plan) };
    });
  }
  function updatePlan(planId, body) {
    const data = z.object({ expectedVersion: z.number().int().positive(), goal: goalSchema, nodes: z.array(workNodeSchema).min(1).max(20) }).strict().parse(body);
    return db.transaction(() => {
      const plan = owned('plan', planId); if (data.expectedVersion !== plan.version) fail('计划已修改，请刷新后再编辑', 409);
      const old = plan.versions.at(-1);
      const protectedNodes = data.nodes.map(node => {
        const reference = old.nodes.find(item => item.id === node.id)?.revisionSource;
        if (node.revisionSource && digest(node.revisionSource) !== digest(reference)) fail('不能替换稿件修订来源，请从当前任务向总控提出修改', 409);
        const { revisionSource: _submitted, ...fields } = node;
        return { ...fields, ...(reference ? { revisionSource: reference } : {}) };
      });
      const nodes = prepareNodes(plan.projectId, protectedNodes);
      const diff = [...new Set([...old.nodes.map(node => node.id), ...nodes.map(node => node.id)])].filter(key => digest(old.nodes.find(node => node.id === key)) !== digest(nodes.find(node => node.id === key))).map(key => ({ nodeId: key, change: !old.nodes.some(node => node.id === key) ? 'added' : !nodes.some(node => node.id === key) ? 'removed' : 'changed' }));
      plan.version++;
      plan.versions.push({ version: plan.version, goal: data.goal, nodes, estimateUSD: nodes.reduce((sum, node) => sum + node.estimateUSD, 0), status: 'draft', planningMode: 'rules', planningCostUSD: 0, createdAt: now(), diff });
      db.put('plan', plan); return { plan: planView(plan) };
    });
  }
  async function approvePlan(planId, body) {
    const data = z.object({ version: z.number().int().positive(), idempotencyKey: keySchema, budgetUSD: z.number().finite().min(0).max(1000).optional() }).strict().parse(body);
    return once(`approve:${planId}`, data.idempotencyKey, data, () => {
      const plan = owned('plan', planId), version = plan.versions.find(version => version.version === data.version);
      if (!version || plan.version !== data.version) fail('请确认当前计划版本；旧版本不能用新批准执行', 409);
      if (version.status === 'approved') return { plan: planView(plan), tasks: version.taskIds.map(key => db.get('task', key)), runs: version.runIds.map(key => db.get('run', key)), reused: true };
      const state = store.get(); project(plan.projectId); version.nodes.forEach(node => accountFor(state, node));
      const previous = [...plan.versions].reverse().find(item => item.version < version.version && item.status === 'approved');
      const changed = new Set(version.nodes.filter(node => !previous || digest(previous.nodes.find(item => item.id === node.id)) !== digest(node)).map(node => node.id));
      let expanded; do { expanded = false; for (const node of version.nodes) if (!changed.has(node.id) && node.dependsOn.some(dependency => changed.has(dependency))) { changed.add(node.id); expanded = true; } } while (expanded);
      const runs = [], tasks = [], nodeRuns = new Map();
      for (const node of version.nodes) {
        const savedPrior = previous?.runIds.map(key => db.get('run', key)).find(run => run?.node.id === node.id);
        const latestPrior = savedPrior && db.get('run', db.get('task', savedPrior.taskId)?.latestRunId);
        const priorRun = latestPrior?.planId === savedPrior?.planId && latestPrior?.planVersion === savedPrior?.planVersion && latestPrior?.node?.id === node.id ? latestPrior : savedPrior;
        if (priorRun && !db.get('task', priorRun.taskId)?.deletedAt && !changed.has(node.id)) { runs.push(priorRun); tasks.push(db.get('task', priorRun.taskId)); nodeRuns.set(node.id, priorRun.id); continue; }
        const oldTask = db.all('task', owner()).find(task => !task.deletedAt && task.planId === planId && task.nodeId === node.id && task.accountId === node.accountId && task.role === node.role);
        if (node.revisionSource && oldTask?.id !== node.revisionSource.taskId) fail('该修订草案的原计划已变化，请从原任务按最新计划重新提出修改；尚未创建或派发新任务', 409);
        if (node.revisionSource) readRevision(plan.projectId, node, oldTask.id, node.revisionSource);
        const taskId = oldTask?.id || id(), runId = id();
        const run = { id: runId, ownerId: owner(), actor: actor(), taskId, projectId: plan.projectId, planId, planVersion: version.version, node: structuredClone(node), input: null, approval: null, dispatchMode: 'per-task', status: 'pending_approval', waitReason: node.dependsOn.length ? '等待前置成果后核对本次派工' : '请核对本次指令、Skills 与费用后确认派工', revision: 0, createdAt: now(), attempts: [], dependencyRuns: [], baseArtifactVersion: oldTask ? (db.get('artifact-head', oldTask.id)?.version || 0) : 0 };
        const account = state.accounts.find(account => account.id === node.accountId);
        const task = { ...(oldTask || {}), id: taskId, ownerId: owner(), projectId: plan.projectId, planId, nodeId: node.id, title: node.title, accountId: node.accountId, accountName: account?.name || '公共研究', role: node.role, latestRunId: runId, status: run.status, createdAt: oldTask?.createdAt || now(), updatedAt: now() };
        db.put('task', task); saveRun(run); event(run, 'plan.confirmed', '计划已保存，等待逐次确认 Agent 派工；未调用收费服务', { planVersion: version.version });
        runs.push(run); tasks.push(task); nodeRuns.set(node.id, runId);
      }
      for (const run of runs) if (run.planVersion === version.version) { run.dependencyRuns = run.node.dependsOn.map(key => nodeRuns.get(key)); db.put('run', run); }
      const retained = new Set(runs.map(run => run.id));
      for (const stale of db.all('run', owner())) if (stale.planId === planId && stale.status === 'pending_approval' && !retained.has(stale.id)) { stale.status = 'cancelled'; stale.finishedAt = now(); stale.waitReason = '新计划已替换尚未批准的派工'; saveRun(stale); event(stale, 'dispatch.superseded', stale.waitReason); }
      Object.assign(version, { status: 'approved', approvalMode: 'per-task', approvedAt: now(), approvedBy: owner(), budgetUSD: 0, taskIds: tasks.map(task => task.id), runIds: runs.map(run => run.id) });
      db.put('plan', plan); return { plan: planView(plan), tasks, runs };
    });
  }
  function assertLease(run, token) {
    const current = db.get('run', run.id);
    if (!current || current.lease?.token !== token || current.status !== 'running' || current.lease.workerId !== workerId) fail('运行所有权已变化，不能覆盖新状态', 409);
    return current;
  }
  function projectLegacy(run, artifact, replacedAssetId = '') {
    if (!['copy', 'script'].includes(artifact.kind) || !run.node.accountId || artifact.legacy?.assetId) return;
    // Each immutable version owns a separate media draft. A stable version key
    // also keeps transaction recovery from creating duplicate content drafts.
    const artifactId = artifact.artifactId || artifact.id;
    const versionKey = createHash('sha256').update(JSON.stringify(['work-artifact', run.ownerId, run.projectId, artifactId, artifact.version, ...(replacedAssetId ? ['recreate', replacedAssetId] : [])])).digest('hex');
    const requestId = `${versionKey.slice(0, 8)}-${versionKey.slice(8, 12)}-8${versionKey.slice(13, 16)}-a${versionKey.slice(17, 20)}-${versionKey.slice(20, 32)}`;
    store.mutate(state => {
      const p = state.projects.find(item => item.id === run.projectId);
      if (!p) fail('项目已不存在，成果需人工核对', 409);
      if (!state.accounts.some(account => account.id === run.node.accountId)) return;
      const asset = createContentDraft(state, p, { requestId, accountId: run.node.accountId, kind: artifact.kind === 'script' ? 'video' : 'image', requirement: run.node.requirement.slice(0, 4000), knowledgeIds: [], title: artifact.title.slice(0, 200) }, rulesOf(state));
      asset.title = artifact.title.slice(0, 200); asset.body = artifact.body;
      asset.contentBrief.knowledgeIds = run.node.knowledgeIds.slice(0, 8);
      if (run.input.creationTrace) asset.creationTrace = structuredClone(run.input.creationTrace); else delete asset.creationTrace;
      const strategy = p.strategies.find(item => item.id === asset.strategyId);
      if (strategy) { strategy.briefSnapshot = structuredClone(run.input.briefSnapshot); if (asset.creationTrace) strategy.creationTrace = structuredClone(asset.creationTrace); else delete strategy.creationTrace; }
      if (Array.isArray(artifact.structured?.scenes)) asset.scenes = artifact.structured.scenes;
      if (artifact.structured?.prompt) asset.prompt = artifact.structured.prompt;
      for (const field of ['knowledgeContext', 'skillTrace', 'review']) if (artifact.structured?.[field]) asset[field] = structuredClone(artifact.structured[field]);
      asset.workOrigin = { taskId: run.taskId, runId: run.id, artifactId, artifactVersion: artifact.version };
      artifact.legacy = { ...artifact.legacy, assetId: asset.id };
    });
  }
  function saveResult(runId, result, leaseToken, recovery = false) {
    return db.transaction(() => {
      let run = db.get('run', runId); if (!run) return;
      if (!recovery) run = assertLease(run, leaseToken);
      if (run.artifact) return db.get('artifact', `${run.artifact.id}:${run.artifact.version}`);
      const validated = z.object({ title: text(500).min(1), body: text(200000).min(1), kind: z.enum(['copy', 'script', 'research']), legacy: z.record(z.string(), z.unknown()).optional(), structured: z.unknown().optional(), usage: z.unknown().optional() }).passthrough().parse(result);
      const head = db.get('artifact-head', run.taskId), nextVersion = Math.max(head?.nextVersion || head?.version || 0, ...db.all('artifact', run.ownerId).filter(item => item.id === run.taskId).map(item => item.version)) + 1;
      const candidate = !!run.requestedAction || (head?.version || 0) !== run.baseArtifactVersion;
      const artifact = { id: run.taskId, version: nextVersion, ownerId: run.ownerId, projectId: run.projectId, accountId: run.node.accountId, taskId: run.taskId, runId, title: validated.title, body: validated.body, kind: validated.kind, structured: validated.structured, legacy: validated.legacy || {}, usage: redactWorkDetail(validated.usage), candidate, createdAt: now(), source: 'generated', dependencies: run.dependencies || [] };
      // Keep an immutable version as the primary result. Legacy editor mapping is
      // created in this same transaction and never overwrites an existing asset.
      if (!candidate) projectLegacy(run, artifact);
      db.put('artifact', { ...artifact, id: `${artifact.id}:${artifact.version}`, artifactId: artifact.id });
      db.put('artifact-head', { id: run.taskId, ownerId: run.ownerId, version: candidate ? head?.version || 0 : nextVersion, nextVersion });
      run.artifact = { id: artifact.id, version: artifact.version }; run.usage = artifact.usage;
      run.status = run.requestedAction === 'cancel' ? 'cancelled' : run.requestedAction === 'pause' ? 'paused' : candidate ? 'waiting_user' : 'succeeded';
      run.waitReason = candidate ? '返回结果已保存为候选版本，等待采用' : '';
      run.finishedAt = now(); delete run.lease; saveRun(run);
      event(run, 'artifact.saved', candidate ? '返回结果已保存为候选版本，未覆盖用户编辑' : '成果已保存并可读取', { artifactId: artifact.id, version: artifact.version, candidate });
      event(run, `task.${run.status}`, run.status === 'succeeded' ? '任务交付完成；尚未发布到平台' : '结果已保留，请核对后继续');
      notification(run, candidate ? 'action' : 'completed', candidate ? '候选成果等待核对' : '任务成果已完成', artifact);
      return artifact;
    });
  }
  async function execute(run) {
    const token = run.lease.token, controller = new AbortController();
    const heartbeat = setInterval(() => { try { db.transaction(() => { const current = assertLease(run, token); current.lease.expiresAt = Date.now() + leaseMs; db.put('run', current); }); } catch { clearInterval(heartbeat); } }, Math.max(250, leaseMs / 3)); heartbeat.unref?.();
    const entry = active.get(run.id); if (entry) entry.controller = controller;
    try {
      await runWithActor(run.actor, async () => {
        authorizeRun(run);
        const result = await (run.kind === 'planning' ? planner : executors).execute({ run: structuredClone(run), input: structuredClone(run.input), dependencies: structuredClone(run.dependencies || []), signal: controller.signal,
          emit: (type, summary, detail) => db.transaction(() => event(assertLease(run, token), type, summary, detail)),
          markSent: receipt => db.transaction(() => { const current = assertLease(run, token); authorizeRun(current); if (current.requestedAction) fail('任务已请求停止，未发送新的外部请求', 409); assertPlanBudget(current); current.sent = true; current.attempts.at(-1).sentAt = now(); current.attempts.at(-1).invocations ||= []; current.attempts.at(-1).invocations.push({ id: id(), ...redactWorkDetail(receipt), sentAt: now() }); saveRun(current); event(current, 'invocation.sent', '请求即将发送至已批准服务', receipt); }),
          checkpoint: checkpoint => db.transaction(() => { const current = assertLease(run, token); current.checkpoint = structuredClone(checkpoint); saveRun(current); event(current, 'checkpoint.saved', '服务回执检查点已保存', { type: checkpoint.type }); }),
        });
        db.transaction(() => { const current = assertLease(run, token); current.checkpoint = { type: run.kind === 'planning' ? 'planning_result_ready' : 'result_ready', result }; current.attempts.at(-1).receivedAt = now(); saveRun(current); });
        finishResult(run, result, token);
      });
    } catch (error) {
      db.transaction(() => {
        const current = db.get('run', run.id); if (!current || current.lease?.token !== token) return;
        const backoff = planWorkBackoff({ run: current, error, policy: config.workWaitPolicy });
        if (backoff.action === 'wait' || backoff.action === 'manual') {
          current.status = backoff.action === 'wait' ? 'queued' : 'paused'; current.waitReason = backoff.reason;
          if (backoff.wait) current.wait = backoff.wait;
          delete current.lease; saveRun(current); event(current, 'resource.waiting', current.waitReason, { wait: current.wait });
          if (backoff.action === 'manual') notification(current, 'action', '任务等待已达上限，请核对后继续');
          return;
        }
        current.error = clean(error.message || '任务暂时无法完成'); current.finishedAt = now();
        current.definitiveFailure = !!(error.noCharge || error.usage || error.definitive);
        current.status = hasReceipt(current) || current.sent && !current.definitiveFailure ? 'needs_reconciliation' : current.requestedAction === 'cancel' ? 'cancelled' : current.requestedAction === 'pause' ? 'paused' : 'failed';
        current.waitReason = current.status === 'needs_reconciliation' ? '外部请求可能已执行，未自动重发，请核对账单和回执' : '';
        if (current.attempts.length) Object.assign(current.attempts.at(-1), { finishedAt: now(), outcome: current.status, error: current.error });
        delete current.lease; saveRun(current); event(current, `task.${current.status}`, current.error, { waitReason: current.waitReason }); notification(current, 'action', current.status === 'needs_reconciliation' ? '外部结果待核实' : '任务需要处理');
      });
    } finally { clearInterval(heartbeat); active.delete(run.id); if (!closing) queueMicrotask(() => void tick()); }
  }
  function refreshDependencies(run) {
    const upstream = run.dependencyRuns.map(key => db.get('run', key));
    if (upstream.some(item => !item || ['failed', 'cancelled', 'needs_reconciliation', 'waiting_user'].includes(item.status))) {
      run.waitReason = '上游任务未交付，等待核对；独立任务继续'; db.put('run', run); return false;
    }
    if (upstream.some(item => item.status !== 'succeeded' || !item.artifact)) return false;
    run.dependencies = upstream.map(item => { const artifact = db.get('artifact', `${item.artifact.id}:${item.artifact.version}`); if (!artifact) fail('上游成果版本缺失'); return { taskId: item.taskId, runId: item.id, projectId: artifact.projectId, accountId: artifact.accountId || '', artifactId: item.artifact.id, version: item.artifact.version, title: artifact.title, body: artifact.body, kind: artifact.kind }; });
    run.status = 'queued'; run.waitReason = ''; saveRun(run); event(run, 'dependency.ready', '已绑定上游成果的固定版本', { dependencies: run.dependencies.map(({ body, ...metadata }) => metadata) }); return true;
  }
  function waitBeforeDispatch(run, code, reason) {
    if (run.status !== 'queued') return;
    const waiting = planWorkBackoff({ run, error: { code, noCharge: true, dispatched: false }, policy: config.workWaitPolicy });
    run.status = waiting.action === 'wait' ? 'queued' : 'paused';
    run.waitReason = waiting.action === 'wait' ? reason : waiting.reason;
    if (waiting.wait) run.wait = waiting.wait;
    saveRun(run); event(run, 'queue.waiting', run.waitReason, { wait: run.wait });
    if (waiting.action !== 'wait') notification(run, 'action', '任务等待需要核对');
  }
  async function tick() {
    if (closing || ticking || !autoStart) return;
    ticking = true;
    try {
      const candidates = db.all('run').filter(run => ['queued', 'waiting_dependencies'].includes(run.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      candidates.sort((a, b) => Number(a.ownerId === lastOwner) - Number(b.ownerId === lastOwner));
      for (let candidate of candidates) {
        if (active.size >= concurrency || closing) break;
        // A provider/resource delay is not a dependency completion signal.
        // Refresh first, and persist the fixed upstream artifact packet before
        // allowing only genuinely ready queued work through dispatch gates.
        let ready = false;
        runWithActor(candidate.actor, () => db.transaction(() => {
          candidate = db.get('run', candidate.id); if (!candidate || !['queued', 'waiting_dependencies'].includes(candidate.status)) return;
          try { authorizeRun(candidate); } catch (error) { candidate.status = 'waiting_user'; candidate.waitReason = clean(error.message); saveRun(candidate); event(candidate, 'permission.changed', candidate.waitReason); notification(candidate, 'action', '任务权限需重新确认'); return; }
          if (candidate.dispatchMode === 'per-task' && (!candidate.input || candidate.approval?.scope !== 'task-only')) { candidate.status = 'pending_approval'; candidate.waitReason = '请先明确批准本次派工'; saveRun(candidate); return; }
          if (candidate.lease && candidate.lease.expiresAt > Date.now()) return;
          if (candidate.dispatchMode === 'per-task' && candidate.dependencyRuns.length !== (candidate.dependencies?.length || 0)) { candidate.status = 'pending_approval'; candidate.input = null; candidate.approval = null; delete candidate.dependencies; candidate.waitReason = '固定前置成果不完整，请重新估算并确认'; saveRun(candidate); return; }
          // Also repair old queued records that never bound their dependencies.
          if (candidate.dependencyRuns.length && candidate.dependencies?.length !== candidate.dependencyRuns.length) candidate.status = 'waiting_dependencies';
          if (candidate.status === 'waiting_dependencies' && !refreshDependencies(candidate)) return;
          ready = candidate.status === 'queued';
        }));
        if (!ready) continue;
        if (candidate.wait) {
          const waiting = workWaitStatus(candidate.wait);
          if (waiting === 'waiting') continue;
          if (waiting !== 'ready') { candidate.status = 'paused'; candidate.waitReason = '自动等待已到时限或系统时间变化，请核对后继续'; saveRun(candidate); event(candidate, 'queue.wait.expired', candidate.waitReason); notification(candidate, 'action', '任务等待需要处理'); continue; }
        }
        const provider = candidate.input.modelRoute?.provider || 'default';
        const admission = providerAdmission({ provider, activeRuns: [...active.values()], limits: config.workProviderLimits || {}, defaultLimit: providerConcurrency });
        if (!admission.allowed) { waitBeforeDispatch(candidate, 'WORK_RATE_GATE', admission.reason); continue; }
        const resource = candidate.node.role === 'douyin-research' ? 'research' : `work-task:${candidate.taskId}`;
        if (activeJobs && !activeJobs.canAcquire(candidate.projectId, resource)) { waitBeforeDispatch(candidate, 'WORK_RESOURCE_BUSY', '等待现有任务释放共享资源'); continue; }
        let claimed;
        runWithActor(candidate.actor, () => db.transaction(() => {
          candidate = db.get('run', candidate.id); if (!candidate || candidate.status !== 'queued') return;
          try { authorizeRun(candidate); } catch (error) { candidate.status = 'waiting_user'; candidate.waitReason = clean(error.message); saveRun(candidate); event(candidate, 'permission.changed', candidate.waitReason); notification(candidate, 'action', '任务权限需重新确认'); return; }
          if (candidate.lease && candidate.lease.expiresAt > Date.now()) return;
          candidate.status = 'running'; candidate.waitReason = ''; candidate.startedAt = now(); candidate.attemptId = id();
          candidate.lease = { workerId, token: id(), expiresAt: Date.now() + leaseMs };
          candidate.attempts.push({ id: candidate.attemptId, claimedAt: now(), workerId }); saveRun(candidate); event(candidate, 'task.started', '后台任务已开始'); claimed = candidate;
        }));
        if (claimed) { lastOwner = claimed.ownerId; const entry = { provider, promise: null }; active.set(claimed.id, entry); entry.promise = execute(claimed); }
      }
    } finally { ticking = false; }
  }
  function recover() {
    for (const run of db.all('run')) {
      if (run.status !== 'running') continue;
      // A second process must never steal a live lease. An expired owner can be
      // recovered, but an external request is never implicitly replayed.
      if (run.lease?.expiresAt > Date.now()) continue;
      runWithActor(run.actor, () => {
        if (hasReceipt(run)) { try { finishResult(run, run.checkpoint.result, null, true); return; } catch { /* preserve receipt and require reconciliation */ } }
        db.transaction(() => { run.status = run.sent ? 'needs_reconciliation' : 'paused'; run.waitReason = run.sent ? '上次运行在外部请求之后中断，需核对回执与费用' : '上次运行中断，尚未派发外部请求；可明确继续'; delete run.lease; saveRun(run); event(run, 'task.interrupted', run.waitReason); notification(run, 'action', '中断任务已保留'); });
      });
    }
  }
  function commands(runId, body) {
    const data = z.object({ command: z.enum(['pause', 'resume', 'cancel', 'retry', 'reconcile']), expectedRevision: z.number().int().positive(), idempotencyKey: keySchema, resolution: z.enum(['not_sent', 'confirmed_failed', 'keep_unknown', 'save_receipt']).optional() }).strict().parse(body);
    return once(`run:${runId}`, data.idempotencyKey, data, () => {
      let run = owned('run', runId); if (run.revision !== data.expectedRevision) fail('任务状态已变化，请刷新后重试', 409);
      if (['pause', 'cancel'].includes(data.command)) {
        if (finalStates.has(run.status)) fail('任务已结束，不能停止', 409);
        if (run.status === 'needs_reconciliation') fail('外部结果未知，请先核对；停止不能抹去费用和回执', 409);
        if (run.status === 'running') { run.requestedAction = data.command; event(run, 'stop.requested', '已请求在安全边界停止；已发送请求仍需等待回执'); }
        else { run.status = data.command === 'pause' ? 'paused' : 'cancelled'; run.finishedAt = now(); event(run, `task.${run.status}`, data.command === 'pause' ? '任务已暂停，未派发新请求' : '任务已取消，未派发新请求'); }
      } else if (data.command === 'resume') {
        if (run.status !== 'paused' || run.sent || run.artifact) fail('只有未发送外部请求的暂停任务可直接继续；其他情况请核对结果或创建新运行', 409);
        authorizeRun(run); run.status = run.dispatchMode === 'per-task' && !run.approval ? 'pending_approval' : run.dependencyRuns.length && !run.dependencies?.length ? 'waiting_dependencies' : 'queued'; delete run.requestedAction; delete run.finishedAt; delete run.wait; event(run, 'task.resumed', '任务已重新排队');
      } else if (data.command === 'retry') {
        if (owned('task', run.taskId).deletedAt) fail('任务记录已删除，请从总控创建并确认新的任务', 409);
        if (owned('task', run.taskId).latestRunId !== run.id) fail('此运行已有新的后继任务，请查看最新运行，不能重复重试旧记录', 409);
        if (hasReceipt(run)) fail('已保存模型回执，请先核对并保存该成果，不能重复发送生成请求', 409);
        if (!['failed', 'cancelled'].includes(run.status) || (run.sent && !run.reconciled && !run.attempts.at(-1)?.receivedAt && !run.definitiveFailure)) fail('此任务尚不能重试，请先核对外部结果和费用', 409);
        authorizeRun(run);
        // Retry is an explicit new execution approved by this command, bounded
        // by the same per-run limit, with no hidden auto-retry of unknown calls.
        const prior = run;
        run = { ...structuredClone(run), id: id(), revision: 0, status: run.dependencyRuns.length ? 'waiting_dependencies' : 'queued', createdAt: now(), attempts: [], sent: false, retryOf: prior.id, baseArtifactVersion: db.get('artifact-head', run.taskId)?.version || 0 };
        for (const field of ['lease', 'artifact', 'checkpoint', 'requestedAction', 'error', 'finishedAt', 'startedAt', 'reconciled', 'definitiveFailure', 'wait']) delete run[field];
        if (run.kind !== 'planning') { run.dispatchMode = 'per-task'; run.status = 'pending_approval'; run.input = null; run.approval = null; delete run.dependencies; run.waitReason = '重试已准备，请核对指令、Skills 与额度并批准本次新派工'; }
        db.put('task', { ...db.get('task', run.taskId), latestRunId: run.id }); event(run, run.kind === 'planning' ? 'retry.approved' : 'retry.prepared', run.kind === 'planning' ? '用户确认创建新的规划运行，历史结果保留' : '重试已准备，尚未批准收费执行', { priorRunId: prior.id, budgetUSD: run.approval?.budgetUSD });
      } else {
        if (run.status !== 'needs_reconciliation') fail('任务不在待核对状态', 409);
        if (data.resolution === 'save_receipt' && hasReceipt(run)) { finishResult(run, run.checkpoint.result, null, true); return { run: db.get('run', run.id) }; }
        if (data.resolution === 'not_sent' && run.sent) fail('已有外部派发记录，不能声明未发送；请核对服务商回执', 409);
        if (data.resolution === 'confirmed_failed') { run.status = 'failed'; run.reconciled = { by: owner(), at: now(), resolution: data.resolution }; run.waitReason = '用户确认外部请求失败；费用仍按原用量记录核对，不自动释放'; }
        else run.waitReason = '仍保留未知结果和预留费用，未重新发送';
        event(run, 'result.reconciled', run.waitReason, { resolution: data.resolution || 'keep_unknown' });
      }
      saveRun(run); queueMicrotask(() => void tick()); return { run };
    });
  }
  const publicArtifact = row => row ? { ...row, id: row.artifactId || row.id, headVersion: db.get('artifact-head', row.artifactId || row.id)?.version || 0 } : null;
  function taskView(task, runs = db.all('run', owner()).filter(run => run.taskId === task.id)) {
    const legacyCompleted = run => run.source === 'legacy-checkpoint' && ['completed', 'failed'].includes(run.legacy?.status);
    const removable = !task.deletedAt && runs.length > 0 && runs.every(run => finalStates.has(run.status) || legacyCompleted(run));
    return { ...task, latestRunCreatedAt: runs.find(run => run.id === task.latestRunId)?.createdAt || task.createdAt, removable, deletionBlockedReason: removable || task.deletedAt ? '' : '任务仍有未结束或待核对的运行，请先处理这些运行。' };
  }
  function removeTask(taskId, body) {
    const data = z.object({ expectedRunId: identifier }).strict().parse(body);
    return db.transaction(() => {
      const task = owned('task', taskId);
      if (task.latestRunId !== data.expectedRunId) fail('任务已有新的运行，请刷新后再删除', 409);
      if (task.deletedAt) return { ok: true, taskId, deletedAt: task.deletedAt };
      const runs = db.all('run', owner()).filter(run => run.taskId === taskId), view = taskView(task, runs);
      if (!view.removable) fail(view.deletionBlockedReason, 409);
      // Keep approved budgets, receipts and fixed upstream artifact references.
      // Removing a task from the workspace must not erase spending evidence or
      // break a downstream run that still uses its result.
      const deletedAt = now();
      db.put('task', { ...task, deletedAt, updatedAt: deletedAt });
      for (const run of runs) event(run, 'task.removed', '用户已从任务列表删除此任务，成果与费用记录仍保留');
      for (const row of db.all('notification', owner()).filter(row => row.target?.taskId === taskId || row.taskId === taskId)) db.put('notification', { ...row, deletedAt, readAt: row.readAt || deletedAt });
      if (task.source === 'legacy-checkpoint') {
        const legacyIds = new Set(runs.map(run => run.legacy?.id).filter(Boolean));
        store.mutate(state => { state.taskJournal = (state.taskJournal || []).filter(row => !legacyIds.has(row.id)); });
      }
      return { ok: true, taskId, deletedAt };
    });
  }
  function taskDetail(taskId) {
    const task = owned('task', taskId); project(task.projectId);
    const runs = db.all('run', owner()).filter(run => run.taskId === taskId).reverse();
    return { task: taskView(task, runs), runs, artifacts: db.all('artifact', owner()).filter(row => row.taskId === taskId).map(publicArtifact).sort((a, b) => b.version - a.version) };
  }
  function prepareArtifactMedia(artifactId, version) {
    return db.transaction(() => {
      const artifact = owned('artifact', `${artifactId}:${version}`);
      if (!['copy', 'script'].includes(artifact.kind)) fail('只有图文文案或视频脚本可以继续制作媒体');
      if (artifact.candidate) fail('请先明确采用候选成果，再继续制作图片或视频', 409);
      const run = owned('run', artifact.runId), p = project(artifact.projectId);
      if (artifact.projectId !== run.projectId || artifact.taskId !== run.taskId || !artifact.accountId || artifact.accountId !== run.node.accountId) fail('成果与原任务的项目或固定账号不一致，未创建素材', 409);
      const account = accountFor(store.get(), run.node);
      const previousAssetId = artifact.legacy?.assetId || '';
      const matchesVersion = asset => asset.workOrigin?.artifactId === artifactId && asset.workOrigin.artifactVersion === version;
      const linked = previousAssetId ? p.assets.find(asset => asset.id === previousAssetId) : null;
      const existing = linked || p.assets.find(matchesVersion);
      if (existing) {
        if (!matchesVersion(existing) || existing.contentBrief?.accountId !== account.id || existing.channel !== account.platform) fail('已有素材与此成果版本或固定账号不一致，请核对后继续', 409);
        if (artifact.legacy?.assetId !== existing.id) { artifact.legacy = { ...artifact.legacy, assetId: existing.id }; db.put('artifact', artifact); }
        return { assetId: existing.id, projectId: p.id };
      }
      // Older edited versions omitted their media link. Repair only that exact
      // version; a removed linked draft gets a fresh key, never an older asset.
      artifact.legacy = { ...artifact.legacy, assetId: undefined };
      projectLegacy(run, artifact, previousAssetId);
      if (!artifact.legacy?.assetId) fail('原目标账号已不可用，未创建素材', 409);
      db.put('artifact', artifact);
      event(run, 'artifact.media.prepared', '已为此成果版本准备媒体草稿；未生成图片或视频、未调用收费服务', { artifactId, version, assetId: artifact.legacy.assetId });
      return { assetId: artifact.legacy.assetId, projectId: p.id };
    });
  }
  function editArtifact(artifactId, version, body) {
    const data = z.object({ title: text(500).min(1), body: text(200000).min(1), expectedHeadVersion: z.number().int().nonnegative(), idempotencyKey: keySchema }).strict().parse(body);
    return once(`artifact:${artifactId}`, data.idempotencyKey, { version, ...data }, () => {
      const source = owned('artifact', `${artifactId}:${version}`), head = db.get('artifact-head', artifactId);
      if ((head?.version || 0) !== data.expectedHeadVersion) fail('成果已在另一处更新，请比较版本后再保存', 409);
      const next = (head?.nextVersion || head?.version || 0) + 1;
      const artifact = { ...source, id: `${artifactId}:${next}`, artifactId, title: data.title, body: data.body, version: next, candidate: false, source: 'user', basedOnVersion: version, legacy: {}, createdAt: now() };
      const run = owned('run', source.runId);
      projectLegacy(run, artifact);
      db.put('artifact', artifact); db.put('artifact-head', { id: artifactId, ownerId: owner(), version: next, nextVersion: next });
      event(run, 'artifact.edited', '用户保存了新成果版本，原版本保留', { version: next });
      return { artifact: publicArtifact(artifact) };
    });
  }
  function adoptArtifact(artifactId, version, body) {
    const data = z.object({ expectedHeadVersion: z.number().int().nonnegative(), idempotencyKey: keySchema }).strict().parse(body);
    return once(`adopt:${artifactId}`, data.idempotencyKey, { version, ...data }, () => {
      const source = owned('artifact', `${artifactId}:${version}`), run = owned('run', source.runId), head = db.get('artifact-head', artifactId);
      if (!source.candidate || !['waiting_user', 'paused'].includes(run.status)) fail('只有等待核对或暂停中的候选成果可以采用；已取消任务不能转为成功', 409);
      if ((head?.version || 0) !== data.expectedHeadVersion) fail('当前成果版本已改变，请先比较版本再采用', 409);
      const next = (head?.nextVersion || head?.version || 0) + 1;
      const artifact = { ...source, id: `${artifactId}:${next}`, artifactId, version: next, candidate: false, source: 'adopted', basedOnVersion: version, createdAt: now(), adoptedBy: owner() };
      if (run.kind === 'planning') planning.applyProposal(run, artifact.structured);
      else { const legacyProjection = { ...artifact, id: artifactId }; projectLegacy(run, legacyProjection); artifact.legacy = legacyProjection.legacy; }
      db.put('artifact', artifact); db.put('artifact-head', { id: artifactId, ownerId: owner(), version: next, nextVersion: next });
      run.artifact = { id: artifactId, version: next }; run.status = 'succeeded'; run.waitReason = ''; run.finishedAt = now(); delete run.requestedAction; saveRun(run);
      event(run, 'artifact.adopted', '用户明确采用候选成果，依赖任务可使用此固定版本', { artifactId, version: next, basedOnVersion: version }); notification(run, 'completed', '候选成果已采用', publicArtifact(artifact));
      queueMicrotask(() => void tick()); return { artifact: publicArtifact(artifact), run };
    });
  }
  function migrateLegacy() {
    return db.transaction(() => {
      const markerId = `${owner()}:legacy-v1`;
      if (db.get('migration', markerId)) return;
      const rows = (store.get().taskJournal || []).filter(row => !row.dismissed);
      for (const row of rows) {
        const taskId = `legacy:${owner()}:${row.id}`, runId = `${taskId}:checkpoint`;
        const status = ['running', 'pausing', 'paused', 'interrupted'].includes(row.status) ? 'needs_reconciliation' : row.status === 'completed' ? 'waiting_user' : 'failed';
        db.put('task', { id: taskId, ownerId: owner(), projectId: row.projectId, accountId: row.accountId || '', accountName: row.accountName || '', title: row.label, role: 'legacy', source: 'legacy-checkpoint', status, latestRunId: runId, createdAt: new Date(row.startedAt || Date.now()).toISOString(), legacyTarget: { page: row.page, ...row.target } });
        const run = { id: runId, taskId, ownerId: owner(), projectId: row.projectId, actor: actor(), status, revision: 1, source: 'legacy-checkpoint', node: { accountId: row.accountId || '' }, attempts: [], createdAt: now(), waitReason: '旧版客户端检查点，不代表后台执行证据；请到旧流程核对回执与用量。', legacy: row };
        db.put('run', run); event(run, 'legacy.imported', '已迁入现存旧记录，未派发任务、未修改预算');
      }
      db.put('migration', { id: markerId, ownerId: owner(), at: now(), count: rows.length });
    });
  }
  function mount(app) {
    const publicRun = run => {
      const { checkpoint, input, actor: savedActor, legacy, ...record } = run;
      const usageRows = store.get().projects.find(project => project.id === run.projectId)?.usage.filter(row => row.runId === run.id || row.planningRunId === run.id) || [];
      const sum = predicate => usageRows.filter(predicate).reduce((total, row) => total + (Number(row.amountUsd) || 0), 0);
      const usage = { estimatedUSD: input?.estimateUSD ?? run.node?.estimateUSD ?? 0, reservedUSD: sum(row => row.status === 'running'), settledUSD: sum(row => row.status === 'completed' && !row.estimated), unknownUSD: sum(row => row.status === 'uncertain' || row.status === 'completed' && row.estimated), records: usageRows.map(row => ({ id: row.id, model: row.model, status: row.status, amountUSD: row.amountUsd, estimated: row.estimated })) };
      return { ...record, usage, ...(run.kind !== 'planning' ? { dispatch: dispatch.describe(run) } : {}), input: { role: input?.role || run.node?.role, platform: input?.platform, accountId: input?.accountId, accountName: input?.accountName, requirement: input?.requirement || input?.goal, modelRoute: input?.modelRoute ? { provider: input.modelRoute.provider, model: input.modelRoute.model, label: input.modelRoute.label } : undefined, skills: input?.skills, estimateUSD: input?.estimateUSD, budgetUSD: input?.budgetUSD ?? input?.planningBudgetUSD, permissions: input?.permissions, knowledgeIds: input?.knowledgeIds, identityRevision: input?.creationTrace?.accounts?.[0]?.profileRevision }, receiptAvailable: hasReceipt(run) };
    };
    app.get('/api/work-capabilities', (_req, res) => res.json({ enabled: true, roles: WORK_ROLES, models: Object.entries(MODELS).map(([id, value]) => ({ id, ...value })), note: '任务在后端执行；总控规则草案不收费。后台进程退出或电脑休眠后不能继续。文案、研究与配图分别批准，不自动发布。' }));
    app.get('/api/projects/:id/controller-view', (req, res) => {
      project(req.params.id);
      res.json(db.get('controller-view', `${owner()}:${req.params.id}`) || { goal: '', accountIds: [], model: '', planId: '', planningMode: 'ai' });
    });
    app.get('/api/projects/:id/controller-messages', (req, res) => { project(req.params.id); res.json({ items: controllerHistory(db, owner(), req.params.id) }); });
    app.post('/api/projects/:id/controller-messages', (req, res) => res.status(201).json(chat.send(req.params.id, req.body)));
    app.put('/api/projects/:id/controller-view', (req, res) => {
      project(req.params.id);
      const data = z.object({ goal: text(16000), accountIds: z.array(identifier).max(20), model: text(100), planId: text(160), planningMode: z.enum(['ai', 'rules']), replyTaskId: text(160), replyRunId: text(160), newConversation: z.boolean() }).partial().strict().parse(req.body);
      if (data.planId && owned('plan', data.planId).projectId !== req.params.id) fail('所选计划不属于当前项目', 409);
      if (data.replyTaskId && owned('task', data.replyTaskId).projectId !== req.params.id) fail('回复目标不属于当前项目', 409);
      if (data.replyRunId) { const run = owned('run', data.replyRunId); if (run.projectId !== req.params.id || run.kind !== 'planning') fail('追问来源不属于当前项目总控', 409); }
      const recordId = `${owner()}:${req.params.id}`;
      res.json(db.put('controller-view', { ...db.get('controller-view', recordId), ...data, id: recordId, ownerId: owner(), projectId: req.params.id, updatedAt: now() }));
    });
    app.post('/api/projects/:id/work-plans', (req, res) => res.status(201).json(createPlan(req.params.id, req.body)));
    app.post('/api/projects/:id/planning/estimate', (req, res) => res.json(planning.estimate(req.params.id, req.body)));
    app.post('/api/projects/:id/planning-runs', async (req, res) => { const result = await planning.start(req.params.id, req.body); res.status(201).json({ ...result, run: publicRun(result.run) }); });
    app.get('/api/planning-runs/:id', (req, res) => {
      const run = owned('run', req.params.id); if (run.kind !== 'planning') fail('此运行不是总控规划', 404);
      res.json({ run: publicRun(run), ...(run.planningPlanId ? { plan: planView(owned('plan', run.planningPlanId)) } : {}), ...(run.planningQuestion ? { question: run.planningQuestion } : {}) });
    });
    app.get('/api/projects/:id/work-plans', (req, res) => { project(req.params.id); res.json({ items: db.all('plan', owner()).filter(plan => plan.projectId === req.params.id).reverse().slice(0, 100).map(planView) }); });
    app.get('/api/work-plans/:id', (req, res) => res.json({ plan: planView(owned('plan', req.params.id)) }));
    app.patch('/api/work-plans/:id', (req, res) => res.json(updatePlan(req.params.id, req.body)));
    app.post('/api/work-plans/:id/approvals', async (req, res) => { const result = await approvePlan(req.params.id, req.body); res.json({ ...result, runs: result.runs.map(publicRun) }); });
    app.get(['/api/projects/:id/tasks', '/api/tasks'], (req, res) => {
      migrateLegacy(); if (req.params.id) project(req.params.id);
      const rows = db.all('task', owner()).filter(task => !task.deletedAt && (!req.params.id || task.projectId === req.params.id) && (!req.query.accountId || task.accountId === req.query.accountId) && (!req.query.status || task.status === req.query.status)).reverse();
      const position = req.query.after ? rows.findIndex(item => item.id === req.query.after) + 1 : 0;
      const runs = db.all('run', owner()), items = rows.slice(position, position + 50).map(task => taskView(task, runs.filter(run => run.taskId === task.id))); res.json({ items, nextCursor: rows.length > position + items.length ? items.at(-1).id : null });
    });
    app.get('/api/tasks/:id', (req, res) => { const result = taskDetail(req.params.id); res.json({ ...result, runs: result.runs.map(publicRun) }); });
    app.delete('/api/tasks/:id', (req, res) => res.json(removeTask(req.params.id, req.body)));
    app.get('/api/task-runs/:id', (req, res) => { const run = owned('run', req.params.id); res.json({ run: publicRun(run), artifacts: taskDetail(run.taskId).artifacts.filter(artifact => artifact.runId === run.id), eventsCursor: db.cursor(run.id) }); });
    app.post('/api/task-runs/:id/approval-estimate', (req, res) => res.json(dispatch.estimate(req.params.id, req.body)));
    app.post('/api/task-runs/:id/approvals', async (req, res) => { const result = await dispatch.approve(req.params.id, req.body); res.json({ ...result, run: publicRun(result.run) }); });
    app.post('/api/task-runs/:id/commands', (req, res) => { const run = owned('run', req.params.id); if (run.source === 'legacy-checkpoint') fail('旧检查点请回到原任务核对；不能直接派发'); res.json({ run: publicRun(commands(run.id, req.body).run) }); });
    // Authenticated short polling is the stream transport: each page is a fresh
    // authorized request, so revoked sessions cannot retain an open connection.
    app.get('/api/task-runs/:id/events', (req, res) => {
      owned('run', req.params.id); const after = z.coerce.number().int().nonnegative().parse(req.query.after || 0), archived = db.get('archive', req.params.id);
      if (archived && after < archived.through) return res.status(409).json({ error: '此游标已归档，请重新加载历史', resync: true, archivedThrough: archived.through });
      const events = db.events(req.params.id, after, 101); res.json({ items: events.slice(0, 100), nextCursor: events.slice(0, 100).at(-1)?.sequence || after, hasMore: events.length > 100 });
    });
    app.get('/api/task-runs/:id/archive', (req, res) => { owned('run', req.params.id); res.json({ archive: db.get('archive', req.params.id) }); });
    app.post('/api/task-runs/:id/archive', (req, res) => { const run = owned('run', req.params.id); if (!finalStates.has(run.status)) fail('未结束任务不能归档活动'); const through = z.number().int().nonnegative().parse(req.body.through); res.json({ archive: db.archiveEvents(run.id, through) }); });
    app.get('/api/tasks/:id/view', (req, res) => { owned('task', req.params.id); res.json(db.get('view', `${owner()}:${req.params.id}`) || { cursor: 0, expandedIds: [], draft: '', scrollTop: 0 }); });
    app.put('/api/tasks/:id/view', (req, res) => {
      owned('task', req.params.id); const data = z.object({ cursor: z.number().int().nonnegative(), expandedIds: z.array(identifier).max(100), draft: text(16000), scrollTop: z.number().finite().nonnegative(), runId: text(160), dispatchDraft: z.object({ runId: identifier, baseRevision: z.number().int().positive(), requirement: text(4000), model: text(100), skillMode: z.enum(['default', 'selected', '']), skillIds: z.array(identifier).max(8), budgetUSD: z.number().finite().min(0).max(1000) }).strict().nullable(), mediaDrafts: z.record(z.string().min(1).max(240), z.object({ count: z.number().int().min(1).max(4), modelKey: text(250), skillId: text(160).nullable(), prompts: z.record(z.string().regex(/^[0-3]$/), z.string().max(1200)), textMode: z.enum(['title', 'none']), watermark: z.boolean() }).strict().nullable()).refine(value => Object.keys(value).length <= 12), artifactDrafts: z.record(z.string().min(1).max(240), z.object({ title: text(500), body: z.string().max(200000), baseVersion: z.number().int().nonnegative() }).strict().nullable()).refine(value => Object.keys(value).length <= 12, '每次最多保存 12 份编辑草稿') }).partial().strict().parse(req.body);
      const viewId = `${owner()}:${req.params.id}`;
      if (data.runId && owned('run', data.runId).taskId !== req.params.id) fail('阅读位置的运行不属于当前任务', 409);
      if (data.dispatchDraft && owned('run', data.dispatchDraft.runId).taskId !== req.params.id) fail('派工草稿不属于当前任务', 409);
      const previous = db.get('view', viewId) || { cursor: 0, expandedIds: [], draft: '', scrollTop: 0 };
      if (data.mediaDrafts) {
        for (const key of Object.keys(data.mediaDrafts)) if (owned('artifact', key).taskId !== req.params.id) fail('图片草稿不属于此任务', 409);
        data.mediaDrafts = { ...previous.mediaDrafts, ...data.mediaDrafts };
        for (const [key, value] of Object.entries(data.mediaDrafts)) if (value === null) delete data.mediaDrafts[key];
        if (Object.keys(data.mediaDrafts).length > 12) fail('此任务已保留 12 份图片设置草稿，请先整理旧版本');
      }
      if (data.artifactDrafts) {
        for (const key of Object.keys(data.artifactDrafts)) if (owned('artifact', key).taskId !== req.params.id) fail('编辑草稿不属于此任务', 409);
        data.artifactDrafts = { ...previous.artifactDrafts, ...data.artifactDrafts };
        for (const [key, value] of Object.entries(data.artifactDrafts)) if (value === null) delete data.artifactDrafts[key];
        if (Object.keys(data.artifactDrafts).length > 12) fail('此任务已保留 12 份编辑草稿，请先保存成果或清理不用的草稿');
      }
      res.json(db.put('view', { ...previous, ...data, id: viewId, ownerId: owner(), updatedAt: now() }));
    });
    app.get('/api/tasks/:id/messages', (req, res) => { owned('task', req.params.id); res.json({ items: db.all('message', owner()).filter(row => row.taskId === req.params.id).slice(-200) }); });
    app.post('/api/tasks/:id/messages', (req, res) => {
      const data = z.object({ text: text(16000).min(1), idempotencyKey: keySchema, expectedRevision: z.number().int().optional() }).strict().parse(req.body);
      res.json(once(`message:${req.params.id}`, data.idempotencyKey, data, () => {
        const task = owned('task', req.params.id), run = owned('run', task.latestRunId);
        if (data.expectedRevision !== undefined && data.expectedRevision !== run.revision) fail('当前任务已变化，请核对后发送', 409);
        const message = { id: id(), ownerId: owner(), taskId: task.id, runId: run.id, role: 'user', text: data.text, at: now(), inputRevision: run.revision }; db.put('message', message);
        const response = { id: id(), ownerId: owner(), taskId: task.id, runId: run.id, role: 'assistant', text: `已记录到本任务。当前状态：${run.status}。${run.artifact ? '成果已保留，可在成果区编辑并保存新版本。' : '后续执行仍按已批准的输入进行。'}修改执行目标请在本页向总控提交修订计划并确认；本次消息未触发收费请求。`, at: now(), source: 'program-fact' }; db.put('message', response);
        return { items: db.all('message', owner()).filter(row => row.taskId === task.id).slice(-200) };
      }));
    });
    app.get('/api/artifacts/:id/versions/:version', (req, res) => res.json({ artifact: publicArtifact(owned('artifact', `${req.params.id}:${z.coerce.number().int().positive().parse(req.params.version)}`)) }));
    app.put('/api/artifacts/:id/versions/:version', (req, res) => res.json(editArtifact(req.params.id, z.coerce.number().int().positive().parse(req.params.version), req.body)));
    app.post('/api/artifacts/:id/versions/:version/media-draft', (req, res) => res.json(prepareArtifactMedia(req.params.id, z.coerce.number().int().positive().parse(req.params.version))));
    app.post('/api/artifacts/:id/versions/:version/adopt', (req, res) => { const result = adoptArtifact(req.params.id, z.coerce.number().int().positive().parse(req.params.version), req.body); res.json({ ...result, run: publicRun(result.run) }); });
    app.get('/api/notifications', (_req, res) => { const rows = db.all('notification', owner()).filter(row => !row.deletedAt).reverse(); res.json({ items: rows.slice(0, 200), unread: rows.filter(row => !row.readAt).length }); });
    app.get('/api/notifications/:id', (req, res) => res.json({ notification: owned('notification', req.params.id) }));
    app.post('/api/notifications/:id/read', (req, res) => { const row = owned('notification', req.params.id); row.readAt ||= now(); res.json(db.put('notification', row)); });
    app.post('/api/notifications/:id/delivery', (req, res) => { const data = z.object({ delivered: z.boolean() }).strict().parse(req.body), row = owned('notification', req.params.id); row.deliveryAttemptedAt = now(); if (data.delivered) row.deliveredAt = now(); res.json(db.put('notification', row)); });
    app.get('/api/work-progress', (_req, res) => { const visibleTasks = new Set(db.all('task', owner()).filter(task => !task.deletedAt).map(task => task.id)), rows = db.all('run', owner()).filter(run => visibleTasks.has(run.taskId)); res.json({ running: rows.filter(run => run.status === 'running').length, queued: rows.filter(run => ['queued', 'waiting_dependencies'].includes(run.status)).length, needsAttention: rows.filter(run => ['pending_approval', 'waiting_user', 'needs_reconciliation', 'failed'].includes(run.status)).length }); });
  }
  recover();
  db.onClose?.(() => { closing = true; clearInterval(timer); });
  if (autoStart) { timer = setInterval(() => { try { recover(); void tick().catch(() => {}); } catch { /* Database shutdown: never re-dispatch on an uncertain storage error. */ } }, 750); timer.unref?.(); }
  return { mount, createPlan, updatePlan, approvePlan, estimateDispatch: dispatch.estimate, approveDispatch: dispatch.approve, describeDispatch: dispatch.describe, estimatePlanning: planning.estimate, startPlanning: planning.start, commands, taskDetail, removeTask, prepareArtifactMedia, editArtifact, adoptArtifact, migrateLegacy, tick, recover,
    get activeCount() { return active.size; },
    async close() {
      if (closing) return; closing = true; clearInterval(timer);
      config.onWorkProgress?.({ ownerId: config.workOwnerId || 'workspace', active: 0, paused: 0 });
      db.transaction(() => {
        for (const run of db.all('run')) {
          if (['queued', 'waiting_dependencies'].includes(run.status)) { run.status = 'paused'; run.waitReason = '后台服务已退出，恢复后需明确继续'; saveRun(run); event(run, 'service.stopping', run.waitReason); }
          else if (run.status === 'running' && run.lease?.workerId === workerId) { run.requestedAction = 'pause'; saveRun(run); event(run, 'service.stopping', '服务退出已请求停止，等待已发送请求回执'); }
        }
      });
      await Promise.allSettled([...active.values()].map(entry => entry.promise));
    },
  };
}
