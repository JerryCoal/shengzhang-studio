import { useState } from 'react';
import { CopyKeywords } from '../components/CopyKeywords';
import { ArrowRight, CalendarDays, Check, CheckCheck, Download, ExternalLink, Info, Link2, MessageSquareText, Plus, X } from 'lucide-react';
import { useStudio } from '../context';
import { LOCAL_DATA } from '../api';
import type { Asset, Publication } from '../types';
import { Channel, date, Empty, Field, Modal, NeedProject, PageTitle, Pill } from '../components';
import { ExportDialog } from '../components/ExportDialog';
import { MCPPublishDialog } from '../components/MCPPublishDialog';
import { CreatorDraftDialog } from '../components/CreatorDraftDialog';
import { hasDesktopCreator } from '../desktop';
import { PublishingNotice } from '../components/PublishingNotice';
import { CREATOR_URLS } from '../../server/content-export.mjs';
import { PlatformActions, publicationStatusLabel } from './PlatformActions';
import { openPublishingSettings } from './SettingsPage';
import { FeishuPlanPanel, FeishuRecord } from './Feishu';
import '../workspace-polish.css';

// Manual record dialogs are kept separate from the platform links and export actions.
const localDatetime = () => { const d = new Date(Date.now() + 3600000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function ScheduleDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { project, state, mutate, run, busy, notify } = useStudio(); const accounts = state.accounts.filter(a => a.platform === asset.channel); const [accountId, setAccountId] = useState(accounts[0]?.id || ''); const [scheduledAt, setScheduledAt] = useState(localDatetime());
  return <Modal title="添加手动发布待办" description="保存待办时间和成品快照，之后由你在官方平台手动发布。" onClose={onClose}><form onSubmit={e => { e.preventDefault(); void run(async () => { await mutate(`/projects/${project!.id}/publications`, 'POST', { assetId: asset.id, accountId, scheduledAt: new Date(scheduledAt).toISOString() }); notify('手动发布待办已保存；到点不会自动上传'); onClose(); }); }}><div className="selected-content"><Channel platform={asset.channel}/><h3><CopyKeywords text={asset.title}/></h3><small>将保存成品 R{asset.revision} 的独立发布快照</small></div><Field label="发布账号"><select required value={accountId} onChange={e => setAccountId(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · 手动发布</option>)}</select></Field><Field label="计划手动发布时间" hint="仅记录待办时间，不会定时上传或自动发布。"><input type="datetime-local" required value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}/></Field><div className="info-box"><Info size={17}/><span>抖音和小红书均为手动发布，无需开放平台认证。导出素材后，前往官方创作中心上传；发布成功再回填链接。</span></div><div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy}><CalendarDays size={16}/>保存手动待办</button></div></form></Modal>;
}
function ConfirmPublish({ record, onClose }: { record: Publication; onClose: () => void }) {
  const { project, mutate, run, busy, notify } = useStudio(); const [url, setUrl] = useState(record.delivery?.url||''); const [confirmed, setConfirmed] = useState(false);
  return <Modal title="登记真实的发布结果" description="请先在平台确认作品已成功发布，再回填链接；保存此记录不会向平台投稿。" onClose={onClose}><form onSubmit={e => { e.preventDefault(); void run(async () => { await mutate(`/projects/${project!.id}/publications/${record.id}/confirm`, 'POST', { url, confirmed }); notify('发布结果已记录，可以开始导入这条作品的评论了'); onClose(); }); }}><div className="selected-content"><Channel platform={record.platform}/><h3><CopyKeywords text={record.title}/></h3></div><Field label="作品链接"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder={record.platform === 'xiaohongshu' ? 'https://www.xiaohongshu.com/explore/…' : 'https://www.douyin.com/video/…'}/></Field><label className="checkbox-row"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>我已在对应账号中检查，确认此作品发布成功。</span></label><div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !confirmed}><CheckCheck size={16}/>确认并记录</button></div></form></Modal>;
}

function EditPlanTime({ record, onClose }: { record: Publication; onClose: () => void }) {
  const { project, mutate, run, busy, notify } = useStudio();
  const [value, setValue] = useState(() => { const date = new Date(record.scheduledAt); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); });
  return <Modal title="修改发布计划时间" description="仅调整排期记录；开启飞书自动同步的项目会同步更新，不会自动发布内容。" onClose={onClose}><form onSubmit={e => { e.preventDefault(); void run(async () => { await mutate(`/projects/${project!.id}/publications/${record.id}`, 'PATCH', { scheduledAt: new Date(value).toISOString(), expectedScheduledAt: record.scheduledAt }); notify('计划时间已更新'); onClose(); }); }}><p>{record.title}</p><Field label="计划发布时间"><input type="datetime-local" required value={value} onChange={e => setValue(e.target.value)}/></Field><div className="modal-actions"><button className="button" type="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>保存时间</button></div></form></Modal>;
}


export function PublishPage() {
  const { project, go, run, mutate, busy, notify } = useStudio();
  const [schedule, setSchedule] = useState<Asset | null>(null), [confirm, setConfirm] = useState<Publication | null>(null);
  const [filter, setFilter] = useState('pending'), [cancel, setCancel] = useState<Publication | null>(null);
  const [exporting, setExporting] = useState<Asset | Publication | null>(null);
  const [drafting, setDrafting] = useState<Asset | Publication | null>(null);
  const [mcpContent, setMcpContent] = useState<Asset | Publication | null>(null);
  const [editingTime, setEditingTime] = useState<Publication | null>(null);
  if (!project) return <NeedProject/>;
  const p = project, ready = p.assets.filter(a => a.status === 'ready');
  const pending = p.publications.filter(r => ['scheduled', 'exported'].includes(r.status));
  const published = p.publications.filter(r => r.status === 'published');
  const records = (filter === 'pending' ? pending : filter === 'published' ? published : p.publications).slice().sort((a, b) => filter === 'pending' ? a.scheduledAt.localeCompare(b.scheduledAt) : b.scheduledAt.localeCompare(a.scheduledAt));
  return <div className="publish-workspace">
    <PageTitle eyebrow="READY TO SHARE" title="把好内容，带到读者面前。" subtitle="准备成品、亲自确认发布，再把评论带回下一次创作。"><button className="button" onClick={() => openPublishingSettings(go)}><Link2 size={16}/>管理账号</button><button className="button" onClick={() => go('analytics')}>运营数据 <ArrowRight size={15}/></button></PageTitle>
    <div className="publish-status-strip" aria-label="本项目发布概况"><button onClick={() => go('studio')}><span>待发布成品</span><b>{ready.length}</b><small>检查并导出</small></button><button onClick={() => setFilter('pending')}><span>待处理计划</span><b>{pending.length}</b><small>核对内容并登记</small></button><button onClick={() => setFilter('published')}><span>已登记发布</span><b>{published.length}</b><small>收集反馈与数据</small></button></div>
    <section className="panel publishing-overview" aria-label="确认发布流程">
      <div className="section-heading"><h2>发布只需三步</h2><Pill color="green">{LOCAL_DATA ? '素材导出' : '确认后投送'}</Pill></div>
      <ol className="publishing-steps"><li><span>01</span><div><h3>准备成品</h3><p>选择成品，用 MCP 投送、发布助手或素材导出。</p></div></li><li><span>02</span><div><h3>在平台发布</h3><p>自动上传与填写，核对后确认提交。</p></div></li><li><span>03</span><div><h3>登记结果</h3><p>保存平台回执，核对结果后收集评论。</p></div></li></ol>
      <div className="creator-shortcuts"><span>前往官方平台</span><a className="button small" href={CREATOR_URLS.xiaohongshu} target="_blank" rel="noreferrer">小红书创作中心 <ExternalLink size={14}/></a><a className="button small" href={CREATOR_URLS.douyin} target="_blank" rel="noreferrer">抖音创作中心 <ExternalLink size={14}/></a></div>
      {hasDesktopCreator()&&<button className="text-button" onClick={()=>void run(async()=>{await window.studioDesktop?.resetPlatformConnections();notify('平台登录已清理，下次打开可切换账号');})}>清理平台登录 / 切换账号</button>}<PublishingNotice/>
    </section>
    <section className="panel publish-ready"><div className="section-heading"><div><h2>待发布成品 <span className="count-bubble">{ready.length}</span></h2><p className="muted">连接 MCP 或打开桌面助手准备发布，也可导出素材；核对平台结果后登记链接。</p></div><button className="text-button green" onClick={() => go('studio')}>内容制作 <ArrowRight size={15}/></button></div>
      {ready.length ? <div className="publish-ready-list">{ready.map(a => <div className="ready-item" key={a.id}><div className="ready-thumb">{a.kind === 'image' ? <img src={a.mediaData} alt={a.title}/> : <video src={a.mediaData} muted playsInline preload="metadata"/>}</div><div className="ready-copy"><Channel platform={a.channel} compact/><h3><CopyKeywords text={a.title}/></h3><small className="muted">成品 R{a.revision}</small></div><div className="ready-actions">{!LOCAL_DATA && <button className="button primary small" disabled={busy} onClick={() => setMcpContent(a)}>MCP 投送</button>}{hasDesktopCreator()&&<button className="button primary small" disabled={busy} onClick={()=>setDrafting(a)}>打开发布助手</button>}<button className="button small" disabled={busy} onClick={() => setExporting(a)}><Download size={15}/>导出素材</button><button className="button small" disabled={busy} onClick={() => setSchedule(a)}><Plus size={14}/>添加待办</button></div></div>)}</div> : <Empty title="还没有完成的内容" text="先制作一张封面或短片，完成后就能在这里导出。"><button className="button primary" onClick={() => go('studio')}>前往内容制作 <ArrowRight size={15}/></button></Empty>}
    </section>
    <FeishuPlanPanel/>
    <section className="publish-records" aria-label="发布待办与记录"><div className="section-heading publish-plan-heading"><h2>待办与发布记录</h2><small className="muted">计划时间仅作记录</small></div>
      <div className="tabbar" aria-label="筛选发布记录">{[['pending', '待处理', pending.length], ['published', '已发布', published.length], ['all', '全部', p.publications.length]].map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(String(key))}>{label}<span className="record-count">{count}</span></button>)}</div>
      {records.length ? <div className="publication-list">{records.map(record => <article className="publication-card" key={record.id}><div className="publish-date"><CalendarDays size={18}/><b>{date(record.scheduledAt)}</b><small>{new Date(record.scheduledAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</small></div><div className="publication-main"><div className="row gap-8 wrap"><Channel platform={record.platform}/><span className="muted">{record.accountName}</span>{record.sample && <Pill color="gray">示例记录</Pill>}</div><h3>{record.title}</h3><div className="row gap-10 wrap"><Pill color={record.status === 'published' ? 'green' : record.status === 'cancelled' ? 'gray' : 'amber'}>{publicationStatusLabel(record)}</Pill><small className="muted">R{record.assetRevision}{record.status === 'scheduled' && new Date(record.scheduledAt) < new Date() ? ' · 已到计划时间' : ''}</small></div></div><div className="publication-actions">{['scheduled', 'exported'].includes(record.status) && <>{!LOCAL_DATA && <button className="button primary small" disabled={busy || !!record.delivery && record.delivery.phase !== 'reset'} onClick={() => setMcpContent(record)}>MCP 投送</button>}{!LOCAL_DATA && <button className="button small" disabled={busy} onClick={() => setEditingTime(record)}>修改时间</button>}{hasDesktopCreator()&&<button className="button small" disabled={busy} onClick={()=>setDrafting(record)}>打开发布助手</button>}<button className="button small" disabled={busy} onClick={() => setExporting(record)}><Download size={14}/>导出素材</button><button className="button primary small" disabled={busy} onClick={() => setConfirm(record)}><Check size={14}/>登记结果</button><button className="icon-button" aria-label={`取消发布计划 ${record.title}`} onClick={() => setCancel(record)}><X size={15}/></button></>}{record.status === 'published' && <>{record.url && <a className="button small" href={record.url} target="_blank" rel="noreferrer">查看作品 <ExternalLink size={14}/></a>}<button className="button small" onClick={() => go('comments', p.id)}><MessageSquareText size={14}/>收集评论</button></>}</div><PlatformActions record={record}/><FeishuRecord record={record}/></article>)}</div> : <div className="panel"><Empty title={filter === 'published' ? '还没有登记发布结果' : filter === 'all' ? '还没有发布记录' : '当前没有待处理的内容'} text={filter === 'published' ? '在平台发布成功后，打开对应待办，点击“登记结果”并粘贴作品链接。' : '在上方成品中添加待办，即可记录计划时间、发布账号和作品链接。'}/></div>}
    </section>
    {exporting && <ExportDialog content={exporting} projectId={p.id} onClose={() => setExporting(null)} onExported={async () => { const current = p.publications.find(r => r.id === exporting.id); if (current?.status === 'scheduled') await mutate('/projects/'+p.id+'/publications/'+exporting.id, 'PATCH', { status: 'exported' }); }}/>}
    {mcpContent && <MCPPublishDialog content={mcpContent} onClose={() => setMcpContent(null)}/>}
    {drafting && <CreatorDraftDialog content={drafting} onClose={()=>setDrafting(null)}/>}
    {editingTime && <EditPlanTime record={editingTime} onClose={() => setEditingTime(null)}/>}
    {schedule && <ScheduleDialog asset={schedule} onClose={() => setSchedule(null)}/>}{confirm && <ConfirmPublish record={confirm} onClose={() => setConfirm(null)}/>}
    {cancel && <Modal title="取消这条发布待办？" description="素材和历史记录会保留，之后可以重新安排。" onClose={() => setCancel(null)}><p>{cancel.title}</p><div className="modal-actions"><button className="button" onClick={() => setCancel(null)}>保留待办</button><button className="button danger" disabled={busy} onClick={() => void run(async () => { await mutate(`/projects/${p.id}/publications/${cancel.id}`, 'PATCH', { status: 'cancelled' }); setCancel(null); notify('发布待办已取消'); })}>取消这条待办</button></div></Modal>}
  </div>;
}
