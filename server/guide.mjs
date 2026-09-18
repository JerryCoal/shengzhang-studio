import { z } from 'zod';
import { activity, assert, makeDraft, newProject, now, seedState } from './domain.mjs';

// Guide preferences live in the same encrypted workspace as the user's projects.
export function guideProgress(state) {
  const guide = { welcomeDismissed: false, showTips: true, active: false, ...state.guide };
  const project = state.projects.find(p => p.id === guide.projectId);
  const confirmed = project?.strategies.find(s => s.status === 'confirmed');
  const assets = project?.assets.filter(a => a.kind === 'image' && project.strategies.some(s => s.id === a.strategyId && s.status === 'confirmed')) || [];
  const exported = assets.find(a => a.id === guide.exportedAssetId && a.revision === guide.exportedRevision && a.status === 'ready' && a.mediaData);
  const asset = exported || assets.find(a => a.status === 'ready' && a.mediaData) || assets[0];
  const steps = [!!confirmed, !!asset && asset.status === 'ready' && !!asset.mediaData, !!exported];
  return { guide, project, asset, steps, step: steps.includes(false) ? steps.indexOf(false) : 3, complete: steps.every(Boolean) };
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('tips'), enabled: z.boolean() }),
  z.object({ action: z.literal('export'), projectId: z.string(), assetId: z.string(), revision: z.number().int().positive() }),
]);
export function updateGuide(state, input) {
  const data = actionSchema.parse(input);
  const { guide } = guideProgress(state);
  if (data.action === 'start') {
    let project = state.projects.find(p => p.id === guide.projectId);
    if (!project) {
      const sample = seedState().projects[0];
      project = newProject({ ...sample.brief, name: '新手练习 · 山野咖啡', channels: ['xiaohongshu'], budgetUsd: 0 });
      project.sample = true;
      makeDraft(project, { title: sample.strategies[0].title, direction: sample.strategies[0].direction });
      state.projects.unshift(project);
      guide.projectId = project.id;
      delete guide.exportedAssetId; delete guide.exportedRevision; delete guide.exportedAt;
      activity(state, '免费练习已准备好', '确认策略 → 制作封面 → 导出素材', project.id);
    }
    guide.active = true; guide.welcomeDismissed = true;
  } else if (data.action === 'pause') guide.active = false;
  else if (data.action === 'dismiss') guide.welcomeDismissed = true;
  else if (data.action === 'tips') guide.showTips = data.enabled;
  else if (data.action === 'export') {
    const { project, steps } = guideProgress(state);
    const asset = project?.assets.find(a => a.id === data.assetId);
    assert(project?.id === data.projectId && steps[0] && asset?.kind === 'image' && asset.status === 'ready' && asset.mediaData && asset.revision === data.revision, '请先完成练习封面的制作，再导出当前版本');
    guide.exportedAssetId = asset.id; guide.exportedRevision = asset.revision; guide.exportedAt = now();
  }
  state.guide = guide;
  return guide;
}

export function nextProjectAction(project) {
  if (!project) return { page: 'projects', title: '创建你的第一个项目', detail: '从品牌资料与宣传目标开始。' };
  if (!project.strategies.some(s => s.status === 'confirmed')) return { page: 'strategy', title: '确认你的第一份内容策略', detail: '检查核心表达与制作要求，再确认进入制作。' };
  if (!project.assets.some(a => a.status === 'ready')) return { page: 'studio', title: '把策略变成看得见的内容', detail: '先用免费本地模板制作封面，也可以配置 AI 创作。' };
  if (!project.publications.some(p => p.status === 'published')) return { page: 'publish', title: '让好内容遇见你的受众', detail: '导出素材，在平台发布后登记链接；加入计划不代表已发布。' };
  if (!project.comments.some(c => !c.irrelevant)) return { page: 'comments', title: '收集作品的第一批反馈', detail: '导入评论，保留作品来源，为复盘准备依据。' };
  if (!project.insights.length) return { page: 'comments', title: '从评论里找到改进方向', detail: '点击“分析评论”，先用免费本地规则体验。' };
  if (!project.experiences.some(e => e.active)) return { page: 'comments', title: '把有价值的建议留下来', detail: '在复盘建议中查看原文依据，选择值得采用的改动。' };
  return { page: 'planning', title: '带着反馈，开始下一轮', detail: '已采用的品牌经验将进入下期策略，让内容持续改进。' };
}
