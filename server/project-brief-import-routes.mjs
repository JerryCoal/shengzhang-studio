import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assert, now, touch } from './domain.mjs';
import { generateStructured, estimateStructuredReservation, tokenCost } from './ai.mjs';
import { briefImportInputSchema, briefImportConfig, briefImportDefinition, briefImportInstructions, BRIEF_IMPORT_FIELDS } from './project-brief-import.mjs';
import { resolveWorkflowSkill, customSkillInstructions } from './creative-skills.mjs';
import { builtinSkillInstructions } from './ai-skill-registry.mjs';
import { resolveBuiltinSkills } from './builtin-skills.mjs';
import { workflowSkillTrace } from './creative-skill-catalog.mjs';
import { canUseTeamWorkspace } from './workspace-access.mjs';

const editorKeySchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const inputSchema = z.object({ editorKey: editorKeySchema, sourceName: z.string(), text: z.string() }).strict();
const requestSchema = inputSchema.extend({ requestId: z.string().uuid(), confirmed: z.literal(true) });
const lockKey = key => key === 'new' ? 'brief-import:new' : key;
const jobsOf = state => state.briefImports || [];
const publicJob = job => {
  if (!job) return null;
  const { inputHash, ...value } = job;
  return value;
};
const usageFor = job => ({ id: job.id, stage: 'brief-import', status: job.status, amountUsd: job.amountUsd, estimated: job.estimated, model: job.model, at: job.at, note: job.note, ...(job.skillTrace ? { skillTrace: structuredClone(job.skillTrace) } : {}) });

// A new-project editor belongs to the current local user. Transfer its existing
// costs and candidates only when that editor is actually saved as a project.
export function attachBriefImports(state, project) {
  const jobs = jobsOf(state).filter(job => job.editorKey === 'new');
  assert(!jobs.some(job => job.status === 'running'), '介绍文档仍在提取中，请等结果返回后再创建项目；可以先保存并关闭窗口。', 409);
  for (const job of jobs) {
    job.editorKey = project.id;
    if (!project.usage.some(usage => usage.id === job.id)) project.usage.push(usageFor(job));
  }
}

export function mountBriefImportRoutes(app, store, config, { project, activeJobs, local, getKey, settingsBusy }) {
  // A process restart must not silently repeat a potentially paid request.
  store.mutate(state => {
    for (const job of jobsOf(state)) if (job.status === 'running') {
      Object.assign(job, { status: 'uncertain', finishedAt: now(), error: '上次文档提取中断，已保留预留费用。请核对 DeepSeek 账单后再试。', note: '运行中断，费用待核对；未自动重试' });
      const usage = state.projects.find(p => p.id === job.editorKey)?.usage.find(u => u.id === job.id);
      if (usage) Object.assign(usage, usageFor(job));
    }
  });
  const access = req => {
    local(req);
    assert(config.profileMode === true && (canUseTeamWorkspace(req, config) || !config.teamMode && !config.authorizeCredentials), '文档填入项目概要需要本机加密工作区或已登录的团队工作区。', 403);
  };
  const draftContext = (state, editorKey) => {
    const p = editorKey === 'new' ? null : project(state, editorKey);
    const draft = state.projectDrafts?.[editorKey];
    assert(draft, '请等待项目草稿保存后再提取介绍文档。');
    assert(!draft.conflict, '项目资料在其他窗口有更新，请先核对并恢复草稿。', 409);
    const budget = draft.brief.budgetUsd;
    assert(Number.isFinite(budget) && budget >= 0, '请先填写有效的模型费用上限。');
    const spent = p ? p.usage.reduce((sum, u) => sum + u.amountUsd, 0) : jobsOf(state).filter(job => job.editorKey === 'new').reduce((sum, job) => sum + job.amountUsd, 0);
    return { p, draft, budget, spent };
  };
  const readInput = body => {
    const input = inputSchema.parse(body);
    const payload = briefImportInputSchema.parse({ sourceName: input.sourceName, text: input.text });
    const skillState = store.get(), creativeSkill = resolveWorkflowSkill(skillState, 'brief-import');
    const builtinSkills = resolveBuiltinSkills(skillState, 'brief-import');
    const instructions = builtinSkillInstructions('brief-import', { builtinSkills }) + '\n' + customSkillInstructions(creativeSkill) + '\n' + briefImportInstructions;
    const reservationUsd = estimateStructuredReservation(payload, briefImportConfig, briefImportDefinition, instructions);
    return { editorKey: input.editorKey, payload, reservationUsd, creativeSkill, builtinSkills, instructions };
  };
  const affordable = (state, editorKey, amount) => {
    const context = draftContext(state, editorKey);
    assert(context.spent + amount <= context.budget, `模型费用上限不足。本次预留约 $${amount.toFixed(4)}，请提高项目费用上限或缩短正文。`);
    return context;
  };
  app.get('/api/brief-import', (req, res) => {
    access(req);
    const editorKey = editorKeySchema.parse(req.query.editorKey);
    const state = store.get();
    if (editorKey !== 'new') project(state, editorKey);
    const job = jobsOf(state).filter(job => job.editorKey === editorKey).at(-1);
    const credential = config.deepseekVault?.status();
    res.json({ job: publicJob(job), configured: !!credential?.configured && !credential.problem, model: briefImportConfig.model });
  });
  app.post('/api/brief-import/estimate', (req, res) => {
    access(req);
    const { editorKey, payload, reservationUsd } = readInput(req.body);
    affordable(store.get(), editorKey, reservationUsd);
    res.json({ reservationUsd, model: briefImportConfig.model, characters: payload.text.length });
  });
  app.post('/api/brief-import', async (req, res) => {
    access(req);
    const { requestId, confirmed, ...input } = requestSchema.parse(req.body);
    const { editorKey, payload, reservationUsd, creativeSkill, builtinSkills, instructions } = readInput(input);
    const inputHash = createHash('sha256').update(JSON.stringify({ editorKey, payload })).digest('hex');
    const previous = jobsOf(store.get()).find(job => job.id === requestId);
    if (previous) {
      assert(previous.inputHash === inputHash, '相同请求编号的文档已改变，请重新确认提取。', 409);
      return res.json({ job: publicJob(previous) });
    }
    const lock = lockKey(editorKey);
    assert(!activeJobs.has(lock) && !settingsBusy(), '此项目正在执行模型任务或修改设置，请等任务完成。', 409);
    activeJobs.add(lock);
    let reserved = false, output;
    try {
      const apiKey = await getKey(req, 'deepseek');
      store.mutate(state => {
        const { p, draft } = affordable(state, editorKey, reservationUsd);
        const job = { id: requestId, editorKey, sourceName: payload.sourceName, inputHash, model: briefImportConfig.model, status: 'running', at: now(), baseline: Object.fromEntries(BRIEF_IMPORT_FIELDS.map(field => [field, draft.brief[field] || ''])), amountUsd: reservationUsd, estimated: true, note: '介绍文档提取进行中，已预留费用' };
        job.skillTrace = workflowSkillTrace('brief-import', { creativeSkill, builtinSkills }, job.at);
        state.briefImports ||= [];
        state.briefImports.push(job);
        // Keep the fee ledger, but bound retained candidate text across documents.
        for (const old of state.briefImports.slice(0, -20)) if (old.status !== 'running') { delete old.result; delete old.baseline; }
        if (p) { p.usage.push(usageFor(job)); touch(p); }
      });
      reserved = true;
      output = await generateStructured(payload, { ...briefImportConfig, apiKey }, briefImportDefinition, instructions, config.fetcher);
      const job = store.mutate(state => {
        const job = jobsOf(state).find(row => row.id === requestId), cost = tokenCost(output.usage, briefImportConfig);
        Object.assign(job, { status: 'completed', finishedAt: now(), result: output.value, amountUsd: cost ?? reservationUsd, estimated: cost === null, note: cost === null ? '未返回有效用量，保留预留费用；请核对 DeepSeek 账单' : '按返回 token 与本次模型单价估算，非最终账单' });
        const p = state.projects.find(p => p.id === editorKey), usage = p?.usage.find(u => u.id === requestId);
        if (usage) { Object.assign(usage, usageFor(job)); touch(p); }
        return publicJob(job);
      });
      res.json({ job });
    } catch (error) {
      if (reserved) store.mutate(state => {
        const job = jobsOf(state).find(row => row.id === requestId);
        if (job?.status !== 'running') return;
        const cost = tokenCost(error.usage || output?.usage, briefImportConfig);
        Object.assign(job, { status: error.noCharge ? 'failed' : 'uncertain', finishedAt: now(), amountUsd: cost ?? (error.noCharge ? 0 : reservationUsd), estimated: cost === null && !error.noCharge, error: error.status ? error.message : '提取未完成，现有资料已保留。请核对 DeepSeek 账单后再试。', note: error.noCharge ? '请求被拒绝，已释放预留费用' : '结果未完成；按返回用量或预留金额记录，请核对账单' });
        const p = state.projects.find(p => p.id === editorKey), usage = p?.usage.find(u => u.id === requestId);
        if (usage) { Object.assign(usage, usageFor(job)); touch(p); }
      });
      throw error;
    } finally { activeJobs.delete(lock); }
  });
}
