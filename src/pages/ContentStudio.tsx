import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Download, Image, Loader2, MoreHorizontal, Pause, Play, Plus, Video } from 'lucide-react';
import { useStudio } from '../context';
import { Channel, Empty, Field, Modal, NeedProject, PageTitle, Pill, ProductArt } from '../components';
import type { Asset } from '../types';
import { LocalAssetImportButton, ProjectReferenceFile } from '../components/LocalMediaFiles';
import { CopyCheckPanel } from '../components/CopyCheckPanel';
import { InputAssist, ResearchTrace } from '../components/InputAssist';
import { CopyKeywords } from '../components/CopyKeywords';
import { ExportDialog } from '../components/ExportDialog';
import { CopyReviewNote, RetrievalResults } from './Corpus';
import { CoverButton, CoverDialog } from './Cover';
import { ProductionButton } from './Production';
import { AIAction } from './AIAction';
import { CreationAccountPicker } from './AccountCreation';
import { XiaohongshuAssistant } from './XiaohongshuAssistant';
import { KnowledgePicker } from './KnowledgeLibrary';
import { useIntegrations } from './Integrations';
import { assetPublishReadiness } from '../../server/publish-readiness.mjs';
import { assetAccountId, assetPublicationRecords } from '../../server/workspace-view.mjs';
import { scopeHasAccount } from '../workspace-scope.mjs';
import { renderPoster, renderVideo } from '../media';
import { guideProgress } from '../../server/guide.mjs';
import { useContentEditDraft } from '../useContentEditDraft';
import type { XhsAssistantMode } from '../../server/xhs-assistant.mjs';
import '../content-editor.css';
import '../skill-trace.css';

type Step = 'brief' | 'copy' | 'media' | 'check';
type NewDraft = { accountId: string; kind: 'image' | 'video'; requirement: string; knowledgeIds: string[]; requestId: string };
// The workspace's notification callback is not shared across logins. Unfinished
// input survives navigation in this session without leaking into another user.
const workspaceDrafts = new WeakMap<object, Map<string, NewDraft>>();
function draftsFor(owner: object) { let drafts = workspaceDrafts.get(owner); if (!drafts) { drafts = new Map(); workspaceDrafts.set(owner, drafts); } return drafts; }
const STEPS: { id: Step; label: string }[] = [{ id: 'brief', label: '需求' }, { id: 'copy', label: '文案' }, { id: 'media', label: '画面' }, { id: 'check', label: '发布核对' }];
export function contentAccount(asset: Asset) { return asset.creationTrace?.accounts.find(account => account.platform === asset.channel); }
export function contentNextStep(asset: Asset): Step {
  if (!asset.body.trim()) return 'copy';
  return assetPublishReadiness(asset).ready ? 'check' : 'media';
}
function requirementOf(asset: Asset) { return asset.contentBrief?.requirement || ''; }
function mediaLabel(asset: Asset) {
  if (!asset.mediaData) return asset.kind === 'image' ? '图文' : '短视频';
  return asset.kind === 'image' ? (asset.mime === 'image/jpeg' ? 'JPG' : 'PNG') : (asset.mime === 'video/mp4' ? 'MP4' : 'WebM');
}
function AssetPicture({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  const { project } = useStudio();
  return <div className={'content-picture ' + (compact ? 'compact' : '')}>
    {asset.mediaData ? asset.kind === 'image' ? <img src={asset.mediaData} alt={asset.title || '内容配图'}/> : <video src={asset.mediaData} controls={!compact} muted={compact} playsInline preload="metadata"/> : <>{!asset.contentBrief && <ProductArt project={project}/>}<span className="content-picture-empty">{asset.kind === 'image' ? <Image size={28}/> : <Video size={28}/>}画面尚未制作，可生成或采用电脑中的文件</span></>}
  </div>;
}
function ContentTrace({ asset }: { asset: Asset }) {
  const account = contentAccount(asset), trace = asset.skillTrace;
  return <details className="content-fold"><summary>查看本篇资料、身份与生成规则</summary>
    {account && <><p>{account.accountName} · 身份 R{account.profileRevision} · {account.presetName || '默认方案'}</p><pre>{account.identityMarkdown || '生成时未填写身份记忆'}</pre>{account.instruction && <p>{account.instruction}</p>}</>}
    {trace && <details><summary>上次使用的写作规则</summary><p>{trace.user?.name || '默认写作规则'} · {new Date(trace.at).toLocaleString('zh-CN')}</p>{trace.builtin.map(rule => <details key={rule.id}><summary>{rule.id} · {rule.version}</summary><pre>{rule.instructions}</pre></details>)}</details>}
    <ResearchTrace references={asset.researchReferences}/>
    {!!asset.corpusReferences?.length && <RetrievalResults results={asset.corpusReferences} method={asset.retrievalMethod} note={asset.retrievalNote}/>}
    <details><summary>制作要求</summary><pre>{asset.prompt}</pre></details>
  </details>;
}
function NewContentDialog({ onClose }: { onClose: () => void }) {
  const { state, project, target, accountScope, busy, mutate, run, go, notify } = useStudio();
  const draftKey = 'new:' + project?.id;
  const restored = draftsFor(notify).get(draftKey) as NewDraft | undefined;
  const [accountId, setAccountId] = useState(target?.accountId || restored?.accountId || accountScope || '');
  const [kind, setKind] = useState<'image' | 'video'>(restored?.kind || 'image');
  const [requirement, setRequirement] = useState(target?.requirement || restored?.requirement || '');
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>(target?.knowledgeIds || restored?.knowledgeIds || []);
  const [requestId, setRequestId] = useState(() => target?.requirement ? crypto.randomUUID() : restored?.requestId || crypto.randomUUID());
  const account = state.accounts.find(item => item.id === accountId);
  const changeRequest = () => setRequestId(crypto.randomUUID());
  useEffect(() => { draftsFor(notify).set(draftKey, { accountId, kind, requirement, knowledgeIds, requestId }); }, [notify, draftKey, accountId, kind, requirement, knowledgeIds, requestId]);
  useEffect(() => { if (account?.platform === 'youtube') setKind('video'); }, [account?.platform]);
  if (!project) return null;
  return <Modal title="新建一份内容" description="写下需求，选择账号和内容形式；创建草稿不会调用模型。" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); void run(async () => {
      const response = await mutate<Asset>('/projects/' + project.id + '/content-drafts', 'POST', { requestId, accountId, kind, requirement, knowledgeIds });
      draftsFor(notify).delete(draftKey); notify('内容草稿已创建，可以写文案或直接采用已有成品'); onClose(); go('studio', project.id, { assetId: response.result.id, tab: 'copy' });
    }); }}>
      <Field label="这次想做什么？"><textarea required rows={5} maxLength={4000} value={requirement} disabled={busy} onChange={event => { setRequirement(event.target.value); changeRequest(); }} placeholder="例如：给通勤生活账号写一篇下班后整理书桌的分享，语气自然、不带广告；用我上传的照片做配图。"/></Field>
      <div className="content-two-fields"><Field label="发布账号"><select required value={accountId} disabled={busy} onChange={event => { setAccountId(event.target.value); changeRequest(); }}><option value="">选择本篇的目标账号</option>{state.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="内容形式"><select value={kind} disabled={busy} onChange={event => { setKind(event.target.value as 'image' | 'video'); changeRequest(); }}><option value="image" disabled={account?.platform === 'youtube'}>图文</option><option value="video">短视频</option></select></Field></div>
      {account && <p className="content-account"><Channel platform={account.platform}/><span>{account.name} · 将保存此账号的身份和默认创作方案</span></p>}
      {!state.accounts.length && <p className="info-box">请先在项目与账号中添加一个目标账号。</p>}
      <details className="content-fold"><summary>添加已保存的知识与参考（{knowledgeIds.length}）</summary><KnowledgePicker selectedIds={knowledgeIds} onChange={ids => { setKnowledgeIds(ids); changeRequest(); }} accountId={accountId} disabled={busy}/></details>
      <p className="small-note">未完成的输入在本次登录中暂存，关闭窗口后可继续。</p>
      <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>稍后继续</button><button className="button primary" disabled={busy || !account || !requirement.trim()}><Plus size={16}/>创建草稿</button></div>
    </form>
  </Modal>;
}

function ContentEditor({ asset, initialStep, onBack, onCreate, onExport, onPrepareCover, job, redfoxMedia }: {
  asset: Asset; initialStep?: string; onBack: () => void; onCreate: (asset: Asset) => void; onExport: (asset: Asset) => void;
  onPrepareCover: (asset: Asset) => void; job: { id: string; progress: number } | null; redfoxMedia: boolean;
}) {
  const { project, busy: foregroundBusy, mutate, run, notify, go } = useStudio();
  const { base, title, body, requirement, knowledgeIds, setBase, setTitle, setBody, setRequirement, setKnowledgeIds, sync, commit, flush, loaded, status: draftStatus, error: draftError } = useContentEditDraft(asset, project?.id || '', notify);
  const busy = foregroundBusy || !loaded;
  const [step, setStep] = useState<Step>(STEPS.some(item => item.id === initialStep) ? initialStep as Step : contentNextStep(asset));
  const [assistant, setAssistant] = useState<XhsAssistantMode | null>(null);
  const assistantPanel = useRef<HTMLDivElement>(null);
  const copyDirty = title !== base.title || body !== base.body;
  const briefDirty = requirement !== base.requirement || JSON.stringify(knowledgeIds) !== JSON.stringify(base.knowledgeIds);
  const dirty = copyDirty || briefDirty, stale = base.revision !== asset.revision;
  const account = contentAccount(asset), ready = assetPublishReadiness(asset), image = asset.kind === 'image';
  useEffect(() => { if (STEPS.some(item => item.id === initialStep)) { setStep(initialStep as Step); setAssistant(null); } }, [initialStep]);
  useEffect(() => { if (assistant) assistantPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [assistant]);
  useEffect(() => { if (loaded && asset.revision !== base.revision && !dirty) sync(asset); }, [asset.revision, base.revision, dirty, loaded]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!project) return null;
  async function save() {
    if (stale) throw new Error('内容已在其他操作中更新，请先重新读入最新内容');
    let current = asset;
    if (briefDirty) {
      current = (await mutate<Asset>('/projects/' + project!.id + '/assets/' + asset.id + '/brief', 'PUT', { expectedRevision: current.revision, requirement, knowledgeIds })).result;
      // If the next text save fails, retain its unsaved input against the
      // successfully saved brief revision so the user can retry only that part.
      setBase({ revision: current.revision, title: current.title, body: current.body, requirement: requirementOf(current), knowledgeIds: current.contentBrief?.knowledgeIds || [] });
      setRequirement(requirementOf(current)); setKnowledgeIds(current.contentBrief?.knowledgeIds || []);
    }
    if (copyDirty) current = (await mutate<Asset>('/projects/' + project!.id + '/assets/' + asset.id, 'PUT', { title, body, expectedRevision: current.revision })).result;
    await commit(current); notify('本篇内容已保存，临时编辑已清理');
  }
  const editingLocked = busy || dirty || stale;
  const tools = (kind: 'title' | 'body') => asset.channel === 'xiaohongshu' && <div className="content-inline-tools">
    {(kind === 'title' ? [{ id: 'titles', label: '更多标题' }, { id: 'title-score', label: '标题评分' }] : [{ id: 'create', label: '参考创作' }, { id: 'rewrite', label: '改写正文' }, { id: 'note-score', label: '正文诊断' }]).map(item => <button type="button" className="text-button" disabled={editingLocked} key={item.id} onClick={() => setAssistant(item.id as XhsAssistantMode)}>{item.label}</button>)}
  </div>;
  return <div className="content-editor" aria-label="单篇内容编辑器">
    <div className="content-editor-heading"><button type="button" className="text-button" disabled={dirty || busy} onClick={onBack}><ArrowLeft size={16}/>返回内容列表</button><div className="content-account"><Channel platform={asset.channel}/><b>{account?.accountName || '历史内容 · 未指定创作账号'}</b><Pill color={ready.ready ? 'green' : 'amber'}>{ready.ready ? '可准备发布' : image ? '图文草稿' : '视频草稿'}</Pill><span>R{asset.revision}</span></div></div>
    <h2>{asset.title || asset.name || '新的内容'}</h2>
    <div className="content-step-tabs" role="tablist" aria-label="本篇内容步骤">{STEPS.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={step === item.id} className={step === item.id ? 'selected' : ''} onClick={() => { setStep(item.id); setAssistant(null); }}><span>{index + 1}</span>{item.id === 'media' ? image ? '图片' : '视频' : item.label}</button>)}</div>
    <p className={draftError ? 'error-banner' : 'small-note'} role="status">{draftError || draftStatus}{draftError && loaded && <button className="text-button" onClick={() => void run(flush)}>重试加密暂存</button>}</p>
    {dirty && <div className="content-save-bar" role="status"><span>{stale ? '作品已有新版本；下方保留的是您的临时编辑，不会覆盖新作品。可先复制保留，再选择读入最新内容。' : '本篇有尚未提交到作品的修改；保存后可生成、切换内容或继续发布。'}</span>{stale ? <><button type="button" className="button small" onClick={() => void run(async () => { await navigator.clipboard.writeText(`需求：${requirement}\n\n${title}\n\n${body}`); notify('临时编辑已复制'); })}>复制临时编辑</button><button type="button" className="button small" disabled={busy} onClick={() => { if (window.confirm('确认放弃下方临时修改，并读入最新作品？尚未复制的修改将被移除。')) void run(() => commit(asset)); }}>放弃临时修改并读入最新</button></> : <button type="button" className="button small primary" disabled={busy || !title.trim() || briefDirty && !requirement.trim()} onClick={() => void run(save)}><Check size={14}/>保存修改</button>}</div>}
    {step === 'brief' && <section className="panel content-step-panel">
      <h3>本篇创作需求</h3><Field label="这次想做什么？" hint="主题、场景、语气和重点都可直接写在这里。"><textarea rows={6} maxLength={4000} value={requirement} disabled={busy} onChange={event => setRequirement(event.target.value)} placeholder="描述这一篇内容希望表达什么；也可以直接补充养号、日常分享或产品介绍的要求。"/></Field>
      {!asset.contentBrief && <p className="small-note">这是旧版本内容，原策略和制作要求继续保留；可在这里补充本篇需求。</p>}
      {!asset.contentBrief && <details className="content-fold"><summary>核对旧内容的创作账号</summary><CreationAccountPicker platform={asset.channel} disabled={busy}/></details>}
      <KnowledgePicker selectedIds={knowledgeIds} onChange={setKnowledgeIds} accountId={account?.accountId} disabled={busy}/>
      <ContentTrace asset={asset}/>
      <div className="content-step-footer"><button className="button primary" disabled={busy || !requirement.trim()} onClick={() => void run(async () => { if (dirty) await save(); setStep('copy'); })}>保存并写文案 <ArrowRight size={16}/></button></div>
    </section>}
    {step === 'copy' && <section className="panel content-step-panel">
      <div className="section-heading"><div><h3>标题与正文</h3><p className="small-note">可直接填写已有文案，或根据本篇需求生成。</p></div><AIAction compact stage="copy" title="生成文案" description="使用本篇需求、项目资料和已绑定账号的身份生成标题、正文与制作要求。" path={'/projects/' + project.id + '/assets/' + asset.id + '/copy'} body={{ expectedRevision: asset.revision }} instruction disabled={editingLocked}/></div>
      <Field label="标题"><input maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)}/></Field>{tools('title')}
      <Field label="发布正文"><textarea rows={11} maxLength={8000} value={body} disabled={busy} onChange={event => setBody(event.target.value)}/></Field>{tools('body')}
      <details className="content-fold"><summary>添加话题或引用项目资料</summary><InputAssist kind="copy" mode="content" value={body} onChange={setBody} maxLength={8000} project={project} disabled={busy}/></details>
      <CopyReviewNote review={asset.copyReview}/>
      <div className="content-step-footer"><button className="button primary" disabled={busy || !title.trim() || stale} onClick={() => void run(async () => { if (dirty) await save(); setStep('media'); })}>保存并制作{image ? '图片' : '视频'} <ArrowRight size={16}/></button><button type="button" className="text-button" onClick={() => void run(async () => { await navigator.clipboard.writeText(title + '\n\n' + body); notify('文案已复制'); })}><Copy size={14}/>复制文案</button></div>
    </section>}
    {step === 'media' && <section className="panel content-step-panel">
      <div className="section-heading"><div><h3>{image ? '制作图片' : '制作视频'}</h3><p className="small-note">已有成品可直接选择电脑文件或拖拽采用。</p></div><LocalAssetImportButton asset={asset} disabled={editingLocked}/></div>
      <div className="content-media-layout"><AssetPicture asset={asset}/><div>
        <div className="content-media-actions">{image ? <CoverButton asset={asset} redfox={redfoxMedia} disabled={editingLocked}/> : <ProductionButton asset={asset} disabled={editingLocked}/>}
          {image && asset.channel === 'xiaohongshu' && <button className="button" disabled={editingLocked} onClick={() => setAssistant('cover-plan')}>先获取封面方案</button>}
          <button className="button" disabled={editingLocked || !!job} onClick={() => onCreate(asset)}><Play size={15}/>{asset.status === 'ready' ? '本地模板重做 · 免费' : '本地模板制作 · 免费'}</button>
        </div>
        {job?.id === asset.id && <p className="info-box" role="status"><Loader2 size={16} className="spin"/>正在制作 {job.progress}%</p>}
        <details className="content-fold"><summary>添加参考图片{!image && '与本地配音'}</summary><ProjectReferenceFile disabled={editingLocked}/>{!image && <ProjectReferenceFile audio disabled={editingLocked}/>}<p className="small-note">参考素材保存在当前项目，供之后的制作使用；现有成品保留。</p>{project.imageData && <img className="content-reference" src={project.imageData} alt="当前项目参考图片"/>}{!image && project.audioData && <audio controls src={project.audioData}/>}</details>
        <p className="small-note">AI 制作会在下一步显示方式与费用，确认后调用。本地模板与采用已有文件免费。</p>
      </div></div>
      <div className="content-step-footer"><button className="button primary" disabled={dirty || busy} onClick={() => setStep('check')}>核对发布内容 <ArrowRight size={16}/></button></div>
    </section>}
    {step === 'check' && <section className="panel content-step-panel">
      <h3>核对这份内容</h3><div className="content-media-layout"><AssetPicture asset={asset}/><div><h3><CopyKeywords text={asset.title}/></h3><p className="preserve-lines"><CopyKeywords text={asset.body}/></p><p className={ready.ready ? 'info-box' : 'info-box error-box'} role="status">{ready.ready ? '当前文案与成品已准备好。继续后选择时间和发布方式。' : ready.message}</p></div></div>
      <details className="content-fold"><summary>文案检查与修正</summary><CopyCheckPanel draft={{ title, body }} asset={asset} onApply={value => { setTitle(value.title); setBody(value.body); setStep('copy'); }}/></details>
      <div className="content-step-footer"><button className="button primary" disabled={dirty || busy} onClick={() => go('publish', project.id, { assetId: asset.id, accountId: account?.accountId })}>前往发布核对 <ArrowRight size={16}/></button><button className="button" disabled={busy || dirty || !ready.ready} onClick={() => onExport(asset)}><Download size={16}/>下载成品</button></div>
    </section>}
    {assistant && <div ref={assistantPanel}><XiaohongshuAssistant key={asset.id + ':' + assistant} targetAssetId={asset.id} initialMode={assistant} disabled={editingLocked} onClose={() => setAssistant(null)} onPrepareCover={onPrepareCover}/></div>}
    <details className="content-fold content-history"><summary>版本与历史（{asset.history.length}）</summary><ContentTrace asset={asset}/>{asset.history.length ? asset.history.map(version => <div className="row between" key={version.revision}><span>R{version.revision} · {version.title}</span><button type="button" className="text-button" disabled={editingLocked || !version.mediaData} onClick={() => void run(async () => { const response = await mutate<Asset>('/projects/' + project.id + '/assets/' + asset.id + '/restore', 'POST', { revision: version.revision }); sync(response.result); notify('已恢复为新版本，历史记录保留'); })}>恢复此版</button></div>) : <p className="small-note">制作与修改后的旧成品会保存在这里。</p>}</details>
  </div>;
}

export function StudioPage({ embedded = false, onNewContent }: { embedded?: boolean; onNewContent?: () => void } = {}) {
  const { state, project, target, scope, accountScope, mutate, run, busy, go, notify } = useStudio();
  const [filter, setFilter] = useState('all');
  const [newContent, setNewContent] = useState(!!target?.newContent);
  const [job, setJob] = useState<{ id: string; progress: number } | null>(null);
  const [jobError, setJobError] = useState(''), [paused, setPaused] = useState(false);
  const pauseRef = useRef(false), controller = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState<Asset | null>(null);
  const [preparedCover, setPreparedCover] = useState<{ projectId: string; assetId: string; revision: number } | null>(null);
  const { value: integrations } = useIntegrations();
  const redfoxMedia = !!integrations?.redfox?.configured && integrations.redfox.supported && integrations.redfox.mediaEnabled;
  useEffect(() => { setNewContent(!!target?.newContent); }, [project?.id, target]);
  useEffect(() => () => { controller.current?.abort(); pauseRef.current = true; }, []);
  if (!project) return <NeedProject/>;
  const p = project, selected = p.assets.find(item => item.id === target?.assetId);
  const scoped = p.assets.filter(asset => scope ? scopeHasAccount(scope, contentAccount(asset)?.accountId) : !accountScope || contentAccount(asset)?.accountId === accountScope);
  const assets = scoped.filter(asset => filter === 'all' || asset.kind === filter);
  async function create(asset: Asset) {
    setJobError(''); controller.current = new AbortController(); setJob({ id: asset.id, progress: 0 });
    try {
      asset = (await mutate<Asset>('/projects/' + p.id + '/assets/' + asset.id + '/review', 'POST', { expectedRevision: asset.revision })).result;
      const result = asset.kind === 'image' ? await renderPoster(p, asset, asset.revision - 1) : await renderVideo(p, asset, progress => setJob({ id: asset.id, progress }), controller.current.signal);
      if (controller.current.signal.aborted) throw new Error('制作已停止，已完成的素材保留');
      await mutate('/projects/' + p.id + '/assets/' + asset.id, 'PUT', { title: asset.title, body: asset.body, expectedRevision: asset.revision, ...result });
    } catch (failure) { setJobError(failure instanceof Error ? failure.message : '制作失败'); throw failure; }
    finally { setJob(null); controller.current = null; }
  }
  const makeAll = () => void run(async () => { pauseRef.current = false; setPaused(false); let completed = 0; for (const asset of assets.filter(item => item.status === 'queued')) { if (pauseRef.current) break; await create(asset); completed++; } notify('已完成 ' + completed + ' 份内容' + (pauseRef.current ? '，后续任务已暂停' : '')); });
  return <>
    {!embedded && <PageTitle title="内容制作" subtitle={selected ? '围绕这一份内容，完成文案、画面和发布核对。' : '选择一份继续，或直接写下需求开始新内容。'}>{!selected && <button type="button" className="button primary" disabled={busy} onClick={() => onNewContent ? onNewContent() : setNewContent(true)}><Plus size={17}/>新建内容</button>}</PageTitle>}
    {jobError && <p className="info-box error-box" role="alert">{jobError}。已完成的内容保留，可单项重试。</p>}
    {selected ? <ContentEditor key={p.id + ':' + selected.id + ':' + assetAccountId(selected)} asset={selected} initialStep={target?.tab} onBack={() => go('studio', p.id)} onCreate={asset => void run(async () => { await create(asset); notify('本地制作已完成'); })} onExport={setExporting} onPrepareCover={asset => setPreparedCover({ projectId: p.id, assetId: asset.id, revision: asset.revision })} job={job} redfoxMedia={redfoxMedia}/> : <>
      {target?.assetId && <p className="info-box">这份内容不存在或已移除，请从列表重新选择。</p>}
      <div className="content-list-toolbar"><div className="tabbar">{[['all', '全部内容'], ['image', '图文'], ['video', '短视频']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}<span>{scoped.filter(item => value === 'all' || item.kind === value).length}</span></button>)}</div><details className="content-list-more"><summary><MoreHorizontal size={16}/>更多</summary><button className="text-button" onClick={() => go('strategy', p.id)}>查看历史策略</button><button className="text-button" disabled={busy || !assets.some(item => item.status === 'queued')} onClick={makeAll}>用本地模板制作待办</button></details></div>
      {job && <p className="info-box"><Loader2 size={16} className="spin"/>正在制作 {job.progress}% <button className="text-button" disabled={paused} onClick={() => { pauseRef.current = true; setPaused(true); }}><Pause size={14}/>{paused ? '当前项结束后暂停' : '暂停后续任务'}</button></p>}
      {assets.length ? <div className="content-list">{assets.map(asset => {
        const account = contentAccount(asset), ready = assetPublishReadiness(asset);
        const publications = assetPublicationRecords(p, asset);
        const publication = publications.find(record => record.status === 'published') || publications.find(record => ['scheduled', 'exported'].includes(record.status));
        const status = publication ? publication.status === 'published' ? '已发布' : '已安排发布' : ready.ready ? '可准备发布' : !asset.body.trim() ? '待写文案' : '待制作画面';
        return <article key={asset.id} className="panel content-list-card"><AssetPicture asset={asset} compact/><div className="content-list-info"><div className="row gap-10"><Channel platform={asset.channel}/><span className="small-note">{account?.accountName || '历史内容 · 未指定账号'} · {mediaLabel(asset)} · R{asset.revision}</span></div><h3>{asset.title || asset.name}</h3><p className="clamp-2">{asset.body || requirementOf(asset) || '尚未填写正文'}</p><Pill color={publication?.status === 'published' || ready.ready ? 'green' : 'amber'}>{status}</Pill></div><div className="content-list-actions"><button className="button primary" onClick={() => publication ? go('publish', p.id, { assetId: asset.id, publicationId: publication.id, accountId: publication.accountId }) : go('studio', p.id, { assetId: asset.id })}>{publication ? '查看发布记录' : `继续${ready.ready ? '核对' : '制作'}`} <ArrowRight size={15}/></button><details><summary><MoreHorizontal size={16}/>更多</summary><button className="text-button" onClick={() => go('studio', p.id, { assetId: asset.id, tab: 'brief' })}>查看需求与版本</button><button className="text-button" onClick={() => go('publish', p.id, { assetId: asset.id, accountId: account?.accountId })}>前往发布</button><button className="text-button" disabled={!ready.ready || busy} onClick={() => setExporting(asset)}>下载成品</button></details></div></article>;
      })}</div> : <section className="panel"><Empty title={accountScope || filter !== 'all' ? '当前范围还没有内容' : '从一句需求开始'} text="选择目标账号，描述这次想做什么，即可创建一份草稿。"><button className="button primary" disabled={busy} onClick={() => onNewContent ? onNewContent() : setNewContent(true)}><Plus size={16}/>新建内容</button></Empty></section>}
    </>}
    {newContent && <NewContentDialog key={p.id} onClose={() => { setNewContent(false); if (target?.newContent) go('studio', p.id); }}/>}
    {exporting && <ExportDialog content={exporting} projectId={p.id} onClose={() => setExporting(null)} onExported={async () => { if (guideProgress(state).guide.projectId === p.id && exporting.kind === 'image') await mutate('/guide', 'PUT', { action: 'export', projectId: p.id, assetId: exporting.id, revision: exporting.revision }); }}/>}
    {preparedCover?.projectId === p.id && p.assets.some(asset => asset.id === preparedCover.assetId) && <CoverDialog key={preparedCover.assetId + ':' + preparedCover.revision} assetId={preparedCover.assetId} onClose={() => setPreparedCover(null)}/>}
  </>;
}
