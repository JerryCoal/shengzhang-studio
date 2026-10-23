import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Clock3, FileText, MessageSquareText, Plus, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { useStudio } from '../context';
import { Field, Modal } from '../components';
import { ArtifactEditor, DeleteWorkTaskButton, PlanReview, TaskList, TaskWorkspace, WorkStatusBadge } from '../pages/WorkControl';
import { WorkDispatch } from './WorkDispatch';
import { activeWork, refinementAccountIds, roleLabels, useControllerView, useWorkAction, useWorkResource, workError, workId, workSession, type WorkArtifact, type WorkCapabilities, type WorkEvent, type WorkPlan, type WorkRun, type WorkTask } from '../work-control';
import './controller-chat.css';

type ChatMessage = { id: string; role: string; text: string; createdAt: string; accountIds?: string[]; messageId?: string; intent?: 'plan' | 'images' | 'publish'; targetTaskId?: string; taskId?: string; planningRunId?: string; runId?: string; planId?: string; planVersion?: number; replyToRunId?: string; question?: string };
type Quote = { quoteId: string; estimateUSD: number; model: string; label?: string; expiresAt: string };
type MediaRequest = { text?: string; taskId: string; kind: 'images' | 'publish'; nonce: number };
const uri = encodeURIComponent;
const dollars = (value: number) => `$${value.toFixed(4)}`;
const failed = (error?: string) => error ? <p className="work-error" role="alert">{error}</p> : null;
export function chatIntent(text: string): 'plan' | 'images' | 'publish' {
  const input = text.trim().replace(/[。！!？?\s]/g, '');
  if (/^(请|帮我)?(继续|开始|准备)?(发布|发布这篇|发布这条|发出去|发布作品|上传发布)$/.test(input)) return 'publish';
  if (/^(请|帮我)?(继续|开始|准备)?(配图|生成图片|制作图片|生成配图|做图片)$/.test(input)) return 'images';
  if (!/(不要|不想|暂不|别|取消|先不)/.test(input) && input.length < 50) {
    if (/^(请|帮我)?(给这篇|为这篇|这篇|这条|它)?(继续|开始|准备|可以|现在|直接|已经)?(发布|发出去|上传发布)(吧|了|吧谢谢|到小红书|到抖音)?$/.test(input)) return 'publish';
    if (/^(请|帮我)?(给这篇|为这篇|给它)?(继续|开始|准备)?(生成|制作|做|配)([一二三四两1234]张)?(图片|配图|图)(吧|可以吗)?$/.test(input)) return 'images';
  }
  return 'plan';
}

export function ControllerChat() {
  const { project, state, settings, target, go } = useStudio();
  const projectId = project!.id, saved = useControllerView(projectId), action = useWorkAction();
  const history = useWorkResource<{ items: ChatMessage[] }>(`/projects/${uri(projectId)}/controller-messages`, 2500);
  const plans = useWorkResource<{ items: WorkPlan[] }>(`/projects/${uri(projectId)}/work-plans`, 3000);
  const tasks = useWorkResource<{ items: WorkTask[] }>(`/projects/${uri(projectId)}/tasks`, 2500);
  const selectedTaskId = saved.value.replyTaskId || target.taskId;
  const exact = useWorkResource<{ task: WorkTask }>(selectedTaskId ? `/tasks/${uri(selectedTaskId)}` : null);
  const capabilities = useWorkResource<WorkCapabilities>('/work-capabilities');
  const [approval, setApproval] = useState<ChatMessage | null>(null), [historyOpen, setHistoryOpen] = useState(false), [optionsOpen, setOptionsOpen] = useState(false);
  const replyTaskId = saved.value.replyTaskId, replyRunId = saved.value.replyRunId;
  const setReplyTaskId = (value: string) => saved.update({ replyTaskId: value });
  const setReplyRunId = (value: string) => saved.update({ replyRunId: value });
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState(''), [mediaRequest, setMediaRequest] = useState<MediaRequest | undefined>(), [limit, setLimit] = useState(12);
  const stream = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), bottom = useRef(true), [newProgress, setNewProgress] = useState(false);
  const sendKey = useRef({ fingerprint: '', id: workId() }), restoredAccounts = useRef(false), focusedTarget = useRef('');
  const visibleTasks = [...new Map([...(tasks.value?.items || []), ...(exact.value?.task && !exact.value.task.deletedAt ? [exact.value.task] : [])].map(task => [task.id, task])).values()].filter(task => !deleted.has(task.id) && !task.deletedAt && task.role !== 'controller-planning').sort((a, b) => (a.latestRunCreatedAt || a.createdAt).localeCompare(b.latestRunCreatedAt || b.createdAt));
  const replyTask = visibleTasks.find(task => task.id === replyTaskId);
  const messages = history.value?.items || [];
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && message.runId);
  useEffect(() => { if (saved.ready && !restoredAccounts.current) { restoredAccounts.current = true; if (!saved.value.accountIds.length && state.accounts.length === 1) saved.update({ accountIds: [state.accounts[0].id] }); } }, [saved.ready, state.accounts]);
  useEffect(() => { if (saved.ready && !saved.value.model && settings.routes.strategy) saved.update({ model: settings.routes.strategy }); }, [saved.ready, saved.value.model, settings.routes.strategy]);
  useEffect(() => { if (saved.ready && target.taskId && target.taskId !== focusedTarget.current) { focusedTarget.current = target.taskId; setReplyTaskId(target.taskId); } }, [target.taskId, saved.ready]);
  const stamp = JSON.stringify([messages.map(message => [message.id, message.text, message.planningRunId]), visibleTasks.map(task => [task.id, task.status, task.latestRunId]), plans.value?.items.map(plan => [plan.id, plan.version, plan.status])]);
  useEffect(() => { const element = stream.current; if (!element) return; if (bottom.current) requestAnimationFrame(() => { element.scrollTop = element.scrollHeight; }); else setNewProgress(true); }, [stamp]);
  useEffect(() => { if (input.current) { input.current.style.height = '0px'; input.current.style.height = Math.min(180, Math.max(54, input.current.scrollHeight)) + 'px'; } }, [saved.value.goal]);
  const jumpBottom = () => { if (stream.current) stream.current.scrollTo({ top: stream.current.scrollHeight, behavior: 'smooth' }); bottom.current = true; setNewProgress(false); };
  const refresh = async () => { await Promise.all([history.reload(), plans.reload(), tasks.reload()]); };
  const selectReply = (task: WorkTask) => { saved.update({ replyTaskId: task.id, replyRunId: '', newConversation: false }); requestAnimationFrame(() => input.current?.focus()); };
  useEffect(() => { if (exact.value?.task.deletedAt && replyTaskId === exact.value.task.id) saved.update({ replyTaskId: '', replyRunId: '', newConversation: true }); }, [exact.value?.task.deletedAt]);
  const onDeleted = async (taskId: string) => { setDeleted(current => new Set([...current, taskId])); if (replyTaskId === taskId) setReplyTaskId(''); if (target.taskId === taskId) go('controller', projectId); await tasks.reload(); };
  async function send() {
    const text = saved.value.goal.trim(); if (!text || action.pending || !saved.ready || capabilities.value?.enabled !== true) return;
    const intent = chatIntent(text), recentTask = visibleTasks.filter(task => task.status === 'succeeded' && (intent === 'plan' || ['xiaohongshu-copy','douyin-script'].includes(task.role))).at(-1);
    const contextual = replyTask || (!saved.value.newConversation && (intent !== 'plan' || /^(把|将|改|调整|重写|补充|删|这篇|这份|这个|再|更|语气|标题|正文|开头|结尾|增加|减少|不要)/.test(text)) ? recentTask : undefined);
    if (intent !== 'plan' && contextual && !['xiaohongshu-copy','douyin-script'].includes(contextual.role)) { setNotice('这是一项研究任务，请在对应文案或脚本成果下继续配图和发布。'); return; }
    if (replyTaskId && !replyTask) { setNotice('当前回复对象尚未读取或已不可用，请取消回复对象后重试。'); return; }
    const compatible = !lastAssistant?.accountIds?.length || JSON.stringify([...lastAssistant.accountIds].sort()) === JSON.stringify([...saved.value.accountIds].sort());
    const questionRun = replyRunId || (!contextual && !saved.value.newConversation && compatible ? lastAssistant?.runId : undefined);
    const body = { text, accountIds: contextual?.accountId ? [contextual.accountId] : saved.value.accountIds, intent, ...(contextual ? { taskId: contextual.id } : {}), ...(questionRun ? { replyToRunId: questionRun } : {}) };
    const fingerprint = JSON.stringify(body); if (sendKey.current.fingerprint !== fingerprint) sendKey.current = { fingerprint, id: workId() };
    await action.execute(async isCurrent => {
      if (contextual?.role === 'douyin-research') { const detail = await api<{task: WorkTask; runs: WorkRun[]}>(`/tasks/${uri(contextual.id)}`); if (!isCurrent()) throw Error('工作区已切换'); body.accountIds = refinementAccountIds(detail.task, detail.runs.find(run => run.id === detail.task.latestRunId)); }
      return api<{ message: ChatMessage }>(`/projects/${uri(projectId)}/controller-messages`, 'POST', { ...body, idempotencyKey: sendKey.current.id });
    }, async (result, isCurrent) => {
      if (!isCurrent()) return; sendKey.current = { fingerprint: '', id: workId() }; saved.update({ goal: '', newConversation: false, ...(contextual ? { replyTaskId: contextual.id } : {}) }); setNotice(''); bottom.current = true;
      if (intent === 'plan') setApproval(result.message);
      else if (contextual) { setMediaRequest({ taskId: contextual.id, kind: intent, text, nonce: Date.now() }); setReplyTaskId(contextual.id); }
      else setNotice('请先完成一份文案，然后在对应成果下制作图片和核对发布。');
      setReplyRunId(''); await history.reload();
    });
  }
  const shownTasks = visibleTasks.filter(task => visibleTasks.slice(-limit).includes(task) || [target.taskId, replyTaskId, mediaRequest?.taskId].includes(task.id));
  useEffect(() => { const id = mediaRequest?.taskId || target.taskId; if (!id) return; const element = document.getElementById(`chat-task-${id}`); if (element) requestAnimationFrame(() => element.scrollIntoView({ block: 'start' })); }, [target.taskId, mediaRequest?.nonce, shownTasks.length]);
  const taskEntries = shownTasks.map(task => ({ id: `task:${task.id}`, time: task.latestRunCreatedAt || task.createdAt, task }));
  const entries = [...messages.map(message => ({ id: `message:${message.id}`, time: message.createdAt, message })), ...taskEntries].sort((a, b) => a.time.localeCompare(b.time));
  const planById = new Map((plans.value?.items || []).map(plan => [plan.id, plan]));
  const latestPlanMessage = new Map<string, string>(); for (const message of messages) if (message.role === 'assistant' && message.planId) latestPlanMessage.set(message.planId, message.id);
  const running = visibleTasks.filter(task => activeWork(task.status));
  return <section className="controller-chat" aria-label="总控聊天工作区">
    <header className="chat-toolbar"><div><Sparkles size={20}/><h1>总控</h1><span>{project!.brief.name}</span></div><div><button className="button small" onClick={() => { saved.update({ replyTaskId: '', replyRunId: '', newConversation: true }); setNotice('直接输入新的需求，已有对话和成果会保留。'); input.current?.focus(); }}><Plus size={15}/>新需求</button><button className="button small" onClick={() => setHistoryOpen(true)}><Clock3 size={15}/>历史任务</button></div></header>
    <div className="chat-stream" ref={stream} onScroll={event => { const element = event.currentTarget; bottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120; if (bottom.current) setNewProgress(false); }}><div className="chat-content" aria-label="总控对话历史" aria-live="off">
      {!messages.length && !visibleTasks.length && <div className="chat-empty"><Sparkles size={34}/><h2>今天，想一起完成什么？</h2><p>说说你的想法。我来安排计划和 Agent，文案、图片与发布都在这段对话里完成。</p><div>{['给我的账号做一篇图文，配图后再核对发布', '先研究同话题内容，再写一份视频脚本'].map(example => <button key={example} onClick={() => { saved.update({ goal: example }); input.current?.focus(); }}>{example}</button>)}</div></div>}
      {visibleTasks.length > limit && <button className="text-button" onClick={() => setLimit(current => current + 12)}>显示更早的任务与成果</button>}
      {entries.map(entry => 'message' in entry ? <article key={entry.id} className={`chat-message ${entry.message.role === 'user' ? 'user' : 'assistant'}`}>
        {entry.message.role !== 'user' && <span className="chat-avatar"><Sparkles size={17}/></span>}<div className="chat-message-body"><div className="chat-message-meta">{entry.message.role === 'user' ? '你' : '总控'}</div>
        {entry.message.role === 'assistant' && entry.message.planId && latestPlanMessage.get(entry.message.planId) === entry.message.id && planById.has(entry.message.planId) ? <ChatPlan plan={planById.get(entry.message.planId)!} onChanged={refresh}/> : <p className="chat-text">{entry.message.text}</p>}
        {entry.message.role === 'user' && entry.message.intent === 'plan' && !entry.message.planningRunId && !entry.message.runId && <button className="button small" onClick={() => setApproval(entry.message)}><ShieldCheck size={14}/>继续核对规划</button>}
        {entry.message.role === 'assistant' && entry.message.runId && <ChatPlanningProgress runId={entry.message.runId} onReply={() => { saved.update({ replyRunId: entry.message.runId!, replyTaskId: '', newConversation: false }); input.current?.focus(); }}/>} 
        {entry.message.role === 'user' && entry.message.intent && entry.message.intent !== 'plan' && <><small>已收到。请在对应成果下核对{entry.message.intent === 'images' ? '图片指令、Skills 和费用' : '发布账号与最终内容'}；发送消息不会自动批准。</small>{entry.message.taskId && <button className="button small" onClick={() => { setReplyTaskId(entry.message.taskId!); setMediaRequest({ taskId: entry.message.taskId!, kind: entry.message.intent as 'images' | 'publish', text: entry.message.text, nonce: Date.now() }); }}>继续核对{entry.message.intent === 'images' ? '图片' : '发布'}</button>}</>}
        </div></article> : <ChatAgent key={entry.id} task={entry.task} projectId={projectId} request={mediaRequest?.taskId === entry.task.id ? mediaRequest : undefined} onReply={() => selectReply(entry.task)} onDeleted={() => onDeleted(entry.task.id)}/>) }
      {failed(history.error || tasks.error || plans.error || exact.error)}{notice && <div className="chat-message assistant"><span className="chat-avatar"><Sparkles size={17}/></span><p>{notice}</p></div>}
    </div></div>
    <div className="chat-composer-wrap">{newProgress && <button className="chat-new-progress" onClick={jumpBottom}><ArrowDown size={14}/>有新进展</button>}{running.length > 0 && <div className="chat-running" role="status">{running.map(task => `${roleLabels[task.role]} · ${task.accountName || '项目共享'}`).join('；')} 正在工作</div>}
      <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        {(replyTaskId || replyRunId) && <div className="chat-composer-context"><MessageSquareText size={14}/><span>{replyTask ? `基于「${replyTask.title}」继续` : replyTaskId ? '正在读取回复对象；不可用时可取消' : '回答总控的补充问题'}</span><button type="button" aria-label="取消当前回复对象" onClick={() => saved.update({ replyTaskId: '', replyRunId: '', newConversation: true })}><X size={14}/></button></div>}
        <textarea ref={input} aria-label="给总控发消息" placeholder="给总控发消息，或继续修改、配图、准备发布…" maxLength={16000} value={saved.value.goal} disabled={!saved.ready || action.pending} onChange={event => saved.update({ goal: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }}/>
        <div className="chat-composer-tools"><button type="button" onClick={() => setOptionsOpen(true)}><Settings2 size={15}/>{saved.value.accountIds.length ? `${saved.value.accountIds.length} 个目标账号` : '选择目标账号'}<ChevronDown size={13}/></button><span>{settings.models[saved.value.model || settings.routes.strategy]?.label || '规划模型'}</span><button className="chat-send" type="submit" aria-label="发送给总控" disabled={!saved.ready || action.pending || !saved.value.goal.trim() || capabilities.value?.enabled !== true}><ArrowUp size={19}/></button></div>
      </form><small className="chat-composer-note">Enter 发送，Shift + Enter 换行 · 调用 Agent 和发布前，会请你核对批准。</small>{failed(action.error || saved.error || capabilities.error)}
    </div>
    {approval && <ChatPlanningApproval key={approval.id} projectId={projectId} message={approval} initialModel={saved.value.model || settings.routes.strategy} onClose={() => setApproval(null)} onStarted={async () => { setApproval(null); await refresh(); }}/>} 
    {optionsOpen && <Modal title="本次聊天设置" description="新派工使用这里的账号范围；已经批准的任务继续保留原账号。" onClose={() => setOptionsOpen(false)}><fieldset disabled={!saved.ready}><legend>目标账号</legend>{state.accounts.map(account => <label className="checkbox-row" key={account.id}><input type="checkbox" checked={saved.value.accountIds.includes(account.id)} onChange={event => saved.update({ accountIds: event.target.checked ? [...saved.value.accountIds, account.id].slice(0,20) : saved.value.accountIds.filter(id => id !== account.id) })}/>{account.name} · {account.platform}</label>)}{!state.accounts.length && <p>请先在账号入口添加平台账号。</p>}<Field label="总控规划模型"><select value={saved.value.model || settings.routes.strategy} onChange={event => saved.update({ model: event.target.value })}>{Object.entries(settings.models).map(([id, model]) => <option key={id} value={id}>{model.label}</option>)}</select></Field></fieldset><button className="button primary" onClick={() => setOptionsOpen(false)}>完成</button></Modal>}
    {historyOpen && <Modal wide title="历史任务" description="选择任务后仍在总控对话中查看；已保存的成果会保留。" onClose={() => setHistoryOpen(false)}><TaskList embedded onSelected={() => setHistoryOpen(false)} onDeleted={onDeleted}/></Modal>}
  </section>;
}

export function ChatPlanningApproval({ projectId, message, initialModel, onClose, onStarted }: { projectId: string; message: ChatMessage; initialModel: string; onClose: () => void; onStarted: () => void | Promise<void> }) {
  const { settings, state } = useStudio(), action = useWorkAction();
  const [model, setModel] = useState(initialModel), [quote, setQuote] = useState<Quote | null>(null), [budget, setBudget] = useState(0), [consent, setConsent] = useState(false);
  const request = useRef(workId());
  useEffect(() => { setQuote(null); setConsent(false); void action.execute(() => api<Quote>(`/projects/${uri(projectId)}/planning/estimate`, 'POST', { messageId: message.id, model }), result => { setQuote(result); setBudget(Math.ceil(result.estimateUSD * 10000) / 10000); }); }, [model, message.id, projectId]);
  const expired = quote && Date.parse(quote.expiresAt) <= Date.now();
  return <Modal title="批准总控规划" description="总控先理解需求并整理任务；后续 Agent、图片和发布会分别请你批准。" onClose={() => { if (!action.pending) onClose(); }}>
    <p className="chat-approval-request">{message.text}</p><Field label="本次规划模型"><select value={model} disabled={action.pending} onChange={event => setModel(event.target.value)}>{Object.entries(settings.models).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></Field>
    <p className="small-note">本次目标账号：{state.accounts.filter(account => message.accountIds?.includes(account.id)).map(account => account.name).join('、') || '未选择账号'}。</p>
    {quote && <><p>本次规划估算 <b>{dollars(quote.estimateUSD)}</b></p><Field label="本次规划费用上限（美元）"><input type="number" min={quote.estimateUSD} max={100} step={0.0001} value={budget} disabled={action.pending} onChange={event => { setBudget(Number(event.target.value)); setConsent(false); }}/></Field><label className="checkbox-row"><input type="checkbox" checked={consent} disabled={action.pending} onChange={event => setConsent(event.target.checked)}/><span>同意本次规划调用及费用。</span></label></>}
    {expired && <p className="work-error">报价已过期，请关闭后重新核对。</p>}{failed(action.error)}<div className="modal-actions"><button className="button" disabled={action.pending} onClick={onClose}>暂不执行</button><button className="button primary" disabled={action.pending || !quote || !consent || !!expired || !Number.isFinite(budget) || budget < quote.estimateUSD || budget > 100} onClick={() => void action.execute(() => api(`/projects/${uri(projectId)}/planning-runs`, 'POST', { quoteId: quote!.quoteId, planningBudgetUSD: budget, idempotencyKey: request.current }), onStarted)}>{action.pending ? '正在核对…' : '批准规划'}</button></div>
  </Modal>;
}

function ChatPlan({ plan, onChanged }: { plan: WorkPlan; onChanged: () => Promise<void> }) {
  const { state } = useStudio(), [open, setOpen] = useState(false);
  return <div className="chat-plan"><p>我将先完成下面的任务，再与你核对图片和最终发布内容。</p><ol>{plan.nodes.map(node => <li key={node.id}><b>{node.title}</b><span>{roleLabels[node.role]} · {state.accounts.find(account => account.id === (node.accountId || node.connectionAccountId))?.name || '项目共享研究'}</span>{node.dependsOn.length > 0 && <small>先使用{node.dependsOn.map(id => `「${plan.nodes.find(item => item.id === id)?.title || id}」`).join('、')}的结果，避免脱离前面的资料创作。</small>}</li>)}</ol><div className="chat-plan-actions"><button className="button small" onClick={() => setOpen(true)}><ShieldCheck size={14}/>{plan.status === 'draft' ? '核对计划' : '查看或调整计划'}</button><small>{plan.status === 'draft' ? '尚未调用执行 Agent' : '计划已确认，每项派工单独批准'}</small></div>{open && <Modal wide title="核对本轮计划" onClose={() => setOpen(false)}><PlanReview plan={plan} onChanged={async () => { setOpen(false); await onChanged(); }}/></Modal>}</div>;
}
function ChatPlanningProgress({ runId, onReply }: { runId: string; onReply: () => void }) {
  const resource = useWorkResource<{ run: WorkRun }>(`/planning-runs/${uri(runId)}`, 2500), run = resource.value?.run;
  return <div className="chat-planning-progress">{run && <WorkStatusBadge status={run.status}/>}<ChatProcess runId={runId} running={!!run && activeWork(run.status)}/>{(run?.planningQuestion || run && ['failed','cancelled'].includes(run.status)) && <button className="button small" onClick={onReply}>{run?.planningQuestion ? '补充信息' : '在对话中继续规划'}</button>}{failed(resource.error)}</div>;
}
export function ChatProcess({ runId, running }: { runId: string; running: boolean }) {
  const [rows, setRows] = useState<WorkEvent[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, busy = false, cursor = 0; const session = workSession(); setRows([]); setError('');
    const valid = () => alive && session === workSession();
    async function read() {
      if (busy || !valid()) return; busy = true;
      try { let more = true; while (more && valid()) { const result = await api<{items: WorkEvent[]; nextCursor?: number; hasMore?: boolean}>(`/task-runs/${uri(runId)}/events?after=${cursor}`); if (!valid()) return; setRows(previous => [...new Map([...previous, ...result.items].map(row => [row.id, row])).values()].sort((a,b) => a.sequence-b.sequence)); const next = Math.max(cursor, result.nextCursor || 0, ...result.items.map(row => row.sequence)); more = !!result.hasMore && next > cursor; cursor = next; } if (valid()) setError(''); }
      catch (failure) { if (valid()) setError(workError(failure)); } finally { busy = false; }
    }
    void read(); const timer = running ? setInterval(() => void read(), 2500) : undefined;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [runId, running]);
  const last = rows.at(-1);
  return <details className="chat-process"><summary>{running ? '正在处理' : '过程与依据'}{last ? ` · ${last.summary}` : ''}</summary><p>这里只显示任务实际执行的步骤、依据和结果。</p><ol>{rows.map(event => <li key={event.id}><span>{event.summary}</span><time>{new Date(event.at).toLocaleTimeString('zh-CN')}</time></li>)}</ol>{failed(error)}</details>;
}

function ChatAgent({ task, projectId, request, onReply, onDeleted }: { task: WorkTask; projectId: string; request?: MediaRequest; onReply: () => void; onDeleted: () => Promise<void> }) {
  const detail = useWorkResource<{ task: WorkTask; runs: WorkRun[]; artifacts: WorkArtifact[] }>(`/tasks/${uri(task.id)}`, activeWork(task.status) || task.status.replaceAll('_','-') === 'pending-approval' ? 2500 : 0);
  const current = detail.value?.task || task, run = detail.value?.runs.find(item => item.id === current.latestRunId);
  const runDetail = useWorkResource<{ run: WorkRun; artifacts: WorkArtifact[] }>(run ? `/task-runs/${uri(run.id)}` : null, run && activeWork(run.status) ? 2500 : 0);
  const latestRun = runDetail.value?.run || run;
  const artifacts = (runDetail.value?.artifacts || detail.value?.artifacts || []).filter(item => item.runId === current.latestRunId).sort((a,b) => b.version-a.version), artifact = artifacts.find(item => !item.candidate) || artifacts[0];
  const [approve, setApprove] = useState(false), [details, setDetails] = useState(false), action = useWorkAction();
  const status = (latestRun?.status || current.status).replaceAll('_','-');
  if (current.deletedAt) return null;
  return <article className="chat-message assistant" id={`chat-task-${task.id}`}><span className="chat-avatar"><Sparkles size={17}/></span><div className="chat-message-body chat-agent"><header className="chat-agent-header"><div><b>{roleLabels[current.role]}</b><span>{current.accountName || '项目共享研究'}</span></div><WorkStatusBadge status={status}/></header><p>{current.title}</p>
    {latestRun && <ChatProcess runId={latestRun.id} running={activeWork(status)}/>} 
    {status === 'pending-approval' && latestRun && <div className="chat-agent-approval"><p>{latestRun.dispatch?.reason || '我已整理好派工指令，等你选择 Skills 并核对费用。'}</p><button className="button small" onClick={() => setApprove(true)}><ShieldCheck size={15}/>核对并批准 Agent</button></div>}
    {['failed','cancelled'].includes(status) && latestRun && <button className="button small" disabled={action.pending} onClick={() => void action.execute(() => api(`/task-runs/${uri(latestRun.id)}/commands`, 'POST', { command: 'retry', expectedRevision: latestRun.revision, idempotencyKey: workId() }), async () => { await detail.reload(); })}>准备重试 · 重新批准</button>}
    {latestRun?.error && failed(latestRun.error)}
    {artifact && <div className="chat-artifact"><ArtifactEditor key={`${artifact.id}:${artifact.version}`} artifact={artifact} projectId={projectId} headVersion={artifact.headVersion ?? artifact.version} chatMode mediaRequest={request} onSaved={async () => { await Promise.all([detail.reload(), runDetail.reload()]); }}/></div>}
    <div className="chat-agent-actions"><button className="text-button" onClick={onReply}><MessageSquareText size={14}/>在对话中修改</button><button className="text-button" onClick={() => setDetails(true)}><FileText size={14}/>任务详情</button><DeleteWorkTaskButton task={current} onDeleted={onDeleted}/></div>{failed(detail.error || runDetail.error || action.error)}
    {approve && latestRun && <WorkDispatch task={current} run={latestRun} onClose={() => setApprove(false)} onApproved={async () => { setApprove(false); await Promise.all([detail.reload(), runDetail.reload()]); }}/>} 
    {details && <Modal wide title="任务详情与历史版本" onClose={() => setDetails(false)}><TaskWorkspace taskId={task.id} embedded onDeleted={async () => { setDetails(false); await onDeleted(); }} onReply={() => { setDetails(false); onReply(); }}/></Modal>}
  </div></article>;
}
