import { canGenerate, stageProvider, providerLabel } from '../model-provider';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { InputAssist, PromptGuide } from '../components/InputAssist';
import { Modal, Field } from '../components';
import { useStudio } from '../context';
import type { Stage } from '../types';
import { WorkflowSkillSummary } from './CreativeSkills';
import { CreationAccountPicker } from './AccountCreation';
import { contentProjectForAsset } from '../../server/content-workflow.mjs';
import { resolveAccountCreation } from '../../server/account-creation.mjs';
import type { SkillWorkflowId } from '../../server/skill-workflows.mjs';
import { ContentKnowledgePreview } from '../components/ContentKnowledgePreview';

export function AIAction({ stage, title, description, path, body = {}, onDone, onResult, instruction = false, disabled = false, compact = false, modelOverride }: { stage: Stage; title: string; description: string; path: string; body?: object; onDone?: () => void; onResult?: (result: unknown) => void; instruction?: boolean; disabled?: boolean; compact?: boolean; modelOverride?: string }) {
  const { state, project, settings, mutate, runBackground, busy, notify, go, agentInput: workspaceInput } = useStudio();
  const [open, setOpen] = useState(false), [text, setText] = useState('');
  const [error, setError] = useState('');
  const reviewOnly = stage === 'copy' && (body as { reviewOnly?: boolean }).reviewOnly === true;
  const isCopy = stage === 'copy' && !reviewOnly;
  const assetId = path.match(/\/assets\/([^/]+)\/copy(?:$|\?)/)?.[1];
  const platform = project?.assets.find(asset => asset.id === assetId)?.channel;
  const copyAsset = project?.assets.find(asset => asset.id === assetId);
  const copyBrief = project?.strategies.find(strategy => strategy.id === copyAsset?.strategyId)?.briefSnapshot || project?.brief;
  const nurture = isCopy && copyBrief?.type === 'nurture' ? copyBrief.nurture : undefined;
  const workflowId = reviewOnly ? 'word-review' : isCopy ? 'copy-' + (platform || 'xiaohongshu') : stage;
  const concise = compact || !!copyAsset?.contentBrief;
  let accountError = '', creation: ReturnType<typeof resolveAccountCreation> | undefined;
  if (copyAsset && project && !reviewOnly) {
    try { creation = resolveAccountCreation(state, contentProjectForAsset(project, copyAsset), platform, workflowId as SkillWorkflowId); }
    catch (error) { accountError = error instanceof Error ? error.message : '本篇创作账号暂不可用'; }
  }
  const boundAccount = creation?.accountContext?.accounts.find(account => account.platform === platform);
  const packet = copyAsset?.agentPacket;
  const packetInput = packet ? { ...Object.fromEntries(Object.entries(packet).filter(([key]) => ['platform', 'accountId', 'model', 'knowledgeIds', 'experienceIds', 'referenceIds', 'skillIds', 'publishingNotes', 'idea'].includes(key))), knowledgeIds: copyAsset?.contentBrief?.knowledgeIds || packet.knowledgeIds } : undefined;
  const bodyInput = (body as { agentInput?: typeof workspaceInput }).agentInput;
  const agentInput = !reviewOnly && ['copy', 'strategy', 'planning', 'analysis'].includes(stage) && (packetInput || workspaceInput || bodyInput) ? { ...packetInput, ...workspaceInput, ...bodyInput, ...(modelOverride ? { model: modelOverride } : {}) } : undefined;
  const requestedModel = modelOverride || agentInput?.model;
  const model = typeof requestedModel === 'string' && settings.models[requestedModel] ? requestedModel : settings.routes[stage], rate = settings.models[model];
  const effectiveSettings = { ...settings, routes: { ...settings.routes, [stage]: model } };
  function manageSkills() {
    try { sessionStorage.setItem('studio-settings-section', 'skills'); } catch { /* optional navigation preference */ }
    setOpen(false); go('settings');
  }
  return <><button type="button" className="button small" disabled={busy || disabled} onClick={() => setOpen(true)}><Sparkles size={15}/>{title}</button>{open && <Modal title={title} description={description} onClose={() => { if (!busy) setOpen(false); }}>
    {concise ? <>{boundAccount && <p className="info-box"><b>本篇账号：{boundAccount.accountName}</b> · 身份 R{boundAccount.profileRevision} · {boundAccount.presetName || '默认方案'}</p>}{copyAsset?.contentBrief?.requirement && <details><summary>本篇创作需求</summary><p className="preserve-lines">{copyAsset.contentBrief.requirement}</p></details>}{accountError && <p className="error-text" role="alert">{accountError}</p>}</> : nurture ? <div className="info-box"><b>{nurture.topic}</b><p>{nurture.scene}</p><details><summary>本份图文使用的文案 Prompt</summary><p className="preserve-lines">{nurture.copyPrompt}</p></details></div> : <PromptGuide stage={stage} platform={platform} reviewOnly={reviewOnly} reviewMode={(body as { reviewMode?: string }).reviewMode}/>}
    {concise && isCopy && !copyAsset?.contentBrief && <details className="content-fold" open={!!accountError}><summary>核对旧内容的创作账号</summary><CreationAccountPicker platform={platform} disabled={busy}/></details>}
    <div className="setting-row"><span>本次模型</span><b>{rate.label}</b></div>
    <p className="muted">输入 ${rate.inputPrice} / 输出 ${rate.outputPrice} 每百万 token。调用前检查项目预算，失败不替换原内容。{rate.priceNote}</p>
    <div className="info-box">本步骤的规则和必要项目资料或评论会发送到 {providerLabel(stageProvider(effectiveSettings, stage))}。结果需人工检查，费用按实际 API 用量结算。</div>
    {concise ? <details className="content-fold"><summary>本次写作规则与身份</summary><p>默认规则{creation?.creativeSkill ? ' + ' + creation.creativeSkill.name + ' · v' + creation.creativeSkill.version : ''}</p>{boundAccount && <pre>{boundAccount.identityMarkdown || '未填写额外身份记忆'}</pre>}<button type="button" className="text-button" onClick={manageSkills}>管理默认规则</button></details> : <>{(isCopy || stage === 'strategy' || stage === 'planning') && <CreationAccountPicker platform={platform} disabled={busy}/>}<WorkflowSkillSummary platform={platform} workflowId={workflowId} disabled={busy} onManage={manageSkills}/></>}
    {isCopy && !concise && <p className="muted"><strong>自然表达润色已启用。</strong>本次生成会同时检查空话、重复和机械句式，保留价格与使用条件，不额外发起一次模型请求。可在语料库把范文标为“文风样本”，提炼并采纳后用于表达参考。</p>}
    {instruction && <><Field label="本次补充要求（可选）"><textarea disabled={busy} rows={3} maxLength={2000} value={text} onChange={e => setText(e.target.value)}/></Field>{!nurture && !concise && <InputAssist kind="copy" value={text} onChange={setText} maxLength={2000} project={project}/>}</>}
    {copyAsset && !reviewOnly && <ContentKnowledgePreview asset={copyAsset} query={text}/>}
    {error && <p className="error-text" role="alert">{error}。本次输入已保留，可以修改后重试。</p>}
    <div className="modal-actions"><button className="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>{canGenerate(effectiveSettings, stage) ? <button className="button primary" disabled={busy || !!accountError} onClick={() => void runBackground(title, async control => {
      setError('');
      try {
        await control.checkpoint('准备生成', { assetId, model, instruction: text });
        const response = await mutate(path, 'POST', { ...body, ...(agentInput ? { agentInput } : {}), ...(requestedModel ? { modelOverride: model } : {}), ...(instruction ? { instruction: text } : {}) });
        await control.checkpoint('生成已保存，待人工核对', { assetId, model });
        onResult?.(response.result); setOpen(false); notify('AI 处理完成，请检查结果'); onDone?.();
      } catch (failure) { setError(failure instanceof Error ? failure.message : '本次生成未完成'); throw failure; }
    })}>{busy ? '处理中…' : '确认费用并生成'}</button> : <button className="button primary" onClick={() => go('settings')}>前往配置 API</button>}</div>
  </Modal>}</>;
}
