import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Bookmark, ExternalLink, Lightbulb, Pencil, Plus } from 'lucide-react';
import { useStudio } from '../context';
import { Empty, Field, Modal, Pill } from '../components';
import { LOCAL_DATA } from '../api';
import { PLATFORM_NAMES } from '../../server/platform-catalog.mjs';
import type { Platform } from '../types';
import type { KnowledgeEntry } from '../../server/content-workflow.mjs';
export type { KnowledgeEntry } from '../../server/content-workflow.mjs';
import '../knowledge-library.css';

export type KnowledgeSource = { title: string; text: string; sourceUrl?: string; sourceId?: string; sourceType?: string; platform?: Platform; accountId?: string };
const safeUrl = (value?: string) => { try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const expired = (entry: KnowledgeEntry) => !!entry.expiresAt && Date.parse(entry.expiresAt) <= Date.now();
const valid = (entry: KnowledgeEntry) => entry.active && !expired(entry);
const day = (value?: string | null) => value ? new Date(value).toLocaleDateString('zh-CN') : '长期保留';
const errorText = (error: unknown) => error instanceof Error ? error.message : '保存未完成，请重试';
const entriesOf = (project: { knowledge?: KnowledgeEntry[] } | undefined) => project?.knowledge || [];

export function KnowledgeSaveDialog({ source, kind, create = false, entry, onClose }: { source: KnowledgeSource; kind: KnowledgeEntry['kind']; create?: boolean; entry?: KnowledgeEntry; onClose: () => void }) {
  const { project, state, mutate, go, notify, busy } = useStudio();
  const candidates = Object.entries(project?.creationSelections || {}).filter(([platform, selection]) => (!source.platform || platform === source.platform) && !!selection?.accountId).map(([, selection]) => selection!.accountId);
  const defaultAccount = [...new Set(candidates)].length === 1 ? candidates[0] : '';
  const [title, setTitle] = useState(source.title.slice(0, 200));
  const [text, setText] = useState(source.text.slice(0, 12000));
  const [sourceUrl, setSourceUrl] = useState(safeUrl(source.sourceUrl));
  const [accountId, setAccountId] = useState(entry ? entry.accountId : source.accountId ?? defaultAccount ?? '');
  const [expiresAt, setExpiresAt] = useState(entry?.expiresAt?.slice(0, 10) || '');
  const [checked, setChecked] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const request = useRef({ fingerprint: '', id: crypto.randomUUID() });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy || pending;
  if (!project) return null;
  // Direct content can target any existing account, even when the project's
  // original channel list predates that platform.
  const accounts = state.accounts;
  async function save() {
    if (locked || !project || !checked) return;
    setError(''); setPending(true);
    try {
      const values = { kind, title: title.trim(), text: text.trim(), sourceUrl: sourceUrl.trim(), sourceId: source.sourceId || '', sourceType: source.sourceType || 'manual', accountId, expiresAt: expiresAt ? new Date(expiresAt + 'T23:59:59').toISOString() : null };
      if (create && values.expiresAt && Date.parse(values.expiresAt) <= Date.now()) throw new Error('这份资料的使用期限已过，请更新期限后再用于新创作。');
      const fingerprint = JSON.stringify(values);
      if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      const saved = await mutate<KnowledgeEntry>(`/projects/${project.id}/knowledge${entry ? '/' + entry.id : ''}`, entry ? 'PATCH' : 'POST', entry ? { ...values, expectedRevision: entry.revision } : { ...values, requestId: request.current.id });
      notify(kind === 'experience' ? '已保存为待验证经验，可在创作时选用' : '参考资料已保存');
      if (mounted.current) { onClose(); if (create) go('studio', project.id, { newContent: true, requirement: `围绕“${values.title}”创作，参考已保存资料中的表达思路，核对适用条件与项目事实。`, knowledgeIds: [saved.result.id], ...(accountId ? { accountId } : {}) }); }
    } catch (failure) { if (mounted.current) setError(errorText(failure)); }
    finally { if (mounted.current) setPending(false); }
  }
  return <Modal title={entry ? '编辑已保存资料' : create ? '核对参考，开始创作' : kind === 'experience' ? '保存为经验' : '收藏资料'} description={kind === 'experience' ? '保存可尝试的方法与验证条件。这里的经验是待验证建议，不会变成品牌或产品事实。' : '先保存来源与核对后的摘录，之后可以在创作中反复选用。'} onClose={() => { if (!locked) onClose(); }} wide>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label={kind === 'experience' ? '经验名称' : '资料名称'}><input required maxLength={200} value={title} disabled={locked} onChange={event => { setTitle(event.target.value); setChecked(false); }}/></Field>
      <Field label={kind === 'experience' ? '待验证的方法、适用条件与验证方式' : '准备保留的正文或摘录'} hint={kind === 'experience' ? '说明什么情况下可以尝试、如何观察结果，避免把单次表现写成必然规律。' : '只保存本次需要的内容，保留不确定性；引用资料不替代已确认的项目事实。'}><textarea required rows={9} maxLength={12000} value={text} disabled={locked} onChange={event => { setText(event.target.value); setChecked(false); }}/></Field>
      {source.text.length > 12000 && <p className="small-note">原资料较长，当前预填前 12,000 字，请检查并保留本次需要的内容。</p>}
      <div className="knowledge-fields"><Field label="适用账号" hint="按本项目创作账号预填，与读取资料的登录账号无关。"><select value={accountId} disabled={locked} onChange={event => { setAccountId(event.target.value); setChecked(false); }}><option value="">本项目共享 · 未限定账号</option>{accountId && !accounts.some(account => account.id === accountId) && <option value={accountId}>原账号已不可用，请重新选择</option>}{accounts.map(account => <option key={account.id} value={account.id}>{PLATFORM_NAMES[account.platform]} · {account.name}</option>)}</select></Field><Field label="使用期限" hint="留空长期保留；到期后不再提供给新创作选择。"><input type="date" value={expiresAt} disabled={locked} onChange={event => setExpiresAt(event.target.value)}/></Field></div>
      <Field label="原始来源链接（可选）"><input type="url" maxLength={2000} value={sourceUrl} disabled={locked} onChange={event => { setSourceUrl(event.target.value); setChecked(false); }} placeholder="https://…"/></Field>
      <label className="checkbox-row"><input type="checkbox" checked={checked} disabled={locked} onChange={event => setChecked(event.target.checked)}/>我已核对保留的文字、来源和适用账号{kind === 'experience' ? '，知道这是一条待验证经验' : ''}。</label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button" disabled={locked} onClick={onClose}>取消</button><button className="button primary" disabled={locked || !checked || !title.trim() || !text.trim() || !!accountId && !accounts.some(account => account.id === accountId)}>{pending ? '正在保存…' : create ? '保存参考并开始创作' : '保存'}</button></div>
    </form>
  </Modal>;
}

export function KnowledgeActions({ source, disabled = false, actions = ['create', 'reference', 'experience'] }: { source: KnowledgeSource; disabled?: boolean; actions?: ('create' | 'reference' | 'experience')[] }) {
  const { busy } = useStudio();
  disabled = disabled || busy;
  const [action, setAction] = useState<'create' | 'reference' | 'experience' | null>(null);
  return <><div className="knowledge-actions">{actions.includes('create') && <button className="button small primary" disabled={disabled} onClick={() => setAction('create')}><ArrowRight size={14}/>用来创作</button>}{actions.includes('reference') && <button className="button small" disabled={disabled} onClick={() => setAction('reference')}><Bookmark size={14}/>收藏资料</button>}{actions.includes('experience') && <button className="button small" disabled={disabled} onClick={() => setAction('experience')}><Lightbulb size={14}/>保存为经验</button>}</div>{action && <KnowledgeSaveDialog source={source} kind={action === 'experience' ? 'experience' : 'reference'} create={action === 'create'} onClose={() => setAction(null)}/>}</>;
}

export function KnowledgePicker({ selectedIds, onChange, accountId, disabled = false }: { selectedIds: string[]; onChange: (ids: string[]) => void; accountId?: string; disabled?: boolean }) {
  const { project, state } = useStudio();
  const entries = entriesOf(project);
  const available = entries.filter(entry => valid(entry) && (!entry.accountId || entry.accountId === accountId));
  const unavailable = selectedIds.filter(id => !available.some(entry => entry.id === id));
  return <section className="knowledge-picker" aria-label="选择创作参考与经验"><div className="section-heading"><div><h3>参考资料与经验</h3><p className="small-note">按目标账号显示可用条目，最多选 5 条。经验作为待验证建议带入。</p></div><span>{selectedIds.length} / 5 已选</span></div>
    {unavailable.length > 0 && <div className="info-box"><p>有 {unavailable.length} 条已选资料已停用、过期，或不适用于当前账号，请重新选择。</p><button type="button" className="button small" disabled={disabled} onClick={() => onChange(selectedIds.filter(id => !unavailable.includes(id)))}>移除不可用选择</button></div>}
    {available.length ? <div className="knowledge-picker-list">{available.map(entry => <label key={entry.id} className="knowledge-picker-item"><input type="checkbox" disabled={disabled || !selectedIds.includes(entry.id) && selectedIds.length >= 5} checked={selectedIds.includes(entry.id)} onChange={event => onChange(event.target.checked ? [...selectedIds, entry.id] : selectedIds.filter(id => id !== entry.id))}/><span><b>{entry.title}</b><small>{entry.kind === 'experience' ? '待验证经验' : '参考资料'} · {entry.accountId ? state.accounts.find(account => account.id === entry.accountId)?.name || '原账号' : '项目共享'} · {day(entry.expiresAt)}</small><span>{entry.text.slice(0, 180)}{entry.text.length > 180 ? '…' : ''}</span></span></label>)}</div> : <p className="small-note">当前账号暂无可用条目。可以先在“选题与资料”收藏来源，也可以直接按本次需求创作。</p>}
  </section>;
}

export function KnowledgeLibrary({ initialKind = 'all' }: { initialKind?: 'all' | 'reference' | 'experience' } = {}) {
  const { project, state, busy, mutate, run, notify, go, accountScope } = useStudio();
  const [kind, setKind] = useState<string>(initialKind), [scope, setScope] = useState(accountScope || 'all'), [search, setSearch] = useState(''), [showInactive, setShowInactive] = useState(false);
  useEffect(() => setScope(accountScope || 'all'), [accountScope]);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null), [adding, setAdding] = useState<KnowledgeEntry['kind'] | null>(null);
  if (!project) return null;
  const entries = entriesOf(project);
  const filtered = entries.filter(entry => (showInactive || valid(entry)) && (kind === 'all' || entry.kind === kind) && (scope === 'all' || (scope === 'shared' ? !entry.accountId : !entry.accountId || entry.accountId === scope)) && `${entry.title}\n${entry.text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="knowledge-library"><div className="section-heading"><div><h2>已保存的资料与经验</h2><p className="small-note">资料保留出处；经验保留为待验证建议。停用或过期不影响历史内容的引用。</p></div><div className="row gap-8 wrap"><button className="button small" disabled={busy} onClick={() => setAdding('reference')}><Plus size={14}/>添加资料</button><button className="button small" disabled={busy} onClick={() => setAdding('experience')}><Lightbulb size={14}/>记录经验</button></div></div>
    {LOCAL_DATA && <p className="info-box">资料仅在此浏览器加密保存；带身份生成需 Windows 或团队版。</p>}
    <div className="knowledge-filters"><input aria-label="搜索已保存资料" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题或正文"/><select aria-label="资料类型" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option><option value="reference">参考资料</option><option value="experience">待验证经验</option></select><select aria-label="资料适用账号" value={scope} onChange={event => setScope(event.target.value)}><option value="all">全部账号与共享资料</option><option value="shared">仅项目共享</option>{state.accounts.map(account => <option key={account.id} value={account.id}>{PLATFORM_NAMES[account.platform]} · {account.name}</option>)}</select><label className="checkbox-row"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)}/>包括已停用和过期</label></div>
    {filtered.length ? <div className="knowledge-list">{filtered.map(entry => { const url = safeUrl(entry.sourceUrl); return <article className="panel knowledge-card" key={entry.id}><div className="row between wrap gap-8"><h3>{entry.kind === 'experience' ? <Lightbulb size={18}/> : <BookOpen size={18}/>} {entry.title}</h3><Pill color={!valid(entry) ? 'gray' : entry.kind === 'experience' ? 'amber' : 'green'}>{!entry.active ? '已停用' : expired(entry) ? '已过期' : entry.kind === 'experience' ? '待验证经验' : '可用参考'}</Pill></div><p className="small-note">{entry.accountId ? state.accounts.find(account => account.id === entry.accountId)?.name || '原账号已不可用' : '本项目共享'} · {entry.expiresAt ? `到期 ${day(entry.expiresAt)}` : '长期保留'} · 第 {entry.revision} 版</p><details><summary>查看保存的正文与出处</summary><p className="preserve-lines">{entry.text}</p>{url && <a href={url} target="_blank" rel="noreferrer">核对来源 <ExternalLink size={12}/></a>}</details><div className="knowledge-actions"><button className="button small primary" disabled={busy || !valid(entry) || !!entry.accountId && !state.accounts.some(account => account.id === entry.accountId)} onClick={() => go('studio', project.id, { newContent: true, requirement: `参考“${entry.title}”创作，核对适用条件与项目事实。`, knowledgeIds: [entry.id], ...(entry.accountId ? { accountId: entry.accountId } : {}) })}>用来创作 <ArrowRight size={14}/></button><button className="button small" disabled={busy} onClick={() => setEditing(entry)}><Pencil size={14}/>编辑</button><button className="text-button" disabled={busy} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/knowledge/${entry.id}`, 'PATCH', { expectedRevision: entry.revision, active: !entry.active }); notify(entry.active ? '已停用，历史引用保留' : '已启用；到期资料仍需更新期限后才能选用'); })}>{entry.active ? '停用' : '重新启用'}</button></div></article>; })}</div> : <div className="panel"><Empty title={entries.length ? '没有符合筛选条件的资料' : '把值得复用的内容留下来'} text="在发现选题中收藏参考或保存经验，也可以在这里手动添加。"/></div>}
    {adding && <KnowledgeSaveDialog source={{ title: '', text: '', sourceType: 'manual' }} kind={adding} onClose={() => setAdding(null)}/>}{editing && <KnowledgeSaveDialog key={`${editing.id}:${editing.revision}`} source={editing} kind={editing.kind} entry={editing} onClose={() => setEditing(null)}/>}
  </div>;
}
