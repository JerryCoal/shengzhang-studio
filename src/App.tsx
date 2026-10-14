import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, BookOpen, ArrowUpRight, Bell, ChevronDown, CircleHelp, FolderOpen, LayoutDashboard, Leaf, Loader2, Menu, MessageSquareText, Search, Settings2, Sparkles, Sprout, Upload, Video, X } from 'lucide-react';
import { api, IS_STATIC, IS_WEB, LOCAL_DATA, type Mutation } from './api';
import { Context } from './context';
import type { AppearancePreferences, Page, Settings, State } from './types';
import { DashboardPage, ProjectsPage, StrategyPage, ProjectEditor } from './pages/Workspace';
import { GuidePage, PageHelp, PracticeCoach } from './pages/Guide';
import { CorpusPage } from './pages/Corpus';
import { TrendsPage } from './pages/Trends';
import { StudioPage } from './pages/Studio';
import { PublishPage, CommentsPage, PlanningPage, SettingsPage } from './pages/Operations';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AppearanceProvider, useAppearance } from './appearance';
import { BackgroundTasks } from './components/BackgroundTasks';
import { useBackgroundTasks, workspaceKey } from './useBackgroundTasks';

const navigation = [
  { page: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { page: 'projects', label: '项目与品牌', icon: FolderOpen },
  { page: 'corpus', label: '项目语料库', icon: BookOpen },
  { page: 'trends', label: '热点与灵感', icon: Search },
  { page: 'strategy', label: '策略与 Prompt', icon: Sparkles },
  { page: 'studio', label: '内容制作', icon: Video },
  { page: 'publish', label: '发布中心', icon: Upload },
  { page: 'comments', label: '评论与复盘', icon: MessageSquareText },
  { page: 'analytics', label: '运营数据', icon: BarChart3 },
  { page: 'planning', label: '下期策划', icon: Sprout },
] as const;
const validPages: Page[] = [...navigation.map(n => n.page), 'settings', 'help'];
function LocalUserLogout({ user, disabled, running, onLogout }: { user?: string; disabled: boolean; running: boolean; onLogout?: () => void | Promise<void> }) {
  const appearance = useAppearance();
  const saving = appearance?.saving;
  return <button className="text-button local-user-button" disabled={disabled || saving} title={saving ? '正在保存外观设置，请稍候再退出' : running ? '请等待后台任务完成再退出用户' : undefined} onClick={() => { if (!saving) void onLogout?.(); }} aria-label="退出当前本地用户"><span>{user}</span> · 退出</button>;
}
function initialPage(): Page { const page = location.hash.slice(1) as Page; return validPages.includes(page) ? page : 'dashboard'; }
function WorkspacePage({ page, search }: { page: Page; search: string }) {
  switch (page) {
    case 'help': return <GuidePage/>;
    case 'dashboard': return <DashboardPage/>;
    case 'projects': return <ProjectsPage search={search}/>;
    case 'corpus': return <CorpusPage/>;
    case 'trends': return <TrendsPage/>;
    case 'strategy': return <StrategyPage/>;
    case 'studio': return <StudioPage/>;
    case 'publish': return <PublishPage/>;
    case 'comments': return <CommentsPage/>;
    case 'analytics': return <AnalyticsPage/>;
    case 'planning': return <PlanningPage/>;
    case 'settings': return <SettingsPage/>;
  }
}
export default function App({ localUser, onLocalLogout }: { localUser?: string; onLocalLogout?: () => void | Promise<void> } = {}) {
  const [state, setState] = useState<State | null>(null); const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>(initialPage); const [selectedId, setSelectedId] = useState(LOCAL_DATA ? '' : localStorage.getItem('studio-project') || '');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [sidebar, setSidebar] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [bootError, setBootError] = useState(''); const [login, setLogin] = useState(false); const [password, setPassword] = useState(''); const [search, setSearch] = useState('');
  const readSequence = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; clearTimeout(toastTimer.current); }; }, []);
  const refresh = useCallback(async () => { if (!alive.current) return; const request = ++readSequence.current; const [s, config] = await Promise.all([api<State>('/state'), api<Settings>('/settings')]); if (alive.current && request === readSequence.current) { setState(s); setSettings(config); setBootError(''); } }, []);
  const notify = useCallback((message: string, error = false) => { if (!alive.current) return; clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), error ? 8500 : 4500); }, []);
  const background = useBackgroundTasks(notify, refresh, () => busyRef.current, IS_WEB);
  const anyRunning = background.tasks.some(task => task.status === 'running');
  useEffect(() => {
    const preventExit = (event: BeforeUnloadEvent) => { if (background.locked()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventExit);
    return () => window.removeEventListener('beforeunload', preventExit);
  }, [background.locked]);
  useEffect(() => {
    const auth = () => setLogin(true); window.addEventListener('studio-auth-required', auth);
    api<{ authRequired: boolean }>('/health').then(health => { if (health.authRequired && !sessionStorage.getItem('studio-session')) setLogin(true); else return refresh(); }).catch(e => setBootError(e.message));
    const hash = () => setPage(initialPage()); window.addEventListener('hashchange', hash);
    return () => { window.removeEventListener('studio-auth-required', auth); window.removeEventListener('hashchange', hash); };
  }, [refresh]);
  const run = async (work: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await work(); } catch (error) { notify(error instanceof Error ? error.message : '操作失败，请重试', true); await refresh().catch(() => {}); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const mutate = async <T,>(path: string, method = 'POST', body?: unknown) => {
    if (!alive.current) throw new Error('原工作区已关闭，请重新登录后核对任务状态。');
    // A slow mutation response can contain an older full-workspace snapshot. Read the
    // current store instead; never replace other projects with that response snapshot.
    readSequence.current++;
    const result = await api<Mutation<T>>(path, method, body);
    if (alive.current) await refresh().catch(() => notify('操作已返回，但暂未刷新到最新内容，请稍后重新查看；不要重复提交。', true));
    return result;
  };
  const go = (target: Page, projectId?: string) => {
    if (projectId) { setSelectedId(projectId); if (!LOCAL_DATA) localStorage.setItem('studio-project', projectId); }
    setPage(target); location.hash = target; setSidebar(false); window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const help = (event: KeyboardEvent) => { if (event.key !== 'F1') return; event.preventDefault(); if (!document.querySelector('dialog[open]')) { setPage('help'); location.hash = 'help'; setSidebar(false); window.scrollTo({ top: 0 }); } };
    window.addEventListener('keydown', help); return () => window.removeEventListener('keydown', help);
  }, []);
  const project = state?.projects.find(p => p.id === selectedId) || state?.projects[0];
  const viewId = project?.id || '';
  const currentKey = workspaceKey(page, viewId);
  const progressVersion = state?.projects.map(p => `${p.id}:${p.revision}`).join('|');
  const hasBackgroundWork = state?.projects.some(p => p.feishuPlan?.autoSync || p.assets.some(a => a.aiCover?.phase === 'generating' || ['generating-frame', 'submitting-video', 'generating-video'].includes(a.aiProduction?.phase || '')) || p.publications.some(r => r.commentSync?.enabled));
  useEffect(() => {
    if (!hasBackgroundWork || login) return;
    let checking = false;
    const timer = setInterval(async () => { if (checking || busyRef.current) return; checking = true; try { const result = await api<{ version: string }>('/progress-version'); if (result.version !== progressVersion) await refresh(); } catch { /* Keep the current screen usable; the next poll can recover. */ } finally { checking = false; } }, 8000);
    return () => clearInterval(timer);
  }, [hasBackgroundWork, progressVersion, refresh, login]);
  if (login) return <div className="boot-screen login-screen"><div className="brand-mark"><Sprout size={30}/></div><h1>欢迎回到生长</h1><p>登录你的运营工作区</p><form onSubmit={e => { e.preventDefault(); void run(async () => { const result = await api<{ token: string }>('/login', 'POST', { password }); sessionStorage.setItem('studio-session', result.token); setPassword(''); setLogin(false); await refresh(); }); }}><label className="field"><span>工作区密码</span><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label><button className="button primary" disabled={busy}>登录工作区</button></form>{toast && <p className="error-text" role="alert">{toast.message}</p>}</div>;
  if (!state || !settings) return <div className="boot-screen"><div className="brand-mark"><Sprout size={32}/></div><h2>{bootError ? '暂时连接不上工作区' : '让好想法，慢慢生长'}</h2><p>{bootError || '正在打开你的运营工作台…'}</p>{bootError ? <button className="button primary" onClick={() => void refresh().catch(e => setBootError(e.message))}>重新连接</button> : <Loader2 className="spin"/>}</div>;
  const pageLabel = page === 'help' ? '使用指南' : navigation.find(n => n.page === page)?.label || '连接与设置';
  const upcoming = state.projects.flatMap(p => p.publications).filter(p => ['scheduled', 'exported'].includes(p.status)).length;
  const baseContext = { state, project, settings, busy, go, notify, run, mutate, refresh, startProject: () => setNewProject(true), runBackground: (label: string, work: () => Promise<unknown>) => background.run({ page, projectId: viewId, projectName: project?.brief.name || '工作区' }, label, work) };
  const views = [...new Map([...background.tasks.filter(task => task.retained || task.status === 'running').map(task => ({ page: task.page, projectId: task.projectId, key: task.workspaceKey })), { page, projectId: viewId, key: currentKey }].map(view => [view.key, view])).values()];
  return <AppearanceProvider persisted={state.appearance} save={value => mutate<AppearancePreferences>('/appearance', 'PUT', value)}><Context.Provider value={baseContext}>
    <div className="app-shell">
      {sidebar && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setSidebar(false)}/>}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <button className="brand" onClick={() => go('dashboard')}><span className="brand-mark"><Sprout size={27}/></span><span><strong>生长<span className="brand-dot">.</span></strong><small>AI 运营工作台</small></span></button>
        <div className="workspace-switch"><span className="workspace-avatar">{localUser?.slice(0, 1) || '我'}</span><div><b>{localUser ? `${localUser}的工作区` : '我的工作空间'}</b><small>{LOCAL_DATA ? '独立用户 · 浏览器本地保存' : localUser ? '独立用户 · 电脑本地加密' : '个人创作 · MVP'}</small></div><ChevronDown size={15}/></div>
        <div className="nav-caption">创作空间</div>
        <nav aria-label="主导航">{navigation.map(({ page: target, label, icon: Icon }) => <button key={target} className={`nav-item ${page === target ? 'active' : ''}`} onClick={() => { setSearch(''); go(target); }} aria-current={page === target ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{target === 'publish' && upcoming > 0 && <span className="nav-count">{upcoming}</span>}{target === 'strategy' && <span className="nav-ai">AI</span>}</button>)}</nav>
        <div className="sidebar-bottom"><button className={`nav-item ${page === 'help' ? 'active' : ''}`} onClick={() => go('help')} aria-current={page === 'help' ? 'page' : undefined}><CircleHelp size={19}/><span>使用指南</span><span className="nav-ai">F1</span></button><div className="growth-note"><span className="note-flower">✳</span><b>每一次创作，都是积累。</b><p>让真实反馈成为<br/>下一次好内容的起点。</p><button onClick={() => go('planning')}>看看品牌经验 <ArrowUpRight size={14}/></button></div><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><Settings2 size={19}/><span>连接与设置</span></button><div className="sidebar-footer"><span className="dot"/>本地工作区<span>v{settings.version}</span></div></div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><div className="row gap-12"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setSidebar(true)}><Menu size={22}/></button><span className="breadcrumb">创作空间 <span>/</span> <b>{pageLabel}</b></span></div><div className="top-actions"><BackgroundTasks tasks={background.tasks} onDismiss={background.dismiss} onOpen={task => { background.resume(task); go(task.page, task.projectId); }}/><label className="searchbox"><Search size={16}/><input aria-label="搜索项目" placeholder="搜索项目…" value={search} onChange={e => { setSearch(e.target.value); if (page !== 'projects') go('projects'); }}/><kbd>⌕</kbd></label><button className="icon-button help-button" aria-label="打开使用指南" title="使用指南 · F1" onClick={() => go('help')}><CircleHelp size={19}/></button><button className="icon-button bell-button" aria-label={`待发布计划 ${upcoming} 条`} onClick={() => go('publish')}><Bell size={19}/>{upcoming > 0 && <span/>}</button><span className="user-avatar">我</span></div></header>
        <main>
          {IS_STATIC && <div className="static-notice"><Leaf size={16}/><span>静态体验版 · 当前数据仅在此浏览器中加密保存。AI 生成与可选评论同步需本地完整版；发布请导出后手动完成。</span><a className="text-button green" href="https://github.com/JerryCoal/shengzhang-studio/releases/latest" target="_blank" rel="noreferrer">下载 Windows 完整版 ↗</a><LocalUserLogout user={localUser} disabled={busy || anyRunning} running={anyRunning} onLogout={onLocalLogout}/></div>}
          {!IS_STATIC && localUser && <div className="static-notice"><Leaf size={16}/><span>{IS_WEB ? '联网网页版 · 数据仅在此浏览器加密保存 · 自动任务需保持网页打开' : 'Windows 完整版 · 本地加密保存 · 保持应用运行以执行后台任务'}</span><LocalUserLogout user={localUser} disabled={busy || anyRunning} running={anyRunning} onLogout={() => { if (!background.locked()) return run(async () => { await onLocalLogout?.(); }); }}/></div>}
          {!['dashboard', 'projects', 'settings', 'help'].includes(page) && state.projects.length > 0 && <div className="project-context"><span className="project-context-icon"><FolderOpen size={16}/></span><label htmlFor="active-project">当前项目</label><select id="active-project" value={project?.id} onChange={e => go(page, e.target.value)}>{state.projects.map(p => <option key={p.id} value={p.id}>{p.brief.name}{p.sample ? '（示例）' : ''}</option>)}</select><span className="context-separator"/><span className="muted">{project?.brief.brand}</span></div>}
          <PracticeCoach page={page}/><PageHelp page={page}/>
          {page === 'settings' && anyRunning && <p className="info-box">后台任务正在使用当前连接配置，完成后即可修改连接设置。外观与阅读选项仍可即时调整。</p>}
          {views.map(view => {
            const visible = view.key === currentKey;
            const origin = state.projects.find(item => item.id === view.projectId);
            const taskPending = background.tasks.some(task => task.workspaceKey === view.key && task.status === 'running');
            const projectLocked = background.locked(view.projectId);
            const locked = busy || (view.page === 'settings' ? anyRunning : projectLocked);
            const minimized = background.minimized.includes(view.key);
            const viewTasks = background.tasks.filter(task => task.workspaceKey === view.key && task.retained);
            const context = { ...baseContext, project: origin, busy: locked, taskPending, dialogsVisible: visible && !minimized,
              minimizeTask: () => background.minimize(view.key),
              restoreDialogs: () => background.restoreDialogs(view.key),
              run: (work: () => Promise<unknown>) => {
                if (background.locked(view.page === 'settings' ? undefined : view.projectId)) { notify('当前项目仍在处理。可以先查看资料，或切换到其他项目继续工作。'); return Promise.resolve(); }
                return run(work);
              },
              runBackground: (label: string, work: () => Promise<unknown>) => background.run({ page: view.page, projectId: view.projectId, projectName: origin?.brief.name || '工作区' }, label, work),
            };
            return <Context.Provider key={view.key} value={context}><div hidden={!visible} className="workspace-view">
              {projectLocked && <div className="background-work-notice" role="status"><Loader2 size={16} className="spin"/><span>本项目正在处理，可切换到其他项目继续工作。结果会留在原项目。</span>{taskPending && !minimized && <button className="button small" onClick={() => background.minimize(view.key)}>收起窗口</button>}</div>}
              {minimized && viewTasks.length > 0 && <div className="background-work-notice"><span>{taskPending ? '任务窗口已收起，请保持应用运行。' : '处理已结束，可以返回查看结果或错误详情。'}</span><button className="button small" onClick={() => background.resume(viewTasks[viewTasks.length - 1])}>查看任务窗口</button></div>}
              <WorkspacePage page={view.page} search={search}/>
            </div></Context.Provider>;
          })}
          <footer className="main-footer"><Leaf size={13}/> 从一个想法，到持续生长的品牌。<span>生长 STUDIO</span></footer>
        </main>
      </div>
      {newProject && <ProjectEditor onClose={() => setNewProject(false)}/>}
      {busy && <div className="busy-indicator" role="status"><Loader2 className="spin" size={16}/>正在处理，请稍候…</div>}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={16}/></button></div>}
    </div>
  </Context.Provider></AppearanceProvider>;
}
