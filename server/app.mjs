import { applyRuleClassification, correctComment } from './comment-analysis.mjs';
import { saveMetricSnapshot } from './operating-data.mjs';
import { createContentDraft, updateContentBrief, createKnowledge, updateKnowledge, previewKnowledge } from './content-workflow.mjs';
import { mountAgentWorkspaceRoutes } from './agent-workspace-routes.mjs';
import { createActiveJobs } from './active-jobs.mjs';
import { mountTaskJournalRoutes } from './task-journal.mjs';
import { mountContentEditDraftRoutes } from './content-edit-drafts.mjs';
import { updatePlatformDelivery } from './platform-delivery.mjs';
import express from 'express';
import { previewCreativeSkill, installCreativeSkill, setCreativeSkillEnabled, removeCreativeSkill, setWorkflowSkill } from './creative-skills.mjs';
import { creativeSkillCatalog } from './creative-skill-catalog.mjs';
import { setBuiltinSkill, resetBuiltinSkill } from './builtin-skills.mjs';
import { canEditSharedSettings } from './workspace-access.mjs';
import { SKILL_WORKFLOWS } from './skill-workflows.mjs';
import { saveAccountCreationProfile, saveProjectCreationSelection } from './account-creation.mjs';
import { contentArchive } from './content-export.mjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import * as domain from './domain.mjs';
import { validateSceneReference } from './nurture.mjs';
import { updateGuide } from './guide.mjs';
import { appearanceOf, saveAppearance } from './appearance.mjs';
import { mountAIRoutes } from './ai-routes.mjs';
import { attachBriefImports } from './project-brief-import-routes.mjs';
import { mountRagRoutes } from './rag-routes.mjs';
import { mountTrendRoutes } from './trend-routes.mjs';
import { mountResearchRoutes } from './research-routes.mjs';
import { createWorkControl } from './work-control.mjs';
import { createWorkExecutors } from './work-executors.mjs';
import { createWorkPlanner } from './work-planning.mjs';
import { createWorkBackup } from './work-backup.mjs';
import { currentActor } from './request-actor.mjs';
import { mountWorkExperienceRoutes } from './work-experience.mjs';
import { createOpenAITransport } from './openai-errors.mjs';
import { createDeepSeekTransport } from './deepseek.mjs';
import { createQwenTransport } from './qwen.mjs';
import { createGLMTransport } from './glm.mjs';
import { createLocalQwenTransport } from './local-qwen.mjs';
import { qwenConnection, qwenRequestUrl } from './qwen-connection.mjs';
import { mountIntegrations } from './integrations.mjs';
import { consumeEditorDraft, rulesOf, saveRules, importCorpus, changeCorpus, searchCorpus, saveEditorDraft, reviewObject } from './workflow.mjs';

export function createApp(store, options = {}) {
  const app = express();
  const config = { apiKey: '', password: '', secret: randomBytes(32).toString('hex'), allowedOrigins: [], ...options };
  if (!config.authorizeWorkActor && !config.teamMode) config.authorizeWorkActor = actor => actor?.userId === (config.workOwnerId || 'personal');
  config.workFetcher = options.fetcher || fetch;
  config.getQwenConnection = () => qwenConnection(store.get().qwenConnection);
  const embeddingFetcher = options.ragFetcher || options.fetcher || fetch;
  config.ragFetcher = (url, init) => embeddingFetcher(qwenRequestUrl(url, store.get().qwenConnection), init);
  const openaiTransport = createOpenAITransport(config.fetcher);
  const deepseekTransport = createDeepSeekTransport(openaiTransport.fetch);
  const qwenTransport = createQwenTransport(deepseekTransport.fetch, () => store.get().qwenConnection);
  const glmTransport = createGLMTransport(qwenTransport.fetch);
  config.fetcher = createLocalQwenTransport(glmTransport.fetch, () => store.get().localQwenConnection, { allowed: config.allowLocalModels !== false, ...(options.localQwenFetcher ? { localFetcher: options.localQwenFetcher } : {}) }).fetch;
  config.glmTransport = app.locals.glmTransport = glmTransport;
  config.qwenTransport = app.locals.qwenTransport = qwenTransport;
  config.deepseekTransport = app.locals.deepseekTransport = deepseekTransport;
  config.openaiTransport = app.locals.openaiTransport = openaiTransport;
  const sessionHash = value => createHmac('sha256', config.secret).update(value).digest('hex');
  const sessions = new Map();
  const loginAttempts = new Map();
  const activeJobs = createActiveJobs();
  app.locals.activeJobs = activeJobs;
  const downloads = new Map();
  app.locals.hasDownload = ticket => { const item = downloads.get(ticket); return !!item && item.expiresAt > Date.now(); };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    if (req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
      const origin = req.get('Origin');
      const self = `${req.protocol}://${req.get('Host')}`;
      const allowed = !origin || origin === self || config.allowedOrigins.includes(origin);
      if (!allowed) return res.status(403).json({ error: '此来源未获允许' });
      if (origin && config.allowedOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin); res.vary('Origin');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Studio-Client');
        res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '32mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, authRequired: !!config.password }));
  app.post('/api/login', (req, res) => {
    const address = req.ip;
    const attempt = loginAttempts.get(address) || { count: 0, at: Date.now() };
    if (Date.now() - attempt.at > 15 * 60 * 1000) { attempt.count = 0; attempt.at = Date.now(); }
    if (attempt.count >= 10) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后重试' });
    const value = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!config.password || !timingSafeEqual(Buffer.from(sessionHash(value)), Buffer.from(sessionHash(config.password)))) {
      attempt.count += 1; loginAttempts.set(address, attempt);
      return res.status(401).json({ error: '工作区密码不正确' });
    }
    loginAttempts.delete(address);
    for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
    const token = randomBytes(32).toString('base64url');
    sessions.set(sessionHash(token), Date.now() + 7 * 86400000);
    res.json({ token });
  });
  app.use('/api', (req, res, next) => {
    if (req.get('X-Studio-Client') !== 'studio-v1') return res.status(403).json({ error: '请从运营工作台访问' });
    if (config.password) {
      const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
      if ((sessions.get(sessionHash(token)) || 0) < Date.now()) return res.status(401).json({ error: '请登录工作区' });
    }
    next();
  });
  app.post('/api/logout', (req, res) => { sessions.delete(sessionHash((req.get('Authorization') || '').replace(/^Bearer /, ''))); res.json({ ok: true }); });
  const project = (state, projectId) => { const p = state.projects.find(p => p.id === projectId); domain.assert(p, '项目不存在', 404); return p; };
  const mutate = (req, res, callback) => {
    const result = store.mutate(state => { const p = project(state, req.params.id); return callback(p, state); });
    res.json({ result, state: store.get() });
  };
  app.get('/api/state', (_req, res) => res.json(store.get()));
  mountAgentWorkspaceRoutes(app, store, { mutate });
  mountTaskJournalRoutes(app, store);
  mountContentEditDraftRoutes(app, store);
  app.get('/api/appearance', (_req, res) => res.json(appearanceOf(store.get())));
  app.put('/api/appearance', (req, res) => { const result = store.mutate(state => saveAppearance(state, req.body)); res.json({ result, state: store.get() }); });
  app.get('/api/creative-skills', (req, res) => res.json({ ...creativeSkillCatalog(store.get()), defaultEditable: canEditSharedSettings(req, config) }));
  app.post('/api/creative-skills/preview', (req, res) => res.json(previewCreativeSkill(req.body)));
  const changeCreativeSkills = (res, work) => { const result = store.mutate(work); res.json({ result, state: store.get() }); };
  const changeBuiltinSkills = (req, res, reset) => {
    domain.assert(canEditSharedSettings(req, config), '只有团队管理员可以修改工作区默认规则', 403);
    changeCreativeSkills(res, state => {
      const before = state.skillsRevision || 0;
      const result = (reset ? resetBuiltinSkill : setBuiltinSkill)(state, req.body);
      if (state.skillsRevision !== before) domain.activity(state, reset ? '默认规则已恢复出厂' : '默认规则已更新', `${SKILL_WORKFLOWS.find(item => item.id === result.workflowId).label} · ${result.name}`);
      return result;
    });
  };
  app.put('/api/creative-skills/default', (req, res) => changeBuiltinSkills(req, res, false));
  app.delete('/api/creative-skills/default', (req, res) => changeBuiltinSkills(req, res, true));
  app.put('/api/creative-skills/selection', (req, res) => changeCreativeSkills(res, state => setWorkflowSkill(state, req.body)));
  app.post('/api/creative-skills', (req, res) => changeCreativeSkills(res, state => installCreativeSkill(state, req.body)));
  app.patch('/api/creative-skills/:skillId', (req, res) => changeCreativeSkills(res, state => setCreativeSkillEnabled(state, req.params.skillId, req.body)));
  app.delete('/api/creative-skills/:skillId', (req, res) => changeCreativeSkills(res, state => removeCreativeSkill(state, req.params.skillId, req.body)));
  app.put('/api/guide', (req, res) => { const result = store.mutate(state => updateGuide(state, req.body)); res.json({ result, state: store.get() }); });
  app.get('/api/content-rules', (_req, res) => { const state = store.get(); res.json({ rules: rulesOf(state), revision: state.rulesRevision || 0 }); });
  app.put('/api/content-rules', (req, res) => { const result = store.mutate(state => saveRules(state, req.body)); res.json({ result, state: store.get() }); });
  app.get('/api/editor-drafts/:key', (req, res) => res.json(store.get().projectDrafts?.[req.params.key] || null));
  app.put('/api/editor-drafts/:key', (req, res) => res.json(store.mutate(state => saveEditorDraft(state, req.params.key, req.body, domain.briefSchema))));
  app.delete('/api/editor-drafts/:key', (req, res) => {
    store.mutate(state => { const current = state.projectDrafts?.[req.params.key]; domain.assert(!current || current.version === req.body.expectedVersion, '草稿已在另一处更新', 409); if (current) delete state.projectDrafts[req.params.key]; }); res.json({ ok: true });
  });
  const rag = mountRagRoutes(app, store, config, { project, activeJobs });
  app.post('/api/projects/:id/content-drafts', (req, res) => mutate(req, res, (p, state) => createContentDraft(state, p, req.body, rulesOf(state))));
  app.put('/api/projects/:id/assets/:assetId/brief', (req, res) => mutate(req, res, (p, state) => updateContentBrief(state, p, req.params.assetId, req.body)));
  app.post('/api/projects/:id/knowledge', (req, res) => mutate(req, res, (p, state) => createKnowledge(state, p, req.body)));
  app.patch('/api/projects/:id/knowledge/:entryId', (req, res) => mutate(req, res, (p, state) => updateKnowledge(state, p, req.params.entryId, req.body)));
  app.post('/api/projects/:id/knowledge/preview', (req, res) => { const state = store.get(); res.json(previewKnowledge(state, project(state, req.params.id), req.body)); });
  app.post('/api/projects/:id/corpus', (req, res) => mutate(req, res, p => { const result = importCorpus(p, req.body); domain.touch(p); return result; }));
  app.patch('/api/projects/:id/corpus/:documentId', (req, res) => mutate(req, res, p => { const result = changeCorpus(p, req.params.documentId, req.body, 'PATCH'); domain.touch(p); return result; }));
  app.delete('/api/projects/:id/corpus/:documentId', (req, res) => mutate(req, res, p => { const result = changeCorpus(p, req.params.documentId, {}, 'DELETE'); domain.touch(p); return result; }));
  app.post('/api/projects/:id/assets/:assetId/review', (req, res) => mutate(req, res, (p, state) => {
    const asset = p.assets.find(a => a.id === req.params.assetId); domain.assert(asset, '内容不存在', 404);
    domain.assert(asset.revision === req.body.expectedRevision, '成品已更新，请重新打开', 409);
    const previous = JSON.stringify([asset.title, asset.body, asset.scenes, asset.prompt]);
    const visual = JSON.stringify([asset.title, asset.scenes]); const old = { title: asset.title, body: asset.body, mediaData: asset.mediaData, mime: asset.mime, revision: asset.revision, at: domain.now(), ...(asset.skillTrace ? { skillTrace: structuredClone(asset.skillTrace) } : {}), ...(asset.creationTrace ? { creationTrace: structuredClone(asset.creationTrace) } : {}) }; const wasReady = asset.status === 'ready'; reviewObject(asset, rulesOf(state));
    if (previous !== JSON.stringify([asset.title, asset.body, asset.scenes, asset.prompt])) { if (wasReady) asset.history = [old, ...asset.history].slice(0, 5); if (visual !== JSON.stringify([asset.title, asset.scenes])) asset.status = 'queued'; asset.revision++; domain.touch(p); }
    return asset;
  }));
  app.get('/api/progress-version', (_req, res) => { const state = store.get(); res.json({ version: state.projects.map(p => `${p.id}:${p.revision}`).join('|'), ...(config.teamMode ? { workspaceVersion: state.teamRevision || 0 } : {}) }); });
  mountAIRoutes(app, store, config, { project, mutate, activeJobs, rag });
  mountTrendRoutes(app, store, config, { project });
  app.locals.integrations = mountIntegrations(app, store, config, { project, mutate, activeJobs });
  mountResearchRoutes(app, store, config, { project, activeJobs });
  if (store.work && config.workControl !== false && !config.webRelay) {
    const executors = config.workExecutors || createWorkExecutors({ store, config, activeJobs, rag, integrations: app.locals.integrations });
    const planner = config.workPlanner || createWorkPlanner({ store, config });
    app.locals.workControl = createWorkControl({ store, config, executors, planner, activeJobs, ...config.workControlOptions });
    app.locals.workControl.mount(app);
    mountWorkExperienceRoutes({ app, store, config });
  }
  app.get('/api/backup', (_req, res) => res.set('Content-Disposition', 'attachment; filename="shengzhang-backup.json"').json(store.get()));
  app.get('/api/work-backup', (_req, res) => {
    if (!store.work) return res.status(503).json({ error: '当前部署没有后台任务数据库' });
    const backup = createWorkBackup(store, { ownerId: config.workOwnerId || 'personal' });
    res.set('Content-Disposition', 'attachment; filename="shengzhang-work-backup.json"').json(backup.exportForOwner(currentActor()?.userId || config.workOwnerId || 'personal'));
  });
  app.post('/api/projects/:id/export', async (req, res) => {
    const data = z.object({ kind: z.enum(['asset', 'publication']), id: z.string(), expectedRevision: z.number().int().positive().optional() }).parse(req.body);
    const p = project(store.get(), req.params.id);
    const content = (data.kind === 'asset' ? p.assets : p.publications).find(item => item.id === data.id);
    domain.assert(content?.mediaData, '请先制作素材', 400);
    domain.assert(!data.expectedRevision || data.expectedRevision === (data.kind === 'asset' ? content.revision : content.assetRevision), '成品已更新，请关闭导出面板后重新打开', 409);
    domain.assert(data.kind !== 'asset' || content.status === 'ready', '当前内容需要重新制作');
    const { data: bytes, filename } = await contentArchive(content);
    for (const [key, value] of downloads) if (value.expiresAt < Date.now()) downloads.delete(key);
    while (downloads.size >= 12) downloads.delete(downloads.keys().next().value);
    const ticket = randomBytes(32).toString('base64url');
    downloads.set(ticket, { bytes, filename, expiresAt: Date.now() + 5 * 60000 });
    res.json({ url: `/downloads/${ticket}`, filename });
  });
  app.post('/api/projects', (req, res) => {
    domain.assert(!activeJobs.has('brief-import:new'), '介绍文档仍在提取中，请等结果返回后再创建项目；可以先保存并关闭窗口。', 409);
    const p = store.mutate(state => { const p = domain.newProject(req.body, rulesOf(state)); consumeEditorDraft(state, req.body); attachBriefImports(state, p); state.projects.unshift(p); domain.activity(state, '新项目已创建', p.brief.name, p.id); return p; });
    res.status(201).json({ result: p, state: store.get() });
  });
  app.patch('/api/projects/:id', (req, res) => mutate(req, res, (p, state) => {
    const data = z.object({ brief: domain.briefSchema, expectedRevision: z.number().int() }).parse(req.body);
    domain.assert(p.revision === data.expectedRevision, '项目已更新，请刷新后再保存', 409);
    p.brief = data.brief; domain.touch(p); domain.activity(state, '项目资料已更新', '已确认策略保留原版；新策略将使用更新后的资料。', p.id); return p;
  }));
  app.put('/api/projects/:id/media', (req, res) => mutate(req, res, p => {
    const data = z.object({ kind: z.enum(['image', 'audio']), data: z.string().max(12000000) }).parse(req.body);
    if (data.kind === 'image' && p.brief.type === 'nurture') validateSceneReference(data.data);
    domain.assert(data.data === '' || (data.kind === 'image' ? /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/ : /^data:audio\/(mpeg|wav|mp3|x-wav|mp4|ogg|webm);base64,[A-Za-z0-9+/=]+$/).test(data.data), '不支持此素材格式');
    p[data.kind === 'image' ? 'imageData' : 'audioData'] = data.data; domain.touch(p); return { ok: true };
  }));
  app.patch('/api/projects/:id/strategies/:strategyId', (req, res) => mutate(req, res, (p, state) => domain.editStrategy(p, req.params.strategyId, req.body, rulesOf(state))));
  app.post('/api/projects/:id/strategies/:strategyId/confirm', (req, res) => mutate(req, res, (p, state) => {
    const s = domain.confirmStrategy(p, req.params.strategyId, rulesOf(state)); domain.activity(state, '策略已确认，开始制作', `V${s.version} · ${s.tasks.length} 项制作任务`, p.id); return s;
  }));
  app.put('/api/projects/:id/assets/:assetId', (req, res) => mutate(req, res, (p, state) => domain.updateAsset(p, req.params.assetId, req.body, rulesOf(state))));
  app.post('/api/projects/:id/assets/:assetId/restore', (req, res) => mutate(req, res, (p, state) => {
    const a = p.assets.find(a => a.id === req.params.assetId); domain.assert(a, '内容不存在', 404);
    const old = a.history.find(h => h.revision === req.body.revision); domain.assert(old?.mediaData, '该版本没有成品');
    const restored = domain.updateAsset(p, a.id, { title: old.title, body: old.body, mediaData: old.mediaData, mime: old.mime, expectedRevision: a.revision }, rulesOf(state));
    if (old.skillTrace) restored.skillTrace = structuredClone(old.skillTrace); else delete restored.skillTrace;
    if (old.creationTrace) restored.creationTrace = structuredClone(old.creationTrace); else delete restored.creationTrace;
    if (old.knowledgeContext) restored.knowledgeContext = structuredClone(old.knowledgeContext); else delete restored.knowledgeContext;
    return restored;
  }));
  app.post('/api/projects/:id/publications', (req, res) => mutate(req, res, (p, state) => {
    const pub = domain.schedulePublication(p, state.accounts, req.body); domain.activity(state, '已加入发布计划', `${pub.title} · 等待手动发布`, p.id); return pub;
  }));
  app.post('/api/projects/:id/publications/:publicationId/confirm', (req, res) => mutate(req, res, (p, state) => {
    const pub = domain.confirmPublication(p, req.params.publicationId, req.body); domain.activity(state, '作品发布结果已登记', `${pub.title} · 用户回填确认`, p.id); return pub;
  }));
  app.post('/api/projects/:id/publications/:publicationId/delivery', (req,res)=>mutate(req,res,p=>{const result=updatePlatformDelivery(p,req.params.publicationId,req.body);domain.touch(p);return result;}));
  app.patch('/api/projects/:id/publications/:publicationId', (req, res) => mutate(req, res, p => {
    const pub = p.publications.find(r => r.id === req.params.publicationId); domain.assert(pub, '记录不存在', 404);
    domain.assert(!['published', 'cancelled'].includes(pub.status), '该记录不可修改');
    const data = z.object({ status: z.enum(['exported', 'cancelled']).optional(), scheduledAt: z.string().datetime({ offset: true }).optional(), expectedScheduledAt: z.string().optional() }).strict().parse(req.body);
    domain.assert(data.status || data.scheduledAt, '请选择要修改的计划信息');
    if (data.scheduledAt) domain.assert(data.expectedScheduledAt === pub.scheduledAt, '计划时间已在另一处修改，请刷新后重试', 409);
    if (data.status) pub.status = data.status;
    if (data.scheduledAt) pub.scheduledAt = data.scheduledAt;
    domain.touch(p); return pub;
  }));
  app.post('/api/projects/:id/comments/import', (req, res) => mutate(req, res, (p, state) => {
    const result = domain.importComments(p, req.body); domain.activity(state, '评论已导入', `${result.added} 条新增，${result.duplicates} 条重复已跳过`, p.id); return result;
  }));
  app.post('/api/projects/:id/comments/sample', (req, res) => mutate(req, res, p => {
    domain.assert(p.sample, '示例评论仅可添加到示例项目');
    let pub = p.publications.find(r => r.sample);
    if (!pub) {
      pub = { id: domain.id(), assetId: '', assetRevision: 0, strategyId: p.strategies[0]?.id || '', accountId: 'sample', accountName: '示例账号', platform: 'xiaohongshu',
        title: '示例作品 · 周末去山野喝杯咖啡', body: '', mediaData: '', mime: '', status: 'published', confirmationSource: 'sample', sample: true, url: '', scheduledAt: domain.now(), publishedAt: domain.now(), createdAt: domain.now() };
      p.publications.push(pub);
    }
    return domain.importComments(p, { publicationId: pub.id, source: 'paste', text: '这个一包多大呀，可以放进随身小包吗？\n户外冲泡要带多少水？\n希望可以拍一个露营冲泡演示\n包装好喜欢，想知道怎么买\n一盒多少钱，有试喝装吗？\n可以展示一下实物大小吗\n上次喝了感觉不错，坚果风味喜欢\n价格有点贵，想了解和普通挂耳的区别\n希望拍一下实际装包的过程\n下雨天在家喝也很有氛围' });
  }));
  app.post('/api/projects/:id/comments/classify-rules', (req, res) => mutate(req, res, p => { const result = applyRuleClassification(p, req.body); domain.touch(p); return result; }));
  app.patch('/api/projects/:id/comments/:commentId', (req, res) => mutate(req, res, p => { const result = correctComment(p, req.params.commentId, req.body); domain.touch(p); return result; }));
  app.post('/api/projects/:id/metrics', (req, res) => mutate(req, res, p => { const result = saveMetricSnapshot(p, req.body); domain.touch(p); return result; }));
  app.patch('/api/projects/:id/insights/:insightId', (req, res) => mutate(req, res, p => domain.decideInsight(p, req.params.insightId, req.body)));
  app.post('/api/accounts', (req,res) => { const result = store.mutate(state => domain.addAccount(state,req.body)); res.status(201).json({result,state:store.get()}); });
  app.put('/api/accounts/:accountId/creation-profile', (req, res) => {
    const result = store.mutate(state => saveAccountCreationProfile(state, req.params.accountId, req.body));
    res.json({ result, state: store.get() });
  });
  app.put('/api/projects/:id/creation-selection', (req, res) => mutate(req, res, (p, state) => saveProjectCreationSelection(state, p, req.body)));
  app.patch('/api/accounts/:accountId', (req, res) => {
    const data = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    store.mutate(state => { const a = state.accounts.find(a => a.id === req.params.accountId); domain.assert(a, '账号不存在', 404); a.name = data.name; });
    res.json({ state: store.get() });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.get('/downloads/:ticket', (req, res) => {
    const item = downloads.get(req.params.ticket);
    if (!item || item.expiresAt < Date.now()) return res.status(404).send('下载链接已过期，请返回工作台重新导出。');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="content.zip"; filename*=UTF-8''${encodeURIComponent(item.filename)}`);
    res.send(item.bytes);
  });
  app.use(express.static(config.staticDirectory || resolve('dist'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(config.staticDirectory || 'dist', 'index.html')));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: `输入有误：${error.issues[0]?.path.join('.')} ${error.issues[0]?.message}` });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '文件过大，请使用较小的素材' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '请求数据格式错误' });
    if (!error.status) console.error('Request failed: internal error');
    res.status(error.status || 500).json({ error: error.status ? error.message : '服务暂时遇到问题，请重试。数据已保留。', ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) });
  });
  return app;
}
