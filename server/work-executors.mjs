import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MODELS, DEFAULT_ROUTES, stageConfig } from './models.mjs';
import { generateStage, generateStructured, estimateReservation, estimateStructuredReservation, tokenCost } from './ai.mjs';
import { resolveAgentContext } from './agent-workspace.mjs';
import { resolveAccountCreation } from './account-creation.mjs';
import { resolveBuiltinSkills } from './builtin-skills.mjs';
import { resolveWorkflowSkill, customSkillInstructions } from './creative-skills.mjs';
import { workflowSkillTrace } from './creative-skill-catalog.mjs';
import { skillVersionsFor } from './ai-skill-registry.mjs';
import { rulesOf, screenCopy, searchCorpus } from './workflow.mjs';
import { acquireTaskResource, createActiveJobs } from './active-jobs.mjs';
import { researchDefinition, researchInstructions } from './research-ai.mjs';
import { cleanReferences } from './research-data.mjs';
import { rankTopicReferences } from './topic-performance.mjs';
import { textOnlyImageEvidence } from './research-image-evidence.mjs';
import { createOpenAITransport } from './openai-errors.mjs';
import { createDeepSeekTransport } from './deepseek.mjs';
import { createQwenTransport } from './qwen.mjs';
import { createGLMTransport } from './glm.mjs';
import { createLocalQwenTransport } from './local-qwen.mjs';
import { qwenConnectionSchema } from './qwen-connection.mjs';
import { localQwenConnection } from './local-qwen-connection.mjs';

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, noCharge: true, ...extra });
const require_ = (condition, message, status = 400) => { if (!condition) throw fail(message, status); };
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const now = () => new Date().toISOString();
const elapsed = started => Math.max(0, Math.round((performance.now() - started) * 1000) / 1000);
const identifier = z.string().trim().min(1).max(160);
const nodeSchema = z.object({ id: identifier, title: z.string().max(200).default(''), role: z.enum(['xiaohongshu-copy', 'douyin-research', 'douyin-script']), accountId: z.string().max(100).default(''), connectionAccountId: z.string().max(100).default(''), requirement: z.string().trim().min(1).max(4000), dependsOn: z.array(identifier).max(12).default([]), knowledgeIds: z.array(identifier).max(8).default([]), experienceIds: z.array(identifier).max(8).default([]), skillIds: z.array(identifier).max(8).default([]), model: z.string().max(100).optional(), budgetUSD: z.number().finite().nonnegative().max(1000) });
const routeFor = (node, config) => {
  const stage = node.role === 'douyin-research' ? 'analysis' : 'copy', routes = config.modelStore?.get() || { ...DEFAULT_ROUTES };
  if (node.model) { require_(Object.hasOwn(MODELS, node.model), '所选文字模型不受支持'); routes[stage] = node.model; }
  const route = stageConfig(stage, routes);
  return node.role === 'douyin-research' ? { ...route, id: 'research_analysis', label: '抖音同话题研究', maxTokens: Math.max(route.maxTokens, 6500), ...(route.provider === 'deepseek' ? { thinking: false } : {}) } : route;
};
const projectOf = (state, projectId) => { const project = state.projects?.find(row => row.id === projectId); require_(project, '任务所属项目已不存在', 404); return project; };
const skillList = payload => [...(payload.builtinSkills || []), ...(payload.creativeSkill ? [payload.creativeSkill] : []), ...(payload.agentContext?.skills || [])].map(skill => ({ id: skill.id, name: skill.name, version: skill.version }));

// Shared by business execution and separately approved controller planning.
// These transports retain the existing provider validation/error handling,
// while route and connection selection come only from the approved snapshot.
export function createFrozenWorkTransport({ config, connections, beforeRequest, signal }) {
  const rawFetch = config.workFetcher || config.fetcher || fetch;
  const request = async (url, options) => { await beforeRequest(); return rawFetch(url, { ...options, ...(signal ? { signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal } : {}) }); };
  const openai = createOpenAITransport(request), deepseek = createDeepSeekTransport(openai.fetch), qwen = createQwenTransport(deepseek.fetch, () => connections.qwen), glm = createGLMTransport(qwen.fetch);
  const localOptions = { allowed: config.allowLocalModels !== false };
  if (config.localQwenFetcher) localOptions.localFetcher = async (url, options) => { await beforeRequest(); return config.localQwenFetcher(url, options); };
  const local = createLocalQwenTransport(glm.fetch, () => connections.localQwen, localOptions);
  return async (url, options) => { if (String(url).startsWith('local-qwen:')) await beforeRequest(); return local.fetch(url, options); };
}

// A worker consumes a server-approved immutable packet. It never accepts a
// browser request or re-resolves the user's current account/Skill selections.
export function createWorkExecutors({ store, config = {}, activeJobs = createActiveJobs(), integrations = {} }) {
  function prepare({ state, project, node: raw }) {
    const node = nodeSchema.parse(raw), research = node.role === 'douyin-research', platform = node.role === 'xiaohongshu-copy' ? 'xiaohongshu' : 'douyin';
    require_(project?.id && state.projects?.some(row => row.id === project.id), '任务所属项目不存在', 404);
    const account = node.accountId ? state.accounts?.find(row => row.id === node.accountId) : null;
    require_(research || account, '创作任务需要明确选择目标账号');
    require_(!node.accountId || account?.platform === platform, '目标账号与任务平台不一致');
    const connectionAccount = research ? state.accounts?.find(row => row.id === node.connectionAccountId && row.platform === 'douyin') : null;
    require_(!research || connectionAccount?.mcpAccountId, '抖音研究需要明确选择已绑定 MCP 的读取连接账号');
    const modelRoute = routeFor(node, config), workflowId = research ? 'research-analysis' : `copy-${platform}`;
    const context = resolveAgentContext(state, project, { accountId: node.accountId, platform, model: modelRoute.model, knowledgeIds: node.knowledgeIds, experienceIds: node.experienceIds, skillIds: node.skillIds, referenceIds: [] }, research ? 'research-analysis' : 'copy', MODELS);
    const creation = research ? { accountContext: null, creativeSkill: resolveWorkflowSkill(state, workflowId) } : resolveAccountCreation(state, { ...project, creationSelections: { ...project.creationSelections, [platform]: { accountId: node.accountId, presetId: project.creationSelections?.[platform]?.accountId === node.accountId ? project.creationSelections[platform].presetId : '' } } }, platform, workflowId);
    const brief = clone(project.brief); brief.channels = [platform];
    const payload = { brief, requirement: node.requirement, instruction: node.requirement, accountContext: creation.accountContext, creativeSkill: creation.creativeSkill, builtinSkills: resolveBuiltinSkills(state, workflowId), agentContext: context, knowledgeContext: context.knowledge, corpusReferences: searchCorpus(project, node.requirement, 8) };
    if (!research) Object.assign(payload, { strategy: { title: node.title || node.requirement.slice(0, 80), core: brief.product, direction: node.role === 'douyin-script' ? '为指定账号生成可审阅的视频脚本与三个分镜，不宣称已经制作或发布视频。' : '为指定账号生成图文标题、正文与封面构思；没有获得图像生成预算，不生成或声称已有图片。', prompt: node.requirement }, task: { channel: platform, kind: node.role === 'douyin-script' ? 'video' : 'image', title: node.title, body: '', prompt: node.requirement } });
    const definition = research ? researchDefinition('xhs-analysis') : null, instructions = research ? researchInstructions('xhs-analysis', payload) + customSkillInstructions(payload.creativeSkill) : '';
    const base = research ? estimateStructuredReservation(payload, modelRoute, definition, instructions) : estimateReservation(payload, modelRoute);
    // Dependencies and collected evidence do not exist at planning time. The
    // approval card includes a bounded upper estimate; exact reservation is
    // validated again from the actual packet immediately before dispatch.
    const estimateUSD = base + (research ? 70000 : node.dependsOn.length ? 36000 : 0) * modelRoute.inputPrice / 1e6;
    const connections = { qwen: qwenConnectionSchema.parse(state.qwenConnection || { region: 'cn-beijing', workspaceId: '' }), localQwen: localQwenConnection(state.localQwenConnection) };
    const permissions = research ? ['model:research-analysis', 'mcp:douyin:search'] : ['model:copy'];
    return freeze(clone({ version: 1, nodeId: node.id, title: node.title, role: node.role, platform, projectId: project.id, accountId: node.accountId, accountName: account?.name || '', connectionAccountId: connectionAccount?.mcpAccountId || '', requirement: node.requirement, dependsOn: node.dependsOn, knowledgeIds: node.knowledgeIds, modelRoute, estimateUSD, budgetUSD: node.budgetUSD, permissions, connections, payload, skills: skillList(payload), contentRules: rulesOf(state), filters: { blockTerms: project.trends?.settings?.blockTerms || [], genericTerms: project.trends?.settings?.genericTerms || [] } }));
  }

  async function credential(provider) {
    if (provider === 'local-qwen') {
      require_(config.allowLocalModels !== false, '当前运行方式不允许访问本地模型', 403);
      const status = config.localQwenVault?.status(); require_(!status?.problem, '本地模型凭据无法解锁', 503);
      return status?.configured ? await config.localQwenVault.getKey() : '';
    }
    const vault = provider === 'qwen' ? config.qwenVault : provider === 'glm' ? config.glmVault : provider === 'deepseek' ? config.deepseekVault : config.vault;
    const status = vault?.status() || {}; require_(!status.problem, '模型凭据无法解锁，请重新保存', 503);
    const key = status.configured ? await vault.getKey() : provider === 'openai' ? config.apiKey : '';
    require_(key, `请先保存 ${provider} 文字模型密钥`); return key;
  }
  async function authorize(actor) { require_(actor?.userId && typeof config.authorizeWorkActor === 'function' && await config.authorizeWorkActor(actor) === true, '工作区成员已失效或权限已撤销', 403); }
  async function prepareConnection({ actor, node: raw }) {
    await authorize(actor);
    const node = nodeSchema.parse(raw), route = routeFor(node, config), key = await credential(route.provider);
    const model = { credentialProvider: route.provider, credentialFingerprint: hash(key) };
    if (node.role !== 'douyin-research') return model;
    require_(typeof integrations.workResearchConnection === 'function', '后台研究读取服务尚未接入', 503);
    const connection = store.get().accounts?.find(account => account.id === node.connectionAccountId && account.platform === 'douyin');
    require_(connection?.mcpAccountId, '请选择已绑定 MCP 的抖音读取账号');
    return { ...model, ...await integrations.workResearchConnection({ actor, accountId: connection.mcpAccountId }) };
  }

  async function execute({ run, input, dependencies = [], emit = () => {}, markSent, checkpoint, signal }) {
    require_(input?.version === 1 && run?.projectId === input.projectId && run.ownerId === run.actor?.userId, '后台任务的输入与归属不一致', 403);
    require_(typeof markSent === 'function' && typeof checkpoint === 'function', '后台任务必须配置持久化发送边界与回执', 500);
    await authorize(run.actor);
    require_(input.permissions.every(permission => run.approval?.permissions?.includes(permission)), '任务操作超出已经确认的权限', 403);
    const current = projectOf(store.get(), input.projectId);
    if (input.accountId) require_(store.get().accounts?.some(account => account.id === input.accountId && account.platform === input.platform), '任务账号已移除或平台已改变', 409);
    const abortBeforeSend = () => { if (signal?.aborted) throw fail('已按用户要求停止后续步骤', 409, { cancelled: true }); };
    abortBeforeSend();
    const resource = input.role === 'douyin-research' ? 'research' : `work-task:${run.taskId}`;
    const release = acquireTaskResource(activeJobs, input.projectId, resource);
    let usageId, reservation = 0, sent = false, modelSent = false, received = false, modelOutput, boundaryError, modelCall, modelDuration;
    const route = input.modelRoute, research = input.role === 'douyin-research';
    try {
      const key = await credential(route.provider);
      require_(input.credentialProvider === route.provider && input.credentialFingerprint && hash(key) === input.credentialFingerprint, '模型密钥或账户已更改，请重新确认任务；没有发送生成请求', 409);
      if (route.provider === 'local-qwen') require_(input.connections.localQwen.enabled && input.connections.localQwen.model, '批准时的本地 Qwen 连接未启用');
      const payload = clone(input.payload);
      if (dependencies.length) {
        require_(dependencies.length <= 12, '任务依赖过多');
        payload.dependencies = dependencies.map(dependency => {
          const content = dependency.content || dependency.result || dependency;
          require_(!dependency.projectId || dependency.projectId === input.projectId, '依赖资料属于其他项目', 403);
          require_(!dependency.accountId || dependency.accountId === input.accountId || content.kind === 'research', '依赖资料属于其他账号', 403);
          return { artifactId: dependency.artifactId || dependency.id, version: dependency.version, title: String(content.title || '').slice(0, 200), body: String(content.body || '').slice(0, 12000), kind: content.kind || 'reference' };
        });
        require_(Buffer.byteLength(JSON.stringify(payload.dependencies)) <= 36000, '依赖材料过长，请缩小已确认的交付范围');
      }
      for (const skill of input.skills) await emit('skill.loaded', `已载入规则：${skill.name || skill.id}`, skill);
      await emit('input.prepared', '已核对任务账号与冻结输入', { accountId: input.accountId, role: input.role });
      let collected, ranked;
      if (research) {
        require_(typeof integrations.workResearchSearch === 'function', '后台研究读取服务尚未接入', 503);
        const keywords = input.requirement.split(/[\n，,、；;]/u).map(value => value.trim()).filter(Boolean).slice(0, 3).map(value => value.slice(0, 30));
        const discovery = { platform: 'douyin', timeRange: 'month', sortBy: 'general', noteType: 'all' };
        let calls = 0, pendingCall;
        const assertActive = async () => { abortBeforeSend(); await authorize(run.actor); };
        // Research tools are sequential. Failed calls can be retained in source
        // reports without an after hook; never pair a later reply with them or
        // claim an exact duration when only the next observation is available.
        const closeUnresolved = async () => {
          if (!pendingCall) return;
          const call = pendingCall; pendingCall = null;
          await emit('tool.unknown', '此工具调用没有可配对回执，请核对来源报告', { ...call.detail, status: 'unknown', elapsedMs: elapsed(call.started), durationBasis: 'dispatch-to-next-observation', businessSuccess: 'unknown' });
        };
        try {
          collected = await integrations.workResearchSearch({ run: { ...run, input }, queries: keywords, at: Date.now(), discovery, assertActive, hooks: {
            beforeRequest: async name => {
              await assertActive(); require_(++calls <= 48, '本次 MCP 调用次数已达批准上限');
              await closeUnresolved();
              const callId = randomUUID(), detail = { callId, provider: 'mcp', model: 'douyin', tool: name };
              // The controller preserves receipt.id as invocation.id.
              await markSent({ id: callId, ...detail }); sent = true;
              pendingCall = { detail, started: performance.now() };
              await emit('tool.started', `正在读取抖音：${name}`, { ...detail, status: 'dispatching' });
            },
            afterRequest: async name => {
              if (!pendingCall || pendingCall.detail.tool !== name) return;
              const call = pendingCall; pendingCall = null;
              await emit('tool.received', `已收到抖音工具响应：${name}`, { ...call.detail, status: 'received', durationMs: elapsed(call.started), durationBasis: 'dispatch-to-response', businessSuccess: 'not-yet-validated' });
            },
          } });
        } finally { await closeUnresolved(); }
        const cleaned = cleanReferences((collected.items || []).filter(item => item.kind === 'douyin'), { keywords, ...input.filters, at: Date.now(), discovery });
        ranked = rankTopicReferences(cleaned.references, { keywords, platform: 'douyin', sortBy: 'general' });
        await checkpoint({ type: 'research.collected', references: ranked.references, reports: collected.reports || [], excluded: cleaned.excluded });
        await emit('evidence.checked', `本轮保留 ${ranked.references.length} 条可核对资料`, { count: ranked.references.length, relevant: ranked.summary.related, knownMetrics: ranked.summary.knownMetrics });
        require_(ranked.analysisReferences.length && ranked.summary.knownMetrics > 0, '本轮没有同时满足主题、正文和可见互动指标的资料；已保存来源报告，没有发起模型分析');
        Object.assign(payload, { keywords, discovery, ...input.filters, sampleComparison: ranked.summary, references: ranked.analysisReferences.map(({ sourceAccountId, sourceAccountName, ...reference }) => ({ ...reference, ...(reference.imageEvidence ? { imageEvidence: textOnlyImageEvidence(reference) } : {}) })) });
      }
      abortBeforeSend(); await authorize(run.actor);
      require_(Buffer.byteLength(JSON.stringify(payload)) <= 110000, '任务输入过长，请减少资料或依赖');
      const definition = research ? researchDefinition('xhs-analysis') : null;
      const instructions = research ? researchInstructions('xhs-analysis', payload) + customSkillInstructions(payload.creativeSkill) : '';
      reservation = research ? estimateStructuredReservation(payload, route, definition, instructions) : estimateReservation(payload, route);
      const limit = Math.min(input.budgetUSD, run.approval.budgetUSD);
      require_(Number.isFinite(limit) && reservation <= limit + 1e-9, '本次实际输入超过任务已批准费用上限，请修改计划后重新确认');
      usageId = randomUUID();
      const callId = randomUUID();
      store.mutate(state => {
        const project = projectOf(state, input.projectId), spent = project.usage.reduce((sum, item) => sum + item.amountUsd, 0);
        require_(spent + reservation <= project.brief.budgetUsd + 1e-9, '项目剩余预算不足，没有发送模型请求');
        project.usage.push({ id: usageId, callId, runId: run.id, taskId: run.taskId, attemptId: run.attemptId, stage: route.id, status: 'running', amountUsd: reservation, estimated: true, model: route.model, inputPrice: route.inputPrice, outputPrice: route.outputPrice, skillVersions: skillVersionsFor(research ? 'research-analysis' : 'copy', payload), skillTrace: workflowSkillTrace(research ? 'research-analysis' : 'copy', payload, now()), at: now(), note: '后台任务 · 已预留费用，尚待服务回执' });
        project.revision++; project.updatedAt = now();
      });
      const beforeModel = async () => {
        if (modelSent) return;
        try { abortBeforeSend(); await authorize(run.actor); await markSent({ id: callId, callId, provider: route.provider, model: route.model, usageId }); }
        catch (error) { boundaryError = error; throw error; }
        modelSent = true; sent = true; modelCall = { callId, started: performance.now() };
        await emit('model.started', `正在请求 ${route.label}`, { callId, provider: route.provider, model: route.model, usageId, status: 'dispatching', reservationUSD: reservation });
      };
      const transport = createFrozenWorkTransport({ config, connections: input.connections, beforeRequest: beforeModel, signal });
      modelOutput = research ? await generateStructured(payload, { ...route, apiKey: key }, definition, instructions, transport) : await generateStage(payload, { ...route, apiKey: key }, transport);
      received = true; modelDuration = elapsed(modelCall.started);
      const cost = tokenCost(modelOutput.usage, route), usage = { usageId, callId, provider: route.provider, model: route.model, amountUSD: cost ?? reservation, estimated: cost === null, tokens: modelOutput.usage || null, settlement: cost === null ? 'estimated' : 'settled' };
      await emit('model.received', '已收到并校验模型回执', { ...usage, status: 'received', durationMs: modelDuration, durationBasis: 'dispatch-to-validated-response' });
      let result;
      if (research) {
        const analyses = modelOutput.value.analyses;
        result = { kind: 'research', title: input.title || '抖音同话题研究', body: analyses.length ? analyses.map(item => `## ${item.title}\n\n观察：${item.observation}\n\n待验证假设：${item.hypothesis}\n\n应用建议：${item.application}\n\n限制：${item.limitations}`).join('\n\n') : '已读取并保存样本；模型没有返回足够可靠的分析方向，不宣称得到了爆款规律。', structured: { analyses, references: ranked.references, reports: collected.reports || [], comparison: ranked.summary }, legacy: {}, usage };
      } else {
        const screened = screenCopy(modelOutput.value, input.contentRules);
        result = { kind: input.role === 'douyin-script' ? 'script' : 'copy', title: screened.value.title, body: screened.value.body, structured: { ...screened.value, review: screened.review, creationTrace: clone(payload.accountContext), knowledgeContext: clone(payload.knowledgeContext), skillTrace: workflowSkillTrace('copy', payload, now()), mediaNotice: '仅生成文案、脚本与视觉构思；未生成图片或视频，未发布。' }, legacy: {}, usage };
        await emit('content.checked', '已完成本地文案规则检查，仍需人工审阅', { hasReview: !!screened.review });
      }
      // Persist the exact response before declaring a saved output. A worker
      // interrupted after this point can recover without repeating a paid call.
      await checkpoint({ type: 'result_ready', result });
      settle('completed', cost ?? reservation, cost === null, modelOutput.usage);
      await emit('model.completed', '已收到并校验模型结果，等待保存交付物', { callId, provider: route.provider, model: route.model, usageId, amountUSD: usage.amountUSD, estimated: usage.estimated, status: 'completed', durationMs: modelDuration, durationBasis: 'dispatch-to-validated-response' });
      return result;
    } catch (error) {
      // Provider transports may wrap a rejected local dispatch boundary as a
      // network failure. Keep the actual authorization/storage/budget reason
      // when no model request was sent, and release only its unsent reserve.
      if (boundaryError && !modelSent) error = boundaryError;
      if (usageId) {
        const cost = tokenCost(modelOutput?.usage || error.usage, route), certain = !modelSent || error.noCharge === true && !received;
        settle(certain ? 'failed' : received ? 'completed' : 'uncertain', cost ?? (certain ? 0 : reservation), cost === null && !certain, modelOutput?.usage || error.usage);
      }
      if (!sent) error.noCharge = true;
      // A retained provider response is not permission to auto-resend. The
      // scheduler can reconcile its saved result_ready checkpoint separately.
      if (received) error.definitive = true;
      if (modelCall && !received) {
        // Never log provider bodies/errors or call a missing response success.
        const known = error.noCharge === true || !!error.usage;
        try { await emit('model.failed', known ? '模型请求未形成可交付结果，费用按已知回执记录' : '模型请求结果未知，请核对服务商回执；没有自动重试', { callId: modelCall.callId, provider: route.provider, model: route.model, usageId, status: known ? 'failed' : 'unknown', durationMs: elapsed(modelCall.started), durationBasis: 'dispatch-to-error', automaticRetry: false }); } catch { /* Preserve the original error and durable sent boundary. */ }
      }
      throw error;
    } finally { release(); }

    function settle(status, amountUsd, estimated, tokens) {
      store.mutate(state => {
        const project = projectOf(state, input.projectId), usage = project.usage.find(item => item.id === usageId);
        if (!usage || usage.status !== 'running') return;
        Object.assign(usage, { status, amountUsd, estimated, tokens: tokens || null, note: status === 'uncertain' ? '后台请求结果未知，保留预留费用；请核对后再决定，不自动重试。' : estimated ? '已收到结果，用量缺失，保留预留估算；实际以服务商账单为准。' : '按本次返回用量估算；实际以服务商账单为准。' });
        project.revision++; project.updatedAt = now();
      });
    }
  }
  function recover({ run }) {
    const checkpoint = run?.checkpoint;
    return checkpoint?.type === 'result_ready' && checkpoint.result ? clone(checkpoint.result) : null;
  }
  return { prepare, prepareConnection, execute, recover };
}
