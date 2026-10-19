import { createHash, randomUUID } from 'node:crypto';
import { assert, now, touch, activity, updateAsset } from './domain.mjs';
import { generateStructured, estimateStructuredReservation, tokenCost } from './ai.mjs';
import { stageConfig } from './models.mjs';
import { resolveBuiltinSkills } from './builtin-skills.mjs';
import { resolveAccountCreation, assertAssetCreationAccount } from './account-creation.mjs';
import { workflowSkillTrace } from './creative-skill-catalog.mjs';
import { skillVersionsFor } from './ai-skill-registry.mjs';
import { rulesOf, screenCopy, searchCorpus, corpusQuery } from './workflow.mjs';
import { contentProjectForAsset, contentRequirement, contentKnowledge, knowledgeInstructions } from './content-workflow.mjs';
import { selectedResearchContext } from './research-data.mjs';
import { adoptedDocumentContext, documentStyleReferences } from './document-context.mjs';
import { redfoxXhsCatalog } from './redfox-xhs-catalog.mjs';
import { structuredVisionCapability, structuredVisionReservation } from './structured-vision.mjs';
import { XHS_ASSISTANT_MODES, XHS_ASSISTANT_WORKFLOWS, xhsAssistantInputSchema, xhsSamplesInputSchema, xhsRunInputSchema, xhsAdoptInputSchema, xhsAssistantOf, xhsSampleDateRange, xhsSampleItems, xhsAssistantDefinition, xhsAssistantInstructions, safeXhsCoverUrl } from './xhs-assistant.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const priceCny = redfoxXhsCatalog['xhs.samples'].priceCny;
const accountInfo = context => {
  const row = context?.accounts?.[0];
  return { accountId: row?.accountId || '', accountName: row?.accountName || '', profileRevision: row?.profileRevision || 0 };
};
const accountBinding = context => (context?.accounts || []).map(({ workflowId, workflowSkill, ...rest }) => rest);
const ensure = p => p.xhsAssistant = xhsAssistantOf(p);
function findRequest(p, kind, requestId, hash) {
  const saved = xhsAssistantOf(p), row = saved[kind].find(item => item.requestId === requestId);
  const ledger = (saved.requestLedger || []).find(item => item.requestId === requestId);
  assert(!ledger || ledger.kind === kind && ledger.fingerprint === hash, '此请求编号已用于不同输入，请重新打开操作', 409);
  assert(!row || row.requestFingerprint === hash, '此请求编号已用于不同输入，请重新打开操作', 409);
  assert(!ledger || row, '这次请求已执行且结果已移出最近记录，没有再次收费；请使用新的请求编号明确开始新任务', 409);
  return row;
}
function remember(p, kind, row) {
  const saved = ensure(p); saved.requestLedger ||= [];
  // Keep a small, durable tombstone after a bulky result is evicted. Never
  // silently forget an idempotency key and resubmit a previously paid request.
  assert(saved.requestLedger.length < 2000, '此项目的创作助手请求记录已达上限，请新建项目继续', 409);
  saved.requestLedger.push({ requestId: row.requestId, fingerprint: row.requestFingerprint, kind });
  saved[kind].unshift(row); saved[kind] = saved[kind].slice(0, kind === 'samples' ? 10 : 20); touch(p);
}
function assetOf(p, assetId, revision) {
  const asset = p.assets.find(item => item.id === assetId);
  assert(asset && asset.channel === 'xiaohongshu', '请选择本项目的小红书素材', 400);
  assert(asset.revision === revision, '素材已更新，请重新打开助手或重新选择素材', 409);
  const strategy = p.strategies.find(item => item.id === asset.strategyId);
  assert(strategy?.status === 'confirmed', '请先确认所选素材对应的策略');
  return { asset, strategy };
}
function basisOf(state, p, input, workflowId) {
  const selected = input.assetId ? assetOf(p, input.assetId, input.expectedAssetRevision) : null;
  const account = resolveAccountCreation(state, contentProjectForAsset(p, selected?.asset), 'xiaohongshu').accountContext;
  return { brief: p.brief, account: accountBinding(account),
    context: creationReferences(p, input, selected, account),
    ...(selected ? { asset: { id: selected.asset.id, revision: selected.asset.revision, strategyId: selected.asset.strategyId }, strategy: { status: selected.strategy.status, title: selected.strategy.title, core: selected.strategy.core, direction: selected.strategy.direction, prompt: selected.strategy.prompt, brief: selected.strategy.briefSnapshot || null } } : {}), workflowId };
}
function creationReferences(p, input, selected, accountContext) {
  const requirement = contentRequirement(selected?.asset), query = corpusQuery(p, `${requirement} ${input.keyword} ${input.title || selected?.asset.title || ''} ${input.instruction}`);
  return { requirement, knowledgeContext: contentKnowledge(p, selected?.asset, accountContext, query), corpusReferences: searchCorpus(p, query), researchReferences: selectedResearchContext(p), adoptedDocumentContext: selected?.strategy.documentContextSnapshot || adoptedDocumentContext(p), styleReferences: selected?.strategy.styleReferencesSnapshot || documentStyleReferences(p) };
}
function staleReason(state, p, run) {
  try { if (fingerprint(basisOf(state, p, run.input, XHS_ASSISTANT_WORKFLOWS[run.mode])) === run.basisFingerprint) return ''; } catch { /* deleted/changed account or asset is stale as well */ }
  return '项目资料、目标账号身份或原素材已变化；结果已保留，不能覆盖当前素材，请基于当前输入重新生成。';
}
const safeFailure = (error, kind) => kind === 'samples'
  ? error.redfoxSafe ? error.message : '样本读取未完成，已保留费用记录，没有自动重试或扩大时间范围。'
  : error.outputKind === 'truncated' ? '模型输出超过长度上限；费用已记录，没有自动重试。请缩短输入后手动开始新任务。'
  : ['schema', 'evidence', 'json', 'incomplete', 'empty'].includes(error.outputKind) ? '模型结果不完整或样本引用未通过检查；原内容与费用记录已保留，没有自动重试。'
  : '本次生成未完成，原内容与费用记录已保留，没有自动重试。请检查模型配置与账单后再决定是否重新生成。';

export function mountXhsAssistantRoutes(app, store, config, { project, activeJobs, local, getKey, settingsBusy }) {
  const base = '/api/projects/:id/xhs-assistant';
  // Only run at server initialization, never during store.get normalization.
  const needsRecovery = store.get().projects.some(p => ['samples', 'runs'].some(kind => xhsAssistantOf(p)[kind].some(row => row.status === 'running')));
  if (needsRecovery) store.mutate(state => {
    for (const p of state.projects) {
      let changed = false;
      for (const kind of ['samples', 'runs']) for (const row of xhsAssistantOf(p)[kind]) if (row.status === 'running') {
        row.status = 'uncertain'; row.finishedAt = now(); row.error = '服务曾中断，无法确认上次请求结果；费用保留，没有自动再次提交。'; changed = true;
        if (row.usageId) { const usage = p.usage.find(item => item.id === row.usageId); if (usage?.status === 'running') Object.assign(usage, { status: 'uncertain', note: row.error }); }
        for (const usage of state.redfoxUsage || []) if (usage.taskId === row.id && usage.status === 'running') Object.assign(usage, { status: 'uncertain', note: row.error });
      }
      if (changed) touch(p);
    }
  });
  const configured = provider => {
    const vault = provider === 'glm' ? config.glmVault : provider === 'deepseek' ? config.deepseekVault : provider === 'qwen' ? config.qwenVault : config.vault;
    const status = vault?.status() || {};
    return !status.problem && (!!status.configured || provider === 'openai' && !!config.apiKey);
  };
  const locked = async (req, work) => {
    local(req); assert(!settingsBusy() && !activeJobs.has(req.params.id), '此项目正在执行任务或更新设置，请等待完成', 409);
    activeJobs.add(req.params.id);
    try { return await work(); } finally { activeJobs.delete(req.params.id); }
  };
  const replyExisting = (res, row) => res.status(row.status === 'running' ? 202 : 200).json({ result: row, state: store.get(), reused: true });
  function prepare(state, p, input) {
    assert(!input.vision || input.mode === 'cover-plan', '图片分析仅用于封面方案，本次未发起模型或图片请求');
    const route = { ...stageConfig(['title-score', 'note-score'].includes(input.mode) ? 'analysis' : 'copy', config.modelStore.get()), id: 'xhs_assistant', label: '小红书创作助手', maxTokens: 5500, thinking: false };
    if (input.vision) { const capability = structuredVisionCapability(route); assert(capability.supported, capability.reason); assert(configured(route.provider), '请先保存当前所选模型的密钥；不会自动切换另一家服务商'); }
    const workflowId = XHS_ASSISTANT_WORKFLOWS[input.mode];
    const selected = input.assetId ? assetOf(p, input.assetId, input.expectedAssetRevision) : null;
    const creation = resolveAccountCreation(state, contentProjectForAsset(p, selected?.asset), 'xiaohongshu', workflowId);
    assert(input.assetId || input.expectedAssetRevision == null, '没有选择素材时，不应提供素材版本');
    if (selected) assertAssetCreationAccount(selected.asset, creation.accountContext);
    const saved = input.sampleId ? xhsAssistantOf(p).samples.find(row => row.id === input.sampleId) : null;
    assert(!input.sampleId || saved?.status === 'completed', '所选样本不存在或尚未完成，请重新选择');
    const samples = (saved?.items || []).slice(0, 10).map(item => ({ id: item.id, title: item.title, body: item.body.slice(0, 2000), url: item.url, publishedAt: item.publishedAt, collectedAt: item.collectedAt, metrics: item.metrics, excerpt: item.excerpt || item.body.length > 2000 }));
    const visionInputs = [], imageURLs = new Set();
    if (input.vision) {
      for (const item of (saved?.items || []).slice(0, 10)) {
        const url = safeXhsCoverUrl(item.coverUrl); if (!url || imageURLs.has(new URL(url).href)) continue;
        visionInputs.push({ referenceId: item.id, url }); imageURLs.add(new URL(url).href);
      }
      assert(visionInputs.length, '所选样本没有可分析的原始 HTTPS 公开封面，请重新选择样本或关闭图片分析');
      route.visionInputs = visionInputs;
    }
    const effective = { ...input, keyword: input.keyword || saved?.keyword || '', title: input.title || selected?.asset.title || '', body: input.body || selected?.asset.body || '' };
    assert(!['title-score', 'note-score'].includes(input.mode) || samples.length > 0, '评分需要至少一条真实匹配样本，请先采集并选择样本');
    assert(input.mode !== 'title-score' || effective.title, '请填写需要评分的标题');
    assert(!['rewrite', 'note-score'].includes(input.mode) || effective.body, '请填写需要改写或评分的正文');
    const payload = { input: effective, brief: selected?.strategy.briefSnapshot || p.brief, ...creationReferences(p, input, selected, creation.accountContext),
      ...(selected ? { strategy: { title: selected.strategy.title, core: selected.strategy.core, direction: selected.strategy.direction, prompt: selected.strategy.prompt }, task: { channel: 'xiaohongshu', kind: selected.asset.kind } } : {}),
      samples, ...(input.vision ? { visionReferenceIds: visionInputs.map(row => row.referenceId) } : {}), sampleContext: saved ? { keyword: saved.keyword, startDate: saved.startDate, endDate: saved.endDate, collectedAt: saved.finishedAt || saved.createdAt } : null,
      builtinSkills: resolveBuiltinSkills(state, workflowId), creativeSkill: creation.creativeSkill, accountContext: creation.accountContext };
    const definition = xhsAssistantDefinition(input.mode), instructions = xhsAssistantInstructions(input.mode, payload) + knowledgeInstructions(payload.knowledgeContext) + '\nrequirement 是本篇明确创作要求，优先于旧策略表达方向。corpusReferences、researchReferences、adoptedDocumentContext 与 styleReferences 仅按各自来源和用途提供背景，不是评分匹配样本；评分和 evidence 只引用本次 samples 的真实原文。文风、经验与热点假设不得冒充产品事实、用户经历或平台成绩。';
    assert(Buffer.byteLength(JSON.stringify(payload)) <= 150000, '本次主题、正文、账号身份和样本合计过长，请精简输入或规则');
    const reservationUsd = estimateStructuredReservation(payload, route, definition, instructions), imageReservation = structuredVisionReservation(route);
    const warnings = [...(saved?.warnings || []), ...(!samples.length ? ['本次没有联网样本，仅基于输入提供文字创作建议。'] : [])];
    if (input.vision) warnings.push(`本次将 ${visionInputs.length} 张公开样本封面发送给所选 ${route.provider} 的 ${route.model} 分析，不会同时发送其他服务商。${imageReservation.note}`);
    return { payload, route, definition, instructions, workflowId, basisFingerprint: fingerprint(basisOf(state, p, input, workflowId)),
      estimate: { mode: input.mode, model: route.model, provider: route.provider, reservationUsd, vision: input.vision, imageCount: imageReservation.imageCount, imageReservationUsd: imageReservation.reservationUsd, sampleCount: samples.length, warnings, ...accountInfo(creation.accountContext) } };
  }
  app.get(base, (req, res) => {
    local(req); const state = store.get(), p = project(state, req.params.id), saved = xhsAssistantOf(p), route = stageConfig('copy', config.modelStore.get());
    const info = accountInfo(resolveAccountCreation(state, p, 'xiaohongshu').accountContext), capability = structuredVisionCapability(route), analysis = stageConfig('analysis', config.modelStore.get());
    res.json({ samples: saved.samples, runs: saved.runs.map(run => { const reason = run.status === 'completed' && !run.adoptedAt ? staleReason(state, p, run) : run.staleReason || ''; return { ...run, stale: !!reason, staleReason: reason }; }),
      modes: XHS_ASSISTANT_MODES, models: { text: { model: route.model, provider: route.provider, label: route.label, configured: configured(route.provider) }, analysis: { model: analysis.model, provider: analysis.provider, label: analysis.label, configured: configured(analysis.provider) }, vision: { model: route.model, provider: route.provider, configured: configured(route.provider), supported: capability.supported, reason: capability.reason || (configured(route.provider) ? '' : '请先保存当前所选模型的密钥') } },
      redfox: { enabled: !!config.redfox?.enabled('data'), configured: !!config.redfox?.status().configured, reservationCny: priceCny },
      account: info.accountId ? { id: info.accountId, name: info.accountName, profileRevision: info.profileRevision } : null });
  });
  app.post(`${base}/samples`, async (req, res) => {
    local(req); const input = xhsSamplesInputSchema.parse(req.body), hash = fingerprint({ keyword: input.keyword, days: input.days });
    const previous = findRequest(project(store.get(), req.params.id), 'samples', input.requestId, hash); if (previous) return replyExisting(res, previous);
    return locked(req, async () => {
      assert(config.redfox?.enabled('data') && config.redfox.status().configured, '请在连接设置保存 Redfox 密钥并启用数据读取');
      const state = store.get(), p = project(state, req.params.id), info = accountInfo(resolveAccountCreation(state, p, 'xiaohongshu').accountContext), dates = xhsSampleDateRange(input.days);
      const row = { id: randomUUID(), requestId: input.requestId, requestFingerprint: hash, keyword: input.keyword, days: input.days, ...dates, status: 'running', items: [], warnings: [], reservationCny: priceCny, createdAt: now(), ...info };
      store.mutate(state => remember(project(state, p.id), 'samples', row));
      try {
        const data = await config.redfox.request('xhs.samples', { keyword: input.keyword, pageNum: 1, pageSize: 50, ...dates }, { projectId: p.id, accountId: info.accountId, platform: 'xiaohongshu', stage: 'xhs_samples', taskId: row.id });
        const parsed = xhsSampleItems(data, Date.now(), dates), result = store.mutate(state => {
          const current = project(state, p.id), record = ensure(current).samples.find(item => item.id === row.id);
          Object.assign(record, parsed, { status: 'completed', finishedAt: now() }); touch(current); activity(state, '小红书参考样本已保存', `${record.items.length} 条 · 单次读取`, p.id); return record;
        });
        res.json({ result, state: store.get() });
      } catch (error) {
        const message = safeFailure(error, 'samples');
        store.mutate(state => { const current = project(state, p.id), record = ensure(current).samples.find(item => item.id === row.id); Object.assign(record, { status: error.noCharge ? 'failed' : 'uncertain', error: message, finishedAt: now() }); touch(current); });
        throw Object.assign(new Error(message), { status: error.status || 502 });
      }
    });
  });
  app.post(`${base}/estimate`, (req, res) => {
    local(req); const input = xhsAssistantInputSchema.parse(req.body), state = store.get(), p = project(state, req.params.id);
    res.json(prepare(state, p, input).estimate);
  });
  app.post(`${base}/runs`, async (req, res) => {
    local(req); const { requestId, confirmed, expectedModel, maxReservationUsd, ...input } = xhsRunInputSchema.parse(req.body), hash = fingerprint({ ...input, ...(expectedModel === undefined ? {} : { expectedModel }), ...(maxReservationUsd === undefined ? {} : { maxReservationUsd }) });
    const previous = findRequest(project(store.get(), req.params.id), 'runs', requestId, hash); if (previous) return replyExisting(res, previous);
    return locked(req, async () => {
      const state = store.get(), p = project(state, req.params.id), prepared = prepare(state, p, input), { payload, route, definition, instructions, estimate, workflowId } = prepared;
      assert(expectedModel === undefined || route.model === expectedModel, '所选模型在估算后已变化，请重新估算并确认，本次未调用模型', 409);
      assert(maxReservationUsd === undefined || estimate.reservationUsd <= maxReservationUsd + 1e-9, '本次费用预留已高于你确认的金额，请重新估算并确认，本次未调用模型', 409);
      const skillTrace = workflowSkillTrace(workflowId, payload, now()), row = { id: randomUUID(), requestId, requestFingerprint: hash, mode: input.mode, input, effectiveInput: payload.input, status: 'running', stale: false, staleReason: '', createdAt: now(), ...estimate,
        basisFingerprint: prepared.basisFingerprint, knowledgeContext: payload.knowledgeContext, corpusReferences: payload.corpusReferences, researchReferences: payload.researchReferences, sampleSnapshot: payload.samples, visionReferenceIds: payload.visionReferenceIds || [], visionInputs: route.visionInputs || [], skillTrace, creationTrace: payload.accountContext, usageId: randomUUID() };
      const reservation = estimate.reservationUsd; let submitted = false, output;
      store.mutate(state => {
        const current = project(state, p.id); assert(current.usage.reduce((sum, item) => sum + item.amountUsd, 0) + reservation <= current.brief.budgetUsd, `文字模型预算不足，本次预留约 $${reservation.toFixed(3)}，请先调整预算`);
        remember(current, 'runs', row);
        current.usage.push({ id: row.usageId, stage: 'xhs_assistant', mode: input.mode, model: route.model, status: 'running', amountUsd: reservation, estimated: true, at: now(), skillVersions: skillVersionsFor(workflowId, payload), skillTrace, accountId: row.accountId, note: '小红书创作助手 · 预留文字模型费用' });
      });
      const settle = (state, status, usage, noCharge = false) => {
        const current = project(state, p.id), record = ensure(current).runs.find(item => item.id === row.id), ledger = current.usage.find(item => item.id === row.usageId);
        if (ledger.status !== 'running') return record;
        const cost = tokenCost(usage, route), amountUsd = cost ?? (noCharge ? 0 : reservation), estimated = cost === null && !noCharge;
        Object.assign(ledger, { status, amountUsd, estimated, tokens: usage || null, note: noCharge ? '未发起付费模型请求或请求被拒绝，已释放预留金额' : estimated ? '结果用量不明确，按预留金额记录，请核对账单' : '按本次返回 token 与模型单价估算，实际以服务商账单为准' });
        Object.assign(record, { amountUsd, estimated, finishedAt: now() }); touch(current); return record;
      };
      try {
        const apiKey = await getKey(req, route.provider);
        const before = store.get(); assert(!staleReason(before, project(before, p.id), row), '等待模型期间账号或原素材已变化，本次未调用模型', 409);
        submitted = true; output = await generateStructured(payload, { ...route, apiKey }, definition, instructions, config.fetcher);
        const result = store.mutate(state => {
          const current = project(state, p.id), record = settle(state, 'completed', output.usage), reason = staleReason(state, current, row);
          Object.assign(record, { status: 'completed', result: output.value, stale: !!reason, staleReason: reason });
          activity(state, '小红书创作助手已完成', `${input.mode} · 结果等待人工采纳`, p.id); return record;
        });
        res.json({ result, state: store.get() });
      } catch (error) {
        const message = !submitted && error.status ? error.message : safeFailure(error, 'runs');
        store.mutate(state => { const record = settle(state, !submitted || error.noCharge ? 'failed' : 'uncertain', error.usage || output?.usage, !submitted || error.noCharge); Object.assign(record, { status: !submitted || error.noCharge ? 'failed' : 'uncertain', error: message }); });
        throw Object.assign(new Error(message), { status: error.status || 502 });
      }
    });
  });
  app.post(`${base}/adopt`, (req, res) => {
    local(req); const input = xhsAdoptInputSchema.parse(req.body); assert(!activeJobs.has(req.params.id), '请等待本项目当前任务结束后再采纳', 409);
    const result = store.mutate(state => {
      const p = project(state, req.params.id), run = ensure(p).runs.find(item => item.id === input.runId);
      assert(run?.status === 'completed' && run.result, '所选结果不存在或尚未完成');
      assert(run.mode !== 'note-score', '正文评分仅为报告，不会自动改写素材');
      if (run.adoptedAt) { const previous = p.assets.find(item => item.id === run.adoptedAssetId); assert(previous?.id === input.assetId && previous.revision === run.adoptedRevision && run.adoptedChoiceIndex === input.choiceIndex, '此结果已经采纳；候选项或当前素材已变化，不会重复覆盖', 409); return previous; }
      assert(!staleReason(state, p, run), '账号、项目资料或原素材已变化，请基于当前内容重新生成后采纳', 409);
      assert(!run.input.assetId || run.input.assetId === input.assetId, '此结果绑定另一份素材，不能跨素材采纳', 409);
      const { asset } = assetOf(p, input.assetId, input.expectedRevision), currentContext = resolveAccountCreation(state, contentProjectForAsset(p, p.assets.find(a => a.id === input.assetId)), 'xiaohongshu').accountContext;
      assertAssetCreationAccount(asset, currentContext);
      const definition = xhsAssistantDefinition(run.mode), fields = Object.keys(definition.schema.properties);
      const originalOutput = Object.fromEntries(fields.map(key => [key, run.result[key]]));
      if (Array.isArray(originalOutput.dimensions)) originalOutput.dimensions = originalOutput.dimensions.map(({ id, score, reason }) => ({ id, score, reason }));
      const value = definition.validate(originalOutput, { input: run.effectiveInput, samples: run.sampleSnapshot, visionReferenceIds: run.visionReferenceIds || [] });
      let title = asset.title, body = asset.body, extras = null;
      if (['create', 'rewrite'].includes(run.mode)) { title = value.title; body = value.body; extras = screenCopy(value, rulesOf(state)); }
      if (['titles', 'title-score', 'cover-plan'].includes(run.mode)) assert(input.choiceIndex !== undefined, '请选择要采纳的候选项');
      if (run.mode === 'titles') { assert(value.titles[input.choiceIndex], '所选标题不存在'); title = value.titles[input.choiceIndex].title; }
      if (run.mode === 'title-score') { assert(value.alternatives[input.choiceIndex], '所选优化标题不存在'); title = value.alternatives[input.choiceIndex].title; }
      let coverPlan;
      if (run.mode === 'cover-plan') {
        const plan = value.plans[input.choiceIndex]; assert(plan, '所选封面方案不存在');
        const checked = screenCopy({ prompt: plan.prompt }, rulesOf(state)); assert(checked.value.prompt.length <= 1200, '词库替换后的封面提示超过 1200 字，请先精简词库或重新生成');
        coverPlan = { ...plan, prompt: checked.value.prompt, runId: run.id, chosenAt: now(), choiceIndex: input.choiceIndex, skillTrace: structuredClone(run.skillTrace), creationTrace: structuredClone(run.creationTrace), references: value.references, vision: value.vision };
      }
      updateAsset(p, asset.id, { title, body, expectedRevision: input.expectedRevision }, rulesOf(state));
      if (coverPlan) asset.xhsCoverPlan = { ...coverPlan, appliedRevision: asset.revision };
      else {
        if (extras) Object.assign(asset, { prompt: extras.value.prompt, scenes: extras.value.scenes, status: 'queued', copyReview: extras.review });
        asset.skillTrace = structuredClone(run.skillTrace); asset.copyModel = run.model;
      }
      // A plan can be adopted before the first AI copy is generated. Bind the
      // underlying asset as well, so the existing cover gate stops account B
      // from generating account A's saved plan after a later account switch.
      if (run.creationTrace) asset.creationTrace = structuredClone(run.creationTrace); else delete asset.creationTrace;
      if (run.knowledgeContext) asset.knowledgeContext = structuredClone(run.knowledgeContext);
      Object.assign(run, { adoptedAt: now(), adoptedAssetId: asset.id, adoptedRevision: asset.revision, adoptedChoiceIndex: input.choiceIndex });
      activity(state, '小红书助手结果已采纳', `${run.mode} · 已更新素材，仍须检查后进入原发布流程`, p.id); return asset;
    });
    res.json({ result, state: store.get() });
  });
}
