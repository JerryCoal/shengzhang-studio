import { useEffect, useRef, useState } from 'react';
import { RetargetDialog } from './RetargetDialog';
import { useStudio } from '../context';
import { LOCAL_DATA } from '../api';
import type { Asset, Publication } from '../types';
import { Channel, date, Empty, Modal, NeedProject, PageTitle, Pill } from '../components';
import { assetPublishReadiness } from '../../server/publish-readiness.mjs';
import { assetAccountId, assetPublicationRecords, scopedPublications } from '../../server/workspace-view.mjs';
import { hasBuiltinPageAssistant } from '../../server/platform-catalog.mjs';
import { hasDesktopCreator } from '../desktop';
import { ExportDialog } from '../components/ExportDialog';
import { MCPPublishDialog } from '../components/MCPPublishDialog';
import { BatchPublishDialog } from '../components/BatchPublishDialog';
import { CreatorDraftDialog } from '../components/CreatorDraftDialog';
import { ScheduleDialog, ConfirmPublish, EditPlanTime } from './PublishPage';
import { PlatformActions, publicationStatusLabel } from './PlatformActions';
import { FeishuPlanPanel, FeishuRecord } from './Feishu';
import { openPublishingSettings } from './SettingsPage';

export function PublishWorkspace() {
  const { project, state, settings, target, accountScope, scope = { projectIds: project ? [project.id] : [], accountIds: accountScope ? [accountScope] : [] }, go, busy, run, mutate, notify } = useStudio();
  const [batchOpen, setBatchOpen] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [preparing, setPreparing] = useState<Asset | Publication | null>(null);
  const [exporting, setExporting] = useState<Asset | Publication | null>(null);
  const [mcp, setMcp] = useState<Asset | Publication | null>(null);
  const [desktop, setDesktop] = useState<Asset | Publication | null>(null);
  const [schedule, setSchedule] = useState<Asset | null>(null);
  const [confirm, setConfirm] = useState<Publication | null>(null);
  const [editing, setEditing] = useState<Publication | null>(null);
  const [cancel, setCancel] = useState<Publication | null>(null);
  const [retarget, setRetarget] = useState<Asset | null>(null), [syncOffer, setSyncOffer] = useState<string | null>(null);
  const observedRecords = useRef<{ projectId: string; ids: Set<string> }>({ projectId: '', ids: new Set() });
  useEffect(() => {
    if (!project) return;
    const previous = observedRecords.current;
    if (previous.projectId === project.id && !project.sample && !project.feishuPlan?.autoSync && state.feishu?.check?.ready && settings.team?.role !== 'editor') {
      const added = project.publications.find(record => !previous.ids.has(record.id) && !record.sample && !record.feishuSync);
      if (added) setSyncOffer(added.id);
    }
    observedRecords.current = { projectId: project.id, ids: new Set(project.publications.map(record => record.id)) };
  }, [project, state.feishu?.check?.ready, settings.team?.role]);
  useEffect(() => { if (target.assetId || target.publicationId) setFilter('all'); }, [target.assetId, target.publicationId]);
  if (!project) return <NeedProject/>;
  const p = project, canPublish = !settings.team || settings.team.role !== 'editor';
  const selectedRecord = p.publications.find(r => r.id === target.publicationId);
  const focusId = selectedRecord?.assetId || target.assetId;
  const assets = p.assets.filter(a => (!focusId || a.id === focusId) && (!scope.accountIds.length || scope.accountIds.includes(assetAccountId(a))));
  const ready = assets.filter(a => assetPublishReadiness(a).ready && !assetPublicationRecords(p, a, accountScope).length);
  const unfinished = assets.filter(a => !assetPublishReadiness(a).ready);
  const arranged = assets.filter(a => assetPublishReadiness(a).ready && assetPublicationRecords(p, a, accountScope).length);
  const records = scopedPublications(p, accountScope).filter(r => (!scope.accountIds.length || scope.accountIds.includes(r.accountId)) && (!target.publicationId || r.id === target.publicationId) && (!focusId || r.assetId === focusId) && (filter === 'all' || (filter === 'published' ? r.status === 'published' : ['scheduled', 'exported'].includes(r.status)))).slice().sort((a,b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const pub = preparing && 'platform' in preparing ? preparing : null;
  const asset = preparing && 'channel' in preparing ? preparing : null;
  const platform = pub?.platform || asset?.channel;
  const availableAccounts = (a: Asset) => state.accounts.filter(account => account.platform === a.channel && !p.publications.some(r => r.assetId === a.id && r.assetRevision === a.revision && r.accountId === account.id && r.status !== 'cancelled'));
  const open = (content: Asset | Publication) => setPreparing(content);
  return <div className="publish-workspace">
    <PageTitle title="发布 Agent" subtitle="核对平台、账号与内容，确认后投送并保留发布时间和真实回执。"><button className="button" onClick={() => openPublishingSettings(go)}>管理账号</button><button className="button primary" disabled={LOCAL_DATA || !canPublish || busy} onClick={() => setBatchOpen(true)}>多选平台 / 批量发布</button></PageTitle>
    {(focusId || target.publicationId) && <div className="publish-focus"><b>正在处理：{selectedRecord?.title || p.assets.find(a => a.id === focusId)?.title || '所选内容'}</b><button className="text-button" onClick={() => go('publish', p.id)}>查看全部内容</button></div>}
    {!canPublish && <p className="info-box">当前为创作者权限，可以核对与导出；发布和排期由发布者或管理员处理。</p>}
    <section className="panel"><div className="section-heading"><h2>待安排发布 · {ready.length}</h2><button className="text-button" onClick={() => go('studio', p.id)}>返回内容</button></div><div className="workflow-task-list">{ready.map(a => <article className="workflow-task" key={a.id}><div className="workflow-task-copy"><Channel platform={a.channel} compact/><h3>{a.title}</h3><p>R{a.revision} · {state.accounts.find(account => account.id === assetAccountId(a))?.name || '发布前选择账号'}</p></div><div className="workflow-task-actions"><button className="button primary" disabled={busy} onClick={() => open(a)}>准备发布</button><button className="button" disabled={busy} onClick={() => setRetarget(a)}>增加平台 / 账号</button></div></article>)}</div>{!ready.length && <p className="small-note">当前范围没有需要新安排的成品。已有计划请在下方继续处理。</p>}
      {unfinished.length > 0 && <details open={!!focusId} className="workflow-secondary"><summary>尚需制作 · {unfinished.length}</summary>{unfinished.map(a => <div className="workflow-task" key={a.id}><div className="workflow-task-copy"><h3>{a.title || a.name}</h3><p>{assetPublishReadiness(a).message}</p></div><button className="button" onClick={() => go('studio', p.id, { assetId: a.id })}>继续制作</button></div>)}</details>}
      {arranged.length > 0 && <details className="workflow-secondary"><summary>当前版本已安排或已发布 · {arranged.length}</summary>{arranged.map(a => <div className="workflow-task" key={a.id}><div className="workflow-task-copy"><h3>{a.title}</h3><p>{assetPublicationRecords(p,a,accountScope).map(r => r.accountName + ' · ' + publicationStatusLabel(r)).join('；')}</p></div><button className="button" onClick={() => { setFilter('all'); go('publish',p.id,{assetId:a.id}); }}>查看记录</button>{availableAccounts(a).length > 0 && <button className="text-button" disabled={busy || !canPublish} onClick={() => setSchedule(a)}>安排到其他账号</button>}</div>)}</details>}
    </section>
    <section className="publish-records"><div className="section-heading"><h2>发布待办与记录</h2></div><div className="tabbar">{[['pending','待处理'],['published','已发布'],['all','全部']].map(([key,label]) => <button key={key} className={key===filter?'active':''} onClick={() => setFilter(key)}>{label}</button>)}</div><div className="workflow-task-list">{records.map(r => <article className="panel" key={r.id}><div className="workflow-task"><div className="workflow-task-copy"><Channel platform={r.platform} compact/><h3>{r.title}</h3><p>{r.accountName} · R{r.assetRevision} · {date(r.scheduledAt,true)}</p><Pill color={r.status==='published'?'green':r.status==='cancelled'?'gray':'amber'}>{publicationStatusLabel(r)}</Pill></div><div className="workflow-task-actions">{['scheduled','exported'].includes(r.status) && <button className="button primary" disabled={busy} onClick={() => open(r)}>继续发布</button>}{r.status==='published' && <button className="button primary" onClick={() => go('comments',p.id,{publicationId:r.id,accountId:r.accountId,tab:'metrics'})}>查看表现与反馈</button>}{r.url && <a className="button" href={r.url} target="_blank" rel="noreferrer">查看作品</a>}<details><summary>更多操作</summary><button className="text-button" onClick={() => setExporting(r)}>导出素材</button>{['scheduled','exported'].includes(r.status) && <><button className="text-button" disabled={busy || !canPublish} onClick={() => setEditing(r)}>修改时间</button><button className="text-button" disabled={busy || !canPublish} onClick={() => setCancel(r)}>取消待办</button></>}</details></div></div><details><summary>平台状态与同步记录</summary><PlatformActions record={r}/><FeishuRecord record={r}/></details></article>)}</div>{!records.length && <Empty title="当前范围没有发布记录" text="成品准备好后，点击准备发布；保存待办或确认投送后，记录会出现在这里。"/>}</section>
    <details className="workflow-secondary"><summary>团队排期与飞书同步</summary><FeishuPlanPanel/></details>
    {focusId && p.assets.find(a => a.id === focusId)?.agentPacket?.publishingNotes && <section className="panel"><h3>交接的发布要求</h3><p className="preserve-lines">{p.assets.find(a => a.id === focusId)?.agentPacket?.publishingNotes}</p><p className="small-note">这些是核对要求，不会自动触发投稿或排期。</p></section>}
    {focusId && p.assets.some(a => a.id === focusId) && <button className="button" onClick={() => setRetarget(p.assets.find(a => a.id === focusId)!)}>改投或增加平台 / 账号</button>}
    {preparing && <Modal title="准备发布" description="先核对作品和目标账号，再选择本次的发布方式。" onClose={() => setPreparing(null)}><h3>{preparing.title}</h3><p className="small-note">{pub ? pub.accountName : state.accounts.find(a=>a.id===assetAccountId(asset!))?.name || '进入下一步选择账号'} · R{pub?.assetRevision || asset?.revision}</p><p className="preserve-lines">{preparing.body}</p><div className="modal-actions">{!LOCAL_DATA && <button className="button primary" disabled={busy || !canPublish || !!pub?.delivery && pub.delivery.phase!=='reset'} onClick={() => {setMcp(preparing);setPreparing(null);}}>连接账号投送</button>}{hasDesktopCreator() && platform && hasBuiltinPageAssistant(platform) && <button className="button" disabled={busy || !canPublish} onClick={() => {setDesktop(preparing);setPreparing(null);}}>打开平台发布助手</button>}<button className="button" onClick={() => {setExporting(preparing);setPreparing(null);}}>导出后手动发布</button>{asset && <button className="button" disabled={busy || !canPublish} onClick={() => {setSchedule(asset);setPreparing(null);}}>保存发布待办</button>}{pub && <button className="button" disabled={busy || !canPublish} onClick={() => {setConfirm(pub);setPreparing(null);}}>登记已发布结果</button>}</div><p className="small-note">保存待办不会自动上传。投送仍需核对账号与内容，并按原流程确认。</p></Modal>}
    {exporting && <ExportDialog content={exporting} projectId={p.id} onClose={()=>setExporting(null)} onExported={async()=>{const r=p.publications.find(r=>r.id===exporting.id);if(r?.status==='scheduled')await mutate('/projects/'+p.id+'/publications/'+r.id,'PATCH',{status:'exported'});}}/>}
    {mcp && <MCPPublishDialog content={mcp} onClose={()=>setMcp(null)}/>}{desktop && <CreatorDraftDialog content={desktop} onClose={()=>setDesktop(null)}/>}
    {schedule && <ScheduleDialog asset={schedule} onClose={()=>setSchedule(null)}/>}{confirm && <ConfirmPublish record={confirm} onClose={()=>setConfirm(null)}/>}{editing && <EditPlanTime record={editing} onClose={()=>setEditing(null)}/>}
    {cancel && <Modal title="取消这条发布待办？" description="内容和历史记录保留。" onClose={()=>setCancel(null)}><p>{cancel.title}</p><button className="button danger" disabled={busy || !canPublish} onClick={()=>void run(async()=>{await mutate('/projects/'+p.id+'/publications/'+cancel.id,'PATCH',{status:'cancelled'});setCancel(null);notify('已取消待办');})}>确认取消</button></Modal>}
    {retarget && <RetargetDialog asset={retarget} onClose={() => setRetarget(null)}/>}
    {batchOpen && <BatchPublishDialog onClose={() => setBatchOpen(false)}/>}
    {syncOffer && !preparing && !schedule && !mcp && !desktop && !confirm && !retarget && <Modal title="要将这条计划记录到飞书吗？" description="已连接的团队表格可记录项目、平台、账号、标题、计划时间、状态和链接；不会上传正文、素材或密钥。" onClose={() => setSyncOffer(null)}><p>{p.publications.find(record => record.id === syncOffer)?.title}</p><p className="small-note">{state.feishu?.tableUrl}</p><div className="modal-actions"><button className="button" onClick={() => setSyncOffer(null)}>本次不记录</button><button className="button primary" disabled={busy} onClick={() => void run(async () => { await mutate(`/projects/${p.id}/feishu-sync`, 'POST', { confirmed: true, recordId: syncOffer }); setSyncOffer(null); notify('已记录到飞书，请核对结果'); })}>确认记录到飞书</button></div></Modal>}
  </div>;
}
