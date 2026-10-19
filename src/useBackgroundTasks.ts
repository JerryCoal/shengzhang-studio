import { useEffect, useRef, useState } from 'react';
import type { BackgroundTask } from './components/BackgroundTasks';
import type { Page, Project } from './types';
import type { WorkspaceTarget } from './context';
import { readTasks, removeTask, saveTask } from './task-journal';
import { flushWorkspaceSavers } from './workspace-save';
import { mergeMediaTasks, projectMediaTasks } from './media-tasks';

export function workspaceKey(page: Page, projectId = '') { return `${page}:${projectId}`; }
export const isActiveTask = (status: BackgroundTask['status']) => ['running', 'pausing', 'paused'].includes(status);
export type BackgroundControl = {
  /** Save before the next operation. This does not cancel a submitted API call. */
  checkpoint: (stage: string, data?: unknown) => Promise<void>;
};
type Origin = { page: Page; projectId: string; projectName: string; accountId?: string; accountName?: string; target?: WorkspaceTarget };

export function useBackgroundTasks(notify: (message: string, error?: boolean) => void, refresh: () => Promise<void>, foregroundBusy: () => boolean, serial = false, scope = 'workspace', projects?: Project[]) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]), [loading, setLoading] = useState(true);
  const [mediaTasks, setMediaTasks] = useState<BackgroundTask[]>([]), mediaRecords = useRef<BackgroundTask[]>([]);
  const mediaDismissed = useRef(new Set<string>());
  const [minimized, setMinimized] = useState<string[]>([]);
  const records = useRef<BackgroundTask[]>([]), alive = useRef(true), epoch = useRef(0);
  const controls = useRef(new Map<string, { requested: boolean; release?: () => void }>());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const audio = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('studio-task-sound-muted') === '1'; } catch { return false; } });
  const mutedRef = useRef(muted); mutedRef.current = muted;

  const update = (work: (tasks: BackgroundTask[]) => BackgroundTask[]) => {
    records.current = work(records.current);
    if (alive.current) setTasks(records.current);
  };
  const persist = (task: BackgroundTask, generation = epoch.current) => {
    const pending = writes.current.catch(() => {}).then(async () => {
      if (alive.current && generation === epoch.current) await saveTask(task);
    });
    writes.current = pending; return pending;
  };
  const change = (id: string, patch: Partial<BackgroundTask>, generation = epoch.current) => {
    if (!alive.current || generation !== epoch.current) return Promise.resolve();
    let task: BackgroundTask | undefined;
    update(rows => rows.map(row => row.id === id ? (task = { ...row, ...patch, updatedAt: Date.now() }) : row));
    return task ? persist(task, generation) : Promise.resolve();
  };
  useEffect(() => {
    alive.current = true; const generation = ++epoch.current; let active = true;
    records.current = []; mediaRecords.current = []; mediaDismissed.current.clear(); setMediaTasks([]); setTasks([]); setMinimized([]); setLoading(true); controls.current.clear();
    readTasks().then(saved => {
      if (!active || generation !== epoch.current) return;
      const recovered = saved.map(task => isActiveTask(task.status) ? { ...task, status: 'interrupted' as const, retained: true, updatedAt: Date.now(), error: '应用上次关闭时任务尚未结束。已保留最后检查点；请查看原项目及服务商记录，确认结果后再决定下一步。不会自动重复请求。' } : task);
      update(() => recovered);
      for (const task of recovered.filter(task => task.status === 'interrupted')) void persist(task, generation).catch(() => {});
    }).catch(error => { if (active) notify(`任务记录暂时无法读取：${error instanceof Error ? error.message : '请重新打开工作区'}`, true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; epoch.current++; };
  }, [scope]);

  useEffect(() => {
    const unlock = () => {
      if (mutedRef.current) return;
      try { audio.current ||= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* Audio is optional. */ }
    };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); void audio.current?.close().catch(() => {}); audio.current = null; };
  }, []);
  const chime = () => {
    const context = audio.current; if (mutedRef.current || !context || context.state !== 'running') return;
    for (const [index, frequency] of [659.25, 880].entries()) {
      const start = context.currentTime + index * .13, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.065, start + .018); gain.gain.exponentialRampToValueAtTime(.001, start + .24);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .25);
    }
  };
  useEffect(() => {
    const candidates = projectMediaTasks(projects || []);
    for (const task of candidates) if (task.status === 'running') mediaDismissed.current.delete(task.id);
    const merged = mergeMediaTasks(mediaRecords.current, candidates.filter(task => !mediaDismissed.current.has(task.id)));
    mediaRecords.current = merged.tasks; setMediaTasks(merged.tasks);
    if (merged.completed.length) {
      notify(merged.completed.length === 1 ? `${merged.completed[0].projectName} · ${merged.completed[0].label}已完成，请检查结果。` : `${merged.completed.length} 项媒体任务已完成，可从任务中心查看。`);
      try { chime(); } catch { /* Optional audio cannot change a completed task. */ }
    }
  }, [projects, scope]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if ([...records.current, ...mediaRecords.current].some(task => isActiveTask(task.status))) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  useEffect(() => {
    window.studioDesktop?.setTaskState?.({ active: [...tasks, ...mediaTasks].filter(task => isActiveTask(task.status)).length, paused: tasks.filter(task => task.status === 'paused').length });
  }, [tasks, mediaTasks]);
  useEffect(() => {
    const unsubscribe = window.studioDesktop?.onPrepareQuit?.(async () => {
      try {
        for (const [id, control] of controls.current) { control.requested = true; await change(id, { status: 'pausing' }); }
        await Promise.all([writes.current, flushWorkspaceSavers()]); await window.studioDesktop?.confirmTaskSave?.({ saved: true });
      }
      catch { await window.studioDesktop?.confirmTaskSave?.({ saved: false }); }
    });
    return () => { unsubscribe?.(); window.studioDesktop?.setTaskState?.({ active: 0, paused: 0, connected: false }); };
  }, []);

  const locked = (projectId?: string, page?: Page) => records.current.some(task => isActiveTask(task.status) && (!projectId || task.projectId === projectId) && (!page || task.page === page)) || (!projectId && !page && mediaRecords.current.some(task => isActiveTask(task.status)));
  const restoreDialogs = (key: string) => setMinimized(keys => keys.filter(item => item !== key));
  const resume = (task: BackgroundTask) => {
    restoreDialogs(task.workspaceKey);
    if (task.externallyManaged) { mediaRecords.current = mediaRecords.current.map(row => row.id === task.id ? { ...row, retained: false } : row); setMediaTasks(mediaRecords.current); return; }
    for (const row of records.current.filter(row => row.workspaceKey === task.workspaceKey && !isActiveTask(row.status))) void change(row.id, { retained: false }).catch(() => notify('查看状态暂未保存，请稍后重试。', true));
  };
  const pause = (id: string) => {
    const control = controls.current.get(id); if (!control) return;
    control.requested = true; void change(id, { status: 'pausing' }).catch(() => notify('暂停请求暂未保存，请保持应用打开。', true));
  };
  const continueTask = (id: string) => {
    const control = controls.current.get(id); if (!control) return;
    const previousStatus = records.current.find(task => task.id === id)?.status === 'paused' ? 'paused' : 'pausing';
    control.requested = false;
    void change(id, { status: 'running' }).then(() => { control.release?.(); control.release = undefined; }).catch(() => { control.requested = true; update(rows => rows.map(row => row.id === id ? { ...row, status: previousStatus } : row)); notify('继续任务前无法保存检查点，请稍后重试。', true); });
  };
  const run = async (origin: Origin, label: string, work: (control: BackgroundControl) => Promise<unknown>) => {
    if (loading) { notify('正在恢复任务记录，请稍候。'); return; }
    if (serial && locked()) { notify('联网网页版目前每次安全处理一个联网请求；桌面版支持不同 Agent 并行。可继续编辑，等待当前请求完成后生成。'); return; }
    if (foregroundBusy() || locked(origin.projectId, origin.page)) { notify('这个 Agent 仍有未完成任务，可以先进入其他 Agent；暂停任务需要继续后才能再次生成。'); return; }
    const key = workspaceKey(origin.page, origin.projectId), generation = epoch.current;
    if (new Set(records.current.filter(task => task.retained && task.workspaceKey !== key).map(task => task.workspaceKey)).size >= 12) { notify('请先在任务中心查看已有结果，再开始新的任务。'); return; }
    const task: BackgroundTask = { ...origin, accountId: origin.accountId || origin.target?.accountId, workspaceKey: key, id: crypto.randomUUID(), label, status: 'running', stage: '准备任务并保存检查点', startedAt: Date.now(), updatedAt: Date.now(), retained: true };
    const control = { requested: false, release: undefined as (() => void) | undefined }; controls.current.set(task.id, control);
    restoreDialogs(key); update(rows => [...rows.map(row => row.workspaceKey === key && !isActiveTask(row.status) ? { ...row, retained: false } : row), task]);
    const checkpoint: BackgroundControl['checkpoint'] = async (stage, data) => {
      if (!alive.current || generation !== epoch.current) throw new Error('原工作区已关闭，已保存检查点，请重新登录后核对任务。');
      await change(task.id, { stage, ...(data === undefined ? {} : { checkpoint: data }), status: control.requested ? 'paused' : 'running' }, generation);
      if (control.requested) {
        const waiting = new Promise<void>(resolve => { control.release = resolve; });
        await change(task.id, { status: 'paused' }, generation);
        if (!control.requested) { control.release?.(); control.release = undefined; }
        await waiting;
      }
    };
    try {
      await persist(task, generation);
      await checkpoint('正在执行，已提交的请求将在返回后保存');
      await work({ checkpoint });
      await checkpoint('本阶段处理已返回，请核对原页面结果');
      await change(task.id, { status: 'completed', finishedAt: Date.now(), stage: '任务已完成' }, generation);
      if (alive.current && generation === epoch.current) { notify(`${origin.projectName} · ${label}已完成，可从“任务中心”查看。`); try { chime(); } catch { /* Optional audio cannot change task status. */ } }
    } catch (error) {
      const message = error instanceof Error ? error.message : '本次处理未完成，请查看详情。';
      await change(task.id, { status: 'failed', error: message, finishedAt: Date.now() }, generation).catch(() => {});
      if (alive.current && generation === epoch.current) { notify(`${origin.projectName} · ${message}`, true); await refresh().catch(() => {}); }
    } finally { controls.current.delete(task.id); }
  };
  return { tasks: [...tasks, ...mediaTasks], minimized, locked, run, resume, restoreDialogs, pause, continueTask, loading, muted, active: isActiveTask,
    toggleMuted: () => setMuted(value => { const next = !value; try { localStorage.setItem('studio-task-sound-muted', next ? '1' : '0'); } catch { /* Preference only. */ } return next; }),
    minimize: (key: string) => setMinimized(keys => keys.includes(key) ? keys : [...keys, key]),
    dismiss: (id: string) => { const external = mediaRecords.current.find(row => row.id === id); if (external && !isActiveTask(external.status) && !external.retained) { mediaDismissed.current.add(id); mediaRecords.current = mediaRecords.current.filter(row => row.id !== id); setMediaTasks(mediaRecords.current); return; } const task = records.current.find(row => row.id === id); if (!task || isActiveTask(task.status) || task.retained) return; void removeTask(id).then(() => update(rows => rows.filter(row => row.id !== id))).catch(() => notify('任务记录暂未移除，请稍后重试。', true)); },
  };
}
