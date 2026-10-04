import { useState } from 'react';
import { Check, Link2, MessageSquareText, RefreshCw } from 'lucide-react';
import { useStudio } from '../context';
import { date, Field, Modal } from '../components';
import type { Publication } from '../types';
import { IS_WEB } from '../api';
import { DouyinVideoPicker } from './DouyinVideos';
const runtimeHint = IS_WEB ? '请保持原工作区页面打开并联网，浏览器关闭或休眠会暂停任务。' : '请保持电脑唤醒、联网且工作区已登录。关闭窗口可保留托盘后台，完全退出会停止任务。';

export function publicationStatusLabel(record: Publication) {
  if (record.status === 'published') return record.sample ? '示例作品' : record.confirmationSource === 'douyin-api' ? '已发布 · 平台核对' : '已发布 · 用户确认';
  if (record.status === 'cancelled') return '已取消';
  if (record.manualReviewRequired) return '旧版任务 · 请先核对平台';
  return record.status === 'exported' ? '已导出 · 待手动发布' : '待导出 / 手动发布';
}
export function PlatformActions({ record }: { record: Publication }) {
  const { project, state, settings, run, mutate, busy } = useStudio();
  const [link, setLink] = useState(false);
  if (record.platform !== 'douyin' || record.sample || record.status === 'cancelled') return null;
  const connected = state.accounts.find(a => a.id === record.accountId)?.connected;
  return <div className="platform-actions">
    {record.manualPublishNote && record.status !== 'published' && <p className="small-note">{record.manualPublishNote}</p>}
    {connected && settings.credential.local && <div className="row gap-8 wrap">
      {record.manualReviewRequired && record.automation?.itemId && <button className="button small" disabled={busy} onClick={() => void run(async () => { await mutate('/projects/'+project!.id+'/publications/'+record.id+'/platform-status'); })}><RefreshCw size={14}/>核对旧版作品状态</button>}
      {!record.platformItemId && <button className="button small" disabled={busy} onClick={() => setLink(true)}><Link2 size={14}/>关联已发布作品以同步评论</button>}
    </div>}
    {link && <LinkPlatformItem record={record} onClose={() => setLink(false)}/>}
  </div>;
}
function LinkPlatformItem({ record, onClose }: { record: Publication; onClose: () => void }) {
  const { project, run, mutate, busy, notify } = useStudio(); const [itemId, setItemId] = useState(''), [confirmed, setConfirmed] = useState(false);
  return <Modal title="关联平台中已有的作品" description="查询授权账号中的公开作品，核对成功后可同步评论；不会重新发视频。" onClose={onClose}><DouyinVideoPicker accountId={record.accountId} selected={itemId} onSelect={value => { setItemId(value); setConfirmed(false); }}/><Field label="平台返回的 item_id（也可手动填写）" hint="使用开放平台返回的完整作品编号，通常为加密字符串，和分享链接中的数字不一定相同。"><input value={itemId} onChange={e => { setItemId(e.target.value); setConfirmed(false); }} maxLength={512}/></Field><label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>我已在抖音确认，此编号对应当前账号的这条作品。</span></label><div className="modal-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !confirmed || !itemId.trim()} onClick={() => void run(async () => { await mutate(`/projects/${project!.id}/publications/${record.id}/platform-item`, 'POST', { itemId, confirmed }); notify('已从抖音核对作品，可开始同步评论'); onClose(); })}><Check size={16}/>查询并关联</button></div></Modal>;
}
export function CommentSyncPanel() {
  const { project, settings, mutate, run, busy, go, notify } = useStudio();
  const [link, setLink] = useState<Publication | null>(null);
  const publications = project!.publications.filter(p => p.platform === 'douyin' && p.status === 'published' && !p.sample);
  return <section className="panel comment-sync-panel"><div className="section-heading"><div><h3><MessageSquareText size={19}/>评论同步 · 可选</h3><p className="muted">需要已有的接口权限及账号授权；普通账号可直接使用下方“导入评论”，不影响手动发布。</p></div><button className="button small" onClick={() => go('settings')}>开通指引与账号授权</button></div>
    {publications.length ? publications.map(pub => <div className="sync-record" key={pub.id}><div><b>{pub.title}</b><small>{pub.platformItemId ? `上次同步：${pub.commentSync?.lastSyncAt ? date(pub.commentSync.lastSyncAt, true) : '尚未同步'}${pub.commentSync?.partial ? ' · 分页采集中' : ''}` : '需要先关联平台作品编号'}</small>{pub.commentSync?.lastSyncAt && <small>本轮新增 {pub.commentSync.lastAdded || 0} 条 · 更新互动数据 {pub.commentSync.lastUpdated || 0} 条{pub.commentSync.enabled ? ` · 下次：${pub.commentSync.nextSyncAt ? new Date(pub.commentSync.nextSyncAt).toLocaleTimeString('zh-CN') : '等待检查'}` : ' · 自动同步已暂停'}</small>}{pub.commentSync?.error && <small className="error-text">{pub.commentSync.error}</small>}</div>{pub.platformItemId ? <div className="row gap-10 wrap"><label className="checkbox-row"><input type="checkbox" checked={!!pub.commentSync?.enabled} disabled={busy || !settings.credential.local} onChange={e => { const enabled = e.target.checked; void run(async () => { await mutate(`/projects/${project!.id}/publications/${pub.id}/comments-sync`, 'PUT', { enabled, intervalMinutes: pub.commentSync?.intervalMinutes || 15 }); notify(enabled ? '自动同步已开启，将按所选频率检查' : '自动同步已关闭'); }); }}/><span>自动同步</span></label><select className="sync-frequency" aria-label={`${pub.title}的同步频率`} value={pub.commentSync?.intervalMinutes || 15} disabled={busy || !settings.credential.local} onChange={e => { const intervalMinutes = Number(e.target.value); void run(async () => { await mutate(`/projects/${project!.id}/publications/${pub.id}/comments-sync`, 'PUT', { enabled: !!pub.commentSync?.enabled, intervalMinutes }); notify('同步频率已保存'); }); }}>{[5, 15, 30, 60].map(n => <option value={n} key={n}>每 {n} 分钟</option>)}</select><button className="button small" disabled={busy || !settings.credential.local} onClick={() => void run(async () => { const result = await mutate<{ added: number; partial: boolean }>(`/projects/${project!.id}/publications/${pub.id}/comments-sync`); notify(`新增 ${result.result.added} 条评论${result.result.partial ? '，还有后续分页待同步' : ''}`); })}><RefreshCw size={14}/>立即同步</button></div> : <button className="button small" disabled={busy || !settings.credential.local} onClick={() => setLink(pub)}>关联作品</button>}</div>) : <p className="small-note">先手动发布并登记作品链接。已有接口权限时，可关联作品开启评论同步；否则使用评论导入。</p>}
    <p className="small-note">{runtimeHint} 每页最多 20 条，每轮最多 200 条；更多分页将续采，重新扫描时按评论 ID 去重。接口可见范围受平台限制，暂不采集评论下的回复。</p>
    {link && <LinkPlatformItem record={link} onClose={() => setLink(null)}/>}
  </section>;
}
