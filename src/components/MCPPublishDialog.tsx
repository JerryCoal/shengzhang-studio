import { useState } from 'react';
import { api } from '../api';
import { Channel, Field, Modal } from '../components';
import { useStudio } from '../context';
import { useMCPConnections } from '../pages/MCPConnections';
import type { Asset, Publication } from '../types';

export function MCPPublishDialog({ content, onClose }: { content: Asset | Publication; onClose: () => void }) {
  const { project, state, mutate, refresh } = useStudio();
  const { connections, error } = useMCPConnections();
  const platform = 'channel' in content ? content.channel : content.platform, connection = connections.find(c => c.platform === platform);
  const accounts = state.accounts.filter(a => a.platform === platform);
  const [accountId, setAccountId] = useState('accountId' in content ? content.accountId : accounts[0]?.id || '');
  const [recordId, setRecordId] = useState('accountId' in content ? content.id : '');
  const [title, setTitle] = useState(content.title), [body, setBody] = useState(content.body), [confirmed, setConfirmed] = useState(false), [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const record = project?.publications.find(r => r.id === recordId), locked = !!record?.delivery && record.delivery.phase !== 'reset';
  const supported = ['image/png','image/jpeg','video/mp4'].includes(content.mime), valid = title.trim() && [...title].length <= 20 && [...body].length <= 1000 && accountId && supported;
  async function submit() {
    if (!project || !confirmed) return;
    setWorking(true); setMessage('');
    try {
      let targetId = recordId;
      if (!targetId && 'channel' in content) {
        const old = project.publications.find(r => r.assetId === content.id && r.assetRevision === content.revision && r.accountId === accountId && r.status !== 'cancelled');
        if (old?.status === 'published') throw Error('此版本已经登记发布，请查看已有记录');
        targetId = old?.id || (await mutate<Publication>(`/projects/${project.id}/publications`, 'POST', { assetId: content.id, accountId, scheduledAt: new Date().toISOString() })).result.id;
        setRecordId(targetId);
      }
      const response = await api<{ result: { note: string } }>(`/projects/${project.id}/publications/${targetId}/mcp/publish`, 'POST', { confirmed: true, expectedRevision: 'assetRevision' in content ? content.assetRevision : content.revision, title, body });
      setMessage(response.result.note); setConfirmed(false);
    } catch (e) { setMessage(e instanceof Error ? e.message : '任务未完成，请核对平台结果'); }
    finally { try { await refresh(); } catch { setMessage('任务已结束，但刷新记录失败，请重新打开发布中心核对结果。'); } finally { setWorking(false); } }
  }
  return <Modal title="MCP 自动投送" description="仅提交本次选定内容。连接或发布结果不明时不会自动重试。" wide onClose={() => { if (!working) onClose(); }}>
    <div className="row gap-10 wrap"><Channel platform={platform}/><span>{connection?.mode === 'external' ? '外部小红书 MCP' : '内置官方页面 MCP'}</span></div>
    <Field label="关联账号" hint="工作台名称不等于平台实际登录账号，请在平台或 MCP 中确认。"><select value={accountId} disabled={working || !!recordId} onChange={e => setAccountId(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
    <div className="creator-draft-preview"><div className="creator-draft-media">{content.mime.startsWith('image/') ? <img src={content.mediaData} alt="本次投稿素材"/> : <video src={content.mediaData} controls preload="metadata"/>}</div><div><Field label={`标题 · ${[...title].length}/20`}><input disabled={working || locked} value={title} onChange={e => { setTitle(e.target.value); setConfirmed(false); }}/></Field><Field label={`正文 · ${[...body].length}/1000`}><textarea rows={8} disabled={working || locked} value={body} onChange={e => { setBody(e.target.value); setConfirmed(false); }}/></Field></div></div>
    {!supported && <p className="info-box">MCP 投送目前支持 PNG、JPG 和 MP4。WebP 可使用原有“打开发布助手”自动转换。</p>}
    {error && <p className="info-box">{error}</p>}
    <p className="small-note">{connection?.mode === 'external' ? '点击下方确认后，外部 MCP 将直接执行发布。请先核对该服务当前登录的账号。原始文案和本次素材会交给你配置的本机 MCP。' : '助手会自动寻找上传入口并填写文案，最后弹出确认框。登录、验证码和平台要求补充的选项需要你处理。'}</p>
    {locked ? <p className="info-box">这条内容已有提交记录。请返回发布中心核对回执并登记结果；确认未发布时可解锁重试。</p> : <label className="checkbox-row"><input type="checkbox" disabled={working} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对当前账号、标题、正文与素材，允许提交这一条内容。</label>}
    {message && <p className="info-box" role="status">{message}</p>}
    {working && <p role="status" className="info-box">正在执行，请在平台窗口完成登录或最终确认。内置助手可点击“返回工作台”结束；外部 MCP 需等待结果，请勿重复投送。</p>}
    <div className="modal-actions"><button className="button" disabled={working} onClick={onClose}>返回</button><button className="button primary" disabled={working || !valid || !confirmed || locked || !connection || connection.mode === 'builtin' && !connection.builtinAvailable} onClick={() => void submit()}>{working ? '投送进行中…' : '确认并开始投送'}</button></div>
  </Modal>;
}
