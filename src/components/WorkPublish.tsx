import { useEffect, useRef, useState } from 'react';
import { api, LOCAL_DATA } from '../api';
import { Channel, Field, Modal, Pill } from '../components';
import { Context, useStudio, type StudioContext } from '../context';
import type { Asset, Publication, State } from '../types';
import { workError, workSession, type WorkArtifact } from '../work-control';
import { assetPublishReadiness } from '../../server/publish-readiness.mjs';
import { publicationStatusLabel } from '../pages/PlatformActions';
import { MCPPublishDialog } from './MCPPublishDialog';
import { ExportDialog } from './ExportDialog';

type Origin = { artifactId: string; artifactVersion: number; taskId: string; runId: string; index: number };
type WorkImage = Asset & { workImageOrigin?: Origin };
type Content = Asset | Publication;
type Choice = { mode: 'publish' | 'export' | 'record'; content: Content; accountId: string; scope: string };
export type WorkPublishProps = { projectId: string; artifact: WorkArtifact; assets: Asset[]; disabled?: boolean; openRequest?: number };
function matchesArtifact(asset: WorkImage, artifact: WorkArtifact) {
  const origin = asset.workImageOrigin;
  return origin?.artifactId === artifact.id && origin.artifactVersion === artifact.version && origin.taskId === artifact.taskId && origin.runId === artifact.runId;
}
function findContent(state: State, projectId: string, content: Content) {
  const project = state.projects.find(item => item.id === projectId);
  return 'channel' in content ? project?.assets.find(item => item.id === content.id) : project?.publications.find(item => item.id === content.id);
}
function sameSnapshot(a: Content, b: Content | undefined) {
  if (!b || a.id !== b.id || a.title !== b.title || a.body !== b.body || a.mime !== b.mime || a.mediaData !== b.mediaData) return false;
  if ('channel' in a) return 'channel' in b && a.revision === b.revision && a.channel === b.channel && a.contentBrief?.accountId === b.contentBrief?.accountId;
  return !('channel' in b) && a.assetRevision === b.assetRevision && a.platform === b.platform && a.accountId === b.accountId;
}
export function WorkPublish({ projectId, artifact, assets, disabled = false, openRequest = 0 }: WorkPublishProps) {
  const studio = useStudio(), project = studio.state.projects.find(item => item.id === projectId), session = workSession();
  const scope = JSON.stringify([session, projectId, studio.project?.id, studio.accountScope, studio.scope.projectIds, studio.scope.accountIds, artifact.id, artifact.version, artifact.taskId, artifact.runId]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const seenRequest = useRef(0), [picker, setPicker] = useState<string | null>(null), [selectedId, setSelectedId] = useState(''), [choice, setChoice] = useState<Choice | null>(null), [message, setMessage] = useState('');
  const publisher = studio.settings.team?.role !== 'editor';
  const blocked = disabled || !!artifact.candidate || !project || !!project.sample || studio.busy;
  const assetIds = new Set(assets.map(item => item.id));
  const images = (project?.assets || []).filter(item => assetIds.has(item.id) && matchesArtifact(item as WorkImage, artifact) && !!item.contentBrief?.accountId && studio.state.accounts.some(account => account.id === item.contentBrief?.accountId && account.platform === item.channel) && (!studio.scope.accountIds.length || studio.scope.accountIds.includes(item.contentBrief!.accountId)));
  const ready = images.filter(item => assetPublishReadiness(item).ready), selected = ready.find(item => item.id === selectedId);
  const records = (project?.publications || []).filter(record => images.some(item => item.id === record.assetId && item.contentBrief?.accountId === record.accountId)).slice().sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  useEffect(() => { setPicker(null); setChoice(null); setSelectedId(''); setMessage(''); }, [scope]);
  useEffect(() => { if (!openRequest || seenRequest.current === openRequest) return; seenRequest.current = openRequest; setChoice(null); setSelectedId(''); setMessage(''); setPicker(scope); }, [openRequest, scope]);
  function open(mode: Choice['mode'], content: Content) {
    if (blocked || mode !== 'export' && !publisher) return;
    const accountId = 'channel' in content ? content.contentBrief?.accountId || '' : content.accountId;
    if (!accountId) return;
    setPicker(null); setMessage(''); setChoice({ mode, content: structuredClone(content), accountId, scope });
  }
  function choose(mode: Choice['mode']) {
    if (!selected) return;
    const existing = records.find(record => record.assetId === selected.id && record.assetRevision === selected.revision && record.accountId === selected.contentBrief?.accountId && record.status !== 'cancelled');
    if (mode !== 'export' && existing?.status === 'published') { setMessage('这个版本已经登记发布，请查看下方已有作品链接。'); return; }
    if (mode === 'publish' && (existing?.manualReviewRequired || existing?.delivery && existing.delivery.phase !== 'reset')) { setMessage('这条内容已有提交记录，请先核对平台结果；不会重复发布。'); return; }
    open(mode, mode === 'export' ? selected : existing || selected);
  }
  return <section className="work-publish" aria-label="本次成果发布">
    <div className="work-media-heading"><div><h3>发布 Agent</h3><p>成果 V{artifact.version} · 单独批准发布</p></div><Pill color={ready.length ? 'green' : 'gray'}>{ready.length ? `${ready.length} 张已采用` : '等待采用图片'}</Pill></div>
    <p className="small-note">当前每次提交一张图片和这份文案。多张配图分别保存，不会自动合并成多图帖子，也不会自动逐张发布。</p>
    {!publisher && <p className="info-box">当前为创作者权限，可以导出；发布和结果登记需要发布者或管理员处理。</p>}
    {message && <p className="info-box" role="status">{message}</p>}
    <button type="button" className="button primary" disabled={blocked} onClick={() => { setChoice(null); setSelectedId(''); setMessage(''); setPicker(scope); }}>选择成品并准备发布</button>
    {records.map(record => {
      const pending = ['scheduled', 'exported'].includes(record.status), submit = pending && !record.manualReviewRequired && (!record.delivery || record.delivery.phase === 'reset'), url = record.url || record.delivery?.url;
      return <article className="workflow-task" key={record.id}><div className="workflow-task-copy"><Channel platform={record.platform} compact/><h4>{record.delivery?.title || record.title}</h4><p>{record.accountName} · 成品 R{record.assetRevision}</p><Pill color={record.status === 'published' ? 'green' : 'amber'}>{publicationStatusLabel(record)}</Pill>{record.delivery?.phase === 'submitting' && <p className="small-note">本次提交结果待核对，重试已锁定。请先查看平台作品列表。</p>}</div><div className="workflow-task-actions">{url && <a className="button" href={url} target="_blank" rel="noreferrer">查看平台作品</a>}{submit && <button type="button" className="button" disabled={blocked || !publisher || LOCAL_DATA} onClick={() => open('publish', record)}>核对并批准这一条</button>}{pending && <button type="button" className="button" disabled={blocked || !publisher} onClick={() => open('record', record)}>登记真实发布结果</button>}<button type="button" className="text-button" disabled={blocked} onClick={() => open('export', record)}>导出这份成品</button></div></article>;
    })}
    {picker === scope && <Modal title="选择本次发布的成品" description="选择一张已采用的图片，再核对账号和平台选项。此步骤不会发布。" onClose={() => setPicker(null)}><Field label="本次单图成品"><select value={selectedId} disabled={blocked} onChange={event => { setSelectedId(event.target.value); setMessage(''); }}><option value="">请选择一张图片</option>{ready.map(item => <option key={item.id} value={item.id}>图片 {((item as WorkImage).workImageOrigin?.index || 0) + 1} · {item.title} · R{item.revision}</option>)}</select></Field>{!ready.length && <p className="info-box">请先在上方检查图片并点击采用，再继续准备发布。</p>}{selected && <><img className="work-media-preview" src={selected.mediaData} alt="本次选择的单图成品"/><p>目标账号：<strong>{studio.state.accounts.find(account => account.id === selected.contentBrief?.accountId)?.name}</strong> · 成品 R{selected.revision}</p><p className="preserve-lines">{selected.body}</p></>}{message && <p className="info-box" role="status">{message}</p>}{LOCAL_DATA && <p className="small-note">当前运行方式不能连接本机 MCP，可以导出后在官方平台发布。</p>}<div className="modal-actions"><button type="button" className="button" onClick={() => setPicker(null)}>返回</button><button type="button" className="button" disabled={blocked || !selected} onClick={() => choose('export')}>导出后手动发布</button><button type="button" className="button" disabled={blocked || !selected || !publisher} onClick={() => choose('record')}>登记已手动发布的结果</button><button type="button" className="button primary" disabled={blocked || !selected || !publisher || LOCAL_DATA} onClick={() => choose('publish')}>核对账号并批准发布</button></div></Modal>}
    {choice?.scope === scope && <BoundDialog key={`${scope}:${choice.mode}:${choice.content.id}`} choice={choice} projectId={projectId} isCurrent={() => currentScope.current === choice.scope && session === workSession()} onClose={() => setChoice(null)}/>}
  </section>;
}
/** Keep publishing bound to the reviewed project, account and snapshot. */
function BoundDialog({ choice, projectId, isCurrent, onClose }: { choice: Choice; projectId: string; isCurrent: () => boolean; onClose: () => void }) {
  const studio = useStudio(), live = useRef(studio), mounted = useRef(true); live.current = studio;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function check() {
    const context = live.current;
    if (!mounted.current || !isCurrent()) throw Error('工作区已切换，未继续发布操作。');
    if (choice.mode !== 'export' && context.settings.team?.role === 'editor') throw Error('当前权限不能发布或登记发布结果。');
    const project = context.state.projects.find(item => item.id === projectId), account = context.state.accounts.find(item => item.id === choice.accountId), platform = 'channel' in choice.content ? choice.content.channel : choice.content.platform;
    if (!project || project.sample || account?.platform !== platform || !sameSnapshot(choice.content, findContent(context.state, projectId, choice.content))) throw Error('作品版本、素材或账号已变化，请返回并重新核对。');
  }
  let error = ''; try { check(); } catch (failure) { error = workError(failure); }
  const guardedMutate: StudioContext['mutate'] = async <T,>(path: string, method = 'POST', body?: unknown) => {
    check(); const prefix = `/projects/${projectId}/publications`;
    if (path !== prefix && !path.startsWith(prefix + '/')) throw Error('本窗口只能处理已核对项目的发布记录。');
    if (live.current.settings.team?.role === 'editor') throw Error('当前权限不能修改发布记录。');
    const result = await live.current.mutate<T>(path, method, body); check(); return result;
  };
  const bound: StudioContext = { ...studio, project: studio.state.projects.find(item => item.id === projectId), state: { ...studio.state, accounts: studio.state.accounts.filter(item => item.id === choice.accountId) }, mutate: guardedMutate, refresh: async () => { if (mounted.current && isCurrent()) await live.current.refresh(); }, notify: (message, failed) => { if (mounted.current && isCurrent()) live.current.notify(message, failed); }, go: (...args) => { if (!mounted.current || !isCurrent()) return; onClose(); live.current.go(...args); } };
  if (error) return <Modal title="请重新核对发布内容" onClose={onClose}><p className="info-box" role="alert">{error}</p><button type="button" className="button" onClick={onClose}>返回总控</button></Modal>;
  return <Context.Provider value={bound}>{choice.mode === 'publish' ? <MCPPublishDialog content={choice.content} projectId={projectId} onClose={onClose}/> : choice.mode === 'export' ? <ExportDialog content={choice.content} projectId={projectId} onClose={onClose}/> : <RecordResult content={choice.content} projectId={projectId} accountId={choice.accountId} isCurrent={() => { try { check(); return true; } catch { return false; } }} onClose={onClose}/>}</Context.Provider>;
}
function RecordResult({ content, projectId, accountId, isCurrent, onClose }: { content: Content; projectId: string; accountId: string; isCurrent: () => boolean; onClose: () => void }) {
  const { mutate, refresh, notify } = useStudio();
  const [url, setUrl] = useState('channel' in content ? '' : content.delivery?.url || content.url || ''), [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), working = useRef(false);
  function check() { if (!isCurrent()) throw Error('工作区或作品已变化，未继续登记。'); }
  async function save() {
    if (!confirmed || !url.trim() || working.current) return;
    working.current = true; setPending(true); setError('');
    try {
      check(); const state = await api<State>('/state'); check();
      const project = state.projects.find(item => item.id === projectId);
      if (!project || !sameSnapshot(content, findContent(state, projectId, content))) throw Error('作品版本或素材已变化，请重新核对后登记。');
      let record: Publication | undefined;
      if ('channel' in content) {
        record = project.publications.find(item => item.assetId === content.id && item.assetRevision === content.revision && item.accountId === accountId && item.status !== 'cancelled');
        if (!record) { check(); record = (await mutate<Publication>(`/projects/${projectId}/publications`, 'POST', { assetId: content.id, accountId, expectedAssetRevision: content.revision, scheduledAt: new Date().toISOString() })).result; check(); }
      } else record = project.publications.find(item => item.id === content.id);
      if (!record || record.accountId !== accountId || record.status === 'cancelled') throw Error('对应发布记录或账号已变化，请重新核对。');
      if (record.status === 'published') throw Error('这条记录已经登记发布，请查看已有作品链接。');
      check(); await mutate(`/projects/${projectId}/publications/${record.id}/confirm`, 'POST', { url: url.trim(), confirmed: true }); check(); await refresh(); check(); notify('真实发布结果已登记，作品链接已保留在总控页面。'); onClose();
    } catch (failure) { if (isCurrent()) setError(workError(failure)); }
    finally { working.current = false; if (isCurrent()) setPending(false); }
  }
  return <Modal title="登记真实发布结果" description="只登记已在平台确认成功的作品，不会上传或再次投稿。" onClose={() => { if (!pending) onClose(); }}><h3>{content.title}</h3><Field label="平台返回的真实作品链接"><input type="url" value={url} disabled={pending} placeholder="粘贴对应账号中的完整作品链接" onChange={event => { setUrl(event.target.value); setConfirmed(false); }}/></Field><label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)}/><span>我已在目标账号中核对，确认此链接对应本次成品且发布成功。</span></label>{error && <p className="info-box error-box" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" disabled={pending} onClick={onClose}>返回</button><button type="button" className="button primary" disabled={pending || !confirmed || !url.trim()} onClick={() => void save()}>{pending ? '正在登记…' : '确认并记录'}</button></div></Modal>;
}
