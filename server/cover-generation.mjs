import { z } from 'zod';
import * as d from './domain.mjs';
import { mediaPrompt } from './prompts.mjs';
import { rulesOf } from './workflow.mjs';
import { generateSeedreamKeyframe, seedreamCost, validateSeedreamReferences } from './seedream.mjs';
import { seedreamSettingsSchema, SEEDREAM_COVER_SIZE } from './seedream-config.mjs';

export const coverInput = z.object({ expectedRevision: z.number().int().positive(), prompt: z.string().trim().max(1200).default(''), query: z.string().trim().max(500).default(''), style: z.enum(['natural', 'clean', 'editorial']).default('natural'), layout: z.enum(['top', 'left', 'center']).default('top'), textMode: z.enum(['title', 'none']).default('title'), confirmed: z.literal(true) }).strict();

export function mountCoverGeneration(app, store, config, helpers, preferences) {
  const { project, activeJobs, local, background, respond, reserve, settle } = helpers;
  const assetIn = (p, id) => { const a = p.assets.find(a => a.id === id); d.assert(a?.kind === 'image' && a.channel === 'xiaohongshu', '请选择小红书图文任务', 404); return a; };
  const update = (pid, aid, work) => store.mutate(state => { const p = project(state, pid), a = assetIn(p, aid); const result = work(p, a, state); d.touch(p); return result; });
  app.post('/api/projects/:id/assets/:assetId/cover', async (req, res) => {
    local(req); const input = coverInput.parse(req.body);
    const settings = seedreamSettingsSchema.parse(preferences.get().seedream);
    d.assert(!activeJobs.has(req.params.id), '此项目正在执行模型请求，请稍候', 409);
    activeJobs.add(req.params.id);
    let key, job;
    try {
      key = await config.seedreamVault?.getKey(); d.assert(key, '请先在连接与设置保存 Seedream API Key');
      job = update(req.params.id, req.params.assetId, (p, a, state) => {
        d.assert(a.revision === input.expectedRevision, '内容已更新，请重新打开封面生成窗口', 409);
        d.assert(a.aiCover?.phase !== 'generating', '封面正在生成，请勿重复提交', 409);
        d.assert(a.aiCover?.phase !== 'uncertain', '上次封面请求结果不明，请核对火山方舟后解除锁定', 409);
        const references = p.imageData ? [p.imageData] : []; validateSeedreamReferences(references);
        const recipe = mediaPrompt(p, a, { ...input, purpose: 'cover' }, rulesOf(state));
        const usageId = reserve(p, settings.model, Math.max(settings.reservationUsd, settings.imagePriceUsd), 'cover');
        const id = d.id();
        // A new request keeps the adopted asset and its history untouched.
        a.aiCover = { id, phase: 'generating', assetRevision: a.revision, model: settings.model, size: SEEDREAM_COVER_SIZE, usageId, input, ...recipe, createdAt: d.now(), error: '' };
        return { pid: p.id, aid: a.id, id, usageId, references, prompt: recipe.prompt };
      });
    } finally { activeJobs.delete(req.params.id); }
    background(async () => {
      try {
        const result = await generateSeedreamKeyframe({ apiKey: key, settings, size: SEEDREAM_COVER_SIZE, prompt: job.prompt, references: job.references }, config.fetcher || fetch);
        update(job.pid, job.aid, (p, a) => {
          settle(p, job.usageId, seedreamCost(result.usage, settings), 'completed', 'Seedream 封面 · 按配置单价估算，最终以账单为准');
          if (a.aiCover?.id !== job.id) return;
          Object.assign(a.aiCover, { phase: a.revision === a.aiCover.assetRevision ? 'ready' : 'stale', mediaData: result.mediaData, completedAt: d.now() });
          if (a.aiCover.phase === 'stale') a.aiCover.error = '生成期间文案或成品已修改。候选图保留供查看，不会覆盖当前版本。';
        });
      } catch (error) {
        update(job.pid, job.aid, (p, a) => {
          settle(p, job.usageId, seedreamCost(error.usage, settings) ?? (error.noCharge ? 0 : null), error.noCharge ? 'failed' : 'uncertain', '封面请求未完成，请核对服务商记录；未自动重试');
          if (a.aiCover?.id === job.id) Object.assign(a.aiCover, { phase: error.noCharge ? 'failed' : 'uncertain', error: error.status ? error.message : '封面请求结果不明，请核对服务商记录。' });
        });
      }
    });
    respond(res);
  });
  app.post('/api/projects/:id/assets/:assetId/cover-apply', (req, res) => {
    local(req);
    const input = z.object({ id: z.string(), expectedRevision: z.number().int(), confirmed: z.literal(true) }).strict().parse(req.body);
    const result = update(req.params.id, req.params.assetId, (p, a, state) => {
      const g = a.aiCover;
      d.assert(g?.id === input.id && g.phase === 'ready' && g.mediaData, '此候选封面尚不能采用，请检查任务状态', 409);
      d.assert(a.revision === input.expectedRevision && a.revision === g.assetRevision, '内容版本已修改，请按当前版本重新生成封面', 409);
      d.updateAsset(p, a.id, { title: a.title, body: a.body, expectedRevision: a.revision, mediaData: g.mediaData, mime: g.mediaData.startsWith('data:image/jpeg;') ? 'image/jpeg' : 'image/png' }, rulesOf(state));
      g.phase = 'applied'; g.appliedRevision = a.revision; g.appliedAt = d.now();
      // The asset now owns these bytes. Avoid duplicating them in every poll/backup.
      delete g.mediaData;
      d.activity(state, 'AI 封面已采用', 'Seedream · 小红书 3:4 封面', p.id); return a;
    });
    res.json({ result, state: store.get() });
  });
  app.post('/api/projects/:id/assets/:assetId/cover-reset', (req, res) => {
    local(req); const input = z.object({ id: z.string(), confirmed: z.literal(true) }).strict().parse(req.body);
    update(req.params.id, req.params.assetId, (_p, a) => {
      d.assert(a.aiCover?.id === input.id && a.aiCover.phase === 'uncertain', '只有结果不明的封面任务需要解除锁定', 409);
      a.aiCover.phase = 'failed'; a.aiCover.error = '已手动核对旧任务。重新生成将单独收费。';
    }); res.json({ result: { reset: true }, state: store.get() });
  });
  return { recover(state) { for (const p of state.projects) for (const a of p.assets) if (a.aiCover?.phase === 'generating') { a.aiCover.phase = 'uncertain'; a.aiCover.error = '应用在封面生成期间重启，请核对火山方舟记录；未自动重复提交。'; } } };
}
