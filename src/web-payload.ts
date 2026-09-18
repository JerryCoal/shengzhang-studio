import { corpusQuery, searchCorpus } from '../server/workflow.mjs';
import type { State } from './types';

export function webPayload(source: State, path: string, body: unknown, projectId?: string): State {
  const base = structuredClone(source); delete base.webPrivate; delete base.projectDrafts; delete base.guide; base.activities = [];
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
  const input = (body || {}) as { instruction?: string; query?: string; prompt?: string };
  const assetId = path.includes('/assets/') ? path.split('/')[4] : '';
  const publicationId = path.includes('/publications/') ? path.split('/')[4] : '';
  const asset = p.assets.find(a => a.id === assetId), strategy = path.endsWith('/strategies'), copy = path.endsWith('/copy');
  const retrievalProject = /\/(cover|keyframes|seedance)$/.test(path) && asset ? { ...p, brief: p.strategies.find(s => s.id === asset.strategyId)?.briefSnapshot || p.brief } : p;
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
  p.publications = path === '/tick' ? p.publications.filter(r => ['queued', 'submitted'].includes(r.automation?.status || '') || r.commentSync?.enabled) : publicationId ? p.publications.filter(r => r.id === publicationId) : [];
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
