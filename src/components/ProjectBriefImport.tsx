import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, FileUp, LoaderCircle, Sparkles } from 'lucide-react';
import { api, IS_STATIC, IS_WEB } from '../api';
import { readDocument } from '../document-text';
import type { Brief, EditorDraft } from '../types';
import type { BriefImportField as ImportField, BriefImportCandidate as Candidate } from '../../server/project-brief-import.mjs';
import '../project-brief-import.css';
import { WorkflowSkillSummary } from '../pages/CreativeSkills';

type ImportJob = {
  id: string; editorKey: string; sourceName: string; model: string;
  status: 'running' | 'completed' | 'failed' | 'uncertain'; at: string; finishedAt?: string;
  baseline?: Partial<Brief>; result?: { fields: Candidate[]; warnings: string[] };
  amountUsd: number; estimated: boolean; error?: string; note: string;
};
type ImportStatus = { job: ImportJob | null; configured: boolean; model: string };
type Estimate = { reservationUsd: number; model: string };
type Choice = { selected: boolean; expected: string };
type Props = {
  editorKey: string; brief: Brief; ready: boolean;
  flush: (force?: boolean) => Promise<{ draft: EditorDraft } | undefined>;
  applyPatch: (patch: Partial<Brief>, expected: Partial<Brief>) => { applied: boolean; conflicts: (keyof Brief)[] };
  onOpenSettings: () => void;
};
const labels: Record<ImportField, string> = { name: '项目名称', brand: '品牌名称', product: '产品 / 服务', goal: '宣传目标', audience: '受众与场景', sellingPoints: '表达卖点', facts: '产品事实', requirements: '语气与要求' };
const money = (amount: number) => `$${amount.toFixed(4)}`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export function ProjectBriefImport({ editorKey, brief, ready, flush, applyPatch, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false), [configured, setConfigured] = useState<boolean | null>(null);
  const [sourceName, setSourceName] = useState(''), [text, setText] = useState(''), [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false), [estimating, setEstimating] = useState(false), [submitting, setSubmitting] = useState(false), [applying, setApplying] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null), [estimate, setEstimate] = useState<Estimate | null>(null), [confirmed, setConfirmed] = useState(false);
  const [choices, setChoices] = useState<Partial<Record<ImportField, Choice>>>({}), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), mounted = useRef(true), briefRef = useRef(brief), parseVersion = useRef(0), sourceVersion = useRef(0);
  const received = useRef(''), requestInFlight = useRef(false), statusVersion = useRef(0);
  briefRef.current = brief;
  const unavailable = IS_STATIC || IS_WEB;
  const running = submitting || job?.status === 'running';
  const byteLength = new TextEncoder().encode(text).byteLength;
  const tooLong = text.length > 30000 || byteLength > 60000;
  const validSource = !!text.trim() && !tooLong;

  const receiveJob = (next: ImportJob | null) => {
    if (!mounted.current) return;
    setJob(next);
    if (!next) return;
    const identity = `${next.id}:${next.status}`;
    if (identity === received.current) return;
    received.current = identity;
    setOpen(true);
    if (next.status === 'completed' && next.result) {
      const nextChoices: Partial<Record<ImportField, Choice>> = {};
      for (const item of next.result.fields) {
        const current = briefRef.current[item.field];
        nextChoices[item.field] = { selected: item.field !== 'facts' && !current.trim() && current === (next.baseline?.[item.field] || ''), expected: current };
      }
      setChoices(nextChoices);
      setNotice('提取已完成。核对建议与原文依据后，选择要填入的项目。');
    } else setChoices({});
  };
  const loadStatus = async () => {
    const version = ++statusVersion.current;
    try {
      const result = await api<ImportStatus>(`/brief-import?editorKey=${encodeURIComponent(editorKey)}`);
      if (!mounted.current || version !== statusVersion.current) return;
      setConfigured(result.configured); setLoaded(true); receiveJob(result.job);
    } catch (failure) { if (mounted.current && version === statusVersion.current) { setLoaded(true); setError(messageOf(failure)); } }
  };
  useEffect(() => {
    mounted.current = true;
    if (!unavailable && ready) void loadStatus();
    return () => { mounted.current = false; parseVersion.current++; statusVersion.current++; };
  }, [editorKey, unavailable, ready]);
  useEffect(() => {
    if (unavailable || job?.status !== 'running') return;
    const timer = setInterval(() => { void loadStatus(); }, 3000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, unavailable]);

  const updateSource = (value: string) => { sourceVersion.current++; setText(value); setEstimate(null); setConfirmed(false); };
  const importFile = async (file?: File) => {
    if (!file) return;
    const version = ++parseVersion.current;
    setParsing(true); setError(''); setNotice(''); setEstimate(null); setConfirmed(false);
    try {
      const result = await readDocument(file);
      if (!mounted.current || version !== parseVersion.current) return;
      setSourceName(file.name.slice(-180)); updateSource(result.text); setParseWarnings(result.extraction.warnings);
      if (result.text.length > 30000 || new TextEncoder().encode(result.text).byteLength > 60000) setError('文档正文超过单次提取限制，已完整保留在预览中。请删去无关部分后再提取，系统不会静默截断。');
    } catch (failure) { if (mounted.current && version === parseVersion.current) setError(messageOf(failure)); }
    finally { if (mounted.current && version === parseVersion.current) setParsing(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const saveBeforeRequest = async () => {
    const saved = await flush(true);
    if (!saved) throw new Error('请等待本地草稿恢复后再提取。');
    if (saved.draft.conflict) throw new Error('项目资料在其他窗口有更新，请先核对自动保存提示，再提取。');
  };
  const estimateCost = async () => {
    const version = sourceVersion.current;
    setEstimating(true); setError(''); setNotice(''); setEstimate(null); setConfirmed(false);
    try {
      await saveBeforeRequest();
      const result = await api<Estimate>('/brief-import/estimate', 'POST', { editorKey, sourceName: sourceName || '粘贴的项目介绍', text });
      if (mounted.current && version === sourceVersion.current) setEstimate(result);
    } catch (failure) { if (mounted.current) setError(messageOf(failure)); }
    finally { if (mounted.current) setEstimating(false); }
  };
  const extract = async () => {
    if (requestInFlight.current || !confirmed || !estimate || !validSource) return;
    requestInFlight.current = true; setSubmitting(true); setError(''); setNotice(''); setChoices({});
    try {
      await saveBeforeRequest();
      statusVersion.current++;
      const result = await api<{ job: ImportJob }>('/brief-import', 'POST', { editorKey, sourceName: sourceName || '粘贴的项目介绍', text, requestId: crypto.randomUUID(), confirmed: true });
      if (mounted.current) { receiveJob(result.job); setEstimate(null); setConfirmed(false); }
    } catch (failure) {
      if (mounted.current) { setError(`${messageOf(failure)}。可点击“刷新提取状态”核对结果，避免重复提交。`); await loadStatus(); }
    } finally { requestInFlight.current = false; if (mounted.current) setSubmitting(false); }
  };
  const apply = async () => {
    if (!job?.result) return;
    const patch: Partial<Brief> = {}, expected: Partial<Brief> = {};
    for (const item of job.result.fields) if (choices[item.field]?.selected) { patch[item.field] = item.value; expected[item.field] = choices[item.field]!.expected; }
    if (!Object.keys(patch).length) return;
    setApplying(true); setError(''); setNotice('');
    try {
      const result = applyPatch(patch, expected);
      if (!result.applied) {
        setChoices(previous => { const next = { ...previous }; for (const field of result.conflicts as ImportField[]) next[field] = { selected: false, expected: briefRef.current[field] }; return next; });
        setError(`你刚修改了${result.conflicts.map(field => labels[field as ImportField]).join('、')}，本次尚未填入任何字段。请核对当前值后重新勾选。`); return;
      }
      setChoices({}); const saved = await flush();
      if (saved?.draft.conflict) throw new Error('所选内容已保留在本地草稿，但项目在其他窗口有更新。请先核对上方自动保存提示，再确认项目资料。');
      if (mounted.current) setNotice(`已填入并保存 ${Object.keys(patch).length} 项资料，可在下方继续编辑。`);
    } catch (failure) { if (mounted.current) setError(messageOf(failure)); }
    finally { if (mounted.current) setApplying(false); }
  };
  const candidates = job?.status === 'completed' ? job.result?.fields || [] : [];
  const selected = candidates.filter(item => choices[item.field]?.selected).length;

  return <section className="brief-import" aria-label="导入介绍文档自动填充">
    <button type="button" className="brief-import-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="brief-import-icon"><FileUp size={20}/></span><span><strong>导入介绍文档，自动填写概要</strong><small>DeepSeek 提取建议，你核对后填入</small></span>
      {running && <span className="brief-import-state">提取中</span>}<ChevronDown size={18} className={open ? 'is-open' : ''}/>
    </button>
    {open && <div className="brief-import-body">
      {unavailable ? <p className="brief-import-note">介绍文档自动填充需要 Windows 本地完整版，以使用本机加密保存的 DeepSeek 密钥。当前浏览器模式可继续手动填写项目概要。</p> : <>
        <div className="brief-import-steps"><span><b>1</b> 导入与预览</span><span><b>2</b> DeepSeek 提取</span><span><b>3</b> 核对并填入</span></div>
        <WorkflowSkillSummary workflowId="brief-import" onManage={() => { try { sessionStorage.setItem('studio-settings-section', 'skills'); } catch { /* still navigate */ } onOpenSettings(); }}/>
        <div className="brief-import-source-row"><button className="button" type="button" disabled={!ready || parsing || running} onClick={() => fileInput.current?.click()}>{parsing ? <LoaderCircle size={16} className="spin"/> : <FileUp size={16}/>} {parsing ? '正在本机读取…' : '选择介绍文档'}</button><span>{sourceName || '也可以直接粘贴介绍正文'}</span></div>
        <input ref={fileInput} className="brief-import-file" type="file" accept=".txt,.md,.docx,.pdf,.pptx,.xlsx" tabIndex={-1} onChange={event => void importFile(event.target.files?.[0])}/>
        <p className="brief-import-note">支持 TXT、MD、DOCX、文字型 PDF；PPTX、XLSX 需要本机增强解析。文件先在本机读取，预览中可删除不需要发送的内容。</p>
        {parseWarnings.length > 0 && <div className="brief-import-warning"><AlertCircle size={16}/><div>{parseWarnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
        <label className="brief-import-source-label" htmlFor={`brief-source-${editorKey}`}>将用于提取的正文</label>
        <textarea id={`brief-source-${editorKey}`} className="brief-import-source" rows={5} value={text} disabled={parsing || running} onChange={event => updateSource(event.target.value)} placeholder="选择文档后在这里核对正文，或直接粘贴项目介绍。只发送这里的文字。"/>
        <div className={`brief-import-size ${tooLong ? 'is-error' : ''}`}>{text.length.toLocaleString()} / 30,000 字符 · {byteLength.toLocaleString()} / 60,000 UTF-8 字节{tooLong && ' · 请精简正文后提取'}</div>
        {!loaded && <p className="brief-import-note" role="status">正在检查 DeepSeek 配置与上次提取结果…</p>}
        {loaded && configured === false && <div className="brief-import-warning"><AlertCircle size={16}/><div><p>尚未配置 DeepSeek API 密钥。请在设置中加密保存后返回。</p><button type="button" className="text-button" onClick={onOpenSettings}>保存草稿并前往设置</button></div></div>}
        <div className="brief-import-actions"><button type="button" className="button small" disabled={!ready || !loaded || !configured || !validSource || parsing || running || estimating} onClick={() => void estimateCost()}>{estimating ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>} {estimating ? '估算中…' : estimate ? '重新估算费用' : '先估算提取费用'}</button><button type="button" className="text-button" disabled={parsing} onClick={() => { setError(''); void loadStatus(); }}>刷新提取状态</button></div>
        {estimate && !running && <div className="brief-import-consent"><p>{estimate.model} · 本次预留约 <strong>{money(estimate.reservationUsd)}</strong>，完成后按返回用量记录，并计入项目费用。未填写的信息保留为空。</p><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>同意将上方正文发送至 DeepSeek 提取项目资料。API 密钥仍加密保存在本机。</span></label><button type="button" className="button primary" disabled={!ready || !confirmed || !validSource || parsing || estimating} onClick={() => void extract()}><Sparkles size={16}/>提取项目概要</button></div>}
        {running && <div className="brief-import-progress" role="status"><LoaderCircle size={17} className="spin"/><div><strong>DeepSeek 正在提取项目概要</strong><p>你可以继续编辑下方内容，或保存并关闭后处理其他工作。返回此项目可查看结果，提取不会自动覆盖输入。</p></div></div>}
        {job && job.status !== 'running' && !submitting && <div className="brief-import-job-meta"><span>上次提取：{job.sourceName}</span><span>{job.model} · {job.estimated ? '预估记录' : '用量记录'} {money(job.amountUsd)}</span>{job.note && <p>{job.note}</p>}</div>}
        {(job?.status === 'failed' || job?.status === 'uncertain') && !submitting && <div className="brief-import-warning" role="alert"><AlertCircle size={16}/><div><strong>{job.status === 'uncertain' ? '上次请求结果待核对' : '上次提取未完成'}</strong><p>{job.error || '请检查 DeepSeek 配置与网络，再重新提取。'}</p></div></div>}
        {candidates.length > 0 && !running && <div className="brief-import-results">
          <div className="brief-import-results-heading"><h4>核对提取结果</h4><span>已选 {selected} / {candidates.length} 项</span></div>
          <p className="brief-import-note">仅空白且未改动的字段默认勾选；已有内容和产品事实需你确认。项目类型、渠道、日期与预算继续手动设置。</p>
          {!!job?.result?.warnings.length && <div className="brief-import-warning"><AlertCircle size={16}/><div>{job.result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
          <div className="brief-import-candidates">{candidates.map(item => {
            const current = brief[item.field], changed = current !== (job?.baseline?.[item.field] || '');
            return <article className={`brief-import-candidate ${choices[item.field]?.selected ? 'is-selected' : ''}`} key={item.field}>
              <label><input type="checkbox" checked={!!choices[item.field]?.selected} onChange={event => setChoices(previous => ({ ...previous, [item.field]: { selected: event.target.checked, expected: current } }))}/><strong>{labels[item.field]}</strong></label>
              {item.field === 'facts' && <p className="brief-import-fact-note">勾选即表示你已核对事实、价格、规格或效果描述。</p>}
              {current.trim() && <details className="brief-import-current"><summary>{changed ? '当前值与提取时不同 · ' : ''}采用后将替换现有内容</summary><p>{current}</p></details>}
              {!current.trim() && changed && <p className="brief-import-fact-note">提取期间已清空，请确认是否填入。</p>}
              <p className="brief-import-value">{item.value}</p>
              <details className="brief-import-evidence"><summary>查看原文依据（{item.evidence.length} 条）</summary>{item.evidence.map((quote, index) => <blockquote key={index}>{quote}</blockquote>)}</details>
            </article>;
          })}</div>
          <div className="brief-import-actions"><button type="button" className="button primary" disabled={!ready || !selected || applying} onClick={() => void apply()}>{applying ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}填入所选 {selected} 项并保存</button><span>填入后仍可在下方修改</span></div>
        </div>}
        {job?.status === 'completed' && !candidates.length && !running && <p className="brief-import-note">{job.result ? '当前资料没有提取出有原文依据的字段，请补充更具体的产品介绍后再试。' : '较早的提取记录仅保留费用，请查看已填入的资料，或重新导入文档提取。'}</p>}
        {notice && <p className="brief-import-feedback" role="status">{notice}</p>}{error && <p className="brief-import-error" role="alert">{error}</p>}
      </>}
    </div>}
  </section>;
}
