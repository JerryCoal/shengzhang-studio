import { useEffect, useRef, useState } from 'react';
import type { BackgroundTask } from './components/BackgroundTasks';
import type { Page } from './types';

export function workspaceKey(page: Page, projectId = '') { return `${page}:${projectId}`; }

export function useBackgroundTasks(notify: (message: string, error?: boolean) => void, refresh: () => Promise<void>, foregroundBusy: () => boolean, serial = false) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [minimized, setMinimized] = useState<string[]>([]);
  const records = useRef<BackgroundTask[]>([]), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (work: (tasks: BackgroundTask[]) => BackgroundTask[]) => {
    records.current = work(records.current);
    if (alive.current) setTasks(records.current);
  };
  const locked = (projectId?: string) => records.current.some(task => task.status === 'running' && (!projectId || task.projectId === projectId));
  // Only explicit user actions restore dialogs; finishing a background preview must stay quiet.
  const restoreDialogs = (key: string) => setMinimized(keys => keys.filter(item => item !== key));
  const resume = (task: BackgroundTask) => {
    restoreDialogs(task.workspaceKey);
    // Keep running views mounted. Completed previews are released only after the user opens them.
    update(rows => rows.map(row => row.workspaceKey === task.workspaceKey && row.status !== 'running' ? { ...row, retained: false } : row));
  };
  const run = async (origin: { page: Page; projectId: string; projectName: string }, label: string, work: () => Promise<unknown>) => {
    if (serial && locked()) { notify('联网网页版每次处理一个联网请求。可以先编辑其他项目，等待当前请求完成后再生成。'); return; }
    if (foregroundBusy() || locked(origin.projectId)) { notify('这个项目仍在处理，请等待当前任务完成，或切换到其他项目。'); return; }
    const key = workspaceKey(origin.page, origin.projectId);
    if (new Set(records.current.filter(task => task.retained && task.workspaceKey !== key).map(task => task.workspaceKey)).size >= 12) { notify('请先在后台任务中查看已有结果，再开始新的任务。'); return; }
    const task: BackgroundTask = { ...origin, workspaceKey: workspaceKey(origin.page, origin.projectId), id: crypto.randomUUID(), label, status: 'running', startedAt: Date.now(), retained: true };
    setMinimized(keys => keys.filter(key => key !== task.workspaceKey));
    update(rows => {
      const previous = rows.map(row => row.workspaceKey === key && row.status !== 'running' ? { ...row, retained: false } : row);
      return [...previous.filter(row => row.retained || row.status === 'running'), ...previous.filter(row => !row.retained && row.status !== 'running').slice(-15), task];
    });
    try {
      await work();
      update(rows => rows.map(row => row.id === task.id ? { ...row, status: 'completed' } : row));
      if (alive.current) notify(`${origin.projectName} · ${label}已完成，可从“后台任务”查看。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '本次处理未完成，请查看详情。';
      update(rows => rows.map(row => row.id === task.id ? { ...row, status: 'failed', error: message } : row));
      if (alive.current) { notify(`${origin.projectName} · ${message}`, true); await refresh().catch(() => {}); }
    }
  };
  return { tasks, minimized, locked, run, resume, restoreDialogs,
    minimize: (key: string) => setMinimized(keys => keys.includes(key) ? keys : [...keys, key]),
    dismiss: (id: string) => update(rows => rows.filter(row => row.id !== id || row.status === 'running' || row.retained)),
  };
}
