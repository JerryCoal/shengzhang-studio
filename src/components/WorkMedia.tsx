import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { Field, Modal, Pill } from '../components';
import { useStudio } from '../context';
import { prepareWorkMedia, workError, workSession, useWorkView, type WorkArtifact } from '../work-control';
import type { Asset, CoverInput, State } from '../types';
import type { CreativeSkillsCatalog } from '../pages/CreativeSkills';
import { ImageWatermarkReview } from './ImageWatermarkReview';
import './work-media.css';
type Model = { provider: 'seedream' | 'redfox'; model: string; label: string; reservation: number; currency: 'USD' | 'CNY' };
type RequestInput = CoverInput & { provider: Model['provider']; model: string; skillId: string; expectedRevision: number };
type Estimate = Model & { fingerprint: string; prompt: string; expectedRevision: number; watermark: boolean; skillTrace: { builtin: { id: string; version: string }[]; user: { id: string; name: string; version: string } | null }; accountContext?: { accounts: { accountId: string; accountName: string }[] } };
type ImageOrigin = { taskId: string; runId: string; artifactId: string; artifactVersion: number; sourceAssetId: string; index: number };
type ImageAsset = Asset & { workImageOrigin: ImageOrigin };
type ItemQuote = { assetId: string; index: number; input: RequestInput; estimate: Estimate; requestId: string };
export type WorkMediaProps = { artifact: WorkArtifact; projectId: string; disabled?: boolean; onUpdated?: () => void | Promise<void> };
const phases = { generating: '生成中', ready: '已完成，待采用', applied: '已采用', failed: '生成失败', uncertain: '旧请求待核对', stale: '内容版本已变化' };
export function workImageAssets(state: State, projectId: string, sourceId: string, artifact: WorkArtifact, expectedAccount = ''): ImageAsset[] {
  const project = state.projects.find(item => item.id === projectId);
  const source = project?.assets.find(item => item.id === sourceId) as (Asset & { workOrigin?: Omit<ImageOrigin, 'sourceAssetId' | 'index'> }) | undefined;
  const origin = source?.workOrigin;
  if (!origin || origin.artifactId !== artifact.id || origin.artifactVersion !== artifact.version || origin.taskId !== artifact.taskId || origin.runId !== artifact.runId || !source?.contentBrief?.accountId || expectedAccount && source.contentBrief.accountId !== expectedAccount) throw Error('图片源内容与当前成果或账号不一致，请重新读取任务');
  const assets = (project!.assets as ImageAsset[]).filter(item => item.workImageOrigin?.sourceAssetId === sourceId).sort((a, b) => a.workImageOrigin.index - b.workImageOrigin.index);
  for (const item of assets) if (item.kind !== 'image' || item.contentBrief?.accountId !== source.contentBrief.accountId || item.workImageOrigin.artifactId !== artifact.id || item.workImageOrigin.artifactVersion !== artifact.version || item.workImageOrigin.taskId !== artifact.taskId || item.workImageOrigin.runId !== artifact.runId) throw Error('某张图片草稿与本次固定账号或成果版本不一致');
  return assets;
}
export function WorkMedia(props: WorkMediaProps) { return <WorkMediaEditor key={`${workSession()}:${props.projectId}:${props.artifact.id}:${props.artifact.version}`} {...props}/>; }
export function WorkMediaEditor({ artifact, projectId, disabled = false, onUpdated }: WorkMediaProps) {
  const { refresh } = useStudio(), savedView = useWorkView(artifact.taskId), draftKey = `${artifact.id}:${artifact.version}`;
  const [assets, setAssets] = useState<ImageAsset[]>([]), [models, setModels] = useState<Model[]>([]), [catalog, setCatalog] = useState<CreativeSkillsCatalog | null>(null);
  const [count, setCount] = useState(2), [modelKey, setModelKey] = useState(''), [skillId, setSkillId] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<Record<number, string>>({}), [textMode, setTextMode] = useState<'title' | 'none'>('title'), [watermark, setWatermark] = useState(false);
  const [quote, setQuote] = useState<ItemQuote[] | null>(null), [approved, setApproved] = useState(false), [imageApproval, setImageApproval] = useState<Record<string, boolean>>({}), [resetApproval, setResetApproval] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState(''), [draftReady, setDraftReady] = useState(false);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const life = useRef({ active: false, session: workSession(), sourceId: '', accountId: '', busy: false }), restored = useRef(false);
  const latest = useRef({ refresh, onUpdated, allowed: !disabled }); latest.current = { refresh, onUpdated, allowed: !disabled };
  const valid = () => life.current.active && life.current.session === workSession();
  const path = (id: string) => `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(id)}`;
  const accept = (state: State) => { const rows = workImageAssets(state, projectId, life.current.sourceId, artifact, life.current.accountId); if (valid()) setAssets(rows); return rows; };
  const reload = async () => { const state = await api<State>('/state'); if (valid()) return accept(state); return []; };
  const prepareSlots = async (amount: number) => {
    if (!valid()) throw Error('工作区已切换，未继续图片处理');
    const result = await api<{ result: { accountId: string }; state: State }>(path(life.current.sourceId) + '/work-images', 'POST', { count: amount });
    if (!valid()) throw Error('工作区已切换，未继续图片处理');
    if (life.current.accountId && life.current.accountId !== result.result.accountId) throw Error('图片账号已变化，未继续');
    life.current.accountId = result.result.accountId; return accept(result.state);
  };
  useEffect(() => {
    life.current.active = true;
    void (async () => {
      try {
        const destination = await prepareWorkMedia(artifact, projectId, () => latest.current.refresh(), valid);
        if (!valid()) return; life.current.sourceId = destination.assetId;
        const [rows, available, skills] = await Promise.all([prepareSlots(2), api<{ models: Model[] }>('/cover-models'), api<CreativeSkillsCatalog>('/creative-skills')]);
        if (!valid()) return; setAssets(rows); setModels(available.models); setCatalog(skills);
      } catch (failure) { if (valid()) setError(workError(failure)); }
      finally { if (valid()) setLoading(false); }
    })();
    return () => { life.current.active = false; };
  }, [projectId, artifact.id, artifact.version]);
  useEffect(() => {
    if (loading || !savedView.ready || restored.current) return;
    restored.current = true;
    const draft = savedView.value.mediaDrafts?.[draftKey];
    if (draft) { setCount(draft.count); setModelKey(draft.modelKey); setSkillId(draft.skillId); setPrompts(draft.prompts); setTextMode(draft.textMode); setWatermark(draft.watermark); }
    else { setCount(Math.max(2, Math.min(4, assets.length))); setPrompts(Object.fromEntries(assets.map(item => [item.workImageOrigin.index, item.aiCover?.input.prompt || item.prompt.slice(0, 1200) || `根据已保存文案制作第 ${item.workImageOrigin.index + 1} 张配图，呈现真实场景与主体。`]))); }
    setDraftReady(true);
  }, [loading, savedView.ready, draftKey]);
  useEffect(() => { if (draftReady) savedView.update({ mediaDrafts: { [draftKey]: { count, modelKey, skillId, prompts, textMode, watermark } } }); }, [draftReady, count, modelKey, skillId, prompts, textMode, watermark]);
  const running = assets.some(item => item.aiCover?.phase === 'generating');
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => { void reload().catch(failure => { if (valid()) setError(workError(failure)); }); }, 3000); return () => window.clearInterval(timer); }, [running]);
  const selectedModel = models.find(model => `${model.provider}:${model.model}` === modelKey);
  const availableSkills = catalog?.skills.filter(skill => skill.enabled && skill.eligibleWorkflowIds?.includes('cover')) || [];
  const locked = disabled || loading || !draftReady || pending;
  const changed = () => { setQuote(null); setApproved(false); };
  const perform = async (action: () => Promise<void>) => { if (!valid() || life.current.busy) return; life.current.busy = true; setPending(true); setError(''); try { await action(); } catch (failure) { if (valid()) setError(workError(failure)); } finally { life.current.busy = false; if (valid()) setPending(false); } };
  const estimate = (onlyIndex?: number) => perform(async () => {
    if (!selectedModel || skillId === null || !latest.current.allowed) return;
    await savedView.save(); if (!valid() || !latest.current.allowed) return;
    const rows = await prepareSlots(count); if (!valid()) return;
    const selected = rows.filter(item => item.workImageOrigin.index < count && (onlyIndex === undefined || item.workImageOrigin.index === onlyIndex) && !(onlyIndex === undefined ? ['generating', 'uncertain', 'ready', 'applied'] : ['generating', 'uncertain']).includes(item.aiCover?.phase || ''));
    if (!selected.length) throw Error('没有待生成图片；已完成的图片不会重复收费生成。');
    const quotes: ItemQuote[] = [];
    for (const item of selected) {
      if (!valid() || !latest.current.allowed) throw Error('工作区或成果状态已变化，未继续核算');
      const index = item.workImageOrigin.index;
      const input: RequestInput = { prompt: (prompts[index] || item.prompt || `根据已保存文案制作第 ${index + 1} 张配图。`).slice(0, 1200), query: '', style: 'natural', layout: 'top', textMode, watermark, provider: selectedModel.provider, model: selectedModel.model, skillId, expectedRevision: item.revision };
      const result = await api<Estimate>(path(item.id) + '/cover-estimate', 'POST', input);
      quotes.push({ assetId: item.id, index, input, estimate: result, requestId: crypto.randomUUID() });
    }
    if (valid()) { setQuote(quotes); setApproved(false); }
  });
  const generate = () => perform(async () => {
    if (!quote?.length || !approved || !latest.current.allowed) return;
    const chosen = quote; setQuote(null); setApproved(false); setImageApproval({});
    for (const item of chosen) {
      if (!valid() || !latest.current.allowed) break;
      try { const result = await api<{ state: State }>(path(item.assetId) + '/cover', 'POST', { ...item.input, approvalFingerprint: item.estimate.fingerprint, requestId: item.requestId, confirmed: true }); if (valid()) { accept(result.state); setItemErrors(previous => ({ ...previous, [item.assetId]: '' })); } }
      catch (failure) { if (valid()) setItemErrors(previous => ({ ...previous, [item.assetId]: workError(failure) })); }
    }
    if (valid()) { await reload(); if (!valid()) return; await latest.current.refresh(); if (valid()) await latest.current.onUpdated?.(); }
  });
  const total = quote?.reduce((sum, item) => sum + item.estimate.reservation, 0) || 0, currency = quote?.[0]?.estimate.currency || selectedModel?.currency || 'USD';
  return <section className="work-media" aria-label={`原地制作图片 · ${artifact.title}`}>
    <div className="work-media-heading"><div><h3><ImagePlus size={18}/>图片 Agent</h3><p>已保存成果 V{artifact.version} · 每张图片独立保存与重试</p></div><Pill color={running ? 'amber' : 'gray'}>{running ? '图片处理中' : assets.some(item => item.aiCover?.phase === 'ready' || item.aiCover?.phase === 'applied') ? '图片成果已保存' : '待核对图片设置'}</Pill></div>
    {(error || savedView.error) && <p className="work-error" role="alert">{error || savedView.error}</p>}{loading && <p role="status">正在恢复这份成果的图片草稿…</p>}
    {!loading && <>
      <div className="work-media-fields"><Field label="本次图片模型"><select aria-label="本次图片模型" value={modelKey} disabled={locked} onChange={event => { setModelKey(event.target.value); changed(); }}><option value="">请选择图片模型</option>{models.map(model => <option key={`${model.provider}:${model.model}`} value={`${model.provider}:${model.model}`}>{model.label}</option>)}</select></Field><Field label="本次图片 Skills" hint="每次明确选择；只影响本次图片。"><select aria-label="本次图片 Skills" value={skillId === null ? '__unselected' : skillId} disabled={locked || !catalog} onChange={event => { setSkillId(event.target.value === '__unselected' ? null : event.target.value); changed(); }}><option value="__unselected">请选择本次规则</option><option value="">仅默认图片规则</option>{availableSkills.map(skill => <option key={skill.id} value={skill.id}>默认 + {skill.name} · v{skill.version}</option>)}</select></Field></div>
      {!models.length && <p className="info-box">尚无可用图片模型，请在连接与设置配置 Seedream 或 Redfox 图片服务后重新打开此任务。</p>}
      <div className="work-media-fields"><Field label="图片数量"><select aria-label="图片数量" value={count} disabled={locked || running} onChange={event => { setCount(Number(event.target.value)); changed(); }}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} 张</option>)}</select></Field><Field label="画面文字"><select value={textMode} disabled={locked} onChange={event => { setTextMode(event.target.value as 'title' | 'none'); changed(); }}><option value="title">使用当前文案标题</option><option value="none">纯画面，不增加文字</option></select></Field></div>
      <label className="checkbox-row"><input type="checkbox" checked={watermark} disabled={locked} onChange={event => { setWatermark(event.target.checked); changed(); }}/><span>本次请求添加可见水印</span></label>
      <div className="work-media-grid">{Array.from({ length: count }, (_, index) => {
        const item = assets.find(asset => asset.workImageOrigin.index === index), saved = item?.aiCover, image = saved?.mediaData || (saved?.phase === 'applied' && saved.appliedRevision === item?.revision ? item!.mediaData : ''), active = saved?.phase === 'generating';
        return <article className="work-media-item" key={index}>
          <div className="work-media-heading"><b>图片 {index + 1}</b><Pill color={active ? 'amber' : saved?.phase === 'ready' || saved?.phase === 'applied' ? 'green' : 'gray'}>{saved ? phases[saved.phase] : '待生成'}</Pill></div>
          <Field label={`图片 ${index + 1} 指令`}><textarea aria-label={`图片 ${index + 1} 指令`} rows={3} maxLength={1200} value={prompts[index] ?? item?.prompt ?? ''} placeholder="描述这张图片的主体、场景和构图" disabled={locked || active} onChange={event => { setPrompts(previous => ({ ...previous, [index]: event.target.value })); changed(); }}/></Field>
          {image ? <img className="work-media-preview" src={image} alt={`成果 V${artifact.version} 的第 ${index + 1} 张图片`}/> : <div className="work-media-placeholder"><ImagePlus size={30}/><span>{active ? '正在生成这张图片…' : '图片将在这里出现'}</span></div>}
          {item && itemErrors[item.id] && <p className="work-error" role="alert">{itemErrors[item.id]}</p>}{saved?.error && <p className="work-error" role="status">{saved.error}</p>}
          {saved && <><p className="small-note">{saved.model}{saved.taskId ? ` · 任务 ${saved.taskId}` : ''}</p><button type="button" className="button small" disabled={pending} onClick={() => void perform(async () => { if (saved.provider === 'redfox' && saved.taskId && ['generating', 'uncertain'].includes(saved.phase)) { const result = await api<{ state: State }>(path(item!.id) + '/cover-status', 'POST'); if (valid()) accept(result.state); } else await reload(); })}><RefreshCw size={14}/>查询本张状态</button></>}
          {(!saved || ['failed', 'stale', 'ready', 'applied'].includes(saved.phase)) && <button type="button" className="button small" disabled={locked || !selectedModel || skillId === null} onClick={() => void estimate(index)}>{saved ? saved.phase === 'ready' || saved.phase === 'applied' ? '重做这张 · 核对费用' : '仅重试这张 · 核对费用' : '仅生成这张 · 核对费用'}</button>}
          {saved?.phase === 'uncertain' && <div className="work-media-confirm"><p>请先核对服务商旧请求，当前不会自动重新生成。</p><label className="checkbox-row"><input type="checkbox" checked={!!resetApproval[item!.id]} disabled={pending} onChange={event => setResetApproval(previous => ({ ...previous, [item!.id]: event.target.checked }))}/><span>已核对旧请求，同意解除本张锁定；再次生成需另行批准费用。</span></label><button type="button" className="button small" disabled={locked || !resetApproval[item!.id]} onClick={() => void perform(async () => { const result = await api<{ state: State }>(path(item!.id) + '/cover-reset', 'POST', { id: saved.id, confirmed: true }); if (valid()) { accept(result.state); setResetApproval(previous => ({ ...previous, [item!.id]: false })); changed(); } })}>解除本张锁定</button></div>}
          {image && <ImageWatermarkReview image={image} check={saved?.watermarkCheck} requested={saved?.watermarkRequested} label={`图片 ${index + 1}`}/>}
          {saved?.phase === 'ready' && <><label className="checkbox-row"><input type="checkbox" checked={!!imageApproval[item!.id]} disabled={pending || saved.assetRevision !== item!.revision} onChange={event => setImageApproval(previous => ({ ...previous, [item!.id]: event.target.checked }))}/><span>已检查主体、文字与角标，同意采用本张图片。</span></label><button type="button" className="button primary small" disabled={locked || !imageApproval[item!.id] || saved.assetRevision !== item!.revision} onClick={() => void perform(async () => { const result = await api<{ state: State }>(path(item!.id) + '/cover-apply', 'POST', { id: saved.id, expectedRevision: item!.revision, confirmed: true }); if (valid()) { accept(result.state); setImageApproval(previous => ({ ...previous, [item!.id]: false })); await latest.current.refresh(); if (valid()) await latest.current.onUpdated?.(); } })}><Check size={15}/>采用这张图片</button></>}
        </article>;
      })}</div>
      <button type="button" className="button" disabled={locked || !selectedModel || skillId === null} onClick={() => void estimate()}>核对待生成图片的总费用</button>
      {quote?.length ? <Modal wide title="批准图片 Agent · 本次生成" description="核对模型、Skills、每张指令和合计费用；只批准本次图片。" onClose={() => { if (!pending) changed(); }}><div className="work-media-confirm" aria-label="图片生成确认"><b>{quote[0].estimate.label} · 本次 {quote.length} 张</b><p>图片：{quote.map(item => item.index + 1).join('、')}；合计预算预留 / 参考费用：{currency === 'CNY' ? '¥' : '$'}{total.toFixed(4)} {currency}。实际费用以服务商账单为准。</p><p>账号：{quote[0].estimate.accountContext?.accounts.map(account => account.accountName).join('、') || '未绑定账号'}；Skills：{quote[0].estimate.skillTrace.user ? `${quote[0].estimate.skillTrace.user.name} · v${quote[0].estimate.skillTrace.user.version}` : '仅默认图片规则'}。</p>{quote.map(item => <details key={item.assetId}><summary>查看图片 {item.index + 1} 将发送的指令与规则</summary><pre>{item.estimate.prompt}</pre></details>)}<label className="checkbox-row"><input type="checkbox" checked={approved} disabled={locked} onChange={event => setApproved(event.target.checked)}/><span>我已核对本次账号、模型、Skills、每张图片指令与合计费用，同意本次生成。</span></label><button type="button" className="button" disabled={pending} onClick={changed}>返回修改指令与 Skills</button><button type="button" className="button primary" disabled={locked || !approved} onClick={() => void generate()}>同意并生成这 {quote.length} 张图片</button></div></Modal> : null}
      {running && <p className="small-note" role="status">正在处理已提交的图片，刷新后会恢复。已完成项不会因为其他图片失败而重复生成。</p>}{artifact.kind === 'script' && <p className="small-note">此处制作脚本配图；图片请求不包含视频生成。</p>}
    </>}
  </section>;
}
