import { CopyKeywords } from './CopyKeywords';
import { useMemo, useState } from 'react';
import { useStudio } from '../context';
import { screenCopy, rulesOf } from '../../server/workflow.mjs';
import { scanCopy } from '../../server/sensitive-checker.mjs';
import { AIAction } from '../pages/AIAction';
import type { Asset, CopyMatch, CopyReview } from '../types';
type Draft = { title: string; body: string };
type SemanticDecision = CopyMatch & { id: string; decision: 'replace' | 'keep' | 'uncertain'; reason: string };
type Candidate = { semanticReview?: { decisions: SemanticDecision[]; source: Draft }; candidate: Draft; review: CopyReview; sourceRevision: number; rulesRevision: number };
export function HighlightedCopy({ text, matches }: { text: string; matches: CopyMatch[] }) {
  let cursor = 0;
  const parts = matches.map((hit, i) => { const prefix = text.slice(cursor, hit.start); cursor = hit.end; return <span key={i}><CopyKeywords text={prefix}/><mark className={hit.action} title={`${hit.risk} · ${hit.action === 'semantic' ? `需判断价格语境；确认后替换为：${hit.replacement}` : hit.action === 'rewrite' ? '需结合上下文改写' : `替换为：${hit.replacement || '删除'}`}`}>{text.slice(hit.start, hit.end)}</mark></span>; });
  return <div className="checked-text">{parts}<CopyKeywords text={text.slice(cursor)}/></div>;
}
export function CopyCheckPanel({ draft, onApply, asset }: { draft: Draft; onApply: (value: Draft) => void; asset?: Asset }) {
  const { state, project, busy } = useStudio();
  const rules = rulesOf(state), revision = state.rulesRevision || 0;
  const screened = useMemo(() => { try { return { result: screenCopy(draft, rules), error: '' }; } catch (error) { return { result: null, error: (error as Error).message }; } }, [draft.title, draft.body, state.rulesRevision, state.contentRules]);
  const [accepted, setAccepted] = useState<{ text: string; revision: number; remaining: CopyMatch[] } | null>(null);
  const acceptedCurrent = accepted?.text === JSON.stringify(draft) && accepted.revision === revision;
  const rawMatches = scanCopy(draft, rules);
  const matches = acceptedCurrent ? rawMatches.filter(m => m.action !== 'semantic' || accepted!.remaining.some(r => r.ruleId === m.ruleId && r.field === m.field && r.start === m.start && r.end === m.end)) : rawMatches;
  const semantic = matches.filter(m => m.action === 'semantic'), fixed = matches.filter(m => m.action === 'replace');
  const [candidate, setCandidate] = useState<{ data: Candidate; draft: string } | null>(null);
  const candidateValid = candidate && candidate.draft === JSON.stringify(draft) && candidate.data.rulesRevision === revision && candidate.data.sourceRevision === project?.assets.find(a => a.id === asset?.id)?.revision;
  const check = screened.result;
  return <section className="copy-check-panel" aria-label="敏感词位置与修改预览">
    <div className="section-heading"><h3>文案自检</h3><span>{matches.length ? `${matches.length} 处命中或语义候选` : acceptedCurrent ? '本次语义处理完成' : '当前词库未命中'}</span></div>
    <p className="small-note">黄色按固定规则替换，橙色需要改写，蓝色待判断价格语境，可能无需替换。文字匹配不判断完整语义，也不保证平台审核结果。</p>
    {['title', 'body'].map(field => { const text = draft[field as keyof Draft]; return text ? <div key={field}><b>{field === 'title' ? '标题' : '正文'}</b><HighlightedCopy text={text} matches={matches.filter(m => m.field === field)}/></div> : null; })}
    {!!matches.length && <details><summary>查看具体位置与规则</summary>{matches.map((m, i) => { const before = draft[m.field as keyof Draft].slice(0, m.start).split('\n'); return <p key={i}>{m.field === 'title' ? '标题' : '正文'} · 第 {before.length} 行，第 {Array.from(before.at(-1) || '').length + 1} 个码点起 · “{m.original}” → {m.action === 'semantic' ? `确认价格语境后用“${m.replacement}”` : m.action === 'rewrite' ? `需改写${m.replacement ? `（建议：${m.replacement}）` : ''}` : m.replacement || '删除'} · {m.risk}</p>; })}</details>}
    {screened.error && <p role="alert">{screened.error}</p>}
    {check && fixed.length > 0 && <details><summary>固定替换后的预览 · 复检剩余 {check.review.remaining?.length || 0} 处</summary><HighlightedCopy text={check.value.title} matches={(check.review.remaining || []).filter(m => m.field === 'title')}/><HighlightedCopy text={check.value.body} matches={(check.review.remaining || []).filter(m => m.field === 'body')}/></details>}
    <div className="rule-toolbar"><button type="button" className="button small" disabled={busy || !check || !fixed.length || (!!draft.title && !check.value.title.trim())} onClick={() => { if (check) { onApply(check.value); setCandidate(null); } }}>应用固定替换 · 免费</button>
      {asset && project && check && check.review.remaining?.some(m => m.action !== 'semantic') && <AIAction stage="copy" title="AI 处理待复核词" description="先执行固定替换，再将这份标题、正文、命中项及项目事实交给当前文案模型。调用一次，返回候选并本地复检；采用前不覆盖原文。" path={`/projects/${project.id}/assets/${asset.id}/copy`} body={{ reviewOnly: true, expectedRevision: asset.revision, rulesRevision: revision, draft }} onResult={value => setCandidate({ data: value as Candidate, draft: JSON.stringify(draft) })}/>}
      {asset && project && semantic.length > 0 && <AIAction stage="copy" title="AI 识别价格并替换" description="把标题、正文及候选位置交给当前文案模型，只判断哪些位置在表达价格。由本地程序使用你设定的替换词，金额数字保持原样；不确定的位置保留。返回修改预览，采用前不覆盖原文。" path={`/projects/${project.id}/assets/${asset.id}/copy`} body={{ reviewOnly: true, reviewMode: 'semantic', expectedRevision: asset.revision, rulesRevision: revision, draft }} onResult={value => setCandidate({ data: value as Candidate, draft: JSON.stringify(draft) })}/>}
    </div>
    {acceptedCurrent && <p className="small-note">已采用本次语义结果，判断为非价格的词已保留。继续修改文案或词库后需要重新检查；最后请点击“保存修改”。</p>}
    {!semantic.length && !acceptedCurrent && <p className="small-note">价格同音字替换：在设置的词库中填写原词与指定替换词，并选择“语义替换（价格）”。命中后可在此逐处交给 AI 判断，未配置的词不会擅自修改。</p>}
    {candidate?.data.semanticReview && <div className="semantic-decisions"><h4>AI 的逐处语义判断</h4>{candidate.data.semanticReview.decisions.map(d => <article key={d.id}><b>{d.field === 'title' ? '标题' : '正文'} · “{d.original}” {d.decision === 'replace' ? '→ “' + d.replacement + '”' : d.decision === 'keep' ? '保持原文' : '无法确定，暂不替换'}</b><p>{d.context}</p><small>{d.reason}</small></article>)}</div>}
    {candidate && <div className="copy-candidate"><h4>AI 修改候选</h4><p>{candidateValid ? `复检剩余 ${candidate.data.review.remaining?.length || 0} 处，请核对语义与事实。` : '文案、词库或成品版本已变化，请重新生成候选。'}</p><HighlightedCopy text={candidate.data.candidate.title} matches={(candidate.data.review.remaining || []).filter(m => m.field === 'title')}/><HighlightedCopy text={candidate.data.candidate.body} matches={(candidate.data.review.remaining || []).filter(m => m.field === 'body')}/><button type="button" className="button small" disabled={!candidateValid || busy} onClick={() => { if (candidate.data.semanticReview) setAccepted({ text: JSON.stringify(candidate.data.candidate), revision, remaining: candidate.data.review.remaining || [] }); else setAccepted(null); onApply(candidate.data.candidate); setCandidate(null); }}>采用到编辑框</button><button type="button" className="text-button" onClick={() => setCandidate(null)}>保留原文，丢弃候选</button></div>}
  </section>;
}
