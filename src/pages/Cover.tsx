import { useState } from 'react';
import { Check, ImagePlus, RefreshCw } from 'lucide-react';
import { useStudio } from '../context';
import { Field, Modal, Pill } from '../components';
import { InputAssist, PromptGuide } from '../components/InputAssist';
import { RedfoxRouteNotice } from './RedfoxSettings';
import { useIntegrations } from './Integrations';
import { COVER_STYLES, COVER_LAYOUTS } from '../../server/prompts.mjs';
import { CopyReviewNote, RetrievalResults } from './Corpus';
import type { Asset, CoverInput } from '../types';
import { IS_STATIC, IS_WEB } from '../api';
import { previewMediaPrompt } from '../media-prompt-preview';
import { WorkflowSkillSummary } from './CreativeSkills';
import { ImageWatermarkReview, VisibleWatermarkOption } from '../components/ImageWatermarkReview';
import { LocalAssetImportButton, ProjectReferenceFile } from '../components/LocalMediaFiles';
import { CreationAccountPicker } from './AccountCreation';
import { ContentAccountSummary } from '../components/ContentAccountSummary';
import { ContentKnowledgePreview } from '../components/ContentKnowledgePreview';

const labels = { generating: '封面生成中', ready: '封面待确认', applied: '查看 AI 封面', failed: '封面未完成', uncertain: '核对封面任务', stale: '封面版本已变化' };
export function CoverButton({ asset, redfox = false, disabled = false }: { asset: Asset; redfox?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false); const { busy, project } = useStudio();
  const nurture = (project?.strategies.find(s => s.id === asset.strategyId)?.briefSnapshot || project?.brief)?.type === 'nurture';
  return <><button type="button" className="button primary small" disabled={busy || disabled} onClick={() => setOpen(true)}><ImagePlus size={15}/>{asset.aiCover ? labels[asset.aiCover.phase] : asset.contentBrief ? '生成图片' : `${nurture ? 'AI 配图' : 'AI 封面'} · ${redfox ? 'Redfox' : 'Seedream'}`}</button>{open && <CoverDialog assetId={asset.id} onClose={() => setOpen(false)}/>}</>;
}
export function CoverDialog({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { state, project, busy, run, mutate, notify, go, refresh } = useStudio(); const { value, error } = useIntegrations();
  const asset = project!.assets.find(a => a.id === assetId)!, saved = asset.aiCover;
  const brief = project!.strategies.find(s => s.id === asset.strategyId)?.briefSnapshot || project!.brief;
  const nurture = brief.type === 'nurture';
  const adoptedPlan = asset.xhsCoverPlan?.appliedRevision === asset.revision ? asset.xhsCoverPlan : null;
  const [input, setInput] = useState<CoverInput>({ ...(saved?.input || { prompt: nurture ? '围绕已填写的主要场景制作自然生活感配图，保持参考图的主体与环境特征。' : '突出真实产品和使用场景，背景简洁，画面有清晰主次。', query: '', style: 'natural', layout: 'top', textMode: 'title' }), ...(adoptedPlan ? { prompt: adoptedPlan.prompt } : {}) });
  const [reset, setReset] = useState(false);
  const [approvedImage, setApprovedImage] = useState('');
  const set = <K extends keyof CoverInput>(key: K, v: CoverInput[K]) => setInput(previous => ({ ...previous, [key]: v }));
  const { recipe, error: promptError } = previewMediaPrompt(state, project!, asset, { ...input, purpose: 'cover', hasProductReference: !!project!.imageData });
  const running = saved?.phase === 'generating', locked = busy || running;
  const redfox = !!value?.redfox?.configured && value.redfox.supported && value.redfox.mediaEnabled;
  const configured = !IS_STATIC && value?.local && (redfox || value.seedream.configured);
  const cost = value ? Math.max(value.seedream.reservationUsd, value.seedream.imagePriceUsd) : null;
  const resultImage = saved?.mediaData || (saved?.phase === 'applied' && saved.appliedRevision === asset.revision ? asset.mediaData : '');
  const watermark = input.watermark ?? (redfox ? true : value?.seedream.watermark ?? true);
  const approvalSignature = saved ? `${saved.id}:${saved.assetRevision}:${saved.watermarkCheck?.checkedAt || ''}` : '';
  const imageApproved = !!approvalSignature && approvedImage === approvalSignature;
  return <Modal title={asset.contentBrief ? "制作本篇图片" : nurture ? "生成养号配图" : "生成小红书 AI 封面"} description="单张 3:4 静态图片 · 预览满意后再采用" onClose={onClose} wide>
    <RedfoxRouteNotice value={value?.redfox} purpose="media"/>
    {asset.contentBrief ? <ContentAccountSummary asset={asset} workflowId="cover"/> : <CreationAccountPicker platform={asset.channel} disabled={locked}/>}
    {asset.contentBrief && <ContentKnowledgePreview asset={asset} query={input.prompt}/>}
    <ProjectReferenceFile disabled={locked}/>
    {project?.imageData && <img className="generation-reference-preview" src={project.imageData} alt="本次生成将使用的参考图片"/>}
    <LocalAssetImportButton asset={asset} disabled={locked}/>
    {!asset.contentBrief && <WorkflowSkillSummary workflowId="cover" platform={asset.channel}/>}<PromptGuide stage="cover"/>
    <div className="production-summary"><Pill color={running ? 'amber' : saved?.phase === 'ready' ? 'green' : 'gray'}>{saved ? labels[saved.phase] : '准备封面'}</Pill><span>1728 × 2304 · 3:4</span><span>{saved?.model || (redfox ? 'Redfox · Seedream 5.0 Pro' : value?.seedream.model) || '正在读取配置…'}</span></div>
    {!configured && <div className="info-box"><span>{error || '请先在设置中配置 Seedream，或开启 Redfox 图片与视频生成。'}</span><button className="button small" disabled={busy} onClick={() => { onClose(); go('settings'); }}>前往设置</button></div>}
    <div className="cover-editor-grid"><div>
      <div className="service-fields"><Field label="封面风格"><select disabled={locked} value={input.style} onChange={e => set('style', e.target.value as CoverInput['style'])}>{Object.entries(COVER_STYLES).map(([key, label]) => <option key={key} value={key}>{(nurture ? label.replaceAll("产品", "主体") : label).split("，")[0]}</option>)}</select></Field><Field label="封面构图"><select disabled={locked} value={input.layout} onChange={e => set('layout', e.target.value as CoverInput['layout'])}>{Object.entries(COVER_LAYOUTS).map(([key, label]) => <option key={key} value={key}>{nurture ? label.replaceAll("产品", "主体") : label}</option>)}</select></Field></div>
      <Field label="画面文字"><select disabled={locked} value={input.textMode} onChange={e => set('textMode', e.target.value as CoverInput['textMode'])}><option value="title">使用当前文案标题</option><option value="none">纯画面，不增加文字</option></select></Field>
      <VisibleWatermarkOption checked={watermark} onChange={checked => set('watermark', checked)} disabled={locked || !value}/>
      <Field label="补充画面要求" hint="描述主体、场景、光线和构图；不用填写视频运镜。"><textarea rows={4} maxLength={1200} value={input.prompt} disabled={locked} onChange={e => set('prompt', e.target.value)}/></Field>{!nurture && <InputAssist kind="cover" value={input.prompt} onChange={v => set('prompt', v)} maxLength={1200} project={project} disabled={locked}/>}
      <Field label="语料检索关键词" hint={nurture ? "留空时根据主题、标题和场景检索相关资料。" : "留空时根据产品、标题和画面要求检索；最多带入 3 段，保留出处。"}><input maxLength={500} value={input.query} disabled={locked} onChange={e => set('query', e.target.value)} placeholder={nurture ? "例如：日常分享、场景氛围" : "例如：产品外观、包装、使用场景"}/></Field>{!nurture && <InputAssist kind="query" value={input.query} onChange={v => set('query', v)} maxLength={500} disabled={locked}/>}
      {recipe ? <details className="cover-prompt"><summary>查看将发送的提示词与资料</summary><pre>{recipe.prompt}</pre><CopyReviewNote review={recipe.copyReview}/>{recipe.corpusReferences?.length ? <RetrievalResults results={recipe.corpusReferences} method="keyword"/> : <p className="small-note">没有匹配语料，将使用已确认的品牌与策略资料。</p>}</details> : <p className="error-text" role="alert">{promptError}</p>}
    </div><div className="cover-result"><div className="cover-candidate">{resultImage ? <img src={resultImage} alt="Seedream 生成的候选封面"/> : <><ImagePlus size={36}/><b>{running ? '正在生成封面并检查角标…' : '封面预览将在这里出现'}</b><p>{nurture ? (project?.imageData ? '将参考已上传的场景图片' : '将根据发布主题与主要场景生成画面') : (project?.imageData ? '将参考已上传的产品图片' : '尚未上传产品图，将按文字要求生成。建议先上传真实产品图。')}</p></>}</div>{saved?.error && <p className="info-box" role="status">{saved.error}</p>}
      {resultImage && <ImageWatermarkReview image={resultImage} check={saved?.watermarkCheck} requested={saved?.watermarkRequested} label="候选封面"/>}
      {saved?.phase === 'ready' && <>{saved.assetRevision !== asset.revision && <p className="info-box" role="status">文案或成品版本已变化，这张候选图无法直接采用。请核对最新要求后重新生成。</p>}<label className="checkbox-row cover-image-approval"><input type="checkbox" checked={imageApproved} disabled={busy || saved.assetRevision !== asset.revision} onChange={event => setApprovedImage(event.target.checked ? approvalSignature : '')}/><span>{nurture ? "我已核对场景、主体、标题、画面文字及角标，确认可以采用。" : "我已核对这张封面的产品外观、标题、画面文字及角标，确认可以采用。"}</span></label><button className="button primary full" disabled={busy || !imageApproved || saved.assetRevision !== asset.revision} onClick={() => void run(async () => { await mutate(`/projects/${project!.id}/assets/${asset.id}/cover-apply`, 'POST', { id: saved.id, expectedRevision: asset.revision, confirmed: true }); notify('AI 封面已采用，可从内容卡片导出；旧成品已保留为历史版本'); })}><Check size={16}/>确认采用为封面</button></>}
      {saved && <details className="cover-prompt"><summary>查看本次生成记录</summary><p className="small-note">{saved.model} · {saved.size} · 规范 {saved.promptVersion}</p><p className="small-note">可见水印：{saved.watermarkRequested === true ? '本次已请求添加' : saved.watermarkRequested === false ? '本次已请求不添加' : '旧任务未记录，请查看原图'}</p><pre>{saved.prompt}</pre><CopyReviewNote review={saved.copyReview}/>{saved.corpusReferences?.length ? <RetrievalResults results={saved.corpusReferences}/> : null}</details>}
    </div></div>
    <p className="small-note">{nurture ? "将发送本份内容的主题、场景、写作要求、相关语料和场景参考图。" : "将发送已确认的项目资料、相关语料和产品参考图。"}{redfox ? "本次使用 Redfox · Seedream 5.0 Pro，每张目录参考 ¥1，实际折扣和费用以 Redfox 账单为准。" : `本次使用火山方舟，每张预留 $${cost?.toFixed(2) || '—'}，实际费用以服务商账单为准。`}{IS_WEB ? '请保持网页打开直到结果保存。' : '生成期间请保持应用运行，可关闭此弹窗。'}采用前不会覆盖现有成品。</p>
    {saved?.phase === 'uncertain' && <div className="info-box cover-reset"><label className="checkbox-row"><input type="checkbox" checked={reset} disabled={busy} onChange={e => setReset(e.target.checked)}/>已在{saved.provider === 'redfox' ? ' Redfox ' : '火山方舟'}核对旧请求，允许重新生成并单独计费</label><button type="button" className="button small" disabled={busy || !reset} onClick={() => void run(async () => { await mutate(`/projects/${project!.id}/assets/${asset.id}/cover-reset`, 'POST', { id: saved.id, confirmed: true }); setReset(false); })}>解除旧请求锁定</button></div>}
    <div className="modal-actions"><button type="button" className="button" onClick={onClose}>收起窗口</button>{(running || saved?.provider === 'redfox' && !!saved.taskId && saved.phase === 'uncertain') && <button type="button" className="button" disabled={busy} onClick={() => void run(async () => { if (saved?.provider === 'redfox') await mutate(`/projects/${project!.id}/assets/${asset.id}/cover-status`); else await refresh(); })}><RefreshCw size={15}/>查询已提交任务</button>}<button type="button" className="button primary" disabled={!configured || locked || !recipe || saved?.phase === 'uncertain'} onClick={() => void run(async () => { setApprovedImage(''); await mutate(`/projects/${project!.id}/assets/${asset.id}/cover`, 'POST', { ...input, watermark, expectedRevision: asset.revision, confirmed: true }); notify('封面请求已提交，请等待并检查候选图'); })}><ImagePlus size={16}/>{running ? '正在生成…' : '确认并生成封面'}</button></div>
  </Modal>;
}
