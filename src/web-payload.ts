import { corpusQuery, searchCorpus } from '../server/workflow.mjs';
import { removeLocalDocumentData } from '../server/local-document-privacy.mjs';
import type { State } from './types';

// Creative rules and their generation snapshots stay in the local workspace.
// Scrub before any early return, including credential checks and news refreshes.
function removeSkillTraces(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) removeSkillTraces(item); return; }
  const record = value as Record<string, unknown>;
  delete record.skillTrace;
  delete record.researchReferences;
  for (const item of Object.values(record)) removeSkillTraces(item);
}

export function webPayload(source: State, path: string, body: unknown, projectId?: string): State {
  if (/\/corpus\/context(?:\/|$)/.test(path)) throw new Error('文档资料提炼目前仅支持本机完整版，请在 Windows 应用中使用');
  const input = (body || {}) as { instruction?: string; query?: string; prompt?: string; skillId?: string; reviewOnly?: boolean };
  if (path.endsWith('/copy') && input.reviewOnly !== true && input.skillId) {
    throw new Error('网页版尚未启用自装 Skills 联网生成，请使用平台内置规则或 Windows 版');
  }
  const base = structuredClone(source); delete base.webPrivate; delete base.projectDrafts; delete base.guide; delete base.appearance; base.activities = [];
  delete base.installedSkills; delete base.skillsRevision; removeSkillTraces(base); removeLocalDocumentData(base);
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
