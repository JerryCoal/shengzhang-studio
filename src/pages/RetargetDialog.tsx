import { useRef, useState } from 'react';
import { useStudio } from '../context';
import { Field, Modal } from '../components';
import type { Asset, Page } from '../types';
import { PLATFORM_NAMES } from '../../server/platform-catalog.mjs';
const pages: Record<string, Page> = { xiaohongshu: 'xiaohongshu-agent', douyin: 'douyin-agent', instagram: 'instagram-agent', youtube: 'youtube-agent', tiktok: 'studio' };
export function RetargetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { state, project, settings, busy, mutate, run, go, notify } = useStudio();
  const [accountIds, setAccountIds] = useState<string[]>([]), [requirement, setRequirement] = useState(asset.contentBrief?.requirement || `围绕《${asset.title}》为目标账号重新创作，沿用项目已核实事实，调整文风、内容形式和受众，不照搬其他账号的个人经历。`), [kind, setKind] = useState(asset.kind), [error, setError] = useState('');
  const requests = useRef(new Map<string, string>());
  const [created, setCreated] = useState<{ accountId: string; assetId: string; projectId: string; page: Page; name: string }[]>([]);
  const accounts = state.accounts.filter(item => accountIds.includes(item.id));
  if (!project) return null;
  return <Modal title="改投或增加多个平台 / 账号" description="可同时勾选多个目标，各自建立独立改编草稿。完成并检查后，在发布中心多选提交；此步骤不直接投稿。" onClose={() => { if (!busy) onClose(); }}>
    <fieldset className="retarget-accounts"><legend>目标平台与账号（最多 20 个）</legend>{state.accounts.map(item => <label key={item.id} className="checkbox-row"><input type="checkbox" checked={accountIds.includes(item.id)} disabled={busy || !!created.length || !accountIds.includes(item.id) && accountIds.length >= 20} onChange={event => setAccountIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/><span>{item.name} · {PLATFORM_NAMES[item.platform]}</span></label>)}</fieldset>
    <Field label="内容形式" hint="YouTube 目标固定为视频，其余目标使用此选择。"><select disabled={busy || !!created.length} value={kind} onChange={e => setKind(e.target.value as 'image' | 'video')}><option value="image">图文</option><option value="video">视频</option></select></Field>
    <Field label="改编要求"><textarea disabled={busy || !!created.length} rows={5} maxLength={4000} value={requirement} onChange={e => setRequirement(e.target.value)}/></Field>
    <p className="small-note">此草稿仅带入上面的要求与原作品标题。账号经验、Skills 和素材需在新 Agent 中重新选用，避免把不同账号的身份和定位混用。</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    {created.length > 0 && <section className="info-box"><b>已建立 {created.length} 份独立草稿</b>{created.map(row => <p key={row.accountId}>{row.name}<button disabled={busy} className="text-button" onClick={() => { if (busy) return; onClose(); go(row.page, row.projectId, { assetId: row.assetId, accountId: row.accountId }); }}>进入对应 Agent 调整</button></p>)}</section>}
    <div className="modal-actions"><button className="button" disabled={busy} onClick={onClose}>{created.length ? '完成' : '取消'}</button><button className="button primary" disabled={busy || !accounts.length || !requirement.trim() || accounts.every(account => created.some(item => item.accountId === account.id))} onClick={() => void run(async () => {
      const session = sessionStorage.getItem('studio-session'), errors: string[] = []; let added = 0; setError('');
      for (const account of accounts.filter(account => !created.some(item => item.accountId === account.id))) {
        if (sessionStorage.getItem('studio-session') !== session) { errors.push('登录用户已变化，剩余目标未处理'); break; }
        const input = { fromAgent: asset.channel, accountId: account.id, platform: account.platform, kind: account.platform === 'youtube' ? 'video' : kind, requirement, model: settings.routes.copy, idea: { title: asset.title, core: '按新目标账号重新创作', direction: requirement, prompt: '参考原选题，不复制未经目标账号确认的个人经历或效果。' } };
        const key = JSON.stringify([project.id, input]); if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID());
        try { const response = await mutate<Asset>(`/projects/${project.id}/agent-handoffs`, 'POST', { ...input, requestId: requests.current.get(key) }); added++; setCreated(rows => [...rows, { accountId: account.id, assetId: response.result.id, projectId: project.id, page: pages[account.platform], name: `${account.name} · ${PLATFORM_NAMES[account.platform]}` }]); }
        catch (failure) { errors.push(`${account.name}：${failure instanceof Error ? failure.message : '交接未完成，输入已保留'}`); }
      }
      setError(errors.join('；')); if (added) notify(`已建立 ${added} 份独立改编草稿，请分别核对各账号`);
    })}>{created.length ? '仅重试未建立的目标' : `建立 ${accounts.length} 份改编草稿`}</button></div>
  </Modal>;
}
