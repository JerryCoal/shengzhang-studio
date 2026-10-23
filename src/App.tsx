import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BookOpen, CircleHelp, FolderOpen, LayoutDashboard, Leaf, Lightbulb, Loader2, Menu, Search, Settings2, Sparkles, Sprout, Upload, UsersRound, Video, X } from 'lucide-react';
import { api, IS_STATIC, IS_WEB, LOCAL_DATA, type Mutation } from './api';
import { Context, type WorkspaceTarget } from './context';
import { readWorkspaceRoute, resolveWorkspacePage, writeWorkspaceRoute } from './workspace-route.mjs';
import type { AppearancePreferences, Page, Settings, State } from './types';
import { DashboardPage, ProjectsPage, StrategyPage, ProjectEditor } from './pages/Workspace';
import { GuidePage, PageHelp, PracticeCoach } from './pages/Guide';
import { CorpusPage } from './pages/Corpus';
import { TrendsPage } from './pages/Trends';
import { StudioPage } from './pages/Studio';
import { PublishPage, SettingsPage } from './pages/Operations';
import { openPublishingSettings } from './pages/SettingsPage';
import './feishu-theme.css';
import './feishu-shell.css';
import './settings-layout.css';
import { AppearanceProvider, useAppearance } from './appearance';
import { BackgroundTasks } from './components/BackgroundTasks';
import { useBackgroundTasks, workspaceKey, type BackgroundControl } from './useBackgroundTasks';
import { TEAM_ROLES } from './pages/TeamSettings';
import { ReviewWorkspace } from './pages/ReviewWorkspace';
import './workflow-shell.css';
import { AnalysisAgent, InspirationAgent, PlatformAgent } from './pages/AgentWorkspace';
import { WorkspaceScopePicker, WorkspaceScopeSummary } from './components/WorkspaceScope';
import { normalizeWorkspaceScope, scopeWithPrimary, type WorkspaceScope } from './workspace-scope.mjs';
import './publish-layout.css';
import { flushWorkspaceSavers } from './workspace-save';
import { AccountsPage, ControllerPage, MaterialsPage, WorkNotificationCenter } from './pages/WorkControl';

const primaryNavigation = [
  { page: 'controller', label: '总控', icon: Sparkles },
  { page: 'accounts', label: '账号', icon: UsersRound },
  { page: 'materials', label: '资料', icon: BookOpen },
] as const;

const navigation = [
  { page: 'dashboard', label: '工作概览', icon: LayoutDashboard },
  { page: 'studio', label: '历史内容', icon: Video },
  { page: 'publish', label: '发布与交付', icon: Upload },
  { page: 'analysis-agent', label: '结果复盘', icon: Lightbulb },
] as const;
export function WorkspaceNavigation({ page, upcoming, onNavigate }: { page: Page; upcoming: number; onNavigate: (page: Page) => void }) {
  return <nav className="workspace-navigation" aria-label="主导航"><div className="work-primary-navigation">{primaryNavigation.map(({ page: destination, label, icon: Icon }) => <button className={`nav-item ${page === destination ? 'active' : ''}`} key={destination} aria-current={page === destination ? 'page' : undefined} onClick={() => onNavigate(destination)}><Icon size={19}/><span>{label}</span></button>)}</div><details className="work-legacy-navigation" open={navigation.some(item => item.page === page)}><summary>历史与交付</summary><div className="navigation-group">{navigation.map(({ page: destination, label, icon: Icon }) => <button key={destination} className={`nav-item ${page === destination ? 'active' : ''}`} onClick={() => onNavigate(destination)} aria-current={page === destination ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{destination === 'publish' && upcoming > 0 && <span className="nav-count">{upcoming}</span>}</button>)}</div></details></nav>;
}
function LocalUserLogout({ user, disabled, running, onLogout }: { user?: string; disabled: boolean; running: boolean; onLogout?: () => void | Promise<void> }) {
  const appearance = useAppearance();
  const saving = appearance?.saving;
  return <button className="text-button local-user-button" disabled={disabled || saving} title={saving ? '正在保存外观设置，请稍候再退出' : running ? '请等待后台任务完成再退出用户' : undefined} onClick={() => { if (!saving) void onLogout?.(); }} aria-label="退出当前用户"><span>{user}</span> · 退出</button>;
}
function initialPage(): Page { return location.hash ? readWorkspaceRoute(location.hash).page : 'controller'; }
function WorkspacePage({ page, search }: { page: Page; search: string }) {
  switch (page) {
    case 'controller': return <ControllerPage/>;
    case 'tasks': return <ControllerPage/>;
    case 'accounts': return <AccountsPage/>;
    case 'materials': return <MaterialsPage/>;
    case 'inspiration': return <InspirationAgent/>;
    case 'xiaohongshu-agent': return <PlatformAgent platform="xiaohongshu"/>;
    case 'douyin-agent': return <PlatformAgent platform="douyin"/>;
    case 'instagram-agent': return <PlatformAgent platform="instagram"/>;
    case 'youtube-agent': return <PlatformAgent platform="youtube"/>;
    case 'analysis-agent': return <AnalysisAgent/>;
    case 'help': return <GuidePage/>;
    case 'dashboard': return <DashboardPage/>;
    case 'projects': return <ProjectsPage search={search}/>;
    case 'corpus': return <CorpusPage/>;
    case 'trends': return <TrendsPage/>;
    case 'strategy': return <StrategyPage/>;
    case 'studio': return <StudioPage/>;
    case 'publish': return <PublishPage/>;
    case 'comments': return <ReviewWorkspace/>;
    case 'analytics': return <ReviewWorkspace initialTab="metrics"/>;
    case 'planning': return <ReviewWorkspace initialTab="experience"/>;
    case 'settings': return <SettingsPage/>;
  }
}
export default function App({ localUser, onLocalLogout }: { localUser?: string; onLocalLogout?: () => void | Promise<void> } = {}) {
  const [state, setState] = useState<State | null>(null); const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>(initialPage); const [selectedId, setSelectedId] = useState(readWorkspaceRoute(location.hash).projectId || (LOCAL_DATA ? '' : localStorage.getItem('studio-project') || ''));
  const [selectedScope, setSelectedScope] = useState<WorkspaceScope>({ projectIds: [], accountIds: [] });
  const setAccountScope = useCallback((accountId: string) => setSelectedScope(current => ({ ...current, accountIds: accountId ? [accountId] : [] })), []);
  const selectedProjectRef = useRef(selectedId); selectedProjectRef.current = selectedId;
  const [targets, setTargets] = useState<Record<string, WorkspaceTarget>>({});
  const routeTarget = useRef(readWorkspaceRoute(location.hash));
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [sidebar, setSidebar] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [teamUpdate, setTeamUpdate] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [bootError, setBootError] = useState(''); const [login, setLogin] = useState(false); const [password, setPassword] = useState(''); const [search, setSearch] = useState('');
  const readSequence = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; clearTimeout(toastTimer.current); }; }, []);
  const refresh = useCallback(async () => { if (!alive.current) return; const request = ++readSequence.current; const [s, config] = await Promise.all([api<State>('/state'), api<Settings>('/settings')]); if (alive.current && request === readSequence.current) { setState(s); setSettings(config); setBootError(''); setTeamUpdate(false); } }, []);
  const notify = useCallback((message: string, error = false) => { if (!alive.current) return; clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), error ? 8500 : 4500); }, []);
  const background = useBackgroundTasks(notify, refresh, () => busyRef.current, IS_WEB, localUser || 'workspace', state?.projects);
  const anyRunning = background.tasks.some(task => background.active(task.status));
  useEffect(() => {
    const auth = () => setLogin(true); window.addEventListener('studio-auth-required', auth);
    api<{ authRequired: boolean }>('/health').then(health => { if (health.authRequired && !sessionStorage.getItem('studio-session')) setLogin(true); else return refresh(); }).catch(e => setBootError(e.message));
    const hash = () => {
      const route = readWorkspaceRoute(location.hash); routeTarget.current = route;
      setPage(route.page);
      if (route.projectId) { setSelectedId(route.projectId); setSelectedScope(current => scopeWithPrimary(current, route.projectId!)); }
      if (route.target.assetId || route.target.publicationId) setAccountScope('');
      setTargets(current => ({ ...current, [workspaceKey(route.page, route.projectId || selectedProjectRef.current)]: route.target }));
    }; window.addEventListener('hashchange', hash);
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
  const go = (target: Page, projectId?: string, detail: WorkspaceTarget = {}) => {
    target = resolveWorkspacePage(target);
    const destination = projectId || selectedId || state?.projects[0]?.id || '';
    if (detail.assetId || detail.publicationId) setAccountScope('');
    if (projectId) { setSelectedId(projectId); setSelectedScope(current => scopeWithPrimary(current, projectId)); if (!LOCAL_DATA) localStorage.setItem('studio-project', projectId); }
    setTargets(current => ({ ...current, [workspaceKey(target, destination)]: detail }));
    setPage(target); history.pushState(null, '', writeWorkspaceRoute(target, destination, detail)); setSidebar(false); window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const help = (event: KeyboardEvent) => { if (event.key !== 'F1') return; event.preventDefault(); if (!document.querySelector('dialog[open]')) { setPage('help'); location.hash = 'help'; setSidebar(false); window.scrollTo({ top: 0 }); } };
    window.addEventListener('keydown', help); return () => window.removeEventListener('keydown', help);
  }, []);
  const project = state?.projects.find(p => p.id === selectedId) || state?.projects[0];
  const scope = normalizeWorkspaceScope(selectedScope, state?.projects.map(item => item.id) || [], state?.accounts.map(item => item.id) || [], project?.id || '');
  // Old pages retain their single-account interface; multi-account readers use scope.
  const accountScope = scope.accountIds.length === 1 ? scope.accountIds[0] : '';
  const setScope = (next: WorkspaceScope) => setSelectedScope(normalizeWorkspaceScope(next, state?.projects.map(item => item.id) || [], state?.accounts.map(item => item.id) || [], project?.id || ''));
  useEffect(() => {
    if (!state) return;
    setSelectedScope(current => {
      const next = normalizeWorkspaceScope(current, state.projects.map(item => item.id), state.accounts.map(item => item.id), project?.id || '');
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  }, [state?.projects, state?.accounts, project?.id]);
  // Keep the current project stable when another member adds a project at the
  // front of the shared list; otherwise a refresh remounts open editing views.
  useEffect(() => { if (project && project.id !== selectedId) setSelectedId(project.id); }, [project?.id, selectedId]);
  const viewId = project?.id || '';
  const currentKey = workspaceKey(page, viewId);
  const progressVersion = state?.projects.map(p => `${p.id}:${p.revision}`).join('|');
  const hasBackgroundWork = state?.projects.some(p => p.feishuPlan?.autoSync || p.assets.some(a => a.aiCover?.phase === 'generating' || ['generating-frame', 'submitting-video', 'generating-video'].includes(a.aiProduction?.phase || '')) || p.publications.some(r => r.commentSync?.enabled));
  useEffect(() => {
    if (!hasBackgroundWork || login || settings?.team) return;
    let checking = false;
    const timer = setInterval(async () => { if (checking || busyRef.current) return; checking = true; try { const result = await api<{ version: string }>('/progress-version'); if (result.version !== progressVersion) await refresh(); } catch { /* Keep the current screen usable; the next poll can recover. */ } finally { checking = false; } }, 8000);
    return () => clearInterval(timer);
  }, [hasBackgroundWork, progressVersion, refresh, login, settings?.team]);
  useEffect(() => {
    if (!settings?.team || login) return;
    let checking = false, active = true;
    const timer = setInterval(async () => {
      if (checking || busyRef.current || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const result = await api<{ version: string; workspaceVersion?: number }>('/progress-version');
        if (!active) return;
        const changed = result.workspaceVersion !== undefined ? result.workspaceVersion !== state?.teamRevision : result.version !== progressVersion;
        if (!changed) return;
        // Poll only passive overview screens automatically. Editing screens retain
        // their local drafts until the user explicitly asks for the shared update.
        const editing = document.activeElement?.matches('input,textarea,select,[contenteditable="true"]') || !!document.querySelector('dialog[open]');
        if (['dashboard', 'projects', 'analytics'].includes(page) && !editing && !anyRunning && !newProject) await refresh();
        else setTeamUpdate(true);
      } catch { /* Keep drafts usable during a brief connection interruption. */ }
      finally { checking = false; }
    }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [settings?.team, state?.teamRevision, progressVersion, page, anyRunning, newProject, login, refresh]);
  if (login) return <div className="boot-screen login-screen"><div className="brand-mark"><Sprout size={30}/></div><h1>欢迎回到生长</h1><p>登录你的运营工作区</p><form onSubmit={e => { e.preventDefault(); void run(async () => { const result = await api<{ token: string }>('/login', 'POST', { password }); sessionStorage.setItem('studio-session', result.token); setPassword(''); setLogin(false); await refresh(); }); }}><label className="field"><span>工作区密码</span><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label><button className="button primary" disabled={busy}>登录工作区</button></form>{toast && <p className="error-text" role="alert">{toast.message}</p>}</div>;
  if (!state || !settings) return <div className="boot-screen"><div className="brand-mark"><Sprout size={32}/></div><h2>{bootError ? '暂时连接不上工作区' : '让好想法，慢慢生长'}</h2><p>{bootError || '正在打开你的运营工作台…'}</p>{bootError ? <button className="button primary" onClick={() => void refresh().catch(e => setBootError(e.message))}>重新连接</button> : <Loader2 className="spin"/>}</div>;
  const pageLabel = ({ controller: '总控', tasks: '总控', accounts: '账号', materials: '资料', projects: '项目与账号', corpus: '项目文档', strategy: '内容计划', comments: '结果与复盘', analytics: '结果与复盘', planning: '运营经验', help: '使用指南', inspiration: '历史灵感工作区', 'xiaohongshu-agent': '小红书历史工作区', 'douyin-agent': '抖音历史工作区', 'instagram-agent': 'Instagram 历史工作区', 'youtube-agent': 'YouTube 历史工作区', trends: '资料与经验' } as Record<string, string>)[page] || navigation.find(n => n.page === page)?.label || '连接与设置';
  const upcoming = state.projects.flatMap(p => p.publications).filter(p => ['scheduled', 'exported'].includes(p.status)).length;
  const taskOrigin = (taskPage: Page, taskProjectId: string, taskProjectName: string, detail: WorkspaceTarget) => {
    const source = state.projects.find(item => item.id === taskProjectId)?.assets.find(item => item.id === detail.assetId);
    const accountId = source?.contentBrief?.accountId || detail.accountId;
    return { page: taskPage, projectId: taskProjectId, projectName: taskProjectName, target: structuredClone(detail), accountId, accountName: state.accounts.find(item => item.id === accountId)?.name };
  };
  const baseContext = { state, project, settings, busy, go, target: targets[currentKey] || (routeTarget.current.page === page && (!routeTarget.current.projectId || routeTarget.current.projectId === viewId) ? routeTarget.current.target : {}), scope, setScope, accountScope, setAccountScope, notify, run, mutate, refresh, startProject: () => setNewProject(true), runBackground: (label: string, work: (control: BackgroundControl) => Promise<unknown>) => background.run(taskOrigin(page, viewId, project?.brief.name || '工作区', targets[currentKey] || routeTarget.current.target), label, work) };
  const views = [...new Map([...background.tasks.filter(task => task.retained || background.active(task.status)).map(task => ({ page: task.page, projectId: task.projectId, key: task.workspaceKey })), { page, projectId: viewId, key: currentKey }].map(view => [view.key, view])).values()];
  return <AppearanceProvider persisted={state.appearance} save={value => mutate<AppearancePreferences>('/appearance', 'PUT', value)}><Context.Provider value={baseContext}>
    <div className="app-shell feishu-workspace">
      {sidebar && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setSidebar(false)}/>}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') setSidebar(false); }}>
        <button className="icon-button sidebar-close" aria-label="收起导航" onClick={() => setSidebar(false)}><X size={20}/></button>
        <button className="brand" onClick={() => go('controller')}><span className="brand-mark"><Sprout size={27}/></span><span><strong>生长<span className="brand-dot">.</span></strong><small>SHENGZHANG STUDIO · v2</small></span></button>
        <div className="workspace-switch"><span className="workspace-avatar">{settings.team ? '团' : localUser?.slice(0, 1) || '我'}</span><div><b>{settings.team?.workspaceName || (localUser ? `${localUser}的工作区` : '我的工作空间')}</b><small>{settings.team ? `${localUser} · ${TEAM_ROLES[settings.team.role]}` : LOCAL_DATA ? '独立用户 · 浏览器本地保存' : localUser ? '独立用户 · 电脑本地加密' : '个人创作 · MVP'}</small></div></div>
        <WorkspaceScopePicker projects={state.projects} accounts={state.accounts} primaryProjectId={viewId} scope={scope} onChange={setScope} onEditProject={id => go(page, id)} onManage={() => go('projects')}/>
        <WorkspaceNavigation page={page} upcoming={upcoming} onNavigate={destination => { setSearch(''); go(destination); }}/>
        <div className="sidebar-bottom"><button className={`nav-item ${page === 'projects' ? 'active' : ''}`} onClick={() => go('projects')}><FolderOpen size={19}/><span>项目与账号</span></button><button className="nav-item platform-accounts-entry" onClick={() => { setSearch(''); openPublishingSettings(go); }}><UsersRound size={19}/><span>账号连接与身份</span><span className="nav-count">{state.accounts.length}</span></button><button className={`nav-item ${page === 'help' ? 'active' : ''}`} onClick={() => go('help')} aria-current={page === 'help' ? 'page' : undefined}><CircleHelp size={19}/><span>使用指南</span><span className="nav-ai">F1</span></button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><Settings2 size={19}/><span>连接与设置</span></button><div className="sidebar-footer"><span className="dot"/>{settings.team ? '团队工作区' : '本地工作区'}<span>v{settings.version}</span></div></div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><div className="row gap-12"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setSidebar(true)}><Menu size={22}/></button><span className="breadcrumb">创作空间 <span>/</span> <b>{pageLabel}</b></span></div><div className="top-actions"><WorkNotificationCenter/><details className="work-legacy-progress"><summary>旧版任务</summary><BackgroundTasks tasks={background.tasks} onDismiss={background.dismiss} onPause={background.pause} onContinue={background.continueTask} muted={background.muted} onToggleMuted={background.toggleMuted} serial={IS_WEB} onOpen={task => { background.resume(task); go(task.page, task.projectId, task.target || targets[task.workspaceKey] || {}); }}/></details><label className="searchbox"><Search size={16}/><input aria-label="搜索项目" placeholder="搜索项目…" value={search} onChange={e => { setSearch(e.target.value); if (page !== 'projects') go('projects'); }}/><kbd>⌕</kbd></label><button className="icon-button help-button" aria-label="打开使用指南" title="使用指南 · F1" onClick={() => go('help')}><CircleHelp size={19}/></button><button className="icon-button bell-button" aria-label={`待发布计划 ${upcoming} 条`} onClick={() => go('publish')}><Bell size={19}/>{upcoming > 0 && <span/>}</button><span className="user-avatar" title={localUser || '当前工作区'}>{localUser?.slice(0, 1) || '我'}</span></div></header>
        <main className={page === 'controller' ? 'controller-main' : undefined}>
          {IS_STATIC && <div className="static-notice"><Leaf size={16}/><span>静态体验版 · 当前数据仅在此浏览器中加密保存。AI 生成与可选评论同步需本地完整版；发布请导出后手动完成。</span><a className="text-button green" href="https://github.com/JerryCoal/shengzhang-studio/releases/latest" target="_blank" rel="noreferrer">下载 Windows 完整版 ↗</a><LocalUserLogout user={localUser} disabled={busy || anyRunning} running={anyRunning} onLogout={() => run(async () => { await flushWorkspaceSavers(); await onLocalLogout?.(); })}/></div>}
          {!IS_STATIC && localUser && <div className="static-notice"><Leaf size={16}/><span>{settings.team ? '团队模式 · 项目与素材保存在主机 · 主机需持续运行' : IS_WEB ? '联网网页版 · 数据仅在此浏览器加密保存 · 自动任务需保持网页打开' : 'Windows 完整版 · 本地加密保存 · 保持应用运行以执行后台任务'}</span><LocalUserLogout user={localUser} disabled={busy || anyRunning} running={anyRunning} onLogout={() => { if (!background.locked()) return run(async () => { await flushWorkspaceSavers(); await onLocalLogout?.(); }); }}/></div>}
          {settings.team && teamUpdate && <div className="team-update-notice" role="status"><span>团队工作区有新内容。当前输入已保留，请完成或保存后刷新查看。</span><button className="button small" disabled={busy || anyRunning || newProject} onClick={() => { if (document.querySelector('dialog[open]')) notify('请先保存或关闭当前编辑窗口，再刷新团队内容。'); else void run(refresh); }}>刷新团队内容</button></div>}
          {settings.team?.role === 'editor' && page === 'publish' && <p className="info-box">当前为创作者权限，可以预览和导出内容。修改发布计划、标记发布或直接投稿需要发布者或管理员权限。</p>}
          {state.projects.length > 0 && <WorkspaceScopeSummary projects={state.projects} accounts={state.accounts} primaryProjectId={viewId} scope={scope} onOpen={() => { setSidebar(true); const picker = document.querySelector('.workspace-scope-picker'); picker?.querySelectorAll('details').forEach(item => { item.open = true; }); picker?.scrollIntoView({ block: 'nearest' }); }}/>} 
          {!primaryNavigation.some(item => item.page === page) && <details className="workflow-help"><summary>页面帮助</summary><PracticeCoach page={page}/><PageHelp page={page}/></details>}
          {page === 'settings' && anyRunning && <p className="info-box">后台任务正在使用当前连接配置，完成后即可修改连接设置。外观与阅读选项仍可即时调整。</p>}
          {views.map(view => {
            const visible = view.key === currentKey;
            const origin = state.projects.find(item => item.id === view.projectId);
            const taskPending = background.tasks.some(task => task.workspaceKey === view.key && background.active(task.status));
            const projectLocked = background.locked(view.projectId, view.page);
            const locked = busy || (view.page === 'settings' ? anyRunning : projectLocked);
            const minimized = background.minimized.includes(view.key);
            const viewTasks = background.tasks.filter(task => task.workspaceKey === view.key && task.retained);
            const currentTask = viewTasks.at(-1);
            const context = { ...baseContext, target: view.key === currentKey ? baseContext.target : targets[view.key] || {}, project: origin, busy: locked, taskPending, dialogsVisible: visible && !minimized,
              backgroundTask: currentTask,
              pauseBackground: currentTask ? () => background.pause(currentTask.id) : undefined,
              continueBackground: currentTask ? () => background.continueTask(currentTask.id) : undefined,
              minimizeTask: () => background.minimize(view.key),
              restoreDialogs: () => background.restoreDialogs(view.key),
              run: (work: () => Promise<unknown>) => {
                if (background.locked(view.page === 'settings' ? undefined : view.projectId, view.page === 'settings' ? undefined : view.page)) { notify('当前 Agent 仍在处理，可以先切换到其他 Agent 继续工作。'); return Promise.resolve(); }
                return run(work);
              },
              runBackground: (label: string, work: (control: BackgroundControl) => Promise<unknown>, frozenTarget?: WorkspaceTarget) => background.run(taskOrigin(view.page, view.projectId, origin?.brief.name || '工作区', frozenTarget || (view.key === currentKey ? baseContext.target : targets[view.key] || {})), label, work),
            };
            return <Context.Provider key={view.key} value={context}><div hidden={!visible} className="workspace-view">
              {projectLocked && <div className="background-work-notice" role="status"><Loader2 size={16} className="spin"/><span>此 Agent 正在处理，可切换其他 Agent 继续工作；结果保留原项目与账号归属。</span>{taskPending && !minimized && <button className="button small" onClick={() => background.minimize(view.key)}>收起窗口</button>}</div>}
              {minimized && viewTasks.length > 0 && <div className="background-work-notice"><span>{taskPending ? '任务窗口已收起，请保持应用运行。' : '处理已结束，可以返回查看结果或错误详情。'}</span><button className="button small" onClick={() => background.resume(viewTasks[viewTasks.length - 1])}>查看任务窗口</button></div>}
              <WorkspacePage page={view.page} search={search}/>
            </div></Context.Provider>;
          })}
          <footer className="main-footer"><Leaf size={13}/> 从一个想法，到持续生长的品牌。<span>Shengzhang Studio · JCoal 开发</span></footer>
        </main>
      </div>
      {newProject && <ProjectEditor onClose={() => setNewProject(false)}/>}
      {busy && <div className="busy-indicator" role="status"><Loader2 className="spin" size={16}/>正在处理，请稍候…</div>}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={16}/></button></div>}
    </div>
  </Context.Provider></AppearanceProvider>;
}
