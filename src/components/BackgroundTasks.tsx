import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronDown, CircleAlert, Info, ListTodo, LoaderCircle, X } from 'lucide-react';
import type { Page } from '../types';
import '../background-tasks.css';

export type BackgroundTask = {
  id: string;
  workspaceKey: string;
  projectId: string;
  projectName: string;
  page: Page;
  label: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  retained: boolean;
  startedAt: number;
};

type BackgroundTasksProps = {
  tasks: BackgroundTask[];
  onOpen: (task: BackgroundTask) => void;
  onDismiss: (id: string) => void;
};

const statusLabels = { running: '处理中', completed: '已完成', failed: '处理失败' } as const;
const actionLabels = { running: '返回任务', completed: '查看结果', failed: '查看详情' } as const;

export function BackgroundTasks({ tasks, onOpen, onDismiss }: BackgroundTasksProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();
  const runningCount = tasks.filter(task => task.status === 'running').length;
  const pendingCount = tasks.filter(task => task.retained && task.status !== 'running').length;
  const taskSummary = [runningCount ? `${runningCount} 个正在处理` : '', pendingCount ? `${pendingCount} 个待查看` : ''].filter(Boolean).join('，') || '当前没有正在处理的任务';
  const orderedTasks = [...tasks].sort((a, b) =>
    Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt,
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
      aria-label={`后台任务，${taskSummary}`}
      title={taskSummary}
      onClick={() => setOpen(value => !value)}
    >
      <ListTodo size={17} aria-hidden="true"/>
      <span>后台任务</span>
      <span className={`background-tasks-count${runningCount ? ' is-running' : pendingCount ? ' is-pending' : ''}`}>{runningCount || pendingCount}</span>
      <ChevronDown size={13} className={open ? 'is-expanded' : undefined} aria-hidden="true"/>
    </button>
    {open && <section className="background-tasks-panel" id={panelId} aria-labelledby={titleId}>
      <div className="background-tasks-heading">
        <div><h2 id={titleId}>后台任务</h2><p aria-live="polite">{taskSummary}</p></div>
        <button type="button" className="icon-button" aria-label="收起后台任务" onClick={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}><X size={18} aria-hidden="true"/></button>
      </div>
      <p className="background-tasks-note"><Info size={15} aria-hidden="true"/><span>收起后继续处理；请保持应用运行。原项目处理期间避免改写，其他项目可继续操作。</span></p>
      {orderedTasks.length ? <ul className="background-tasks-list">
        {orderedTasks.map(task => <li className="background-task" key={task.id}>
          <div className="background-task-topline">
            <span className="background-task-project" title={task.projectName}>{task.projectName || '未命名项目'}</span>
            <span className={`background-task-status is-${task.status}`}>
              {task.status === 'running' ? <LoaderCircle size={13} className="background-task-spinner" aria-hidden="true"/> : task.status === 'completed' ? <CheckCircle2 size={13} aria-hidden="true"/> : <CircleAlert size={13} aria-hidden="true"/>}
              {statusLabels[task.status]}
            </span>
          </div>
          <h3>{task.label}</h3>
          {task.error && <p className="background-task-error">{task.error}</p>}
          {task.retained && task.status !== 'running' && <p className="background-task-retained">有待查看结果，请返回原项目查看。</p>}
          <div className="background-task-actions">
            <button type="button" className="background-task-open" onClick={() => {
              setOpen(false);
              onOpen(task);
            }}>{actionLabels[task.status]}<ArrowUpRight size={14} aria-hidden="true"/></button>
            {task.status !== 'running' && !task.retained && <button type="button" className="background-task-dismiss" aria-label={`移除记录：${task.label}`} onClick={() => onDismiss(task.id)}>移除记录</button>}
          </div>
        </li>)}
      </ul> : <div className="background-tasks-empty"><ListTodo size={25} aria-hidden="true"/><p>还没有后台任务</p><span>处理中的任务会显示在这里，可随时返回查看。</span></div>}
    </section>}
  </div>;
}
