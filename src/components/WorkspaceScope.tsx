import { ChevronDown, FolderOpen, PencilLine, UsersRound } from 'lucide-react';
import type { Account, Project } from '../types';
import { platformName } from '../components';
import { toggleScopeAccount, toggleScopeProject, type WorkspaceScope } from '../workspace-scope.mjs';
import '../workspace-scope.css';

type ScopeProps = { projects: Project[]; accounts: Account[]; primaryProjectId: string; scope: WorkspaceScope };

export function WorkspaceScopePicker({ projects, accounts, primaryProjectId, scope, onChange, onEditProject, onManage }: ScopeProps & { onChange: (scope: WorkspaceScope) => void; onEditProject: (id: string) => void; onManage: () => void }) {
  const primary = projects.find(project => project.id === primaryProjectId);
  return <section className="workspace-scope-picker" aria-label="项目与账号范围">
    <div className="scope-picker-heading"><span>项目与账号</span><button type="button" onClick={onManage}>管理</button></div>
    <div className="scope-primary"><PencilLine size={14}/><div><small>当前编辑项目</small><b>{primary?.brief.name || '尚无项目'}</b></div></div>
    <details className="scope-picker-section">
      <summary><FolderOpen size={14}/><span>项目范围</span><b>{scope.projectIds.length}</b><ChevronDown size={14}/></summary>
      <p>勾选用于批量目标。点击“编辑”只切换当前项目。</p>
      <div className="scope-choice-list">{projects.map(project => <div className="scope-project-row" key={project.id}>
        <label className="scope-choice"><input type="checkbox" checked={scope.projectIds.includes(project.id)} disabled={project.id === primaryProjectId} onChange={() => onChange(toggleScopeProject(scope, project.id, primaryProjectId))}/><span>{project.brief.name}{project.sample && <small>示例项目</small>}</span></label>
        <button type="button" className="scope-edit-project" aria-label={`编辑项目 ${project.brief.name}`} aria-current={project.id === primaryProjectId ? 'true' : undefined} onClick={() => onEditProject(project.id)}>{project.id === primaryProjectId ? '当前' : '编辑'}</button>
      </div>)}</div>
      {scope.projectIds.length > 1 && <button type="button" className="scope-reset" onClick={() => onChange({ ...scope, projectIds: primaryProjectId ? [primaryProjectId] : [] })}>仅保留当前项目</button>}
      {!projects.length && <button type="button" className="scope-reset" onClick={onManage}>创建第一个项目</button>}
    </details>
    <details className="scope-picker-section">
      <summary><UsersRound size={14}/><span>账号范围</span><b>{scope.accountIds.length || '全部'}</b><ChevronDown size={14}/></summary>
      <p>勾选可多选，仅筛选内容和批量目标；创作账号仍在每篇中确认。</p>
      <label className="scope-choice scope-all-accounts"><input type="checkbox" checked={!scope.accountIds.length} onChange={() => onChange({ ...scope, accountIds: [] })}/><span>全部账号</span></label>
      <div className="scope-choice-list">{accounts.map(account => <label className="scope-choice" key={account.id}><input type="checkbox" checked={scope.accountIds.includes(account.id)} onChange={() => onChange(toggleScopeAccount(scope, account.id))}/><span>{account.name}<small>{platformName(account.platform)}</small></span></label>)}</div>
      {!accounts.length && <p>暂无账号，请在“管理”中添加。</p>}
    </details>
  </section>;
}

export function WorkspaceScopeSummary({ projects, accounts, primaryProjectId, scope, onOpen }: ScopeProps & { onOpen: () => void }) {
  const primary = projects.find(project => project.id === primaryProjectId);
  const selectedProjects = projects.filter(project => scope.projectIds.includes(project.id));
  const selectedAccounts = accounts.filter(account => scope.accountIds.includes(account.id));
  return <section className="workspace-scope-summary" aria-label="当前工作范围">
    <div className="scope-summary-primary"><PencilLine size={15}/><span>当前编辑</span><b>{primary?.brief.name || '尚未选择项目'}</b><button type="button" className="scope-summary-change" onClick={onOpen}>调整范围</button></div>
    <div className="scope-summary-targets"><span className="scope-summary-label">项目范围</span><div>{selectedProjects.map(project => <span className="scope-summary-chip" key={project.id}>{project.brief.name}</span>)}</div><span className="scope-summary-label">账号范围</span><div>{selectedAccounts.length ? selectedAccounts.map(account => <span className="scope-summary-chip" key={account.id}>{account.name}<small>{platformName(account.platform)}</small></span>) : <span className="scope-summary-chip">全部账号 · {accounts.length}</span>}</div></div>
    <p>{scope.projectIds.length > 1 ? '多项目范围用于批量目标；当前页面只编辑上方项目，每篇生成独立使用所属项目的资料。' : '当前页使用此项目资料；账号范围仅用于查看和批量目标，不会改写作品的创作账号。'}</p>
  </section>;
}
