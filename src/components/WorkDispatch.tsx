import { useEffect, useRef, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { Field, Modal } from '../components';
import { useStudio } from '../context';
import type { CreativeSkillsCatalog } from '../pages/CreativeSkills';
import { roleLabels, useWorkAction, useWorkResource, useWorkView, workId, type DispatchDraft, type WorkRun, type WorkTask } from '../work-control';

export type DispatchQuote = { revisionSource?: {title: string; version: number} | null; quoteId: string; runId: string; revision: number; estimateUSD: number; expiresAt: string; model: string; accountName?: string; skills: { id: string; name: string; version: string }[]; dependencies: { taskId: string; runId: string; artifactId: string; version: number; title: string; kind: string }[]; scope: 'task-only' };
const workflowFor = { 'xiaohongshu-copy': 'copy-xiaohongshu', 'douyin-script': 'copy-douyin', 'douyin-research': 'research-analysis', 'controller-planning': 'planning' };
const money = (value: number) => `$${value.toFixed(4)}`;

/** The dialog collects one explicit dispatch. A plan confirmation never opens a paid request. */
export function WorkDispatch({ task, run, onClose, onApproved }: { task: WorkTask; run: WorkRun; onClose: () => void; onApproved: (run: WorkRun) => Promise<void> }) {
  const { settings, state } = useStudio();
  const saved = useWorkView(task.id), action = useWorkAction();
  const catalog = useWorkResource<CreativeSkillsCatalog>(`/creative-skills?revision=${state.skillsRevision || 0}`);
  const [draft, setDraft] = useState<DispatchDraft>({ runId: run.id, baseRevision: run.revision, requirement: run.node?.requirement || '', model: run.node?.model || '', skillMode: '', skillIds: [], budgetUSD: run.node?.budgetUSD || 0 });
  const [quote, setQuote] = useState<DispatchQuote | null>(null), [ready, setReady] = useState(false);
  const restored = useRef(false), request = useRef(workId());
  const workflowId = run.dispatch?.workflowId || workflowFor[task.role];
  const workflow = catalog.value?.workflows.find(item => item.id === workflowId);
  const skills = catalog.value?.skills.filter(item => item.enabled && (item.eligibleWorkflowIds?.includes(workflowId) || workflow?.eligibleSkillIds.includes(item.id))) || [];
  const selectionValid = draft.skillMode === 'default' || (draft.skillMode === 'selected' && draft.skillIds.length > 0 && draft.skillIds.every(id => skills.some(item => item.id === id)));
  const fingerprint = JSON.stringify([run.id, run.revision, draft.requirement.trim(), draft.model, draft.skillMode, draft.skillIds, catalog.value?.revision]);
  const latest = useRef(fingerprint); latest.current = fingerprint;
  const pending = run.status.replaceAll('_', '-') === 'pending-approval';
  const canEstimate = ready && pending && run.dispatch?.ready === true && !!catalog.value && selectionValid && !!draft.requirement.trim() && !!draft.model;
  const quoteValid = !!quote && quote.runId === run.id && quote.revision === run.revision && Date.parse(quote.expiresAt) > Date.now();
  useEffect(() => {
    if (!saved.ready || restored.current) return;
    restored.current = true;
    const previous = saved.value.dispatchDraft;
    if (previous?.runId === run.id && previous.baseRevision === run.revision) setDraft(previous);
    setReady(true);
  }, [saved.ready, saved.value.dispatchDraft, run.id, run.revision]);
  useEffect(() => { setQuote(null); request.current = workId(); }, [fingerprint]);
  function change(patch: Partial<DispatchDraft>) {
    const next = { ...draft, ...patch }; setDraft(next); saved.update({ dispatchDraft: next });
  }
  async function estimate() {
    if (!canEstimate) return;
    const captured = fingerprint;
    await action.execute(() => api<DispatchQuote>(`/task-runs/${encodeURIComponent(run.id)}/approval-estimate`, 'POST', { expectedRevision: run.revision, requirement: draft.requirement.trim(), model: draft.model, skillMode: draft.skillMode, skillIds: draft.skillMode === 'selected' ? draft.skillIds : [] }), result => {
      if (latest.current !== captured) return;
      setQuote(result); change({ budgetUSD: Math.max(draft.budgetUSD, Math.ceil(result.estimateUSD * 10000) / 10000) }); request.current = workId();
    });
  }
  async function approve() {
    if (!canEstimate || !quoteValid || !quote || !Number.isFinite(draft.budgetUSD) || draft.budgetUSD < quote.estimateUSD || draft.budgetUSD > 1000) return;
    await action.execute(() => api<{ run: WorkRun }>(`/task-runs/${encodeURIComponent(run.id)}/approvals`, 'POST', { expectedRevision: run.revision, quoteId: quote.quoteId, budgetUSD: draft.budgetUSD, idempotencyKey: request.current }), async (result, isCurrent) => {
      saved.update({ dispatchDraft: null }); await saved.save().catch(() => {}); if (isCurrent()) await onApproved(result.run);
    });
  }
  const error = action.error || catalog.error || saved.error;
  return <Modal title={`批准本次派工 · ${roleLabels[task.role]}`} description="核对指令和 Skills 后，只批准这一项任务。后续 Agent 会再次请你确认。" onClose={() => { if (!action.pending) onClose(); }} wide>
    <fieldset className="work-dispatch-fields" disabled={!ready || action.pending || !pending}>
      <div className="work-dispatch-context"><div><small>目标账号</small><b>{task.accountName || (task.accountId ? state.accounts.find(item => item.id === task.accountId)?.name || task.accountId : '项目共享研究')}</b></div><div><small>预期交付</small><b>{task.title}</b></div></div>
      {run.dispatch?.reason && <p className="info-box">{run.dispatch.reason}</p>}
      <Field label="总控下发的指令 · 可直接修改"><textarea rows={6} maxLength={4000} value={draft.requirement} onChange={event => change({ requirement: event.target.value })}/></Field>
      <Field label="执行模型"><select value={draft.model} onChange={event => change({ model: event.target.value })}><option value="" disabled>请选择模型</option>{draft.model && !settings.models[draft.model] && <option value={draft.model}>{draft.model}</option>}{Object.entries(settings.models).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></Field>
      <fieldset className="work-dispatch-skills"><legend>选择本次使用的 Skills</legend><p className="small-note">只显示适用于此 Agent 的已启用 Skills。选择仅用于本次派工。</p>
        {catalog.loading && <p role="status">正在读取可用 Skills…</p>}
        {skills.map(skill => <div className="work-dispatch-skill" key={skill.id}><label className="checkbox-row"><input type="checkbox" checked={draft.skillMode === 'selected' && draft.skillIds.includes(skill.id)} onChange={event => change({ skillMode: 'selected', skillIds: event.target.checked ? [...new Set([...draft.skillIds, skill.id])] : draft.skillIds.filter(id => id !== skill.id) })}/><span>{skill.name} · v{skill.version}<small>{skill.description}</small></span></label><details><summary>查看指令原文</summary><pre>{skill.instructions}</pre></details></div>)}
        {catalog.value && !skills.length && <p className="small-note">此 Agent 暂无已导入的可用 Skill。</p>}
        <label className="checkbox-row"><input type="checkbox" checked={draft.skillMode === 'default'} onChange={event => change({ skillMode: event.target.checked ? 'default' : '', skillIds: [] })}/><span>本次只用默认规则，不使用额外 Skill</span></label>
        {!!workflow?.skills.length && <details><summary>查看默认规则</summary>{workflow.skills.map(skill => <div key={skill.id}><b>{skill.name} · v{skill.version}</b><pre>{skill.instructions}</pre></div>)}</details>}
      </fieldset>
      <button type="button" className="button" disabled={!canEstimate || action.pending} onClick={() => void estimate()}>核对资料与预估费用（不调用模型）</button>
      {quote && <section className="work-dispatch-quote"><p>本次估算 <b>{money(quote.estimateUSD)}</b> · {quote.accountName || task.accountName || '项目共享研究'}</p><p className="small-note">将固定指令、账号、所选模型、Skills 版本和以下前置成果。费用以服务方实际记录为准。</p>{quote.revisionSource && <p>本次基于《{quote.revisionSource.title}》V{quote.revisionSource.version} 修改；保留未要求改动的内容。</p>}{quote.dependencies.length > 0 ? <ul>{quote.dependencies.map(item => <li key={`${item.artifactId}:${item.version}`}>{item.title} · V{item.version}</li>)}</ul> : <p className="small-note">资料来源：本项目事实、账号定位和本次已选资料；没有前置任务成果。</p>}<p className="small-note">Skills：{quote.skills.length ? quote.skills.map(item => `${item.name} v${item.version}`).join('、') : '默认规则'}</p><Field label="本次费用上限（美元）"><input type="number" min={0} max={1000} step={0.0001} value={draft.budgetUSD} onChange={event => change({ budgetUSD: Number(event.target.value) })}/></Field>{!quoteValid && <p className="work-error">预估已过期或任务状态已变化，请重新核对。</p>}</section>}
    </fieldset>
    {error && <p className="work-error" role="alert">{error}</p>}
    <div className="work-dispatch-footer"><button type="button" className="button" disabled={action.pending} onClick={onClose}>暂不执行</button><button type="button" className="button primary" disabled={!canEstimate || action.pending || !quoteValid || !quote || !Number.isFinite(draft.budgetUSD) || draft.budgetUSD < quote.estimateUSD || draft.budgetUSD > 1000} onClick={() => void approve()}><Check size={16}/>{action.pending ? '正在核对…' : '批准本次派工'}</button></div>
    <p className="small-note"><ShieldCheck size={14}/> 本次只生成草稿或读取已授权资料，不发布。批准之后修改要求，需要建立新的待批准派工。</p>
  </Modal>;
}
