import { useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, UsersRound } from 'lucide-react';
import { api } from '../api';
import { useStudio } from '../context';
import { Field, Modal, Pill } from '../components';
import type { TeamRole } from '../types';
import '../team-workspace.css';

type TeamMember = { id: string; username: string; role: TeamRole; disabled: boolean; createdAt: string };
export const TEAM_ROLES: Record<TeamRole, string> = { admin: '管理员', editor: '创作者', publisher: '发布者' };
export function TeamSettings() {
  const { settings, busy, run, notify, refresh } = useStudio();
  const team = settings.team;
  const [users, setUsers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<TeamRole>('editor');
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editedRole, setEditedRole] = useState<TeamRole>('editor');
  const [editedDisabled, setEditedDisabled] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const isAdmin = team?.role === 'admin';
  const reload = async () => { setLoading(true); setFailure(''); try { const result = await api<{ users: TeamMember[] }>('/team/users'); setUsers(result.users); } catch (error) { setFailure(error instanceof Error ? error.message : '无法读取成员'); } finally { setLoading(false); } };
  useEffect(() => { if (isAdmin) void reload(); else setUsers([]); }, [isAdmin]);
  if (!team) return null;
  return <section className="panel settings-card team-settings">
    <div className="section-heading"><div><h2><UsersRound size={20}/> 团队成员与权限</h2><p className="muted">{team.workspaceName} · 当前以 {team.username} 登录</p></div><Pill color="green">{TEAM_ROLES[team.role]}</Pill></div>
    <div className="team-role-guide"><p><b>创作者：</b>查看共享项目、准备素材和生成内容。</p><p><b>发布者：</b>拥有创作权限，并可执行发布与平台互动操作。</p><p><b>管理员：</b>拥有发布权限，并管理成员、密钥和连接配置。</p></div>
    <p className="info-box">团队工作区、素材、平台账号身份和 Skills 由同事共享。你的目标账号选择独立保存；生成与发布记录保留实际操作人。</p>
    {!isAdmin ? <p className="small-note">添加成员、重设密码或调整权限，请联系团队管理员。</p> : <>
      <h3>添加同事</h3>
      <form className="team-member-form" onSubmit={event => { event.preventDefault(); if (busy) return; void run(async () => { const result = await api<{ users: TeamMember[] }>('/team/users', 'POST', { username: name.trim(), password, role }); setUsers(result.users); setName(''); setPassword(''); setRole('editor'); notify('团队成员已添加，请将登录信息交给对应同事。'); }); }}>
        <Field label="用户名"><input required minLength={2} maxLength={32} autoComplete="off" value={name} onChange={event => setName(event.target.value)} disabled={busy}/></Field>
        <Field label="登录密码" hint="至少 10 位；请通过合适的方式交给对应同事。"><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/></Field>
        <Field label="权限"><select value={role} onChange={event => setRole(event.target.value as TeamRole)} disabled={busy}>{Object.entries(TEAM_ROLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <div className="modal-actions"><button type="submit" className="button primary" disabled={busy}><Plus size={16}/>添加成员</button></div>
      </form>
      <div className="section-heading"><h3>已加入的成员</h3><button type="button" className="button small" disabled={loading || busy} onClick={() => void reload()}><RefreshCw size={15}/>刷新</button></div>
      {loading && <p role="status"><Loader2 size={16} className="spin"/>正在读取成员…</p>}
      {failure && <p className="error-text" role="alert">{failure}</p>}
      <div className="team-member-list">{users.map(user => <article className="team-member" key={user.id}><div><h3>{user.username}{user.id === team.userId ? '（我）' : ''}</h3><p className="muted">加入时间：{new Date(user.createdAt).toLocaleDateString('zh-CN')}</p></div><div className="team-member-actions"><Pill color={user.disabled ? 'gray' : 'green'}>{user.disabled ? '已停用' : TEAM_ROLES[user.role]}</Pill><button className="button small" disabled={busy} onClick={() => { setEditing(user); setEditedRole(user.role); setEditedDisabled(user.disabled); setNewPassword(''); }}>管理成员</button></div></article>)}</div>
      <p className="small-note">停用成员或修改权限后，其旧会话将失效，需重新登录。工作区至少保留一名启用的管理员。</p>
    </>}
    {editing && <Modal title={`管理成员 · ${editing.username}`} description="角色和账号状态会影响该成员下一次操作；已有项目和创作记录会继续保留。" onClose={() => { if (!busy) { setEditing(null); setNewPassword(''); } }}><form onSubmit={event => { event.preventDefault(); if (busy) return; void run(async () => { const result = await api<{ users: TeamMember[] }>(`/team/users/${encodeURIComponent(editing.id)}`, 'PATCH', { role: editedRole, disabled: editedDisabled, ...(newPassword ? { password: newPassword } : {}) }); setUsers(result.users); setEditing(null); setNewPassword(''); await refresh(); notify('成员设置已保存'); }); }}>
      <Field label="权限"><select value={editedRole} onChange={event => setEditedRole(event.target.value as TeamRole)} disabled={busy}>{Object.entries(TEAM_ROLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="重设密码（选填）" hint="留空时保留现有密码。"><input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={busy}/></Field>
      <label className="checkbox-row"><input type="checkbox" checked={editedDisabled} onChange={event => setEditedDisabled(event.target.checked)} disabled={busy}/><span>停用此成员</span></label>
      {editing.id === team.userId && <p className="info-box">你正在修改自己的账号。调整权限或密码后可能需要重新登录。</p>}
      <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={() => { setEditing(null); setNewPassword(''); }}>取消</button><button type="submit" className="button primary" disabled={busy}>保存设置</button></div>
    </form></Modal>}
  </section>;
}
