import { corpusQuery, searchCorpus } from '../server/workflow.mjs';
import { removeLocalDocumentData } from '../server/local-document-privacy.mjs';
import { removeWebSkillHistory } from '../server/web-skill-privacy.mjs';
import { webSkillWorkflowId } from '../server/web-skill-routing.mjs';
import { resolveAccountCreation } from '../server/account-creation.mjs';
import type { State } from './types';

export function webPayload(source: State, path: string, body: unknown, projectId?: string): State {
  if (/\/corpus\/context(?:\/|$)/.test(path)) throw new Error('文档资料提炼目前仅支持本机完整版，请在 Windows 应用中使用');
  const input = (body || {}) as { instruction?: string; query?: string; prompt?: string; skillId?: string; reviewOnly?: boolean };
  if ((body as { agentInput?: unknown } | undefined)?.agentInput) throw new Error('Agent 的账号身份、多选 Skills 与经验数据包请在 Windows 版或团队工作区生成；此网页版仅保存草稿，不会丢弃这些选择后继续生成。');
  if (path.endsWith('/copy') && input.reviewOnly !== true && input.skillId) {
    throw new Error('网页版尚未启用自装 Skills 联网生成，请使用平台内置规则或 Windows 版');
  }
  const workflowId = webSkillWorkflowId(source, path, body);
  if (workflowId && Object.keys(source.builtinSkillOverrides?.[workflowId] || {}).length) throw new Error('此步骤使用了修改后的默认 Skills，请在 Windows 版或团队版继续生成；网页版尚未启用这些私人规则的传输，不会自动改用出厂规则。');
  const creationProject = source.projects.find(project => project.id === (projectId || path.split('/')[2]));
  const creationAsset = creationProject?.assets.find(asset => asset.id === path.split('/')[4]);
  if (creationAsset && (creationAsset.contentBrief || creationProject?.strategies.some(strategy => strategy.id === creationAsset.strategyId && strategy.source === 'direct'))) {
    throw new Error('这篇内容包含单篇创作要求和绑定账号，请在 Windows 本机版或团队工作区继续生成。网页版仍可保存要求与资料，不会清除记忆后改走旧流程。');
  }
  if (path === '/tick' && source.projects.some(project => project.assets.some(asset => asset.contentBrief && asset.aiProduction?.phase === 'generating-video'))) throw new Error('绑定账号的单篇视频任务请在发起任务的本机版或团队工作区查看，网页版不会转交中转服务。');
  let accountSelectionChecked = false;
  if (workflowId && creationProject && source.accounts.some(account => account.creationProfile) && (['strategy', 'planning', 'cover', 'first_frame', 'last_frame', 'video'].includes(workflowId) || workflowId.startsWith('copy-'))) {
    const selected = resolveAccountCreation(source, creationProject, creationAsset?.channel, workflowId);
    accountSelectionChecked = true;
    if (selected.creativeSkill || selected.accountContext?.accounts.some(account => account.identityMarkdown.trim() || account.topic.trim() || account.instruction.trim() || account.workflowSkill)) throw new Error('账号身份记忆与创作方案目前仅支持 Windows 本机版生成，网页版不会将私人身份或 Skills 上传到中转服务。请在本机版继续创作。');
  }
  const selections = (source as State & { skillSelections?: Record<string, string> }).skillSelections;
  if (workflowId && !accountSelectionChecked && selections?.[workflowId]) throw new Error('当前网页版尚未启用自装规则传输，请改用 Windows 本机版或在设置中将此步骤恢复默认');
  const base = structuredClone(source); delete base.webPrivate; delete base.projectDrafts; delete base.guide; delete base.appearance; base.activities = [];
  removeWebSkillHistory(base); removeLocalDocumentData(base);
  delete (base as unknown as Record<string, unknown>).researchSettings;
  // Local semantic indexes and their consent never travel through the relay.
  for (const project of base.projects) for (const key of ['ragIndex', 'ragEnabled', 'ragConsent', 'ragUsage', 'ragPreviousCny', 'ragRevision', 'research', 'researchUsage', 'researchPreviousCny']) delete (project as unknown as Record<string, unknown>)[key];
  base.projects = projectId ? base.projects.filter(p => p.id === projectId) : [];
  const p = base.projects[0]; if (!p) return base;
  if (path.endsWith('/trends/refresh')) {
    base.accounts = []; base.contentRules = [];
    base.projects = [{ id: p.id, revision: p.revision, createdAt: '', updatedAt: p.updatedAt, sample: false,
      brief: { name: '热点检索', brand: '未传输', product: '未传输', type: 'daily', goal: '新闻筛选', audience: '未传输', sellingPoints: '未传输', facts: '', requirements: '', channels: ['xiaohongshu'], deadline: '2099-01-01', budgetUsd: 0 },
      strategies: [], assets: [], publications: [], comments: [], insights: [], experiences: [], usage: [], corpus: [], imageData: '', audioData: '', lastImportAt: null,
      trends: p.trends ? { ...p.trends, tags: [] } : undefined,
    }];
    return base;
  }
  if (!path.includes('/trends/')) delete p.trends;
  const assetId = path.includes('/assets/') ? path.split('/')[4] : '';
  const publicationId = path.includes('/publications/') ? path.split('/')[4] : '';
  const asset = p.assets.find(a => a.id === assetId), strategy = path.endsWith('/strategies'), copy = path.endsWith('/copy');
  const retrievalProject = /\/(copy|cover|keyframes|seedance)$/.test(path) && asset ? { ...p, brief: p.strategies.find(s => s.id === asset.strategyId)?.briefSnapshot || p.brief } : p;
  if (strategy || copy || /\/(cover|keyframes|seedance)$/.test(path)) {
    const query = strategy ? input.query || corpusQuery(p, input.instruction || '') : input.query || corpusQuery(retrievalProject, `${asset?.title || ''} ${input.instruction || input.prompt || ''}`);
    const references = searchCorpus(p, query);
    p.corpus = (p.corpus || []).filter(doc => references.some(r => r.documentId === doc.id)).map(doc => {
      const rows = references.filter(r => r.documentId === doc.id);
      return { ...doc, text: rows.map(r => r.text).join('\n'), chunks: rows.map(r => ({ index: r.chunk, text: r.text })) };
    });
  } else p.corpus = [];
  p.audioData = ''; if (!path.endsWith('/keyframes') && !path.endsWith('/cover')) p.imageData = '';
  p.assets = path === '/tick' ? p.assets.filter(a => a.aiProduction?.phase === 'generating-video') : asset ? [asset] : [];
  p.strategies = strategy ? p.strategies.slice(-1) : asset ? p.strategies.filter(s => s.id === asset.strategyId) : [];
  p.publications = path === '/tick' ? p.publications.filter(r => r.commentSync?.enabled) : publicationId ? p.publications.filter(r => r.id === publicationId) : [];
  if (strategy) {
    p.experiences = p.experiences.filter(e => e.active);
    p.insights = p.insights.filter(i => p.experiences.some(e => e.insightId === i.id));
    p.comments = p.comments.filter(c => p.insights.some(i => i.evidenceIds.includes(c.id)));
  } else {
    p.experiences = []; p.insights = [];
    if (path.endsWith('/classify')) p.comments = p.comments.filter(c => !c.irrelevant && !c.correctedAt && !c.classificationModel).slice(0, 60);
    else if (path.endsWith('/analysis')) p.comments = p.comments.filter(c => !c.irrelevant);
    else p.comments = p.comments.filter(c => p.publications.some(r => r.id === c.publicationId));
  }
  return base;
}
