import { useEffect, useState } from 'react';
import { FileCheck2, Sparkles } from 'lucide-react';
import { api, IS_STATIC, IS_WEB } from '../api';
import { useStudio } from '../context';
import { canGenerate } from '../model-provider';
import type { CorpusPurpose, DocumentContextCard, DocumentContextItem, DocumentContextState, Project } from '../types';
import '../corpus-context.css';

export const CORPUS_PURPOSE_LABELS: Record<CorpusPurpose, string> = { product_facts: '产品事实', event_plan: '活动安排', brand_guidelines: '品牌规范', style_sample: '文风样本' };
const KIND_LABELS: Record<DocumentContextItem['kind'], string> = { fact: '事实', audience: '受众', use_case: '用途', price_terms: '价格与条件', brand_rule: '品牌规范', style_note: '表达习惯' };

function Evidence({ item }: { item: DocumentContextItem }) {
  return <details><summary>核对原文出处（{item.evidence.length}）</summary>{item.evidence.map((source, i) => <blockquote key={i}><p>{source.quote}</p><small>{source.name} · 段落 {source.chunk}{source.page ? ` · 第 ${source.page} 页` : ''}{source.heading ? ` · ${source.heading}` : ''} · {CORPUS_PURPOSE_LABELS[source.purpose]}</small></blockquote>)}</details>;
}
function ReadOnlyCard({ card }: { card: DocumentContextCard }) {
  return <div className="document-context-items">{card.items.map(item => <article key={item.id}><b>{KIND_LABELS[item.kind]}</b><p>{item.text}</p><Evidence item={item}/></article>)}</div>;
}

export function CorpusContext({ project }: { project: Project }) {
  const { settings, busy, run, runBackground, mutate, notify } = useStudio();
  const [status, setStatus] = useState<DocumentContextState | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [adoptIds, setAdoptIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const available = !IS_STATIC && !IS_WEB && settings.profileMode === true && !settings.browserStorage;
  const path = `/projects/${project.id}/corpus/context`;
  useEffect(() => {
    if (!available) { setStatus(null); return; }
    let cancelled = false;
    api<DocumentContextState>(path).then(value => { if (!cancelled) { setStatus(value); setError(''); } }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '资料卡状态未读取'); });
    return () => { cancelled = true; };
  }, [available, path, project.updatedAt, reloadKey]);
  useEffect(() => { setSelected([]); setAdoptIds([]); setConfirming(false); }, [project.id]);
  useEffect(() => { setAdoptIds([]); }, [status?.candidate?.id]);
  const docs = (project.corpus || []).filter(doc => doc.enabled);
  const chosen = docs.filter(doc => selected.includes(doc.id));
  const count = chosen.reduce((sum, doc) => sum + doc.text.length, 0);
  const canExtract = available && canGenerate(settings, 'strategy') && chosen.length > 0 && chosen.length <= 8 && count <= 24000;
  const candidate = status?.candidate;
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
  return <section className="panel document-context" aria-label="项目资料卡">
    <div className="section-heading"><div><h2><FileCheck2 size={19}/>项目资料卡</h2><p className="muted">从选定文档整理事实与表达要求，核对原文后再选择采纳。</p></div></div>
    {!available ? <p className="small-note">资料提炼与采纳需要 Windows 版的本机加密工作区。此处仍可导入正文、设置用途和本地检索。</p> : <>
      <div className="document-context-select" role="group" aria-label="选择要提炼的文档">{docs.length ? docs.map(doc => <label key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} disabled={busy} onChange={() => { setSelected(toggle(selected, doc.id)); setConfirming(false); }}/><span>{doc.name}<small>{CORPUS_PURPOSE_LABELS[doc.purpose || 'product_facts']} · {doc.text.length.toLocaleString()} 字符</small></span></label>) : <p className="small-note">先导入并启用资料，再选择本次要提炼的文档。</p>}</div>
      <p className="small-note">已选 {chosen.length} / 8 份 · {count.toLocaleString()} / 24,000 字符。使用“宣传策略”配置的 {settings.routes.strategy}，计入项目生成预算。不会截断文档后假装已读全文。</p>
      {!canGenerate(settings, 'strategy') && <p className="small-note">请先在连接与设置中配置宣传策略使用的模型。</p>}
      <button className="button primary" disabled={busy || !canExtract} onClick={() => setConfirming(true)}><Sparkles size={16}/>提炼项目资料</button>
      {confirming && <div className="document-context-confirm" role="group" aria-label="确认发送所选资料"><p>本次会把所选 {chosen.length} 份文档的正文发送给上述模型服务，可能产生费用。生成后先保存候选，不自动改写项目事实。</p><div className="row gap-12 wrap"><button className="button" disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="button primary" disabled={busy || !canExtract} onClick={() => void runBackground('提炼项目资料', async () => { await mutate(path, 'POST', { documentIds: chosen.map(doc => doc.id), confirmed: true }); setStatus(await api<DocumentContextState>(path)); setConfirming(false); notify('资料卡候选已生成，请逐项核对原文'); })}>确认发送并提炼</button></div></div>}
      {error && <p role="alert" className="error-text">{error}<button className="text-button" onClick={() => setReloadKey(value => value + 1)}>重新读取</button></p>}
      {status?.adopted && <div className="document-context-adopted"><strong>{status.adoptedCurrent ? `已采纳 ${status.adopted.items.length} 项，用于后续 AI 策略` : '来源已变化，资料卡已暂停用于新策略'}</strong><p className="small-note">{status.adoptedCurrent ? '已确认策略继续使用生成时的资料快照。需要更换资料时，重新生成并确认新策略。' : '请重新提炼并核对；历史策略与已采纳记录仍保留。'}</p><details><summary>查看已采纳内容</summary><ReadOnlyCard card={status.adopted}/></details><button className="text-button" disabled={busy} onClick={() => void run(async () => { const result = await mutate<DocumentContextState>(path, 'DELETE', { expectedRevision: status.revision }); setStatus(result.result); notify('已停用资料卡，历史策略保持原有快照'); })}>停用此资料卡</button></div>}
      {candidate && <div className="document-context-candidate"><h3>待核对资料卡</h3><p className="small-note">{candidate.model} · {new Date(candidate.createdAt).toLocaleString('zh-CN')}。引文已匹配输入原文；含义、真实性及使用条件仍需人工核对。</p>{!status.candidateCurrent && <p className="error-text">来源文档或用途已变化，请重新提炼后再采纳。</p>}
        <div className="document-context-items">{candidate.items.map(item => <article key={item.id}><label className="checkbox-row"><input type="checkbox" checked={adoptIds.includes(item.id)} disabled={busy || !status.candidateCurrent} onChange={() => setAdoptIds(toggle(adoptIds, item.id))}/><b>{KIND_LABELS[item.kind]} · 采纳此项</b></label><p>{item.text}</p><Evidence item={item}/></article>)}</div>
        {!candidate.items.length && <p>本次没有可直接采纳的条目，请按下列缺口补充资料。</p>}
        {!!candidate.missing.length && <div className="document-context-missing"><h4>待确认与待补充</h4><ul>{candidate.missing.map((item, i) => <li key={i}>{item}</li>)}</ul><p className="small-note">这些问题不会作为产品事实使用。</p></div>}
        <button className="button primary" disabled={busy || !status.candidateCurrent || !adoptIds.length} onClick={() => void run(async () => { const result = await mutate<DocumentContextState>(path + '/adopt', 'POST', { candidateId: candidate.id, expectedRevision: status.revision, itemIds: adoptIds, confirmed: true }); setStatus(result.result); notify('选中条目已采纳，将用于后续 AI 策略'); })}>已核对原文，采纳选中 {adoptIds.length} 项</button>
      </div>}
    </>}
    <p className="small-note">资料卡不覆盖原始语料。文风样本不参加事实检索；只有采纳了对应“表达习惯”的样本才用于新策略，最多带入 3 份的各 1,200 字符节选。其他资料仍按检索规则使用。</p>
  </section>;
}
