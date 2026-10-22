import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { acquireTaskResource } from './active-jobs.mjs';
import * as d from './domain.mjs';
import { integrationError, isPublicAddress, readBounded } from './integration-http.mjs';
import { validateSeedreamReferences } from './seedream.mjs';
import { SEEDREAM_SIZE, SEEDREAM_COVER_SIZE } from './seedream-config.mjs';
import { coverInput } from './cover-generation.mjs';
import { mediaPrompt } from './prompts.mjs';
import { contentProjectForAsset } from './content-workflow.mjs';
import { rulesOf } from './workflow.mjs';
import { reviewGeneratedImage } from './image-generation-review.mjs';
import { resolveAccountCreation, assertAssetCreationAccount } from './account-creation.mjs';
import { workflowSkillTrace } from './creative-skill-catalog.mjs';
import { resolveBuiltinSkills } from './builtin-skills.mjs';
import { validateSceneReference } from './nurture.mjs';
import { currentActor, runWithActor } from './request-actor.mjs';
import { coverRequest, rememberCoverRequest } from './cover-request.mjs';

const IMAGE_MODEL = 'Seedream 5.0 Pro', VIDEO_MODEL = 'Seedance 2.0';
const working = ['generating-frame', 'submitting-video', 'generating-video'];
const terminal = ['complete', 'ready', 'applied', 'stale', 'failed'];
const actor = () => currentActor() ? { ...currentActor() } : null;
const taskId = value => { d.assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value), 'Redfox 未返回有效任务编号，请核对任务记录；不会自动重复提交。', 502); return value; };
const safeError = (error, action) => error?.provider === 'redfox' ? error.message : `Redfox ${action}未完成，请核对任务记录；不会自动重复提交。`;

export function redfoxMediaURL(value) {
  let url; try { url = new URL(value); } catch { throw integrationError('Redfox 媒体地址无效'); }
  d.assert(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && url.hostname === 'redfox-hk.oss-cn-hangzhou.aliyuncs.com', 'Redfox 返回了未支持的媒体地址，请在服务商控制台查看。', 502);
  return url.href;
}
export async function downloadRedfoxMedia(value, kind, fetcher = fetch, resolver = lookup) {
  const url = new URL(redfoxMediaURL(value));
  const addresses = await resolver(url.hostname, { all: true });
  d.assert(addresses.length && addresses.every(({ address }) => isPublicAddress(address)), 'Redfox 媒体下载地址不可用', 502);
  // No API credentials are sent to OSS. Redirects cannot escape the allowlist.
  const response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  d.assert(response.ok, 'Redfox 成品暂时无法下载，可以再次查询原任务。', 502);
  const bytes = await readBounded(response, kind === 'video' ? 17_900_000 : 9_000_000);
  const mime = kind === 'video' ? (bytes.subarray(4, 8).toString() === 'ftyp' ? 'video/mp4' : '') : bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && bytes.subarray(-2).toString('hex') === 'ffd9' ? 'image/jpeg' : '';
  d.assert(mime, 'Redfox 成品文件格式不符合要求，请核对原任务。', 502);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
function imageURL(value) {
  let urls = value.imageUrls;
  if (typeof urls === 'string') { try { urls = JSON.parse(urls); } catch { urls = null; } }
  d.assert(Array.isArray(urls) && urls.length === 1 && typeof urls[0] === 'string', 'Redfox 未返回单张图片结果，请核对任务。', 502);
  return redfoxMediaURL(urls[0]);
}

export function createRedfoxMedia(store, config, helpers, preferences) {
  const { project, activeJobs, background, respond, assertSameCreationAccount } = helpers;
  const locks = new Set();
  const ready = () => d.assert(config.redfox?.status().configured && !config.redfox.status().problem, '请先在连接与设置保存可用的 Redfox API Key');
  const assetIn = (p, id) => { const a = p.assets.find(item => item.id === id); d.assert(a, '内容不存在', 404); return a; };
  const update = (pid, aid, fn) => store.mutate(state => { const p = project(state, pid), a = assetIn(p, aid); const result = fn(p, a, state); d.touch(p); return result; });
  const context = (pid, a, job, stage, id) => ({ projectId: pid, assetId: a.id, accountId: job.accountContext?.accounts?.[0]?.accountId || job.recipe?.accountContext?.accounts?.[0]?.accountId || '', platform: a.channel, stage, taskId: id || '', initiatedBy: job.initiatedBy || job.frameInitiatedBy });
  const request = (op, body, ctx) => config.redfox.request(op, body, ctx);
  const download = (url, kind) => (config.downloadRedfoxMedia || downloadRedfoxMedia)(url, kind, config.fetcher || fetch, config.redfoxMediaResolver || lookup);
  const snapshot = (pid, aid, type) => { const a = assetIn(project(store.get(), pid), aid); return { a, job: type === 'cover' ? a.aiCover : a.aiProduction }; };
  const same = (job, old, type) => job?.id === old.id && (type === 'frame' ? job.frameTaskId === old.frameTaskId : job.taskId === old.taskId);
  function recipeOf(state, p, a, purpose, input) {
    const { creativeSkill, accountContext } = resolveAccountCreation(state, contentProjectForAsset(p, a), a.channel, purpose);
    const builtinSkills = resolveBuiltinSkills(state, purpose);
    assertAssetCreationAccount(a, accountContext);
    const recipe = mediaPrompt(p, a, { ...input, purpose, hasProductReference: purpose !== 'video' && !!p.imageData, creativeSkill, builtinSkills, accountContext }, rulesOf(state));
    recipe.skillTrace = workflowSkillTrace(purpose, { creativeSkill, builtinSkills, accountContext }, d.now());
    return recipe;
  }
  async function submitImage(pid, aid, type, id, references, prompt, size, watermark) {
    try {
      const { a, job } = snapshot(pid, aid, type);
      const value = await request('media.imageSubmit', { prompt, size, watermark, outputFormat: 'jpeg', responseFormat: 'url', ...(references.length ? { image: references } : {}) }, context(pid, a, type === 'frame' ? job.frameJob : job, type === 'cover' ? 'cover' : 'keyframe'));
      const upstreamId = taskId(value?.taskId);
      update(pid, aid, (_p, a) => { const job = type === 'cover' ? a.aiCover : a.aiProduction; if (job?.id !== id) return; if (type === 'frame') job.frameTaskId = upstreamId; else job.taskId = upstreamId; job.nextPollAt = Date.now() + 10000; });
    } catch (error) {
      update(pid, aid, (_p, a) => { const job = type === 'cover' ? a.aiCover : a.aiProduction; if (job?.id === id) Object.assign(job, { phase: error.noCharge ? 'failed' : 'uncertain', error: safeError(error, '图片提交') }); });
    }
  }
  async function cover(req, res) {
    ready();
    const input = coverInput.parse(req.body);
    const releaseTask = acquireTaskResource(activeJobs, req.params.id, `asset:${req.params.assetId}`); let job;
    try {
      job = update(req.params.id, req.params.assetId, (p, a, state) => {
        const brief = p.strategies.find(s => s.id === a.strategyId)?.briefSnapshot || p.brief;
        d.assert(a.kind === 'image' && (a.channel === 'xiaohongshu' || ((brief.type === 'nurture' || a.contentBrief) && ['douyin', 'tiktok', 'instagram'].includes(a.channel))), '请选择支持的图文任务', 404);
        d.assert(a.revision === input.expectedRevision, '内容已更新，请重新打开封面生成窗口', 409);
        d.assert(!['generating', 'uncertain'].includes(a.aiCover?.phase), '已有封面任务，请查询结果或核对后解除锁定', 409);
        if (brief.type === 'nurture' && p.imageData) validateSceneReference(p.imageData);
        const references = p.imageData ? [p.imageData] : []; validateSeedreamReferences(references);
        const { recipe } = coverRequest(state, p, a, input, config, preferences), id = d.id();
        const watermark = input.watermark ?? preferences.get().seedream?.watermark ?? false;
        rememberCoverRequest(a, input, id);
        a.aiCover = { id, provider: 'redfox', phase: 'generating', assetRevision: a.revision, model: IMAGE_MODEL, size: SEEDREAM_COVER_SIZE, watermarkRequested: watermark, input, ...recipe, initiatedBy: actor(), createdAt: d.now(), error: '', failures: 0 };
        return { id, references, prompt: recipe.prompt, watermark };
      });
    } finally { releaseTask(); }
    background(() => submitImage(req.params.id, req.params.assetId, 'cover', job.id, job.references, job.prompt, SEEDREAM_COVER_SIZE, job.watermark));
    respond(res);
  }
  async function keyframe(req, res) {
    ready();
    const input = z.object({ provider: z.enum(['openai', 'seedream']).optional(), role: z.enum(['first_frame', 'last_frame']), prompt: z.string().trim().min(1).max(4000), quality: z.enum(['low', 'medium', 'high']).default('medium'), watermark: z.boolean().optional(), expectedRevision: z.number().int() }).strict().parse(req.body);
    const releaseTask = acquireTaskResource(activeJobs, req.params.id, `asset:${req.params.assetId}`); let job;
    try {
      job = update(req.params.id, req.params.assetId, (p, a, state) => {
        d.assert(a.kind === 'video' && a.revision === input.expectedRevision, '请刷新视频任务后再生成关键帧', 409);
        d.assert(!working.includes(a.aiProduction?.phase) && a.aiProduction?.phase !== 'uncertain', '已有生成任务，请先核对结果', 409);
        d.assert(!a.aiProduction?.taskId || a.aiProduction.phase === 'complete', '已有视频任务，请先核对并解除旧任务锁定', 409);
        const current = a.aiProduction?.assetRevision === a.revision ? a.aiProduction : { id: d.id(), assetRevision: a.revision, frames: [], phase: 'frames' };
        const first = current.frames.find(f => f.role === 'first_frame');
        d.assert(input.role !== 'last_frame' || first, '请先生成首帧');
        d.assert(p.strategies.find(s => s.id === a.strategyId)?.status === 'confirmed', '请先确认策略');
        const references = [p.imageData, ...(input.role === 'last_frame' ? [first.mediaData] : [])].filter(Boolean); validateSeedreamReferences(references);
        const recipe = recipeOf(state, p, a, input.role, input);
        if (input.role === 'last_frame') assertSameCreationAccount(first.recipe?.accountContext, recipe.accountContext);
        const watermark = input.watermark ?? preferences.get().seedream?.watermark ?? false;
        const frameJob = { role: input.role, prompt: input.prompt, recipe, watermarkRequested: watermark, initiatedBy: actor() };
        a.aiProduction = { ...current, phase: 'generating-frame', frameProvider: 'redfox', frameModel: IMAGE_MODEL, frameInitiatedBy: actor(), frameJob, error: '', failures: 0 };
        delete a.aiProduction.frameTaskId;
        return { id: current.id, references, prompt: recipe.prompt, watermark };
      });
    } finally { releaseTask(); }
    background(() => submitImage(req.params.id, req.params.assetId, 'frame', job.id, job.references, job.prompt, SEEDREAM_SIZE, job.watermark));
    respond(res);
  }
  async function uploadFrame(pid, aid, job, frame) {
    if (frame.redfoxUpload && Date.now() - Date.parse(frame.redfoxUpload.uploadedAt) < 20 * 3600000) return redfoxMediaURL(frame.redfoxUpload.url);
    validateSeedreamReferences([frame.mediaData]);
    const mime = frame.mediaData.slice(5, frame.mediaData.indexOf(';')), format = mime.split('/')[1];
    const body = new FormData(); body.set('format', format); body.set('file', new Blob([Buffer.from(frame.mediaData.split(',')[1], 'base64')], { type: mime }), `${frame.role}.${format}`);
    const { a } = snapshot(pid, aid, 'video');
    const result = await request('media.uploadImage', body, context(pid, a, job, 'video-reference'));
    const url = redfoxMediaURL(result?.imageUrl);
    update(pid, aid, (_p, a) => { if (a.aiProduction?.id === job.id) { const fresh = a.aiProduction.frames.find(f => f.id === frame.id); if (fresh) fresh.redfoxUpload = { url, uploadedAt: d.now() }; } });
    return url;
  }
  async function video(req, res) {
    ready();
    const input = z.object({ productionId: z.string(), expectedRevision: z.number().int(), prompt: z.string().trim().min(1).max(4000), duration: z.union([z.literal(5), z.literal(8), z.literal(12)]), generateAudio: z.boolean(), confirmed: z.literal(true) }).strict().parse(req.body);
    const releaseTask = acquireTaskResource(activeJobs, req.params.id, `asset:${req.params.assetId}`);
    let job;
    try { job = update(req.params.id, req.params.assetId, (p, a, state) => {
      const g = a.aiProduction;
      d.assert(a.kind === 'video' && a.revision === input.expectedRevision && g?.assetRevision === a.revision && g.id === input.productionId, '内容版本已改变，请重新检查关键帧', 409);
      d.assert(['frames', 'failed'].includes(g.phase) && !g.taskId, '任务已经提交或需要先核对结果，请勿重复生成', 409);
      d.assert(g.frames.length === 2 && g.frames.some(f => f.role === 'first_frame') && g.frames.some(f => f.role === 'last_frame'), '请先完成首尾两张关键帧');
      const recipe = recipeOf(state, p, a, 'video', { ...input, hasProductReference: false });
      for (const frame of g.frames) { assertSameCreationAccount(frame.recipe?.accountContext, recipe.accountContext); validateSeedreamReferences([frame.mediaData]); }
      Object.assign(g, { phase: 'submitting-video', provider: 'redfox', model: VIDEO_MODEL, prompt: input.prompt, recipe, duration: input.duration, generateAudio: input.generateAudio, submittedAt: d.now(), initiatedBy: actor(), error: '', failures: 0 });
      return structuredClone(g);
    }); } finally { releaseTask(); }
    background(async () => {
      try {
        const imageWithRoles = [];
        for (const frame of job.frames) imageWithRoles.push({ role: frame.role, url: await uploadFrame(req.params.id, req.params.assetId, job, frame) });
        const { a } = snapshot(req.params.id, req.params.assetId, 'video');
        const value = await request('media.videoSubmit', { prompt: job.recipe.prompt, duration: job.duration, generateAudio: job.generateAudio, resolution: '720p', aspectRatio: '9:16', returnLastFrame: false, imageWithRoles }, context(req.params.id, a, job, 'video'));
        const id = taskId(value?.taskId);
        update(req.params.id, req.params.assetId, (_p, a) => { if (a.aiProduction?.id === job.id) Object.assign(a.aiProduction, { taskId: id, phase: 'generating-video', nextPollAt: Date.now() + 10000 }); });
      } catch (error) { update(req.params.id, req.params.assetId, (_p, a) => { if (a.aiProduction?.id === job.id) Object.assign(a.aiProduction, { phase: error.noCharge ? 'failed' : 'uncertain', error: safeError(error, '视频提交') }); }); }
    });
    respond(res);
  }
  async function poll(pid, aid, type) {
    const lock = `${pid}/${aid}/${type}`; if (locks.has(lock)) return; locks.add(lock);
    try {
      const { a, job } = snapshot(pid, aid, type);
      const old = structuredClone(job), id = type === 'frame' ? old?.frameTaskId : old?.taskId;
      d.assert(id, '没有可查询的 Redfox 任务');
      if (terminal.includes(old.phase)) return;
      await runWithActor(type === 'frame' ? old.frameInitiatedBy : old.initiatedBy, async () => {
        try {
          const value = await request(type === 'video' ? 'media.videoResult' : 'media.imageResult', { taskId: id }, context(pid, a, type === 'frame' ? old.frameJob : old, type === 'video' ? 'video-status' : type === 'cover' ? 'cover-status' : 'keyframe-status', id));
          d.assert(value?.taskId === id, 'Redfox 返回的任务编号不匹配', 502);
          if (['succeeded', 'completed'].includes(value.status)) {
            const url = type === 'video' ? redfoxMediaURL(value.videoUrl) : imageURL(value);
            const mediaData = await download(url, type === 'video' ? 'video' : 'image');
            const watermarkCheck = type === 'video' ? undefined : await reviewGeneratedImage(mediaData, config);
            update(pid, aid, (p, a, state) => {
              const g = type === 'cover' ? a.aiCover : a.aiProduction; if (!same(g, old, type)) return;
              const stale = a.revision !== g.assetRevision;
              if (type === 'cover') {
                Object.assign(g, { phase: stale ? 'stale' : 'ready', mediaData, watermarkCheck, completedAt: d.now(), error: stale ? '内容版本已修改，候选图保留供核对。' : '' });
                d.activity(state, 'AI 封面候选已生成', 'Redfox · Seedream 5.0 Pro，等待采用。', p.id);
              } else if (type === 'frame') {
                const item = old.frameJob;
                g.frames = g.frames.filter(f => item.role === 'last_frame' && f.role === 'first_frame');
                g.frames.push({ id: d.id(), ...item, mediaData, model: IMAGE_MODEL, provider: 'redfox', size: SEEDREAM_SIZE, watermarkCheck, upstreamTaskId: id, createdAt: d.now() });
                g.phase = stale ? 'stale' : 'frames'; g.error = stale ? '内容版本已修改，关键帧保留供核对。' : '';
                delete g.frameJob;
              } else if (stale) {
                Object.assign(g, { phase: 'stale', error: '视频已生成，但内容版本已修改。成品已保留供核对。', resultMediaData: mediaData, completedAt: d.now() });
                d.activity(state, 'AI 视频已生成，待核对版本', 'Redfox 已返回原账号的视频候选。', p.id);
              } else {
                d.updateAsset(p, a.id, { title: a.title, body: a.body, mediaData, mime: 'video/mp4', expectedRevision: a.revision });
                if (g.recipe?.accountContext) a.creationTrace = structuredClone(g.recipe.accountContext); else delete a.creationTrace;
                if (g.recipe?.knowledgeContext) a.knowledgeContext = structuredClone(g.recipe.knowledgeContext);
                Object.assign(g, { phase: 'complete', error: '', completedAt: d.now() });
                d.activity(state, 'AI 视频已生成', 'Redfox · Seedance 2.0，归属原生成账号。', p.id);
              }
            });
          } else if (['failed', 'cancelled', 'expired'].includes(value.status)) {
            update(pid, aid, (_p, a) => { const g = type === 'cover' ? a.aiCover : a.aiProduction; if (same(g, old, type)) Object.assign(g, { phase: 'failed', error: 'Redfox 任务未完成，请核对服务商任务和账单。' }); });
          } else {
            d.assert(['queued', 'running', 'in_progress', 'pending'].includes(value.status), 'Redfox 返回了未知任务状态', 502);
            update(pid, aid, (_p, a) => { const g = type === 'cover' ? a.aiCover : a.aiProduction; if (same(g, old, type)) Object.assign(g, { phase: type === 'cover' ? 'generating' : type === 'frame' ? 'generating-frame' : 'generating-video', failures: 0, error: '', nextPollAt: Date.now() + 20000 }); });
          }
        } catch (error) {
          update(pid, aid, (_p, a) => { const g = type === 'cover' ? a.aiCover : a.aiProduction; if (!same(g, old, type)) return; g.failures = (g.failures || 0) + 1; g.nextPollAt = Date.now() + Math.min(300000, 20000 * 2 ** Math.min(g.failures, 4)); g.error = safeError(error, '任务查询或成品下载'); if (g.failures >= 8) g.phase = 'uncertain'; });
        }
      });
    } finally { locks.delete(lock); }
  }
  return { cover, keyframe, video, poll, busy: () => locks.size > 0,
    async tick() {
      for (const p of store.get().projects) for (const a of p.assets) {
        if (a.aiCover?.provider === 'redfox' && a.aiCover.phase === 'generating' && a.aiCover.taskId && a.aiCover.nextPollAt <= Date.now()) await poll(p.id, a.id, 'cover');
        const g = a.aiProduction;
        if (g?.frameProvider === 'redfox' && g.phase === 'generating-frame' && g.frameTaskId && g.nextPollAt <= Date.now()) await poll(p.id, a.id, 'frame');
        if (g?.provider === 'redfox' && g.phase === 'generating-video' && g.taskId && g.nextPollAt <= Date.now()) await poll(p.id, a.id, 'video');
      }
    },
  };
}
