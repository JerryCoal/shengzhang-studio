import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CircleHelp, Copy, ExternalLink, Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { api, LOCAL_DATA } from '../api';
import { Field, Modal, Pill } from '../components';
import { useStudio } from '../context';
import type { Asset } from '../types';
import { resolveAccountCreation } from '../../server/account-creation.mjs';
import { contentProjectForAsset } from '../../server/content-workflow.mjs';
import type { SkillWorkflowId } from '../../server/skill-workflows.mjs';
import type { XhsAssistantEstimate, XhsAssistantInput, XhsAssistantMode, XhsAssistantResult, XhsAssistantRun, XhsAssistantSample, XhsAssistantStatus } from '../../server/xhs-assistant.mjs';
import '../xiaohongshu-assistant.css';
import { ContentKnowledgePreview } from '../components/ContentKnowledgePreview';

const MODES = [
  { id: 'create', label: '创作图文', detail: '结合主题与真实参考，起草一篇图文。' },
  { id: 'rewrite', label: '改写文案', detail: '保留原意与已确认事实，调整表达和结构。' },
  { id: 'titles', label: '10 个标题', detail: '围绕同一内容生成不同切入点的标题。' },
  { id: 'title-score', label: '标题六维评分', detail: '六个维度分别按 10 分评估，加权得出总分与 S / A / B / C 等级。' },
  { id: 'cover-plan', label: '3 套封面方案', detail: '形成画面方案，核对并采纳后再进入封面制作。' },
  { id: 'note-score', label: '正文四维诊断', detail: '四个维度分别按 100 分评估，取平均得到工作站评分。' },
] as const;
const STATUS = { running: '处理中', completed: '已完成', failed: '未完成', uncertain: '结果待核对' };
const modeLabel = (mode: XhsAssistantMode) => MODES.find(item => item.id === mode)?.label || mode;
const timeLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未记录';
const errorLabel = (failure: unknown) => failure instanceof Error ? failure.message : '操作未完成，请刷新记录后核对';
function safeUrl(value: string, image = false) {
  try { const url = new URL(value); return (image ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function Notes({ items }: { items?: string[] }) { return items?.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : null; }
function Sources({ sample }: { sample: XhsAssistantSample }) {
  return <div>
    <p className="small-note">{sample.keyword} · 近 {sample.days} 天 · {STATUS[sample.status]} · {sample.items.length} 条 · 参考读取预留 ¥{sample.reservationCny.toFixed(2)}</p>
    <p className="small-note">读取账号：{sample.accountName || '未指定账号'} · 获取时间：{timeLabel(sample.createdAt)} · 日期范围：{sample.startDate} 至 {sample.endDate}</p>
    {sample.error && <p className="error-text">{sample.error}</p>}<Notes items={sample.warnings}/>
    <div className="xhs-assistant-source-grid">{sample.items.map(item => <article className="xhs-assistant-source" key={item.id}>
      {safeUrl(item.url) ? <a href={safeUrl(item.url)} target="_blank" rel="noreferrer">{item.title || '查看来源'}<ExternalLink size={12}/></a> : <b>{item.title || '参考内容'}</b>}
      <p className="small-note">发布：{item.publishedAt ? timeLabel(item.publishedAt) : '来源未提供'} · 采集：{timeLabel(item.collectedAt)}</p>
      {item.dateNote && <p className="small-note">{item.dateNote}</p>}
      <p>赞 {item.metrics.likes ?? '未知'} · 收藏 {item.metrics.favorites ?? '未知'} · 评论 {item.metrics.comments ?? '未知'} · 分享 {item.metrics.shares ?? '未知'}</p>
      <details><summary>展开原文与来源图片{item.excerpt ? '（摘要）' : ''}</summary><blockquote>{item.body || '来源未提供正文'}</blockquote>
        {safeUrl(item.coverUrl, true) && <img src={safeUrl(item.coverUrl, true)} alt={'来源封面：' + item.title} loading="lazy" referrerPolicy="no-referrer"/>}
      </details>
    </article>)}</div>
  </div>;
}
function ResultDetails({ result }: { result: XhsAssistantResult }) {
  return <>{result.summary && <p>{result.summary}</p>}{!!result.limitations.length && <div className="info-box"><b>本次结果的限制</b><Notes items={result.limitations}/></div>}
    <details><summary>展开引用来源 · {result.references.length} 条</summary>{result.references.length ? result.references.map((reference, index) => <div className="xhs-assistant-source" key={reference.sampleId + ':' + index}>
      {safeUrl(reference.url) ? <a href={safeUrl(reference.url)} target="_blank" rel="noreferrer">{reference.title || '查看来源'}<ExternalLink size={12}/></a> : <b>{reference.title || '参考内容'}</b>}
      {reference.quote && <blockquote>{reference.quote}</blockquote>}
    </div>) : <p className="small-note">本次未引用真实样本；内容为模型建议，请核对事实。</p>}</details>
  </>;
}
function resultText(result: XhsAssistantResult) {
  if ('body' in result) return result.title + '\n\n' + result.body;
  if ('titles' in result) return result.titles.map((item, index) => (index + 1) + '. ' + item.title + '\n' + item.reason).join('\n\n');
  if ('plans' in result) return result.plans.map(item => item.name + '\n' + item.headline + '\n' + item.prompt).join('\n\n');
  return result.summary + '\n\n总分：' + result.totalScore + '/' + result.maxScore + ' · ' + result.grade + '\n' + result.dimensions.map(item => item.name + '：' + item.score + '/' + result.maxScore + '\n' + item.reason).join('\n\n') + '\n\n修改建议：\n' + result.improvements.join('\n');
}
function ResultContent({ run, disabled, onCopy, onAdopt }: { run: XhsAssistantRun; disabled: boolean; onCopy: (value: string) => void; onAdopt: (choiceIndex?: number) => void }) {
  const result = run.result;
  if (!result) return null;
  return <><ResultDetails result={result}/>
    {'body' in result && <><h4>{result.title}</h4><p className="preserve-lines">{result.body}</p><details><summary>展开配图要求与分镜</summary><p className="preserve-lines">{result.prompt}</p><Notes items={result.scenes}/></details><div className="xhs-assistant-actions"><button type="button" className="button small" onClick={() => onCopy(resultText(result))}><Copy size={14}/>复制文案</button><button type="button" className="button small primary" disabled={disabled} onClick={() => onAdopt()}>采纳到目标成品</button></div></>}
    {'titles' in result && <><p className="small-note">{result.scoreLabel || '主题匹配度为模型主观评分，不是标题六维评分。'}</p><div className="xhs-assistant-choices">{result.titles.map((item, index) => <div className="xhs-assistant-choice" key={index}><h5>{index + 1}. {item.title}</h5><Pill color="gray">主题匹配 {item.matchScore} / 10</Pill><p>{item.reason}</p><div className="xhs-assistant-actions"><button type="button" className="button small" onClick={() => onCopy(item.title)}>复制标题</button><button type="button" className="button small primary" disabled={disabled} onClick={() => onAdopt(index)}>采纳此标题</button></div></div>)}</div></>}
    {'dimensions' in result && <>
      <div className="xhs-assistant-score"><strong>{result.totalScore}<small>/ {result.maxScore}</small></strong><div><Pill color="blue">{result.grade} · 工作站评级</Pill><p>{result.scoreLabel}</p></div></div>
      <div className="xhs-assistant-table-wrap"><table className="xhs-assistant-score-table"><caption>{run.mode === 'title-score' ? '标题六维评分 · 加权汇总' : '正文四维诊断 · 四项取平均'}</caption><thead><tr><th>维度</th><th>得分</th>{run.mode === 'title-score' && <th>权重</th>}<th>依据与建议</th></tr></thead><tbody>{result.dimensions.map(dimension => <tr key={dimension.id}><td>{dimension.name}</td><td className="xhs-assistant-number">{dimension.score} / {result.maxScore}</td>{run.mode === 'title-score' && <td className="xhs-assistant-number">{dimension.weight === undefined ? '—' : dimension.weight + '%'}</td>}<td>{dimension.reason}</td></tr>)}</tbody></table></div>
      {'strengths' in result && <><h5>值得保留</h5><Notes items={result.strengths}/><p>关键词：{result.keywords.join('、') || '未提取'}</p></>}
      <h5>修改建议</h5><Notes items={result.improvements}/>
      {'alternatives' in result && <div className="xhs-assistant-choices">{result.alternatives.map((item, index) => <div className="xhs-assistant-choice" key={index}><h5>优化标题 {index + 1} · {item.title}</h5><p>{item.reason}</p><div className="xhs-assistant-actions"><button type="button" className="button small" onClick={() => onCopy(item.title)}>复制标题</button><button type="button" className="button small primary" disabled={disabled} onClick={() => onAdopt(index)}>采纳此标题</button></div></div>)}</div>}
      <button type="button" className="button small" onClick={() => onCopy(resultText(result))}><Copy size={14}/>复制诊断</button>
    </>}
    {'plans' in result && <><p className="small-note">{result.vision ? '本次结合公开参考封面进行分析。' : '本次为文字封面方案，未分析参考图片中的视觉元素。'}采纳仅预填制作要求，生图费用会在封面制作中另行确认。</p>{!!result.observations.length && <details><summary>展开样本观察</summary><Notes items={result.observations.map(item => item.observation)}/></details>}<div className="xhs-assistant-choices">{result.plans.map((plan, index) => <div className="xhs-assistant-choice" key={index}><h5>{index + 1}. {plan.name}</h5><p><b>封面文字：</b>{plan.headline}</p><p><b>排版：</b>{plan.layout}</p><p><b>配色：</b>{plan.colors}</p><p>{plan.reason}</p><pre>{plan.prompt}</pre><div className="xhs-assistant-actions"><button type="button" className="button small" onClick={() => onCopy(plan.prompt)}>复制制作要求</button><button type="button" className="button small primary" disabled={disabled} onClick={() => onAdopt(index)}>预填到封面制作</button></div></div>)}</div></>}
  </>;
}
type Confirmation = { kind: 'samples'; keyword: string; days: 1 | 3 | 7 | 30; reservationCny: number; scope: string } |
  { kind: 'run'; input: XhsAssistantInput; estimate: XhsAssistantEstimate; scope: string } |
  { kind: 'adopt'; run: XhsAssistantRun; asset: Asset; choiceIndex?: number; scope: string };

export function XiaohongshuAssistant({ onPrepareCover, targetAssetId = '', initialMode = 'create', onClose, disabled: parentDisabled = false }: {
  onPrepareCover: (asset: Asset) => void; targetAssetId?: string; initialMode?: XhsAssistantMode; onClose?: () => void; disabled?: boolean;
}) {
  const { state, project, settings, busy, go, mutate, runBackground, notify } = useStudio();
  const targetAsset = project?.assets.find(item => item.id === targetAssetId);
  const embedded = !!targetAssetId;
  const [mode, setMode] = useState<XhsAssistantMode>(initialMode);
  const [assetId, setAssetId] = useState(targetAssetId), [assetRevision, setAssetRevision] = useState<number | null>(targetAsset?.revision ?? null);
  const [keyword, setKeyword] = useState((targetAsset?.title || project?.brief.nurture?.topic || project?.brief.product || '').slice(0, 150));
  const [title, setTitle] = useState(targetAsset?.title || ''), [body, setBody] = useState(targetAsset?.body || ''), [instruction, setInstruction] = useState('');
  const [days, setDays] = useState<1 | 3 | 7 | 30>(7), [vision, setVision] = useState(false), [sampleId, setSampleId] = useState('');
  const [status, setStatus] = useState<XhsAssistantStatus | null>(null), [loading, setLoading] = useState(!LOCAL_DATA);
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null), [copyFallback, setCopyFallback] = useState('');
  const alive = useRef(true), readSequence = useRef(0), actionLock = useRef(false);
  const asset = project?.assets.find(item => item.id === assetId && item.channel === 'xiaohongshu');
  let accountId = '', accountName = '未指定小红书账号', profileRevision = 0, presetId = '', accountError = '';
  try {
    const workflowId = ({ create: 'xhs-creator', rewrite: 'xhs-creator', titles: 'xhs-title-score', 'title-score': 'xhs-title-score', 'cover-plan': 'xhs-cover', 'note-score': 'xhs-note-analyzer' } as const)[mode];
    const account = project && resolveAccountCreation(state, contentProjectForAsset(project, asset), 'xiaohongshu', workflowId as SkillWorkflowId).accountContext?.accounts[0];
    if (account) { accountId = account.accountId; accountName = account.accountName; profileRevision = account.profileRevision; presetId = account.presetId; }
  } catch (failure) { accountError = errorLabel(failure); }
  const accountScope = [project?.id, accountId, profileRevision, presetId].join(':');
  const modelScope = [settings.routes.copy, settings.routes.analysis, settings.openaiConfigured, ...Object.values(settings.providers || {}).map(provider => provider.configured)].join(':');
  const scope = [accountScope, modelScope, assetId, assetRevision, asset?.revision ?? ''].join(':');
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const accountScopeRef = useRef(accountScope); accountScopeRef.current = accountScope;
  const path = '/projects/' + project?.id + '/xhs-assistant';
  const load = useCallback(async (silent = false) => {
    if (LOCAL_DATA) return;
    const sequence = ++readSequence.current, expectedScope = accountScope;
    if (!silent) setLoading(true);
    try {
      const next = await api<XhsAssistantStatus>(path);
      if (alive.current && sequence === readSequence.current && accountScopeRef.current === expectedScope) { setStatus(next); if (!silent) setError(''); }
    } catch (failure) { if (alive.current && sequence === readSequence.current && !silent) setError(errorLabel(failure)); }
    finally { if (alive.current && sequence === readSequence.current) setLoading(false); }
  }, [path, accountScope, modelScope]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current += 1; }; }, []);
  useEffect(() => { setStatus(null); setConfirmation(null); setSampleId(''); void load(); }, [load]);
  useEffect(() => { setTitle(asset?.title || ''); setBody(asset?.body || ''); setAssetRevision(asset?.revision ?? null); setConfirmation(null); }, [assetId]);
  useEffect(() => { setSampleId(''); setConfirmation(null); }, [keyword, days]);
  useEffect(() => { setConfirmation(null); }, [mode, title, body, instruction, vision, sampleId]);
  useEffect(() => { if (status && (!status.models.vision.configured || !status.models.vision.supported)) setVision(false); }, [status]);
  const saved = project?.xhsAssistant;
  const merge = <T extends { id: string }>(fresh: T[] | undefined, stored: T[] | undefined) => {
    const records = new Map((stored || []).map(item => [item.id, item]));
    for (const item of fresh || []) records.set(item.id, item);
    return Array.from(records.values());
  };
  const samples = merge(status?.samples, saved?.samples).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const allRuns = merge(status?.runs, saved?.runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const runs = embedded ? allRuns.filter(item => item.input.assetId === assetId && item.mode === mode) : allRuns;
  const anyRunning = allRuns.some(item => item.status === 'running') || samples.some(item => item.status === 'running');
  useEffect(() => {
    if (!anyRunning || LOCAL_DATA) return;
    let polls = 0;
    const timer = window.setInterval(() => { if (++polls > 60) { window.clearInterval(timer); return; } void load(true); }, 3000);
    return () => window.clearInterval(timer);
  }, [anyRunning, load]);
  if (!project) return null;
  const disabled = parentDisabled || busy || !!pending || loading || anyRunning || LOCAL_DATA;
  const selectedSample = samples.find(item => item.id === sampleId && item.status === 'completed');
  const selectedCount = selectedSample?.items.length || 0;
  const scoring = mode === 'title-score' || mode === 'note-score';
  const selectedModel = scoring ? status?.models.analysis : status?.models.text;
  const currentMode = MODES.find(item => item.id === mode)!;
  const assetChanged = !!assetId && (!asset || asset.revision !== assetRevision);
  const input: XhsAssistantInput = { mode, keyword: keyword.trim(), title, body, instruction, sampleId, assetId, expectedAssetRevision: assetRevision, vision: mode === 'cover-plan' && vision };
  const inputError = accountError || (assetChanged ? '目标成品已变化，请先重新读入最新内容。' :
    mode === 'cover-plan' && asset?.kind === 'video' ? '封面制作需要图文成品，请改选图文成品或暂不关联成品。' :
    mode === 'title-score' && !title.trim() ? '请填写待评分标题。' :
    (mode === 'rewrite' || mode === 'note-score') && !body.trim() ? '请填写需要处理的正文。' :
    !keyword.trim() && !title.trim() && !body.trim() ? '请填写主题、标题或正文。' :
    scoring && !selectedCount ? '评分需要至少 1 条真实参考，请先获取并选择样本。' :
    vision && mode === 'cover-plan' && (!status?.models.vision.configured || !status.models.vision.supported || !selectedSample?.items.some(item => safeUrl(item.coverUrl, true))) ? '看图分析需要已配置的支持型号和真实 HTTPS 来源封面。' : '');
  function recordReason(record: XhsAssistantRun) {
    if (record.adoptedAt) return '已采纳到成品 R' + record.adoptedRevision + '，该结果不能重复采纳。';
    if (record.status !== 'completed' || !record.result) return '结果尚未完成，不能采纳。';
    if (record.stale) return record.staleReason || '此结果已过期，请基于当前内容重新生成。';
    if (record.accountId !== accountId || record.profileRevision !== profileRevision) return '当前账号或身份版本与生成时不同，请切回原账号核对，或重新生成。';
    if (!record.input.assetId) return '生成时未关联成品，仅可复制结果。';
    const target = project!.assets.find(item => item.id === record.input.assetId && item.channel === 'xiaohongshu');
    if (!target || target.revision !== record.input.expectedAssetRevision) return '目标成品已变化，请重新生成后采纳。';
    if (record.mode === 'cover-plan' && target.kind !== 'image') return '封面方案仅可采纳到图文成品。';
    return '';
  }
  const manageSkills = () => { try { sessionStorage.setItem('studio-settings-section', 'skills'); } catch { /* Navigation still works. */ } go('settings'); };
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); notify('已复制'); }
    catch { if (alive.current) setCopyFallback(value); }
  }
  function background(label: string, work: () => Promise<void>) {
    if (disabled || actionLock.current) return;
    const expectedScope = scope;
    actionLock.current = true; setPending(label); setError('');
    void runBackground(label, async () => {
      try { await work(); }
      catch (failure) { if (alive.current && scopeRef.current === expectedScope) setError(errorLabel(failure)); throw failure; }
      finally { actionLock.current = false; if (alive.current) { setPending(''); void load(true); } }
    });
  }
  async function estimate() {
    if (disabled || inputError || actionLock.current) return;
    const expectedScope = scope; actionLock.current = true; setPending('正在估算生成费用'); setError('');
    try {
      const quote = await api<XhsAssistantEstimate>(path + '/estimate', 'POST', input);
      if (alive.current && scopeRef.current === expectedScope) setConfirmation({ kind: 'run', input: { ...input }, estimate: quote, scope: expectedScope });
    } catch (failure) { if (alive.current && scopeRef.current === expectedScope) setError(errorLabel(failure)); }
    finally { actionLock.current = false; if (alive.current) setPending(''); }
  }
  function prepareAdoption(record: XhsAssistantRun, choiceIndex?: number) {
    if (disabled || recordReason(record)) return;
    const target = project!.assets.find(item => item.id === record.input.assetId);
    if (target) setConfirmation({ kind: 'adopt', run: record, asset: target, choiceIndex, scope });
  }
  function confirm() {
    const chosen = confirmation;
    if (!chosen || chosen.scope !== scope || disabled) { setConfirmation(null); return; }
    if (chosen.kind === 'adopt' && recordReason(chosen.run)) { setError(recordReason(chosen.run)); setConfirmation(null); return; }
    setConfirmation(null);
    if (chosen.kind === 'samples') background('正在获取小红书参考', async () => {
      const response = await mutate<XhsAssistantSample>(path + '/samples', 'POST', { keyword: chosen.keyword, days: chosen.days, requestId: crypto.randomUUID(), confirmed: true });
      if (alive.current && scopeRef.current === chosen.scope && response.result.status === 'completed') setSampleId(response.result.id);
    });
    else if (chosen.kind === 'run') background('正在生成' + modeLabel(chosen.input.mode), async () => {
      await mutate<XhsAssistantRun>(path + '/runs', 'POST', { ...chosen.input, expectedModel: chosen.estimate.model, maxReservationUsd: chosen.estimate.reservationUsd, requestId: crypto.randomUUID(), confirmed: true });
      if (alive.current && scopeRef.current === chosen.scope) notify('结果已保存，请核对后采纳');
    });
    else background('正在采纳小红书助手结果', async () => {
      const response = await mutate<Asset>(path + '/adopt', 'POST', { runId: chosen.run.id, assetId: chosen.asset.id, expectedRevision: chosen.asset.revision, choiceIndex: chosen.choiceIndex, confirmed: true });
      if (alive.current && scopeRef.current === chosen.scope) {
        if (assetId === response.result.id) { setTitle(response.result.title); setBody(response.result.body); setAssetRevision(response.result.revision); }
        if (chosen.run.mode === 'cover-plan') onPrepareCover(response.result);
        notify(chosen.run.mode === 'cover-plan' ? '制作要求已预填，请在封面制作中核对后确认生图' : '已采纳到成品，请重新核对文案与画面');
      }
    });
  }
  return <section className={'panel xhs-assistant' + (embedded ? ' embedded' : '')} aria-label={embedded ? '本篇内容工具' : '小红书创作助手'}>
    <div className="section-heading"><div><h2><Sparkles size={20}/>{embedded ? currentMode.label : '小红书创作助手'}</h2><p className="muted">{embedded ? '结果用于当前内容，核对满意后再采纳。' : '先读参考，再创作或诊断；满意后选择要采纳的内容。'}</p></div>{onClose ? <button type="button" className="button small" aria-label="收起本篇工具" disabled={!!pending} onClick={onClose}><X size={15}/>收起</button> : <button type="button" className="button small" disabled={busy || !!pending} onClick={manageSkills}><BookOpen size={15}/>管理 Skills</button>}</div>
    {LOCAL_DATA && <p className="info-box">此功能需要 Windows 版或团队版。当前版本可以查看已有记录，获取参考、生成与采纳请在完整版中操作。</p>}
    {accountError ? <p className="error-text" role="alert">{accountError}</p> : <p className="xhs-assistant-account"><Pill color="gray">{accountName}</Pill><span>身份 R{profileRevision}{embedded ? ' · 本篇账号' : ' · 当前创作账号'}</span></p>}
    {!embedded && <div className="xhs-assistant-modes" role="group" aria-label="选择小红书助手功能">{MODES.map(item => <button key={item.id} type="button" disabled={disabled} className={mode === item.id ? 'selected' : ''} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}</div>}
    <p className="xhs-assistant-mode-note">{currentMode.detail}{selectedModel && <span> 本次使用{scoring ? '分析' : '文案'}模型：{selectedModel.model}（{selectedModel.provider}）。</span>}</p>
    {!embedded && <Field label="结果用于哪份内容" hint="不选择时只保存和复制结果；不会自动创建或修改成品。"><select value={assetId} disabled={disabled} onChange={event => setAssetId(event.target.value)}><option value="">暂不关联成品 · 仅保存 / 复制</option>{project.assets.filter(item => item.channel === 'xiaohongshu').map(item => <option key={item.id} value={item.id}>{item.title || item.name} · R{item.revision}</option>)}</select></Field>}
    {embedded && <p className="small-note">已读入本篇标题与正文 · R{assetRevision}。在编辑器保存的内容会用于本次处理。</p>}
    {parentDisabled && <p className="info-box">编辑器中有未保存修改或正在处理任务，请先完成保存后使用本工具。</p>}
    <details className="content-fold" open={!embedded}><summary>查看本次使用的标题与正文</summary><div className="xhs-assistant-inputs">
      <Field label={mode === 'title-score' ? '待评分标题' : '标题或标题方向'}><input value={title} maxLength={200} disabled={disabled} onChange={event => setTitle(event.target.value)} placeholder={mode === 'title-score' ? '输入要诊断的完整标题' : '选填已有标题或希望突出的一点'}/></Field>
      {mode !== 'title-score' && <div className="xhs-assistant-input-wide"><Field label={mode === 'note-score' ? '待诊断正文' : mode === 'rewrite' ? '待改写正文' : '已有正文或内容要点'}><textarea rows={5} value={body} maxLength={8000} disabled={disabled} onChange={event => setBody(event.target.value)} placeholder="填写真实内容、已知条件和需要保留的信息"/></Field></div>}
    </div></details>
    <Field label="本次补充要求（可选）"><textarea rows={2} value={instruction} maxLength={4000} disabled={disabled} onChange={event => setInstruction(event.target.value)}/></Field>
    {asset && <ContentKnowledgePreview asset={asset} query={instruction}/>}
    <details className="content-fold" open={scoring && !selectedCount}><summary>{scoring ? '评分参考' : '添加参考（可选）'} · {selectedCount ? selectedCount + ' 条已选择' : '未使用参考样本'}</summary>
      <div className="xhs-assistant-inputs">
      <div className="xhs-assistant-input-wide"><Field label="本次使用的参考样本" hint={scoring ? '评分至少需要 1 条真实样本；少于 5 条时结果的代表性有限。' : '也可不使用样本，按主题与已有正文生成。'}><select value={sampleId} disabled={disabled} onChange={event => setSampleId(event.target.value)}><option value="">不使用参考样本</option>{samples.filter(item => item.status === 'completed' && item.items.length > 0).map(item => <option key={item.id} value={item.id}>{item.keyword} · {item.items.length} 条 · 近 {item.days} 天 · {timeLabel(item.createdAt)}</option>)}</select></Field></div>
      </div>
      <details className="content-fold" open={!samples.some(item => item.status === 'completed' && item.items.length)}><summary>读取新的参考样本 · 单独确认费用</summary><div className="xhs-assistant-inputs">
        <Field label="参考主题关键词"><input value={keyword} maxLength={150} disabled={disabled} onChange={event => setKeyword(event.target.value)} placeholder="例如：大学生自习"/></Field>
        <Field label="参考发布时间"><select value={days} disabled={disabled} onChange={event => setDays(Number(event.target.value) as 1 | 3 | 7 | 30)}>{[1, 3, 7, 30].map(value => <option key={value} value={value}>近 {value} 天</option>)}</select></Field>
      </div><button type="button" className="button" disabled={disabled || !keyword.trim() || !!accountError || !status?.redfox.enabled || !status.redfox.configured} onClick={() => setConfirmation({ kind: 'samples', keyword: keyword.trim(), days, reservationCny: status?.redfox.reservationCny ?? 0.06, scope })}><Search size={16}/>查看参考读取费用</button>{status && (!status.redfox.enabled || !status.redfox.configured) && <p className="small-note">读取新参考需要在设置中配置并启用 Redfox。</p>}</details>
      <details className="xhs-assistant-sources"><summary>核对已保存样本与来源 · {samples.length} 次读取</summary>{samples.map(sample => <details key={sample.id}><summary>{sample.keyword} · {sample.items.length} 条 · {STATUS[sample.status]}</summary><Sources sample={sample}/></details>)}</details>
    </details>
    {assetChanged && <div className="info-box">目标成品已更新。当前输入仍保留，请重新读入最新标题和正文后再生成。<button type="button" className="button small" disabled={disabled || !asset} onClick={() => { setTitle(asset?.title || ''); setBody(asset?.body || ''); setAssetRevision(asset?.revision ?? null); }}>重新读入最新内容</button></div>}
    {mode === 'cover-plan' && <div className="xhs-assistant-vision"><label><input type="checkbox" checked={vision && !!status?.models.vision.configured && !!status.models.vision.supported} disabled={disabled || !status?.models.vision.configured || !status.models.vision.supported} onChange={event => setVision(event.target.checked)}/>结合参考封面看图分析</label><p className="small-note">{status?.models.vision.supported && status.models.vision.configured ? '确认后最多将 10 张公开 HTTPS 封面发送到所选 ' + status.models.vision.provider + ' 的 ' + status.models.vision.model + '，不会同时发送其他提供商；费用将在下一步确认。' : (status?.models.vision.reason || '正在读取图片分析能力') + '。可在模型设置选择支持看图的型号，也可继续生成文字方案。'}</p></div>}
    <div className="xhs-assistant-actions"><button type="button" className="button primary" disabled={disabled || !!inputError || !selectedModel?.configured} onClick={() => void estimate()}><Sparkles size={16}/>查看{scoring ? '诊断' : '生成'}费用</button></div>
    {!LOCAL_DATA && selectedModel && !selectedModel.configured && <p className="small-note">本次{scoring ? '分析' : '文案'}模型尚未配置，请到设置完成配置后生成。</p>}
    {!LOCAL_DATA && inputError && <p className="small-note">{inputError}</p>}
    <details className="content-fold"><summary><CircleHelp size={13}/>费用与使用说明</summary><p className="small-note">参考读取与文字模型分别确认费用。Redfox 数据按 T+1 更新，未返回足够样本时不会自动扩大天数或追加收费。评分为工作站辅助诊断，不是小红书平台分数，也不能保证推荐量。</p><button type="button" className="text-button" disabled={busy || !!pending} onClick={manageSkills}><BookOpen size={14}/>管理本步骤规则</button></details>
    {(pending || loading || anyRunning) && <p className="xhs-assistant-progress" role="status"><Loader2 className="spin" size={16}/>{pending || (loading ? '正在读取记录' : '已有任务处理中，完成后会更新记录')}。切换项目不会把结果写入其他项目。</p>}
    {error && <p className="info-box error-box" role="alert">{error}。如请求中断，请先刷新记录核对状态，避免重复付费。</p>}
    <section className="xhs-assistant-history" aria-label="小红书助手历史结果"><div className="xhs-assistant-history-toolbar"><h3>生成与诊断记录 <Pill color="gray">{runs.length} 条</Pill></h3><button type="button" className="button small" disabled={LOCAL_DATA || loading} onClick={() => void load()}><RefreshCw size={14}/>刷新记录</button></div><p className="small-note">当前项目独立保存。每条记录标明生成时的账号、目标成品和版本；过期结果可复制，但不能直接覆盖当前成品。</p>
      <div className="xhs-assistant-records">{runs.map((record, index) => {
        const target = project.assets.find(item => item.id === record.input.assetId), reason = recordReason(record);
        return <details className="xhs-record-fold" key={record.id} open={index === 0 && !record.adoptedAt}><summary><b>{modeLabel(record.mode)}</b><Pill color={record.status === 'completed' ? 'green' : 'amber'}>{STATUS[record.status]}</Pill><span>{timeLabel(record.createdAt)}{record.adoptedAt ? ' · 已采纳' : ''}</span></summary><div className="xhs-assistant-record">
          <div className="xhs-assistant-record-meta"><span>账号：{record.accountName || '未指定账号'} · 身份 R{record.profileRevision}</span><span>目标：{record.input.assetId ? (target?.name || record.input.assetId) + ' · R' + record.input.expectedAssetRevision : '未关联成品 · 仅复制'}</span><span>{timeLabel(record.createdAt)}</span><span>{record.model} · {record.amountUsd === undefined ? '预留' : record.estimated ? '估算' : '费用'} {'$'}{Number(record.amountUsd ?? record.reservationUsd).toFixed(4)}</span></div>
          {reason && <p className="info-box">{reason}</p>}{record.error && <p className="error-text">{record.error}</p>}<Notes items={record.warnings}/>
          {record.result && <ResultContent run={record} disabled={disabled || !!reason} onCopy={value => void copy(value)} onAdopt={choiceIndex => prepareAdoption(record, choiceIndex)}/>}
          <details><summary>展开本次输入与归属</summary><p>记录：{record.id}</p><p>账号 ID：{record.accountId || '未指定'}</p><p>主题：{record.input.keyword || '未填写'}</p><p>标题：{record.input.title || '未填写'}</p><p className="preserve-lines">{record.input.body}</p><p className="preserve-lines">补充要求：{record.input.instruction || '无'}</p><p>样本：{record.input.sampleId || '未使用'}</p></details>
        </div></details>;
      })}</div>{!runs.length && <p className="small-note">还没有结果。生成完成后会保存在这里，采纳前可逐项核对。</p>}
    </section>
    {confirmation && confirmation.scope === scope && <Modal title={confirmation.kind === 'samples' ? '确认读取参考样本' : confirmation.kind === 'run' ? '确认生成与费用' : '确认采纳结果'} onClose={() => setConfirmation(null)}>
      <div className="xhs-assistant-confirm">{confirmation.kind === 'samples' ? <>
        <p>使用 Redfox 读取“{confirmation.keyword}”近 {confirmation.days} 天的真实笔记参考，预留费用 <b>¥{confirmation.reservationCny.toFixed(2)} CNY</b>。</p><p>本次只发起一次查询，不自动补页或扩展时间。无结果也可能产生调用费用；获取后可选择是否继续生成。</p>
      </> : confirmation.kind === 'run' ? <>
        <dl><div><dt>功能</dt><dd>{modeLabel(confirmation.input.mode)}</dd></div><div><dt>模型</dt><dd>{confirmation.estimate.model}</dd></div><div><dt>目标账号</dt><dd>{confirmation.estimate.accountName || '未指定账号'} · 身份 R{confirmation.estimate.profileRevision}</dd></div><div><dt>参考样本</dt><dd>{confirmation.estimate.sampleCount} 条</dd></div><div><dt>预留费用</dt><dd><b>{'$'}{confirmation.estimate.reservationUsd.toFixed(4)} USD</b>{confirmation.estimate.imageCount > 0 && '（含 ' + confirmation.estimate.imageCount + ' 张图片分析，图片预留 $' + confirmation.estimate.imageReservationUsd.toFixed(4) + '）'}</dd></div></dl><Notes items={confirmation.estimate.warnings}/>{confirmation.estimate.vision && <p>本次将 {confirmation.estimate.imageCount} 张公开 HTTPS 参考封面发送给 {confirmation.estimate.provider} 的 {confirmation.estimate.model} 分析（最多 10 张），只调用这一家提供商。</p>}<p>确认后调用模型并保存结果。生成不会自动采纳、制作图片或发布；实际费用以调用记录为准。</p>
      </> : <>
        <p>将{confirmation.run.mode === 'cover-plan' ? '制作要求预填到封面制作' : '所选内容写入目标成品'}：<b>{confirmation.asset.name}</b> · R{confirmation.asset.revision}。</p><p>账号：{confirmation.run.accountName || '未指定账号'}。{confirmation.run.mode === 'cover-plan' ? '下一步可以编辑制作要求，再单独确认生图费用。' : '采纳后请核对当前文案并按需重新制作画面。'}</p>
      </>}<div className="xhs-assistant-actions"><button type="button" className="button" onClick={() => setConfirmation(null)}>取消</button><button type="button" className="button primary" disabled={disabled} onClick={confirm}>{confirmation.kind === 'samples' ? '确认付费读取' : confirmation.kind === 'run' ? '确认费用并生成' : confirmation.run.mode === 'cover-plan' ? '确认预填并打开封面制作' : '确认采纳'}</button></div></div>
    </Modal>}
    {copyFallback && <Modal title="复制结果" description="当前浏览器无法直接写入剪贴板，请选中文字手动复制。" onClose={() => setCopyFallback('')}><textarea className="xhs-assistant-copy-fallback" rows={12} readOnly value={copyFallback} onFocus={event => event.target.select()}/></Modal>}
  </section>;
}
