const scopeKey = ids => [...new Set(ids || [])].sort().join('\n');
// The controller sees only its own planning conversation and public plan
// summaries. Task-private messages, raw model packets and credentials never
// participate in this projection or in follow-up planning context.
export function controllerHistory(db, ownerId, projectId, accountIds) {
  const scoped = accountIds !== undefined, key = scopeKey(accountIds), turns = [];
  for (const run of db.all('run', ownerId)) {
    if (run.projectId !== projectId || run.kind !== 'planning') continue;
    if (scoped && scopeKey(run.input?.accountIds) !== key) continue;
    const shared = { runId: run.id, taskId: run.taskId, ...(run.planningPlanId ? { planId: run.planningPlanId, planVersion: run.planningPlanVersion } : {}) };
    turns.push({ id: `${run.id}:request`, role: 'user', text: String(run.input?.goal || run.node?.requirement || '').slice(0, 16000), createdAt: run.createdAt, ...shared });
    const artifact = run.artifact && db.get('artifact', `${run.artifact.id}:${run.artifact.version}`);
    const text = artifact ? artifact.candidate ? `规划结果已保留为候选，尚未采用。\n${artifact.body}` : artifact.kind === 'plan' ? `${run.planningQuestion ? '' : '这是待确认计划，尚未批准执行。\n'}${artifact.body}` : '规划成果已保存。' : run.status === 'needs_reconciliation' ? '规划请求的外部结果未知，已保留费用记录；请先核对回执，不会自动重发。' : run.status === 'failed' ? `规划未完成：${run.error || '请查看任务活动'}` : ['cancelled', 'paused'].includes(run.status) ? '规划已停止或暂停；已提交请求仍需核对。' : '正在整理计划，进度以规划任务内的真实活动为准。';
    turns.push({ id: `${run.id}:reply`, role: 'assistant', text: text.slice(0, 16000), createdAt: run.finishedAt || run.updatedAt || run.createdAt, ...shared });
  }
  for (const plan of db.all('plan', ownerId)) {
    if (plan.projectId !== projectId) continue;
    const first = plan.versions[0];
    if (!first || first.planningMode !== 'rules') continue;
    const accounts = first.nodes.flatMap(node => [node.accountId, node.connectionAccountId]).filter(Boolean);
    if (scoped && scopeKey(accounts) !== key) continue;
    const shared = { planId: plan.id, planVersion: first.version };
    turns.push({ id: `${plan.id}:request`, role: 'user', text: first.goal, createdAt: first.createdAt || plan.createdAt, ...shared });
    turns.push({ id: `${plan.id}:reply`, role: 'assistant', text: `免费规则草案，不是模型推理：\n${first.nodes.map(node => `• ${node.title}：${node.requirement}`).join('\n')}\n需核对并批准当前版本后才执行。`, createdAt: first.createdAt || plan.createdAt, ...shared });
  }
  return turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-40);
}

export function planningConversation(db, ownerId, projectId, accountIds) {
  return controllerHistory(db, ownerId, projectId, accountIds).slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 2000) }));
}
