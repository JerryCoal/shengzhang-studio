import { canGenerate, stageProvider, providerLabel } from '../model-provider';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { InputAssist, PromptGuide } from '../components/InputAssist';
import { Modal, Field } from '../components';
import { useStudio } from '../context';
import type { Stage } from '../types';
import { CreativeSkillSelector, validateCreativeSkillSelection } from './CreativeSkills';

export function AIAction({ stage, title, description, path, body = {}, onDone, onResult, instruction = false, disabled = false }: { stage: Stage; title: string; description: string; path: string; body?: object; onDone?: () => void; onResult?: (result: unknown) => void; instruction?: boolean; disabled?: boolean }) {
  const { project, settings, mutate, runBackground, busy, notify, go } = useStudio(); const [open, setOpen] = useState(false); const [text, setText] = useState('');
  const [skillId, setSkillId] = useState('');
  const [skillReady, setSkillReady] = useState(false);
  const usesCreativeSkill = stage === 'copy' && (body as { reviewOnly?: boolean }).reviewOnly !== true;
  const assetId = path.match(/\/assets\/([^/]+)\/copy(?:$|\?)/)?.[1];
  const platform = project?.assets.find(asset => asset.id === assetId)?.channel;
  const model = settings.routes[stage], rate = settings.models[model];
  return <><button type="button" className="button small" disabled={busy || disabled} onClick={() => { setSkillId(''); setSkillReady(false); setOpen(true); }}><Sparkles size={15}/>{title}</button>{open && <Modal title={title} description={description} onClose={() => { if (!busy) setOpen(false); }}><PromptGuide stage={stage}/><div className="setting-row"><span>本次模型</span><b>{rate.label}</b></div><p className="muted">输入 ${rate.inputPrice} / 输出 ${rate.outputPrice} 每百万 token。调用前检查项目预算，失败不替换原内容。{rate.priceNote}</p><div className="info-box">{usesCreativeSkill && !settings.browserStorage ? <>所选写作规则和本次所需资料会发给 {providerLabel(stageProvider(settings, stage))}；密钥只用于请求授权。</> : <>本次所需的项目资料或评论会发送到 {providerLabel(stageProvider(settings, stage))}。</>}结果需人工检查，费用按实际 API 用量结算。</div>{usesCreativeSkill && <p className="muted"><strong>自然表达润色已启用。</strong>本次生成会同时检查空话、重复和机械句式，保留价格与使用条件，不额外发起一次模型请求。可在语料库把范文标为“文风样本”，提炼并采纳后用于表达参考。</p>}{usesCreativeSkill && <CreativeSkillSelector builtinOnly={!!settings.browserStorage} platform={platform} value={skillId} onChange={setSkillId} onValidityChange={setSkillReady} disabled={busy} onManage={() => { try { sessionStorage.setItem('studio-settings-section', 'rules'); } catch { /* optional navigation preference */ } setOpen(false); go('settings'); }}/>} {instruction && <><Field label="希望怎样修改？"><textarea disabled={busy} rows={3} maxLength={2000} value={text} onChange={e => setText(e.target.value)}/></Field><InputAssist kind="copy" value={text} onChange={setText} maxLength={2000} project={project}/></>}<div className="modal-actions"><button className="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>{canGenerate(settings, stage) ? <button className="button primary" disabled={busy || (usesCreativeSkill && !skillReady)} onClick={() => void runBackground(title, async () => { const selectedSkillId = settings.browserStorage ? '' : skillId; if (usesCreativeSkill) await validateCreativeSkillSelection(selectedSkillId, platform); const response = await mutate(path, 'POST', { ...body, ...(instruction ? { instruction: text } : {}), ...(usesCreativeSkill ? { skillId: selectedSkillId } : {}) }); onResult?.(response.result); setOpen(false); notify('AI 处理完成，请检查结果'); onDone?.(); })}>{busy ? '处理中…' : '开始 AI 处理'}</button> : <button className="button primary" onClick={() => go('settings')}>前往配置 API</button>}</div></Modal>}</>;
}
