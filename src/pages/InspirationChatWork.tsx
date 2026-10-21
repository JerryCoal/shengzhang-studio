import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Download, Flame, Pause, Play, Plus, RefreshCw, Send, Sparkles } from 'lucide-react';
import { download, LOCAL_DATA } from '../api';
import { useStudio } from '../context';
import { Field, Modal } from '../components';
import { InspirationConversation, type InspirationProgress } from '../components/InspirationConversation';
import { canGenerate, providerLabel } from '../model-provider';
import { buildInspirationRequest, type InspirationConversation as ConversationState } from '../../server/inspiration-conversation.mjs';
import { changeInspirationTarget, inspirationCanReview, inspirationDraftFingerprint, inspirationHandoffRequirement, scopedInspirationTurns, suggestInspirationTarget } from '../inspiration-chat-state.mjs';
import { KnowledgeLibrary } from './KnowledgeLibrary';
import { ResearchPanel } from './Research';
import type { AgentDraft, AgentDraftForm, AgentPlatform } from './AgentWorkspace';
import type { Asset, Page } from '../types';

type PlatformEntry = { platform: AgentPlatform; name: string; page: Page };
type Props = {
  form: AgentDraftForm;
  platforms: readonly PlatformEntry[];
  savedState: ReactNode;
  renderModels: (draft: AgentDraft, disabled: boolean) => ReactNode;
  renderExperience: (draft: AgentDraft, disabled: boolean) => ReactNode;
};
type Review = { draft: AgentDraft; message: string; fingerprint: string; session: string | null; changed: boolean; mentioned: string[] };
const session = () => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('studio-session'); } catch { return null; } };
const failureText = (error: unknown) => error instanceof Error ? error.message : '暂时没有收到完整结果，请核对已保存结果。';
const newConversation = (input = ''): ConversationState => ({ version: 1, id: crypto.randomUUID(), input, turns: [] });
const fingerprint = inspirationDraftFingerprint;

export function InspirationChatWork({ form, platforms, savedState, renderModels, renderExperience }: Props) {
  const context = useStudio(), { project, state, settings, busy, run, runBackground, mutate, go, notify } = context;
  const { draft, update } = form;
  const [section, setSection] = useState<'chat' | 'research' | 'experience'>('chat');
  const [researchSeed, setResearchSeed] = useState<{ keywords: string; platform: AgentPlatform } | null>(null);
  const [review, setReview] = useState<Review | null>(null), [resetOpen, setResetOpen] = useState(false), [error, setError] = useState('');
  const [sending, setSending] = useState(false), [phase, setPhase] = useState<InspirationProgress | null>(null);
  const [handoffAccountId, setHandoffAccountId] = useState('');
  const inFlight = useRef(false), alive = useRef(true), originalSession = useRef(session());
  const handoffRequest = useRef({ fingerprint: '', id: '' });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (form.loaded && !draft.conversation) update({ conversation: newConversation(draft.requirement) }); }, [form.loaded, draft.conversation]);
  const assertSession = () => { if (!alive.current || session() !== originalSession.current) throw new Error('登录工作区已变化。结果仍属于原用户，请重新登录后核对，不能在当前身份继续提交。'); };
  if (!project) return null;

  const conversation = draft.conversation;
  const input = conversation?.input ?? draft.requirement;
  const pending = conversation?.turns.find(turn => turn.status === 'pending');
  const locked = busy || sending || !form.loaded || !!pending;
  const turns = scopedInspirationTurns(conversation, draft.platform, draft.accountId);
  const accounts = state.accounts.filter(account => account.platform === draft.platform);
  const selectedAccount = accounts.find(account => account.id === draft.accountId);
  const handoffAccount = accounts.find(account => account.id === (draft.accountId || handoffAccountId));
  const destination = platforms.find(item => item.platform === draft.platform)!;
  const selectedResearch = project.research?.analyses.filter(item => draft.referenceIds.includes(item.id)) || [];
  const hotIntent = /热点|热帖|爆帖|爆款|趋势|hot\s?topic|trending/i.test(input);
  const canReview = inspirationCanReview({ loaded: form.loaded && !!conversation, busy: busy || sending, input, conversation, localData: LOCAL_DATA });
  const chatTask = context.backgroundTask?.label === '灵感对话' ? context.backgroundTask : undefined;
  const progress: InspirationProgress | null = chatTask && ['running', 'paused', 'pausing'].includes(chatTask.status) ? {
    status: chatTask.status === 'paused' ? 'paused' : 'running',
    stage: chatTask.status === 'pausing' ? '已请求暂停，等待安全检查点' : chatTask.status === 'paused' ? chatTask.stage || '已在检查点暂停' : phase?.stage || chatTask.stage || '正在处理本轮对话',
    detail: chatTask.status === 'paused' || chatTask.status === 'pausing' ? '暂停不会撤回已发出的模型请求。结果返回后先保存，再在检查点等待继续。' : phase?.detail || '正在处理本轮需求。这里显示执行阶段，不展示模型内部推理或虚构百分比。',
  } : phase || (pending ? { status: 'pending', stage: '本轮请求仍待核对', detail: '先读取已保存结果，不会自动重发或重复计费。' } : null);

  function writeInput(value: string) {
    if (locked) return;
    update({ conversation: { ...(conversation || newConversation()), input: value } });
  }
  function changeTarget(platform: AgentPlatform, accountId: string) {
    if (locked) return;
    update(changeInspirationTarget(draft, platform, accountId)); setError(''); setPhase(null);
  }
  function openReview() {
    if (!canReview || inFlight.current) return;
    const suggestion = suggestInspirationTarget(draft, input);
    setReview({ ...suggestion, message: input.trim(), fingerprint: fingerprint(draft), session: session() }); setError('');
  }
  async function refreshResult() {
    try { assertSession(); await form.save(); await form.reload(); assertSession(); await context.refresh(); setError(''); setPhase(null); }
    catch (failure) { if (alive.current) setError(failureText(failure)); }
  }
  async function cancelUnsubmitted() {
    assertSession();
    const latest = await form.reload(); assertSession();
    const orphan = latest?.conversation?.turns.find(turn => turn.status === 'pending');
    if (!latest?.conversation || !orphan) return;
    if (orphan.submittedAt) throw new Error('服务端已接受这一轮。不能取消已提交请求，请先核对结果和账单。');
    update({ ...latest, conversation: { ...latest.conversation, input: latest.conversation.input || orphan.user, turns: latest.conversation.turns.map(turn => turn.id === orphan.id ? { ...turn, status: 'interrupted', error: '本轮在提交模型前停止，输入已保留；需要你重新确认才会生成。' } : turn) } });
    await form.save(); setPhase(null); setError('');
  }
  async function confirmSend() {
    if (!review || inFlight.current || !canReview) return;
    if (review.session !== session() || review.fingerprint !== fingerprint(draft)) { setError('输入、账号或模型已经变化，请关闭确认窗口后重新核对。'); return; }
    const frozen = structuredClone(review), turnId = crypto.randomUUID();
    inFlight.current = true; setSending(true);
    try {
      await runBackground('灵感对话', async control => {
        assertSession(); setReview(null); setError('');
        const previous = frozen.draft.conversation!;
        const next: AgentDraft = { ...frozen.draft, conversation: { ...previous, input: '', turns: [...previous.turns, { id: turnId, user: frozen.message, at: new Date().toISOString(), platform: frozen.draft.platform, accountId: frozen.draft.accountId, model: frozen.draft.model, status: 'pending' }] } };
        let saved = false;
        try {
          setPhase({ status: 'running', stage: '正在保存这一轮需求', detail: '固定本轮项目、账号、模型和已选资料。' });
          update(next); await form.save(); saved = true; assertSession();
          await control.checkpoint('需求已保存，准备提交模型', { conversationId: previous.id, turnId, accountId: next.accountId, platform: next.platform, model: next.model });
          assertSession();
          const request = buildInspirationRequest(next, frozen.message);
          setPhase({ status: 'running', stage: '请求处理中，正在构思本轮方案', detail: `已发起工作站请求：采用同账号最近 ${request.inspirationConversation.history.length} 轮对话、当前方案与 ${next.knowledgeIds.length + next.experienceIds.length} 项已选资料/经验。等待校验、检索和模型返回；尚未取得新结果。` });
          await mutate(`/projects/${project!.id}/strategies`, 'POST', { mode: 'openai', stage: 'strategy', instruction: request.instruction, agentInput: request.agentInput, inspirationTurn: { conversationId: previous.id, turnId } });
          assertSession();
          // The server stores the reply with its strategy in one transaction.
          // Reload its revision, never overwrite it using this pre-call draft.
          await form.reload(); assertSession();
          setPhase({ status: 'completed', stage: '本轮方案已保存', detail: '可以直接追问继续修改，也可展开编辑后交给平台 Agent。尚未生成媒体或发布。' });
          await control.checkpoint('方案与对话已保存，等待人工核对', { conversationId: previous.id, turnId, accountId: next.accountId, model: next.model });
        } catch (failure) {
          if (alive.current && session() === frozen.session) {
            if (saved) await form.reload().catch(() => {});
            else update({ ...frozen.draft, conversation: { ...previous, input: frozen.message } });
            setError(failureText(failure));
            setPhase({ status: 'interrupted', stage: '本轮未取得确认结果', detail: '原方案已保留。先点“核对已保存结果”；若服务已接收请求，仍可能产生费用，不会自动重发。' });
          }
          throw failure;
        }
      }, { accountId: frozen.draft.accountId });
    } finally { inFlight.current = false; if (alive.current) setSending(false); }
  }
  function startResearch() {
    const keywords = (input || draft.requirement).replace(/帮我|分析一下|热点分析|热点帖子|热点|爆款|爆帖|请/g, '').trim().slice(0, 30) || project!.brief.product.slice(0, 30);
    setResearchSeed({ keywords, platform: draft.platform }); setSection('research');
  }
  async function handoff() {
    assertSession(); await form.save();
    if (!handoffAccount) throw new Error('请先选择真实的目标账号，再确认交接。');
    const values = { platform: draft.platform, accountId: handoffAccount.id, model: draft.model, knowledgeIds: draft.knowledgeIds, experienceIds: draft.experienceIds, referenceIds: draft.referenceIds, skillIds: [], publishingNotes: draft.publishingNotes, ...(draft.idea ? { idea: draft.idea } : {}), requirement: inspirationHandoffRequirement(draft, input), kind: draft.kind, fromAgent: 'inspiration' };
    const valueKey = JSON.stringify(values);
    if (handoffRequest.current.fingerprint !== valueKey) handoffRequest.current = { fingerprint: valueKey, id: crypto.randomUUID() };
    const response = await mutate<Asset>(`/projects/${project!.id}/agent-handoffs`, 'POST', { ...values, requestId: handoffRequest.current.id });
    assertSession(); notify(`资料包已交给${destination.name} Agent，可继续调整与制作`);
    go(destination.page, project!.id, { assetId: response.result.id, tab: 'brief', accountId: handoffAccount.id });
  }
  function exportConversation() {
    if (!conversation) return;
    download(new Blob([JSON.stringify({ project: project!.brief.name, conversation, currentIdea: draft.idea }, null, 2)], { type: 'application/json;charset=utf-8' }), `灵感对话-${project!.id}-${new Date().toISOString().slice(0, 10)}.json`);
  }
  async function resetConversation() {
    if (locked) return;
    update({ conversation: newConversation(), requirement: '', idea: undefined }); await form.save(); setResetOpen(false); setPhase(null); setError('');
  }

  const result = draft.idea && <div className="inspiration-reply-card">
    <h3>{draft.idea.title}</h3><dl><div><dt>核心想法</dt><dd>{draft.idea.core}</dd></div><div><dt>内容方向</dt><dd>{draft.idea.direction}</dd></div></dl>
    <details className="inspiration-reply-prompt"><summary>直接编辑这份方案</summary>
      <Field label="灵感标题"><input disabled={locked} maxLength={200} value={draft.idea.title} onChange={event => update({ idea: { ...draft.idea!, title: event.target.value } })}/></Field>
      <Field label="核心表达"><textarea disabled={locked} rows={3} maxLength={2000} value={draft.idea.core} onChange={event => update({ idea: { ...draft.idea!, core: event.target.value } })}/></Field>
      <Field label="内容方向"><textarea disabled={locked} rows={4} maxLength={4000} value={draft.idea.direction} onChange={event => update({ idea: { ...draft.idea!, direction: event.target.value } })}/></Field>
      <Field label="创作提示"><textarea disabled={locked} rows={4} maxLength={16000} value={draft.idea.prompt} onChange={event => update({ idea: { ...draft.idea!, prompt: event.target.value } })}/></Field>
    </details>
  </div>;
  const handoffPanel = (draft.idea || draft.requirement || input.trim()) && <details className="inspiration-context-options"><summary><ArrowRight size={16}/><span>交给{destination.name} Agent 继续制作</span></summary><div className="inspiration-context-options-body">
    <p className="small-note">只建立独立创作草稿，不调用模型、不发布。交接以当前确认方案为准，不会沿用已被后续对话替换的早期要求。发布仍单独确认。</p>
    <div className="agent-two-fields"><Field label="交接目标账号"><select disabled={locked || !!draft.accountId} value={draft.accountId || handoffAccountId} onChange={event => setHandoffAccountId(event.target.value)}><option value="">选择接收通用方案的账号</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field><Field label="内容形式"><select disabled={locked} value={draft.kind} onChange={event => update({ kind: event.target.value as 'image' | 'video' })}><option value="image" disabled={draft.platform === 'youtube'}>图文</option><option value="video">视频</option></select></Field></div>
    <Field label="发布要求（可选）"><input disabled={locked} maxLength={2000} value={draft.publishingNotes} onChange={event => update({ publishingNotes: event.target.value })}/></Field>
    <button className="button primary" disabled={locked || !handoffAccount || !(draft.requirement || input.trim())} onClick={() => void run(handoff)}>确认交接，不发布 <ArrowRight size={15}/></button>
    <p className="small-note">{draft.accountId ? '本轮方案已绑定创作账号，按该账号交接。' : '通用灵感可交给你明确选择的账号；平台 Agent 会继续按该账号身份调整。不会把其他账号的私人对话一并带入。'}</p>
  </div></details>;
  const contextPanel = <>
    <p className="small-note">同一项目的不同账号分别记忆对话。切换目标会清除当前方案与已选私人经验，不改变已有历史。</p>
    <div className="agent-two-fields"><Field label="目标平台"><select disabled={locked} value={draft.platform} onChange={event => changeTarget(event.target.value as AgentPlatform, '')}>{platforms.map(item => <option key={item.platform} value={item.platform}>{item.name}</option>)}</select></Field><Field label="创作账号"><select disabled={locked} value={draft.accountId} onChange={event => changeTarget(draft.platform, event.target.value)}><option value="">项目通用灵感（未绑定账号）</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field></div>
    {renderModels(draft, locked)}{renderExperience(draft, locked)}
    {selectedResearch.length > 0 && <div className="agent-picked-research"><b>本轮采用的已确认热点分析</b>{selectedResearch.map(item => <p key={item.id}>{item.title}</p>)}</div>}
    {!!project.research?.selectedIds.length && <button className="text-button" disabled={locked} onClick={() => update({ referenceIds: project.research?.selectedIds.slice(0, 8) || [] })}>采用研究页已确认的参考（{project.research.selectedIds.length} 条）</button>}
    {!accounts.length && <button className="text-button" disabled={locked} onClick={() => go('projects')}>添加{destination.name}账号</button>}
    <p className="small-note">图片和文档可从“资料与经验”导入后选择。只有已取得并确认的资料才作为依据，聊天不会自行采集平台。</p>
  </>;
  const reviewModel = review ? settings.models[review.draft.model] : undefined;
  const effectiveSettings = review ? { ...settings, routes: { ...settings.routes, strategy: review.draft.model } } : settings;
  const reviewContext = review ? buildInspirationRequest(review.draft, review.message).inspirationConversation : undefined;
  const activeTurn = !pending && turns.at(-1)?.status === 'completed' ? turns.at(-1)?.id : undefined;

  return <>
    {LOCAL_DATA && <p className="info-box">浏览器版可加密保存对话草稿与手动交接；AI 对话生成请使用 Windows 完整版或团队版。</p>}
    {section === 'chat' ? <InspirationConversation turns={turns} input={input} onInput={writeInput} disabled={locked} onSubmitReview={openReview} progress={progress} activeTurnId={activeTurn} result={result} handoff={handoffPanel} contextPanel={contextPanel}
      contextSummary={<><b>{project.brief.name}</b> · {destination.name} · {selectedAccount?.name || '项目通用灵感，未绑定账号'} · {settings.models[draft.model]?.label || draft.model}<br/>已选 {draft.knowledgeIds.length + draft.experienceIds.length} 份资料/经验 · {draft.referenceIds.length} 份热点参考 · 当前目标 {turns.length} 轮对话{conversation && conversation.turns.length > turns.length ? '（其他账号历史已隔离）' : ''}</>}
      actions={<>{savedState}<button className="button small" disabled={locked} onClick={() => setResetOpen(true)}><Plus size={14}/>新对话</button></>}
      toolbar={<><button className="button small" disabled={locked} onClick={startResearch}><Flame size={14}/>热点与参考</button><button className="button small" disabled={locked} onClick={() => setSection('experience')}><BookOpen size={14}/>资料与经验</button><button className="text-button" disabled={!form.loaded || sending || busy} onClick={() => void run(refreshResult)}><RefreshCw size={13}/>核对已保存结果</button>{chatTask?.status === 'running' && <button className="button small" onClick={context.pauseBackground}><Pause size={14}/>请求暂停</button>}{chatTask && ['paused', 'pausing'].includes(chatTask.status) && <button className="button small" onClick={context.continueBackground}><Play size={14}/>继续任务</button>}</>}
      submitAction={<button className="button primary" disabled={!canReview} onClick={openReview}><Send size={15}/>{sending || pending ? '本轮处理中' : turns.length ? '发送修改要求' : '发送需求'}</button>}/>
      : <section className="agent-research"><div className="agent-tabbar"><button className="button" onClick={() => setSection('chat')}>← 返回灵感对话</button>{savedState}</div>{section === 'research' ? <><p className="info-box">先核对来源、账号和费用。研究过程独立显示状态，不代表聊天已经读取平台。</p><ResearchPanel key={researchSeed ? `${researchSeed.platform}:${researchSeed.keywords}` : 'saved'} initialKeywords={researchSeed?.keywords} initialPlatform={researchSeed?.platform || draft.platform}/><button className="button primary" disabled={busy} onClick={() => { update({ referenceIds: project.research?.selectedIds.slice(0, 8) || [] }); setSection('chat'); }}>带回已确认参考，继续对话</button></> : <KnowledgeLibrary/>}</section>}
    {hotIntent && section === 'chat' && <p className="info-box">这条提到了热点。聊天本身不会采集最新帖子；可以先进入“热点与参考”确认读取，或只讨论选题思路。</p>}
    {conversation && conversation.turns.length >= 20 && <p className="info-box">当前对话已保存 20 轮。可导出留存后开启新对话；不会静默删除旧轮次。</p>}
    {pending && !pending.submittedAt && !context.taskPending && !sending && <p className="info-box">有一轮停在提交前。<button className="text-button" disabled={busy} onClick={() => void run(cancelUnsubmitted)}>核对并取消未提交等待，保留输入</button></p>}
    {!pending && !input.trim() && turns.at(-1) && ['failed', 'interrupted'].includes(turns.at(-1)!.status) && <button className="button small" disabled={locked} onClick={() => writeInput(turns.at(-1)!.user)}>把上一条消息放回输入框（不重新提交）</button>}
    {!draft.idea && turns.some(turn => turn.status === 'completed' && turn.reply) && <button className="button small" disabled={locked} onClick={() => { const last = [...turns].reverse().find(turn => turn.status === 'completed' && turn.reply)!; update({ idea: structuredClone(last.reply!), requirement: turns[0]?.user || last.user }); }}>采用当前账号最近的方案</button>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {review && <Modal title="确认这一轮灵感对话" description="一次请求生成一份可继续修改的方案。不会自动采集热点、生成图片视频或发布。" onClose={() => { if (!inFlight.current) setReview(null); }}>
      <p className="info-box"><b>{project.brief.name} · {platforms.find(item => item.platform === review.draft.platform)?.name}</b><br/>账号：{state.accounts.find(account => account.id === review.draft.accountId)?.name || '未绑定账号，仅形成项目通用灵感'}<br/>模型：{reviewModel?.label || review.draft.model}</p>
      {review.changed && <p className="info-box">根据本条明确提到的平台，建议切换为{platforms.find(item => item.platform === review.draft.platform)?.name}。确认后采用新目标；旧账号经验和方案不会混入。若不是你的意思，请取消并在高级选项核对目标。</p>}
      {review.mentioned.length > 1 && <p className="small-note">本条提到多个平台，本轮仍使用上方明确目标；没有自动向多个账号生成或发布。</p>}
      <p className="preserve-lines">{review.message}</p>
      <p className="small-note">本轮使用同账号最近 {reviewContext?.history.length || 0} 轮已完成对话、当前编辑方案，以及 {review.draft.knowledgeIds.length + review.draft.experienceIds.length} 项已选资料/经验。{reviewContext?.truncated ? '较早对话仍保存在本机，但不全部送给模型。' : ''}</p>
      {reviewModel && <><p>输入 ${reviewModel.inputPrice} / 输出 ${reviewModel.outputPrice} 每百万 token。调用前检查项目预算。{reviewModel.priceNote}</p><p className="small-note">必要项目资料与选中上下文将发送到 {providerLabel(reviewModel.provider || 'openai')}。结果需人工检查，实际费用以服务商账单为准。</p></>}
      {turns.some(turn => ['failed', 'interrupted'].includes(turn.status)) && <p className="info-box">此前有未完成轮次。如你已核对原请求仍要再生成，本次将是新的独立请求，可能再次计费。</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button" disabled={sending} onClick={() => setReview(null)}>取消</button>{reviewModel && canGenerate(effectiveSettings, 'strategy') ? <button className="button primary" disabled={sending || busy || !canReview} onClick={() => void confirmSend()}><Sparkles size={15}/>确认费用并发送</button> : <button className="button primary" onClick={() => { setReview(null); go('settings'); }}>配置此模型</button>}</div>
    </Modal>}
    {resetOpen && <Modal title="开启新的灵感对话？" description="当前聊天记录将从本页替换，已有策略和已交接内容不会删除。建议先导出留存；导出文件为明文，请自行妥善保管。" onClose={() => setResetOpen(false)}><div className="modal-actions"><button className="button" onClick={exportConversation}><Download size={14}/>导出当前对话</button><button className="button" onClick={() => setResetOpen(false)}>取消</button><button className="button primary" disabled={locked} onClick={() => void run(resetConversation)}>确认开启新对话</button></div></Modal>}
  </>;
}
