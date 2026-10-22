import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, LOCAL_DATA } from './api';
import { registerWorkspaceSaver } from './workspace-save';
export type WorkRole = 'xiaohongshu-copy' | 'douyin-research' | 'douyin-script';
export type WorkStatus = 'pending-approval' | 'waiting-dependencies' | 'queued' | 'running' | 'waiting-user' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'needs-reconciliation';
export type PlanNode = { id: string; title: string; role: WorkRole; accountId: string; connectionAccountId?: string; requirement: string; dependsOn: string[]; model: string; budgetUSD: number; estimateUSD?: number; knowledgeIds?: string[]; experienceIds?: string[]; skillIds?: string[]; skillMode?: 'default' | 'selected' };
export type WorkPlan = { id: string; projectId: string; version: number; goal: string; status: 'draft' | 'approved'; nodes: PlanNode[]; estimateUSD: number; versions?: { version: number; status?: string; goal?: string }[] };
export type WorkTask = { id: string; title: string; projectId: string; planId?: string; nodeId?: string; accountId?: string; accountName?: string; role: WorkRole | 'controller-planning'; status: WorkStatus; latestRunId: string; createdAt: string; deletedAt?: string; removable?: boolean; deletionBlockedReason?: string };
export type WorkRun = { id: string; taskId: string; projectId: string; status: WorkStatus; waitReason?: string; revision: number; error?: string; createdAt: string; finishedAt?: string; planId?: string; planVersion?: number; planningPlanId?: string; planningPlanVersion?: number; planningQuestion?: string; node?: Pick<PlanNode, 'id' | 'role' | 'accountId' | 'connectionAccountId'> & Partial<Omit<PlanNode, 'id' | 'role' | 'accountId' | 'connectionAccountId'>>; dispatch?: { ready: boolean; reason?: string; workflowId?: string }; input?: Record<string, unknown>; receiptAvailable?: boolean; usage?: { estimatedUSD?: number; reservedUSD?: number; settledUSD?: number; unknownUSD?: number } };
export type WorkArtifact = { id: string; version: number; headVersion?: number; title: string; body: string; kind: string; taskId: string; runId: string; legacy?: { assetId?: string; projectId?: string }; candidate?: boolean };
export type WorkEvent = { id: string; sequence: number; runId: string; type: string; summary: string; detail?: string | Record<string, unknown>; at: string };
export type DispatchDraft = { runId: string; baseRevision: number; requirement: string; model: string; skillMode: '' | 'default' | 'selected'; skillIds: string[]; budgetUSD: number };
export type MediaDraft = { count: number; modelKey: string; skillId: string | null; prompts: Record<number, string>; textMode: 'title' | 'none'; watermark: boolean };
export type WorkView = { cursor: number; expandedIds: string[]; draft: string; scrollTop?: number; runId?: string; dispatchDraft?: DispatchDraft | null; mediaDrafts?: Record<string, MediaDraft | null>; artifactDrafts?: Record<string, {title: string; body: string; baseVersion: number} | null> };
export type ControllerView = { goal: string; accountIds: string[]; model: string; planId: string; planningMode: 'ai' | 'rules' };
export type WorkMessage = { id: string; text: string; role?: string; at?: string; createdAt?: string };
export type WorkNotification = { id: string; title?: string; summary?: string; message?: string; projectId: string; taskId: string; runId?: string; artifactId?: string; artifactVersion?: number; readAt?: string | null; deliveryAttemptedAt?: string; deliveredAt?: string; createdAt?: string; target?: { projectId?: string; taskId?: string; runId?: string; artifactId?: string; artifactVersion?: number } };
export type WorkCapabilities = { enabled: boolean; roles: (WorkRole | { id: WorkRole; label?: string })[]; models: (string | { id: string; label?: string })[]; note?: string };
export const roleLabels: Record<WorkRole | 'controller-planning', string> = { 'controller-planning': '总控 AI 规划', 'xiaohongshu-copy': '小红书图文', 'douyin-research': '抖音同话题研究', 'douyin-script': '抖音视频脚本' };
export const statusLabels: Record<WorkStatus, string> = { 'pending-approval': '待确认', 'waiting-dependencies': '等待前置成果', queued: '已排队', running: '执行中', 'waiting-user': '等待处理', paused: '已暂停', succeeded: '成果已保存', failed: '失败', cancelled: '已取消', 'needs-reconciliation': '结果待核对' };
export const statusLabel = (value: string) => statusLabels[value.replaceAll('_', '-') as WorkStatus] || value;
export const activeWork = (value: string) => ['queued', 'running', 'waiting-dependencies'].includes(value.replaceAll('_', '-'));
export const attentionWork = (value: string) => ['pending-approval', 'waiting-user', 'paused', 'failed', 'needs-reconciliation'].includes(value.replaceAll('_', '-'));
export const workError = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
export const workSession = () => sessionStorage.getItem('studio-session') || '';
export const workId = () => crypto.randomUUID();
/** Repair historical media links and refresh shared state before opening the exact draft. */
export async function prepareWorkMedia(artifact: WorkArtifact, projectId: string, refresh: () => Promise<void>, isCurrent = () => true) {
  const session = workSession(), valid = () => session === workSession() && isCurrent();
  if (!valid()) throw Error('工作区已切换，未继续制作');
  if (artifact.candidate || !['copy', 'script'].includes(artifact.kind)) throw Error('请先采用文案或脚本成果，再继续制作');
  const target = await api<{ assetId: string; projectId: string }>(`/artifacts/${encodeURIComponent(artifact.id)}/versions/${artifact.version}/media-draft`, 'POST');
  if (!valid()) throw Error('工作区已切换，未继续制作');
  if (!target.assetId || target.projectId !== projectId) throw Error('成果归属无法核对，请刷新任务后重试');
  await refresh();
  if (!valid()) throw Error('工作区已切换，未继续制作');
  return target;
}
export function refinementAccountIds(task: WorkTask, latestRun?: WorkRun): string[] {
  if (task.role !== 'douyin-research') return task.accountId ? [task.accountId] : [];
  if (!latestRun || latestRun.id !== task.latestRunId || latestRun.taskId !== task.id || latestRun.projectId !== task.projectId || latestRun.node?.role !== 'douyin-research') return [];
  return latestRun.node.connectionAccountId ? [latestRun.node.connectionAccountId] : [];
}
type WorkDeliveryArgs = { notificationId: string; sessionToken: string; sound: boolean };
type WorkDeliveryServices = { read: (id: string) => Promise<{ notification: WorkNotification }>; notify: (args: WorkDeliveryArgs) => Promise<{ delivered: boolean }>; failed?: (id: string) => Promise<unknown> };
/** Recheck the notification and current identity before invoking the trusted native bridge. Never marks read. */
export async function deliverWorkNotification(args: WorkDeliveryArgs, isCurrent = () => true, services?: WorkDeliveryServices) {
  const valid = () => isCurrent() && args.sessionToken === workSession();
  if (!valid()) throw Error('当前登录身份已变化，未发送桌面提醒');
  const notify = services?.notify || window.studioDesktop?.notifyWork;
  if (!notify) throw Error('当前环境不支持桌面提醒，站内进展仍保留');
  const result = await (services?.read || ((id: string) => api<{ notification: WorkNotification }>(`/notifications/${encodeURIComponent(id)}`)))(args.notificationId);
  if (!valid()) throw Error('当前登录身份已变化，未发送桌面提醒');
  if (result.notification?.id !== args.notificationId) throw Error('通知身份无法核对，未发送桌面提醒');
  if (result.notification.deliveredAt) return { delivered: true };
  if (result.notification.readAt) return { delivered: false };
  const failed = async () => { if (!valid()) return; if (services) await services.failed?.(args.notificationId); else await api(`/notifications/${encodeURIComponent(args.notificationId)}/delivery`, 'POST', { delivered: false }); };
  let delivered;
  try { delivered = await notify(args); } catch (error) { await failed().catch(() => {}); throw error; }
  if (!valid()) throw Error('当前登录身份已变化，未更新提醒状态');
  if (!delivered.delivered) await failed().catch(() => {});
  return { delivered: delivered.delivered === true };
}
const emptyControllerView = (): ControllerView => ({ goal: '', accountIds: [], model: '', planId: '', planningMode: 'ai' });
/** Project drafts restore before editing, and every queued save keeps its original owner/project. */
export function useControllerView(projectId: string) {
  const ownerSession = workSession();
  const scope = useMemo(() => ({ projectId, session: ownerSession, epoch: 0, active: false, ready: false, fields: {} as Partial<ControllerView>, fieldVersions: {} as Partial<Record<keyof ControllerView, number>>, counter: 0, chain: Promise.resolve() as Promise<void> }), [projectId, ownerSession]);
  const current = useRef(scope); current.current = scope;
  const [state, setState] = useState({ scope, value: emptyControllerView(), ready: false, error: '' }), [revision, setRevision] = useState(0);
  const save = useCallback(() => {
    if (!scope.ready || scope.session !== workSession() || !Object.keys(scope.fields).length) return scope.chain;
    const pending = scope.fields, pendingVersions = { ...scope.fieldVersions }; scope.fields = {};
    scope.chain = scope.chain.catch(() => {}).then(async () => {
      if (scope.session !== workSession()) return;
      try {
        await api(`/projects/${encodeURIComponent(scope.projectId)}/controller-view`, 'PUT', pending, { keepalive: true });
        if (scope.active && current.current === scope && scope.session === workSession()) setState(previous => ({ ...previous, error: '' }));
      } catch (failure) {
        const retry = Object.fromEntries(Object.entries(pending).filter(([key]) => scope.fieldVersions[key as keyof ControllerView] === pendingVersions[key as keyof ControllerView]));
        scope.fields = { ...retry, ...scope.fields };
        if (scope.active && current.current === scope && scope.session === workSession()) setState(previous => ({ ...previous, error: workError(failure) }));
        throw failure;
      }
    });
    return scope.chain;
  }, [scope]);
  useEffect(() => {
    scope.active = true; const epoch = ++scope.epoch;
    const valid = () => scope.active && scope.epoch === epoch && current.current === scope && scope.session === workSession();
    if (!scope.ready) void api<Partial<ControllerView>>(`/projects/${encodeURIComponent(scope.projectId)}/controller-view`).then(saved => {
      if (!valid()) return;
      scope.ready = true; setState({ scope, value: { ...emptyControllerView(), ...saved }, ready: true, error: '' });
    }).catch(failure => { if (valid()) setState({ scope, value: emptyControllerView(), ready: false, error: workError(failure) }); });
    const off = registerWorkspaceSaver(save);
    return () => { scope.active = false; scope.epoch++; off(); void save().catch(() => {}); };
  }, [scope, save]);
  useEffect(() => { if (!scope.ready) return; const timer = setTimeout(() => void save().catch(() => {}), 600); return () => clearTimeout(timer); }, [scope, revision, state.ready, save]);
  const update = useCallback((patch: Partial<ControllerView>) => {
    if (!scope.ready || !scope.active || current.current !== scope || scope.session !== workSession()) return;
    for (const key of Object.keys(patch) as (keyof ControllerView)[]) scope.fieldVersions[key] = ++scope.counter;
    scope.fields = { ...scope.fields, ...patch };
    setState(previous => previous.scope === scope ? { ...previous, value: { ...previous.value, ...patch } } : previous);
    setRevision(value => value + 1);
  }, [scope]);
  return { value: state.scope === scope ? state.value : emptyControllerView(), ready: state.scope === scope && state.ready, error: state.scope === scope ? state.error : '', update, save };
}
export function useWorkResource<T>(path: string | null, interval = 0) {
  const [value, setValue] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(!!path);
  const generation = useRef(0), reader = useRef<() => Promise<void>>(async () => {}), resolvedPath = useRef<string | null>(null);
  useEffect(() => {
    const epoch = ++generation.current, session = workSession(); let pending = false;
    const valid = () => epoch === generation.current && session === workSession();
    setValue(null); setError(''); setLoading(!!path);
    const read = async () => {
      if (!path || pending || LOCAL_DATA || !valid()) { if (!path || LOCAL_DATA) setLoading(false); return; }
      pending = true;
      try { const next = await api<T>(path); if (valid()) { resolvedPath.current = path; setValue(next); setError(''); } }
      catch (failure) { if (valid()) setError(workError(failure)); }
      finally { pending = false; if (valid()) setLoading(false); }
    };
    reader.current = read; void read();
    const timer = interval && path ? setInterval(() => { void read(); }, interval) : undefined;
    return () => { generation.current++; if (timer) clearInterval(timer); };
  }, [path, interval]);
  const reload = useCallback(() => reader.current(), []);
  return { value: resolvedPath.current === path ? value : null, error, loading, reload };
}
/** Delayed requests may never cross a login, project or task boundary. */
export function useWorkAction() {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), working = useRef(false);
  useEffect(() => { epoch.current++; return () => { epoch.current++; }; }, []);
  async function execute<T>(work: (isCurrent: () => boolean) => Promise<T>, accept?: (result: T, isCurrent: () => boolean) => void | Promise<void>) {
    if (working.current) return;
    const current = epoch.current, session = workSession(); working.current = true; setPending(true); setError('');
    const valid = () => current === epoch.current && session === workSession();
    try { const result = await work(valid); if (valid()) await accept?.(result, valid); }
    catch (failure) { if (valid()) setError(workError(failure)); }
    finally { working.current = false; if (valid()) setPending(false); }
  }
  return { pending, error, execute };
}

/** Only touched fields are sent; independent panels do not erase one another. */
export function useWorkView(taskId: string) {
  const [value, setValue] = useState<WorkView>({ cursor: 0, expandedIds: [], draft: '' }), [ready, setReady] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const fields = useRef<Partial<WorkView>>({}), chain = useRef<Promise<void>>(Promise.resolve()), session = useRef(workSession()), alive = useRef(true), enabled = useRef(false);
  const save = useCallback(() => {
    const pending = fields.current; fields.current = {};
    if (!enabled.current || !Object.keys(pending).length || session.current !== workSession()) return chain.current;
    chain.current = chain.current.catch(() => {}).then(async () => {
      if (session.current !== workSession()) return;
      try { await api(`/tasks/${encodeURIComponent(taskId)}/view`, 'PUT', pending, { keepalive: true }); if (alive.current) setError(''); }
      catch (failure) { fields.current = { ...pending, ...fields.current }; if (alive.current) setError(workError(failure)); throw failure; }
    });
    return chain.current;
  }, [taskId]);
  useEffect(() => {
    alive.current = true; let current = true;
    void api<Partial<WorkView>>(`/tasks/${encodeURIComponent(taskId)}/view`).then(saved => { if (current && session.current === workSession()) { setValue({ cursor: 0, expandedIds: [], draft: '', ...saved }); enabled.current = true; setReady(true); } }).catch(failure => { if (current) setError(workError(failure)); });
    const off = registerWorkspaceSaver(save);
    return () => { current = false; alive.current = false; off(); void save().catch(() => {}); };
  }, [taskId, save]);
  useEffect(() => { if (!ready) return; const timer = setTimeout(() => void save().catch(() => {}), 600); return () => clearTimeout(timer); }, [revision, ready, save]);
  const update = useCallback((patch: Partial<WorkView>) => {
    if (!enabled.current || session.current !== workSession()) return;
    fields.current = { ...fields.current, ...patch, ...(patch.mediaDrafts ? { mediaDrafts: { ...fields.current.mediaDrafts, ...patch.mediaDrafts } } : {}), ...(patch.artifactDrafts ? { artifactDrafts: { ...fields.current.artifactDrafts, ...patch.artifactDrafts } } : {}) };
    setValue(current => ({ ...current, ...patch, ...(patch.mediaDrafts ? { mediaDrafts: { ...current.mediaDrafts, ...patch.mediaDrafts } } : {}), ...(patch.artifactDrafts ? { artifactDrafts: { ...current.artifactDrafts, ...patch.artifactDrafts } } : {}) }));
    setRevision(current => current + 1);
  }, []);
  return { value, ready, error, update, save };
}
