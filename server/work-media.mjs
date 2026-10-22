import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createContentDraft } from './content-workflow.mjs';
import { currentActor } from './request-actor.mjs';
import { rulesOf } from './workflow.mjs';
const fail = message => { throw Object.assign(Error(message), { status: 409, noCharge: true }); };
export function workImageSource(state, store, config, projectId, sourceId) {
  const project = state.projects.find(item => item.id === projectId), source = project?.assets.find(item => item.id === sourceId);
  const origin = source?.workOrigin;
  if (!origin) fail('图片源内容没有已保存的任务成果');
  const artifact = store.work?.get('artifact', `${origin.artifactId}:${origin.artifactVersion}`);
  const ownerId = currentActor()?.userId || config.workOwnerId || 'personal';
  if (!artifact || artifact.ownerId !== ownerId || artifact.candidate || !['copy', 'script'].includes(artifact.kind) || artifact.projectId !== projectId || artifact.runId !== origin.runId || artifact.taskId !== origin.taskId || artifact.accountId !== source.contentBrief?.accountId) fail('成果版本、项目或账号不一致，未准备图片');
  if (!state.accounts.some(account => account.id === artifact.accountId && account.platform === source.channel)) fail('原目标账号已不可用');
  return { project, source, artifact };
}
export function mountWorkImageDrafts(app, store, config, local) {
  app.post('/api/projects/:id/assets/:assetId/work-images', (req, res) => {
    local(req); const { count } = z.object({ count: z.number().int().min(1).max(4) }).strict().parse(req.body);
    const result = store.mutate(state => {
      const { project, source, artifact } = workImageSource(state, store, config, req.params.id, req.params.assetId);
      const items = [];
      for (let index = 0; index < count; index++) {
        let asset = project.assets.find(item => item.workImageOrigin?.sourceAssetId === source.id && item.workImageOrigin.index === index);
        if (asset) {
          if (asset.kind !== 'image' || asset.channel !== source.channel || asset.contentBrief?.accountId !== artifact.accountId || asset.workImageOrigin.artifactId !== source.workOrigin.artifactId || asset.workImageOrigin.artifactVersion !== source.workOrigin.artifactVersion || asset.workImageOrigin.taskId !== source.workOrigin.taskId || asset.workImageOrigin.runId !== source.workOrigin.runId) fail('已有图片草稿归属已改变，请核对');
        } else {
          const hash = createHash('sha256').update(JSON.stringify([source.id, index])).digest('hex');
          const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
          asset = createContentDraft(state, project, { requestId, accountId: artifact.accountId, kind: 'image', requirement: source.contentBrief.requirement || '按已保存成果制作图片', knowledgeIds: source.contentBrief.knowledgeIds || [], title: artifact.title.slice(0, 200) }, rulesOf(state));
          asset.body = artifact.body; asset.prompt = source.prompt || artifact.structured?.prompt || '';
          asset.workImageOrigin = { ...source.workOrigin, sourceAssetId: source.id, index };
          const strategy = project.strategies.find(item => item.id === asset.strategyId), sourceStrategy = project.strategies.find(item => item.id === source.strategyId);
          if (strategy && sourceStrategy?.briefSnapshot) strategy.briefSnapshot = structuredClone(sourceStrategy.briefSnapshot);
        }
        items.push({ id: asset.id, index });
      }
      return { items, accountId: artifact.accountId, sourceAssetId: source.id };
    });
    res.json({ result, state: store.get() });
  });
}
