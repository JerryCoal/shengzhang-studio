import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronDown, CircleAlert, Info, ListTodo, LoaderCircle, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import type { Page } from '../types';
import type { WorkspaceTarget } from '../context';
import '../background-tasks.css';

export type BackgroundTask = {
  id: string;
  workspaceKey: string;
  projectId: string;
  projectName: string;
  accountId?: string;
  accountName?: string;
  externallyManaged?: boolean;
  dismissed?: boolean;
  page: Page;
  target?: WorkspaceTarget;
  label: string;
  status: 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'interrupted';
  stage?: string;
  checkpoint?: unknown;
  error?: string;
  retained: boolean;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

type BackgroundTasksProps = {
  tasks: BackgroundTask[];
  onOpen: (task: BackgroundTask) => void;
  onDismiss: (id: string) => void;
  onPause?: (id: string) => void;
  onContinue?: (id: string) => void;
  muted?: boolean;
  onToggleMuted?: () => void;
  serial?: boolean;
};

const active = (task: BackgroundTask) => ['running', 'pausing', 'paused'].includes(task.status);
const statusLabels = { running: '处理中', pausing: '等待检查点', paused: '已暂停', completed: '已完成', failed: '处理失败', interrupted: '恢复待核对' } as const;
const actionLabels = { running: '返回任务', pausing: '返回任务', paused: '查看进度', completed: '查看结果', failed: '查看详情', interrupted: '核对原项目' } as const;

export function BackgroundTasks({ tasks, onOpen, onDismiss, onPause, onContinue, muted, onToggleMuted, serial }: BackgroundTasksProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();
  const runningCount = tasks.filter(active).length;
  const pendingCount = tasks.filter(task => task.retained && !active(task)).length;
  const taskSummary = [runningCount ? `${runningCount} 个正在处理` : '', pendingCount ? `${pendingCount} 个待查看` : ''].filter(Boolean).join('，') || '当前没有正在处理的任务';
  const orderedTasks = [...tasks].sort((a, b) =>
    Number(active(b)) - Number(active(a)) || b.startedAt - a.startedAt,
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return <div className="background-tasks" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="background-tasks-trigger"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`任务中心，${taskSummary}`}
      title={taskSummary}
      onClick={() => setOpen(value => !value)}
    >
      <ListTodo size={17} aria-hidden="true"/>
      <span>任务中心</span>
      <span className={`background-tasks-count${runningCount ? ' is-running' : pendingCount ? ' is-pending' : ''}`}>{runningCount || pendingCount}</span>
      <ChevronDown size={13} className={open ? 'is-expanded' : undefined} aria-hidden="true"/>
    </button>
    {open && <section className="background-tasks-panel" id={panelId} aria-labelledby={titleId}>
      <div className="background-tasks-heading">
        <div><h2 id={titleId}>Agent 任务中心</h2><p aria-live="polite">{taskSummary}</p></div>
        <div className="background-task-heading-actions">{onToggleMuted && <button type="button" className="icon-button" aria-label={muted ? '开启任务完成提示音' : '关闭任务完成提示音'} aria-pressed={!muted} title={muted ? '提示音已关闭' : '任务完成后播放轻提示音'} onClick={onToggleMuted}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>}
        <button type="button" className="icon-button" aria-label="收起任务中心" onClick={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}><X size={18} aria-hidden="true"/></button></div>
      </div>
      <p className="background-tasks-note"><Info size={15} aria-hidden="true"/><span>{serial ? '联网网页版每次处理一个联网请求。' : '不同 Agent 可并行工作，同一内容会防止重复执行。'} 暂停在检查点生效；已提交的模型请求仍会完成并可能计费。进度随阶段保存。</span></p>
      {orderedTasks.length ? <ul className="background-tasks-list">
        {orderedTasks.map(task => <li className="background-task" key={task.id}>
          <div className="background-task-topline">
            <span className="background-task-project" title={task.projectName}>{task.projectName || '未命名项目'}</span>
            <span className={`background-task-status is-${task.status}`}>
              {['running', 'pausing'].includes(task.status) ? <LoaderCircle size={13} className="background-task-spinner" aria-hidden="true"/> : task.status === 'paused' ? <Pause size={13} aria-hidden="true"/> : task.status === 'completed' ? <CheckCircle2 size={13} aria-hidden="true"/> : <CircleAlert size={13} aria-hidden="true"/>}
              {statusLabels[task.status]}
            </span>
          </div>
          <h3>{task.label}</h3>
          {task.accountId && <p className="background-task-account">目标账号 · {task.accountName || task.accountId}</p>}
          {task.stage && <p className="background-task-stage">{task.stage}</p>}
          {task.status === 'pausing' && <p className="background-task-retained">等待当前请求返回并保存，然后暂停下一阶段。</p>}
          {task.status === 'paused' && <p className="background-task-retained">检查点已保存，继续后进入下一阶段。</p>}
          {task.error && <p className="background-task-error">{task.error}</p>}
          {task.retained && !active(task) && <p className="background-task-retained">已保存任务记录，请返回原项目核对结果。</p>}
          <div className="background-task-actions">
            <button type="button" className="background-task-open" onClick={() => {
              setOpen(false);
              onOpen(task);
            }}>{actionLabels[task.status]}<ArrowUpRight size={14} aria-hidden="true"/></button>
            {task.status === 'running' && onPause && !task.externallyManaged && <button type="button" className="background-task-open" onClick={() => onPause(task.id)}><Pause size={13}/>检查点暂停</button>}
            {['pausing', 'paused'].includes(task.status) && onContinue && <button type="button" className="background-task-open" onClick={() => onContinue(task.id)}><Play size={13}/>{task.status === 'pausing' ? '撤回暂停' : '继续'}</button>}
            {!active(task) && (!task.retained || ['completed', 'failed'].includes(task.status)) && <button type="button" className="background-task-dismiss" aria-label={`移除记录：${task.label}`} onClick={() => onDismiss(task.id)}>移除记录</button>}
          </div>
        </li>)}
      </ul> : <div className="background-tasks-empty"><ListTodo size={25} aria-hidden="true"/><p>还没有 Agent 任务</p><span>实时进度、待查看结果和恢复记录都会显示在这里。</span></div>}
    </section>}
  </div>;
}
