import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Sprout, UsersRound } from 'lucide-react';
import App from './App';
import './local-auth.css';
import './team-workspace.css';

export type TeamSession = { token: string; username: string; userId: string; role: 'admin' | 'editor' | 'publisher'; teamMode: true };
export default function TeamAuth({ username, workspaceName, setupRequired, authenticate, logout }: {
  username: string;
  workspaceName: string;
  setupRequired: boolean;
  authenticate: (username: string, password: string, setupCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (username) return <App key={username} localUser={username} onLocalLogout={logout}/>;
  return <div className="local-auth team-auth">
    <section className="auth-story"><div className="auth-brand"><span className="brand-mark"><Sprout size={27}/></span>生长<span>.</span></div><div className="auth-story-copy"><span className="auth-eyebrow">GROW TOGETHER.</span><h1>让好想法，<br/>一起生长。</h1><p>共享品牌资料与创作成果，<br/>让每个账号都有自己的声音。</p><div className="auth-orbit" aria-hidden="true"><span>✳</span><i/><b><UsersRound size={19}/>一个团队，同一个工作区。</b></div></div><small>生长 STUDIO · 局域网团队工作站</small></section>
    <section className="auth-form-side"><div className="auth-card"><span className="auth-label"><UsersRound size={15}/>{workspaceName}</span><h2>{setupRequired ? '创建首位管理员。' : '欢迎回到团队。'}</h2><p className="auth-intro">{setupRequired ? '由主机管理员完成首次设置，之后可以添加同事。' : '使用管理员分配的账号，进入共享工作区。'}</p>
      <form onSubmit={async event => { event.preventDefault(); if (busy) return; setError(''); if (setupRequired && password !== confirmation) { setError('两次输入的密码不一致。'); return; } setBusy(true); try { await authenticate(name.trim(), password, setupRequired ? setupCode.trim() : undefined); setPassword(''); setConfirmation(''); setSetupCode(''); } catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法登录，请稍后重试。'); } finally { setBusy(false); } }}>
        <label className="field"><span>用户名</span><input required minLength={2} maxLength={32} value={name} onChange={event => setName(event.target.value)} disabled={busy} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={setupRequired ? '设置管理员用户名' : '输入你的团队用户名'}/></label>
        <label className="field"><span>密码</span><div className="auth-password"><input required minLength={setupRequired ? 10 : 1} maxLength={128} type={visible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} autoComplete={setupRequired ? 'new-password' : 'current-password'} placeholder={setupRequired ? '至少 10 位' : '输入登录密码'}/><button type="button" className="icon-button" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
        {setupRequired && <><label className="field"><span>确认密码</span><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy}/></label><label className="field"><span>首次设置码</span><input required type="password" autoComplete="off" value={setupCode} onChange={event => setSetupCode(event.target.value)} disabled={busy} placeholder="由运行主机的管理员提供"/><small>设置码由团队服务启动时生成或配置，仅用于创建第一位管理员。</small></label></>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button primary auth-submit" disabled={busy}>{busy ? <><Loader2 size={17} className="spin"/>正在连接工作区…</> : <>{setupRequired ? '创建管理员并进入' : '进入团队工作区'}<ArrowRight size={17}/></>}</button>
      </form>
      <div className="auth-privacy"><LockKeyhole size={18}/><p>项目、素材和账号身份统一保存在团队主机，同事按权限协作。浏览器无需安装桌面程序。<br/><strong>请保持主机服务运行。忘记密码时，请联系团队管理员重设。</strong></p></div>
      <p className="auth-static-note">{setupRequired ? '首次设置完成后，普通登录页面不再开放注册。' : '没有账号？请联系管理员在“连接与设置 → 团队协作”中添加。'}</p>
    </div></section>
  </div>;
}
