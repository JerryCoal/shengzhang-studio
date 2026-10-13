import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ExternalLink, Link2, RefreshCw, Settings2 } from 'lucide-react';
import { api, IS_STATIC, IS_WEB } from '../api';
import { useStudio } from '../context';
import { Field, Modal, Pill } from '../components';
import type { FeishuConnection, Publication } from '../types';
import './feishu.css';

type ConnectionStatus = { configured: boolean; supported: boolean; busy: boolean; connection: FeishuConnection; problem: string; fields: { field_name: string; type: number }[] };
const unavailable = IS_STATIC || IS_WEB;
const sharedFields = '项目、平台、账号、标题、计划时间、发布状态、作品链接和计划编号';
export function openTeamSettings(go: (page: 'settings') => void) {
  try { sessionStorage.setItem('studio-settings-section', 'team'); } catch { /* Navigation still works. */ }
  go('settings');
}
export function FeishuSettings() {
  const { run, busy, refresh, notify } = useStudio();
  const [status, setStatus] = useState<ConnectionStatus | null>(null), [error, setError] = useState('');
  const [appId, setAppId] = useState(''), [secret, setSecret] = useState(''), [url, setUrl] = useState('');
  const [action, setAction] = useState<'initialize' | 'disconnect' | null>(null);
  useEffect(() => {
    if (unavailable) return;
    let live = true;
    api<ConnectionStatus>('/team/feishu').then(s => { if (live) { setStatus(s); setAppId(s.connection.appId || ''); setUrl(s.connection.tableUrl || ''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  const report = status?.connection.check;
  const updateStatus = async (path: string, method = 'POST', body?: unknown) => {
    const s = await api<ConnectionStatus>(path, method, body); setStatus(s); setError(''); await refresh(); return s;
  };
  return <section className="panel settings-card feishu-settings">
    <div className="section-heading"><div><h2>飞书发布计划</h2><p className="muted">在工作台安排内容，在团队表格查看进度。</p></div><Pill color={report?.ready ? 'green' : 'gray'}>{report?.ready ? '字段已就绪' : '首次连接'}</Pill></div>
    {unavailable ? <p className="info-box">请使用 Windows 完整版或连接本机后端的网页配置。静态体验版和独立网页版暂不保存飞书凭证。</p> : <>
      <ol className="feishu-steps"><li><b>创建团队应用</b><p>在飞书开放平台创建自建应用，申请多维表格的字段读取、新增字段、记录读取、新增和更新权限，并发布应用版本。团队可能需要管理员审批。</p><a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">打开飞书开放平台 <ExternalLink size={13}/></a></li><li><b>创建空白多维表格</b><p>在团队飞书中新建多维表格，将首列改名为“计划编号”并保持文本类型，用“添加文档应用”授权上一步的应用。选中具体数据表，复制含 /base/ 和 table= 的链接；第一版暂不接知识库链接。</p></li><li><b>检查并准备字段</b><p>保存下面的连接，检查权限后初始化标准字段。已有列会保留，字段类型不匹配时会提示调整。</p></li></ol>
      {error && <p role="alert" className="error-text">{error}</p>}
      {status?.problem && <p role="alert" className="error-text">{status.problem}</p>}
      {status && !status.supported && <p className="info-box">当前环境没有可用的本地凭证保险箱，请在 Windows 完整版配置。</p>}
      <form onSubmit={e => { e.preventDefault(); void run(async () => {
        await updateStatus('/team/feishu', 'PUT', { appId, ...(secret.trim() ? { appSecret: secret.trim() } : {}), tableUrl: url, expectedRevision: status?.connection.revision || 0 });
        setSecret(''); notify('连接已保存在本机，正在检查表格');
        const s = await updateStatus('/team/feishu/check'); notify(s.connection.check?.ready ? '连接可用，发布计划字段已就绪' : '已连接，请初始化或调整标准字段');
      }); }}>
        <div className="feishu-form-grid"><Field label="应用 App ID"><input required autoComplete="off" value={appId} maxLength={84} onChange={e => setAppId(e.target.value)} placeholder="cli_…"/></Field><Field label="应用 App Secret" hint={status?.configured ? '已保存；留空继续使用，更换 App ID 时需重新填写。' : '只在本机加密保存，不会写入飞书表格或工作区备份。'}><input type="password" autoComplete="new-password" value={secret} maxLength={512} required={!status?.configured} onChange={e => setSecret(e.target.value)} placeholder={status?.configured ? '已保存，留空不修改' : '粘贴应用密钥'}/></Field></div>
        <Field label="多维表格数据表链接"><input type="url" required autoComplete="off" value={url} maxLength={2000} onChange={e => setUrl(e.target.value)} placeholder="https://团队.feishu.cn/base/…?table=tbl…"/></Field>
        <p className="small-note">更换应用或表格后，各项目的自动同步会关闭，需重新确认。保存连接本身不会上传发布计划。</p>
        <div className="row gap-10 wrap"><button className="button primary" disabled={busy || !status?.supported}><Link2 size={15}/>保存并检查</button><button type="button" className="button" disabled={busy || !status?.configured} onClick={() => void run(async () => { await updateStatus('/team/feishu/check'); notify('检查完成'); })}><RefreshCw size={15}/>检查已保存连接</button></div>
      </form>
      {report && <div className="feishu-schema"><b>{report.ready ? '标准字段已就绪' : '还需准备字段'}</b><p>{report.missing.length ? `缺少：${report.missing.join('、')}` : '所需列已存在。'}{report.incompatible.length > 0 && ` 类型不匹配：${report.incompatible.join('、')}。请调整为标准类型或使用新表。`}</p><div className="row gap-10 wrap">{!report.ready && <button className="button" disabled={busy || !!report.incompatible.length} onClick={() => setAction('initialize')}>初始化标准字段</button>}{status?.connection.tableUrl && <a className="button" href={status.connection.tableUrl} target="_blank" rel="noreferrer">打开团队表格 <ArrowUpRight size={14}/></a>}</div></div>}
      <details className="settings-details"><summary>哪些数据会同步？如何处理团队修改？</summary><p>仅同步 {sharedFields}。负责人在首次新增时按项目设置填写，之后由团队维护；团队备注始终不覆盖。不会上传正文、图片、视频、语料、评论或模型密钥。</p><p>单向同步以 App 排期为来源。飞书中的同一列有不同改动时暂停并提示冲突。同步计划不会发布抖音或小红书内容。团队查看已同步数据不需要你的电脑开机；新同步需要 App 运行并登录。</p><p>计划时间按绝对时间写入；请在飞书查看时确认时区设置。自动重试最多三次，仍失败可在发布中心手动重试。</p><a href="https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview" target="_blank" rel="noreferrer">飞书官方接入文档 ↗</a></details>
      {status?.configured && <button className="text-button muted" disabled={busy} onClick={() => setAction('disconnect')}>断开连接并删除本机应用密钥</button>}
    </>}
    {action && <Modal title={action === 'initialize' ? '准备团队发布计划字段' : '断开飞书连接'} description={action === 'initialize' ? '只在已保存的目标数据表新增缺少的列；不会删除现有列或记录。' : '停止所有项目自动同步并删除本机凭证，飞书上的现有记录仍保留。'} onClose={() => setAction(null)}><p>{status?.connection.tableUrl}</p>{action === 'initialize' && <p>{status?.fields.map(f => f.field_name).join('、')}。负责人使用文本类型，首版不需要通讯录权限。</p>}<div className="modal-actions"><button className="button" onClick={() => setAction(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void run(async () => { await updateStatus(`/team/feishu${action === 'initialize' ? '/initialize' : ''}`, action === 'initialize' ? 'POST' : 'DELETE', action === 'initialize' ? { confirmed: true } : undefined); setSecret(''); setAction(null); notify('操作完成'); })}>确认{action === 'initialize' ? '添加字段' : '断开'}</button></div></Modal>}
  </section>;
}

export function FeishuPlanPanel() {
  const { state, project, go, run, mutate, busy, notify } = useStudio();
  const [owner, setOwner] = useState(project?.feishuPlan?.owner || ''), [auto, setAuto] = useState(!!project?.feishuPlan?.autoSync), [confirm, setConfirm] = useState(false);
  useEffect(() => { setOwner(project?.feishuPlan?.owner || ''); setAuto(!!project?.feishuPlan?.autoSync); }, [project?.id, project?.feishuPlan?.owner, project?.feishuPlan?.autoSync]);
  if (unavailable || !project) return null;
  const ready = state.feishu?.check?.ready, count = project.publications.filter(p => !p.sample).length;
  const dirty = owner !== (project.feishuPlan?.owner || '') || auto !== !!project.feishuPlan?.autoSync;
  return <section className="panel feishu-plan-panel"><div className="section-heading"><div><h2><Link2 size={18}/>团队发布计划</h2><p className="muted">将本项目排期同步到飞书，团队直接查看和补充备注。</p></div><button className="button small" onClick={() => openTeamSettings(go)}><Settings2 size={15}/>{ready ? '连接设置' : '连接飞书'}</button></div>
    {project.sample ? <p className="small-note">示例项目不会上传。创建自己的项目后可启用团队同步。</p> : ready ? <>
      <div className="feishu-plan-options"><Field label="默认负责人（可选）" hint="首次新增行时填写，后续保留团队修改。"><input value={owner} maxLength={80} onChange={e => setOwner(e.target.value)} placeholder="例如：小陈"/></Field><label className="checkbox-row"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}/><span>自动同步本项目已有和后续发布计划到飞书</span></label></div>
      <p className="small-note">{dirty && '设置尚未保存，请先保存。'}共享范围：{sharedFields}。不会上传素材和正文；实际发布仍由你确认。</p>
      {project.feishuPlan?.error && <p className="error-text" role="alert">{project.feishuPlan.error}</p>}
      <div className="row gap-10 wrap"><button className="button" disabled={busy} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/feishu-plan`, 'PUT', { owner, autoSync: auto, confirmed: auto }); notify(auto ? '已开启自动同步，登录并运行时会更新排期' : '项目同步设置已保存'); })}>保存同步设置</button><button className="button primary" disabled={busy || !count || dirty} onClick={() => setConfirm(true)}><RefreshCw size={15}/>立即同步计划</button><a href={state.feishu?.tableUrl} target="_blank" rel="noreferrer" className="button">打开团队表格 <ArrowUpRight size={14}/></a></div>
    </> : <p className="muted">先在连接设置中保存团队应用和空白多维表格链接，再初始化标准字段。</p>}
    {confirm && <Modal title="同步本项目发布计划到飞书" description="只更新 App 管理的排期列，保留负责人和团队备注。遇到冲突将暂停。" onClose={() => setConfirm(false)}><p>项目：{project.brief.name}。共 {count} 条非示例记录，单次最多处理 50 条有变化的计划，包含已发布和已取消状态。</p><p className="muted">目标：{state.feishu?.tableUrl}</p><div className="modal-actions"><button className="button" onClick={() => setConfirm(false)}>取消</button><button className="button primary" disabled={busy} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/feishu-sync`, 'POST', { confirmed: true }); setConfirm(false); notify('本批同步完成，可到飞书核对；未处理的计划可继续同步'); })}>确认同步到飞书</button></div></Modal>}
  </section>;
}

export function FeishuRecord({ record }: { record: Publication }) {
  const { project, state, mutate, run, busy, notify } = useStudio();
  const [confirm, setConfirm] = useState(false);
  if (unavailable || !project || project.sample || record.sample || !state.feishu?.tableId) return null;
  const s = record.feishuSync, target = state.feishu;
  const sameTarget = s?.targetKey === `${target.appId}:${target.appToken}:${target.tableId}`;
  const sent = s?.sentFields;
  const dirty = !sameTarget || !sent || sent['标题'] !== record.title || sent['项目'] !== project.brief.name || sent['计划发布时间'] !== new Date(record.scheduledAt).getTime() || sent['作品链接'] !== (record.url || '') || sent['发布账号'] !== record.accountName || sent['发布状态'] !== ({ scheduled: '待发布', exported: '已导出', published: '已发布', cancelled: '已取消' })[record.status];
  const status = sameTarget && ['error','conflict','syncing'].includes(s?.status || '') ? s!.status : dirty ? 'pending' : 'synced';
  const labels: Record<string, string> = { error: '飞书同步失败', conflict: '飞书有不同修改', syncing: '正在同步飞书', pending: '待同步飞书', synced: '飞书已同步' };
  return <div className="feishu-record"><div className="row gap-10 wrap"><Pill color={status === 'synced' ? 'green' : status === 'error' || status === 'conflict' ? 'amber' : 'gray'}>{labels[status]}</Pill>{s?.syncedAt && sameTarget && <small className="muted">上次同步 {new Date(s.syncedAt).toLocaleString('zh-CN')}</small>}{status !== 'syncing' && <button className="text-button" disabled={busy || !target.check?.ready} onClick={() => setConfirm(true)}>{status === 'conflict' ? '查看冲突' : status === 'synced' ? '核对同步' : '同步这条'}</button>}</div>{sameTarget && s?.error && <p className="error-text">{s.error}</p>}
    {confirm && <Modal title={status === 'conflict' ? '核对飞书中的修改' : '同步这条发布计划'} description="同步排期不会向内容平台投稿。团队备注和负责人不覆盖。" onClose={() => setConfirm(false)}><p>{record.title}</p>{status === 'conflict' && <p>冲突字段：{s?.conflicts?.join('、') || '记录已删除或发生变化'}。选择“按 App 更新”将采用 App 中本次待同步的版本；请先打开飞书核对。</p>}<a href={target.tableUrl} target="_blank" rel="noreferrer">打开飞书表格 ↗</a><div className="modal-actions"><button className="button" onClick={() => setConfirm(false)}>暂不处理</button><button className="button primary" disabled={busy || (status === 'conflict' && !s?.remoteHash)} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/feishu-sync`, 'POST', { confirmed: true, recordId: record.id, ...(status === 'conflict' ? { overwriteConflict: true, expectedRemoteHash: s?.remoteHash } : {}) }); setConfirm(false); notify('本次同步完成'); })}><Check size={14}/>{status === 'conflict' ? '按 App 更新' : '确认同步'}</button></div></Modal>}
  </div>;
}
