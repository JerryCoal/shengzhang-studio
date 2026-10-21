import { useEffect, useState } from 'react';
import { Context, useStudio } from '../context';
import { Empty, NeedProject, PageTitle } from '../components';
import { AnalyticsPage } from './AnalyticsPage';
import { CommentsPage } from './CommentsPage';
import { KnowledgeActions, KnowledgeLibrary } from './KnowledgeLibrary';
import { Evidence } from './Insights';
import type { Insight } from '../types';
import { scopeHasAccount } from '../workspace-scope.mjs';

export function ReviewWorkspace({ initialTab = 'metrics' }: { initialTab?: string }) {
  const context = useStudio(), { project, target, accountScope, scope, go } = context;
  const [tab, setTab] = useState(target.tab || initialTab);
  const [publicationId, setPublicationId] = useState(target.publicationId || '');
  const [evidence, setEvidence] = useState<Insight | null>(null);
  useEffect(() => { setPublicationId(target.publicationId || ''); setTab(target.tab || initialTab); }, [project?.id, target.publicationId, target.tab, initialTab]);
  if (!project) return <NeedProject/>;
  const publications = project.publications.filter(p => p.status === 'published' && (scope ? scopeHasAccount(scope, p.accountId) : !accountScope || p.accountId === accountScope));
  const selected = publications.find(p => p.id === publicationId);
  const works = selected ? [selected] : publications;
  const ids = new Set(works.map(p => p.id));
  const comments = project.comments.filter(c => ids.has(c.publicationId));
  const insights = project.insights.filter(i => i.publicationIds.every(id => ids.has(id)));
  const scoped = { ...project, publications: works, comments, insights, metricSnapshots: (project.metricSnapshots || []).filter(m => ids.has(m.publicationId)) };
  const latest = selected ? [...(project.metricSnapshots || [])].filter(m => m.publicationId === selected.id).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0] : undefined;
  const source = selected ? { title: `复盘：${selected.title}`, text: `作品：${selected.title}\n账号：${selected.accountName}\n已收集评论：${comments.length} 条\n${latest ? `指标采集时间：${latest.capturedAt}\n累计指标：${JSON.stringify(latest.metrics)}` : '尚未记录作品指标'}\n\n待验证的改进：请填写下一篇想验证的具体改动。`, sourceId: selected.id, sourceUrl: selected.url, sourceType: 'publication-review', platform: selected.platform, accountId: selected.accountId } : undefined;
  return <>
    <PageTitle title="复盘" subtitle="围绕同一篇作品查看表现、收集评论，把有用的结论留给下一次创作。"/>
    <div className="review-identity"><label htmlFor="review-work">查看作品</label><select id="review-work" value={selected?.id || ''} onChange={e => setPublicationId(e.target.value)}><option value="">当前账号范围内的全部已发布作品</option>{publications.map(p => <option key={p.id} value={p.id}>{p.title} · {p.accountName}</option>)}</select>{selected && <button className="button small" onClick={() => go('publish', project.id, { publicationId: selected.id, assetId: selected.assetId })}>发布记录</button>}</div>
    <div className="tabbar review-tabs" aria-label="复盘内容">{[['metrics', '作品表现'], ['comments', '评论与建议'], ['experience', '运营经验']].map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>
    <Context.Provider value={{ ...context, project: scoped, target: { ...target, publicationId: selected?.id, tab }, go: (page, projectId, detail = {}) => {
      if (['comments', 'analytics', 'planning'].includes(page)) go('comments', projectId || project.id, { ...detail, publicationId: detail.publicationId || selected?.id, tab: detail.tab || (page === 'analytics' ? 'metrics' : page === 'planning' ? 'experience' : 'comments') });
      else go(page, projectId, detail);
    } }}>
      {tab === 'metrics' ? <AnalyticsPage key={selected?.id || scope?.accountIds.join('|') || accountScope || 'all'}/> : tab === 'comments' ? <CommentsPage key={selected?.id || scope?.accountIds.join('|') || accountScope || 'all'}/> : null}
    </Context.Provider>
    {source && tab !== 'experience' && <section className="panel"><h3>把这次观察留给下一篇</h3><p className="small-note">核对并补充具体改进后保存。累计指标只是观察依据，不直接证明效果原因。</p><KnowledgeActions source={source} actions={['experience']}/></section>}
    {tab === 'experience' && <>
      <KnowledgeLibrary initialKind="experience"/>
      {project.experiences.some(e => e.active) && <details className="workflow-secondary"><summary>历史品牌经验 · {project.experiences.filter(e => e.active).length} 条</summary><p className="small-note">历史经验保留原来的项目归属。可选择一条，保存为带账号范围的运营经验。</p><div className="review-experience-list">{project.experiences.filter(e => e.active).map(e => { const insight = project.insights.find(i => i.id === e.insightId); return <article key={e.id}><p>{e.text}</p>{insight && <button className="text-button" onClick={() => setEvidence(insight)}>查看原评论依据</button>}<KnowledgeActions source={{ title: insight?.title || '历史运营经验', text: e.text, sourceId: e.id, sourceType: 'legacy-experience' }} actions={['experience', 'create']}/></article>; })}</div></details>}
    </>}
    {!publications.length && tab !== 'experience' && <Empty title="先完成一篇作品的发布登记" text="发布记录、作品数据和评论会在这里对应起来。"><button className="button" onClick={() => go('publish', project.id)}>前往发布</button></Empty>}
    {evidence && <Evidence insight={evidence} onClose={() => setEvidence(null)}/>}
  </>;
}
