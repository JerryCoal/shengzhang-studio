import { useRef, useState } from 'react';
import { useStudio } from '../context';
import { Field, Modal } from '../components';
import type { Asset, Page } from '../types';
const pages: Record<string, Page> = { xiaohongshu: 'xiaohongshu-agent', douyin: 'douyin-agent', instagram: 'instagram-agent', youtube: 'youtube-agent', tiktok: 'studio' };
export function RetargetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { state, project, settings, busy, mutate, run, go, notify } = useStudio();
  const [accountId, setAccountId] = useState(''), [requirement, setRequirement] = useState(asset.contentBrief?.requirement || `围绕《${asset.title}》为目标账号重新创作，沿用项目已核实事实，调整文风、内容形式和受众，不照搬其他账号的个人经历。`), [kind, setKind] = useState(asset.kind), [error, setError] = useState('');
  const request = useRef({ key: '', id: crypto.randomUUID() });
  const account = state.accounts.find(item => item.id === accountId);
  if (!project) return null;
  return <Modal title="改投或增加平台 / 账号" description="为新目标建立独立的改编草稿，回到相应 Agent 调整并检查。原作品与发布记录保留，不会直接重复投稿。" onClose={onClose}>
    <Field label="新的目标账号"><select value={accountId} onChange={e => { setAccountId(e.target.value); if (state.accounts.find(a => a.id === e.target.value)?.platform === 'youtube') setKind('video'); }}><option value="">选择目标平台账号</option>{state.accounts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.platform}</option>)}</select></Field>
    <Field label="内容形式"><select value={kind} onChange={e => setKind(e.target.value as 'image' | 'video')}><option value="image" disabled={account?.platform === 'youtube'}>图文</option><option value="video">视频</option></select></Field>
    <Field label="改编要求"><textarea rows={5} maxLength={4000} value={requirement} onChange={e => setRequirement(e.target.value)}/></Field>
    <p className="small-note">此草稿仅带入上面的要求与原作品标题。账号经验、Skills 和素材需在新 Agent 中重新选用，避免把不同账号的身份和定位混用。</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="modal-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !account || !requirement.trim()} onClick={() => void run(async () => {
      if (!account) return;
      const input = { fromAgent: asset.channel, accountId, platform: account.platform, kind, requirement, model: settings.routes.copy, idea: { title: asset.title, core: '按新目标账号重新创作', direction: requirement, prompt: '参考原选题，不复制未经目标账号确认的个人经历或效果。' } };
      const key = JSON.stringify(input); if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
      try { const response = await mutate<Asset>(`/projects/${project.id}/agent-handoffs`, 'POST', { ...input, requestId: request.current.id }); onClose(); notify('已建立独立改编草稿，请核对新账号'); go(pages[account.platform], project.id, { assetId: response.result.id, accountId }); }
      catch (failure) { setError(failure instanceof Error ? failure.message : '交接未完成，输入已保留'); }
    })}>建立改编草稿</button></div>
  </Modal>;
}
