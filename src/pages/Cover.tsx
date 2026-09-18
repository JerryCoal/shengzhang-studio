import { useState } from 'react';
import { Check, ImagePlus, RefreshCw } from 'lucide-react';
import { useStudio } from '../context';
import { Field, Modal, Pill } from '../components';
import { InputAssist, PromptGuide } from '../components/InputAssist';
import { useIntegrations } from './Integrations';
import { mediaPrompt, COVER_STYLES, COVER_LAYOUTS } from '../../server/prompts.mjs';
import { CopyReviewNote, RetrievalResults } from './Corpus';
import type { Asset, CoverInput } from '../types';
import { IS_STATIC, IS_WEB } from '../api';

const labels = { generating: '封面生成中', ready: '封面待确认', applied: '查看 AI 封面', failed: '封面未完成', uncertain: '核对封面任务', stale: '封面版本已变化' };
export function CoverButton({ asset }: { asset: Asset }) {
  const [open, setOpen] = useState(false); const { busy } = useStudio();
  return <><button type="button" className="button primary small" disabled={busy} onClick={() => setOpen(true)}><ImagePlus size={15}/>{asset.aiCover ? labels[asset.aiCover.phase] : 'AI 封面 · Seedream'}</button>{open && <CoverDialog assetId={asset.id} onClose={() => setOpen(false)}/>}</>;
}
function CoverDialog({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { state, project, busy, run, mutate, notify, go, refresh } = useStudio(); const { value, error } = useIntegrations();
  const asset = project!.assets.find(a => a.id === assetId)!, saved = asset.aiCover;
  const [input, setInput] = useState<CoverInput>(saved?.input || { prompt: '突出真实产品和使用场景，背景简洁，画面有清晰主次。', query: '', style: 'natural', layout: 'top', textMode: 'title' });
  const [reset, setReset] = useState(false);
  const set = <K extends keyof CoverInput>(key: K, v: CoverInput[K]) => setInput(previous => ({ ...previous, [key]: v }));
  const recipe = mediaPrompt(project!, asset, { ...input, purpose: 'cover' }, state.contentRules);
  const running = saved?.phase === 'generating', locked = busy || running;
  const configured = !IS_STATIC && value?.local && value.seedream.configured;
  const cost = value ? Math.max(value.seedream.reservationUsd, value.seedream.imagePriceUsd) : null;
  const resultImage = saved?.mediaData || (saved?.phase === 'applied' && saved.appliedRevision === asset.revision ? asset.mediaData : '');
  return <Modal title="生成小红书 AI 封面" description="Seedream · 单张 3:4 静态封面 · 预览满意后再采用" onClose={() => { if (!busy) onClose(); }} wide>
    <PromptGuide stage="cover"/>
    <div className="production-summary"><Pill color={running ? 'amber' : saved?.phase === 'ready' ? 'green' : 'gray'}>{saved ? labels[saved.phase] : '准备封面'}</Pill><span>1728 × 2304 · 3:4</span><span>{value?.seedream.model || '正在读取配置…'}</span></div>
    {!configured && <div className="info-box"><span>{error || '请先在连接与设置中填写 Seedream 密钥并开通对应模型。封面不需要 Seedance 或 OpenAI 密钥。'}</span><button className="button small" disabled={busy} onClick={() => { onClose(); go('settings'); }}>前往设置</button></div>}
    <div className="cover-editor-grid"><div>
      <div className="service-fields"><Field label="封面风格"><select disabled={locked} value={input.style} onChange={e => set('style', e.target.value as CoverInput['style'])}>{Object.entries(COVER_STYLES).map(([key, label]) => <option key={key} value={key}>{label.split('，')[0]}</option>)}</select></Field><Field label="封面构图"><select disabled={locked} value={input.layout} onChange={e => set('layout', e.target.value as CoverInput['layout'])}>{Object.entries(COVER_LAYOUTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
      <Field label="画面文字"><select disabled={locked} value={input.textMode} onChange={e => set('textMode', e.target.value as CoverInput['textMode'])}><option value="title">使用当前文案标题</option><option value="none">纯画面，不增加文字</option></select></Field>
      <Field label="补充画面要求" hint="描述主体、场景、光线和构图；不用填写视频运镜。"><textarea rows={4} maxLength={1200} value={input.prompt} disabled={locked} onChange={e => set('prompt', e.target.value)}/></Field><InputAssist kind="cover" value={input.prompt} onChange={v => set('prompt', v)} maxLength={1200} project={project} disabled={locked}/>
      <Field label="语料检索关键词" hint="留空时根据产品、标题和画面要求检索；最多带入 3 段，保留出处。"><input maxLength={500} value={input.query} disabled={locked} onChange={e => set('query', e.target.value)} placeholder="例如：产品外观、包装、使用场景"/></Field><InputAssist kind="query" value={input.query} onChange={v => set('query', v)} maxLength={500} disabled={locked}/>
      <details className="cover-prompt"><summary>查看将发送的提示词与资料</summary><pre>{recipe.prompt}</pre><CopyReviewNote review={recipe.copyReview}/>{recipe.corpusReferences?.length ? <RetrievalResults results={recipe.corpusReferences}/> : <p className="small-note">没有匹配语料，将使用已确认的品牌与策略资料。</p>}</details>
    </div><div className="cover-result"><div className="cover-candidate">{resultImage ? <img src={resultImage} alt="Seedream 生成的候选封面"/> : <><ImagePlus size={36}/><b>{running ? 'Seedream 正在绘制封面…' : '封面预览将在这里出现'}</b><p>{project?.imageData ? '将参考已上传的产品图片' : '尚未上传产品图，将按文字要求生成。建议先上传真实产品图。'}</p></>}</div>{saved?.error && <p className="info-box" role="status">{saved.error}</p>}
      {saved?.phase === 'ready' && <>{saved.assetRevision !== asset.revision && <p className="info-box" role="status">文案或成品版本已变化，这张候选图无法直接采用。请核对最新要求后重新生成。</p>}<p className="small-note">请检查产品外观、标题和画面文字。图片中的文字需要人工核对，文字词库无法代替图像检查。</p><button className="button primary full" disabled={busy || saved.assetRevision !== asset.revision} onClick={() => void run(async () => { await mutate(`/projects/${project!.id}/assets/${asset.id}/cover-apply`, 'POST', { id: saved.id, expectedRevision: asset.revision, confirmed: true }); notify('AI 封面已采用，可从内容卡片导出；旧成品已保留为历史版本'); })}><Check size={16}/>确认采用为封面</button></>}
      {saved && <details className="cover-prompt"><summary>查看本次生成记录</summary><p className="small-note">{saved.model} · {saved.size} · 规范 {saved.promptVersion}</p><pre>{saved.prompt}</pre><CopyReviewNote review={saved.copyReview}/>{saved.corpusReferences?.length ? <RetrievalResults results={saved.corpusReferences}/> : null}</details>}
    </div></div>
    <p className="small-note">将发送已确认的项目资料、相关语料和产品参考图至火山方舟。每次生成一张封面，预留 ${cost?.toFixed(2) || '—'}，实际费用以服务商账单为准。{IS_WEB ? '请保持网页打开直到结果保存。' : '生成期间请保持应用运行，可关闭此弹窗。'}采用前不会覆盖现有成品。</p>
    {saved?.phase === 'uncertain' && <div className="info-box cover-reset"><label className="checkbox-row"><input type="checkbox" checked={reset} disabled={busy} onChange={e => setReset(e.target.checked)}/>已在火山方舟核对旧请求，允许重新生成并单独计费</label><button type="button" className="button small" disabled={busy || !reset} onClick={() => void run(async () => { await mutate(`/projects/${project!.id}/assets/${asset.id}/cover-reset`, 'POST', { id: saved.id, confirmed: true }); setReset(false); })}>解除旧请求锁定</button></div>}
    <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>关闭</button>{running && <button type="button" className="button" disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={15}/>刷新状态</button>}<button type="button" className="button primary" disabled={!configured || locked || saved?.phase === 'uncertain'} onClick={() => void run(async () => { await mutate(`/projects/${project!.id}/assets/${asset.id}/cover`, 'POST', { ...input, expectedRevision: asset.revision, confirmed: true }); notify('封面请求已提交，请等待并检查候选图'); })}><ImagePlus size={16}/>{running ? '正在生成…' : '确认并生成封面'}</button></div>
  </Modal>;
}
