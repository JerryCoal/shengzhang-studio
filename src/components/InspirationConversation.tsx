import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, CircleAlert, LoaderCircle, MessageSquareText, Pause, SlidersHorizontal, Sparkles } from 'lucide-react';
import '../inspiration-conversation.css';

export type InspirationReply = { title: string; core: string; direction: string; prompt: string };
export type InspirationConversationTurn = {
  id: string;
  user: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted';
  at?: string;
  platform?: string;
  accountId?: string;
  model?: string;
  reply?: InspirationReply;
  error?: string;
};
export type InspirationProgress = {
  stage: string;
  detail?: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted';
};
export type InspirationConversationProps = {
  /** The container supplies history already filtered to the current project/account. */
  turns: InspirationConversationTurn[];
  input: string;
  onInput: (value: string) => void;
  /** An explicit review/fee-confirmation action. This component never generates by itself. */
  submitAction: ReactNode;
  contextSummary?: ReactNode;
  toolbar?: ReactNode;
  contextPanel?: ReactNode;
  result?: ReactNode;
  handoff?: ReactNode;
  actions?: ReactNode;
  disabled?: boolean;
  onSuggestion?: (value: string) => void;
  onSubmitReview?: () => void;
  suggestions?: string[];
  /** If omitted, result is an independent current editable plan after the history. */
  activeTurnId?: string;
  /** Only actual, externally supplied workflow events belong here. */
  progress?: InspirationProgress | null;
};

const DEFAULT_SUGGESTIONS = [
  '围绕当前项目，帮我想 3 个适合目标账号的内容方向。',
  '我想参考热点找灵感，先一起明确要研究的话题。',
  '我有一个初步想法，帮我把它完善成可执行的内容方案。',
];
const STATUS_LABELS: Record<InspirationProgress['status'], string> = {
  pending: '等待处理', running: '进行中', paused: '已暂停', completed: '已完成', failed: '未完成', interrupted: '已中断',
};
const PLATFORM_LABELS: Record<string, string> = { xiaohongshu: '小红书', douyin: '抖音', instagram: 'Instagram', youtube: 'YouTube' };

type ReviewShortcut = { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };

/** Kept pure so IME and shortcut behavior can be checked without a browser runtime. */
export function isInspirationReviewShortcut(event: ReviewShortcut) {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

function TurnTime({ at }: { at?: string }) {
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return <time dateTime={at}>{new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>;
}

function ProgressIcon({ status }: { status: InspirationProgress['status'] }) {
  if (status === 'running') return <LoaderCircle className="inspiration-progress-spinner" size={17} aria-hidden="true"/>;
  if (status === 'completed') return <Check size={17} aria-hidden="true"/>;
  if (status === 'paused' || status === 'interrupted') return <Pause size={17} aria-hidden="true"/>;
  if (status === 'failed') return <CircleAlert size={17} aria-hidden="true"/>;
  return <MessageSquareText size={17} aria-hidden="true"/>;
}

function ReplyCard({ reply }: { reply: InspirationReply }) {
  return <div className="inspiration-reply-card">
    <h3>{reply.title || '灵感方案'}</h3>
    <dl>
      <div><dt>核心想法</dt><dd>{reply.core || '未提供'}</dd></div>
      <div><dt>内容方向</dt><dd>{reply.direction || '未提供'}</dd></div>
    </dl>
    {reply.prompt && <details className="inspiration-reply-prompt"><summary>查看创作提示<ChevronDown size={14} aria-hidden="true"/></summary><p>{reply.prompt}</p></details>}
  </div>;
}

export function InspirationConversation({ turns, input, onInput, submitAction, contextSummary, toolbar, contextPanel, result, handoff, actions, disabled = false, onSuggestion, onSubmitReview, suggestions = DEFAULT_SUGGESTIONS, activeTurnId, progress }: InspirationConversationProps) {
  const id = useId();
  const scrollArea = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousLastTurn = useRef<string | undefined>(undefined);
  const [showLatest, setShowLatest] = useState(false);
  const resultInHistory = Boolean(result != null && activeTurnId && turns.some(turn => turn.id === activeTurnId));
  const latestTurnId = turns.at(-1)?.id;
  const latestTurnStatus = turns.at(-1)?.status;
  function scrollToLatest() {
    if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
    nearBottom.current = true;
    setShowLatest(false);
  }
  useEffect(() => {
    const newUserTurn = latestTurnId !== previousLastTurn.current && latestTurnStatus === 'pending';
    if (nearBottom.current || newUserTurn) scrollToLatest();
    previousLastTurn.current = latestTurnId;
  }, [latestTurnId, latestTurnStatus, turns, progress, result, handoff]);
  function reviewShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isInspirationReviewShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) return;
    if (!disabled && input.trim() && onSubmitReview) {
      event.preventDefault();
      onSubmitReview();
    }
  }

  return <section className="inspiration-conversation" aria-labelledby={`${id}-title`}>
    <header className="inspiration-conversation-header">
      <div className="inspiration-assistant-identity"><span className="inspiration-assistant-avatar"><Sparkles size={23} aria-hidden="true"/></span><div><p>想法，从这里开始</p><h2 id={`${id}-title`}>灵感 Agent</h2></div></div>
      {actions != null && <div className="inspiration-header-actions">{actions}</div>}
      {contextSummary != null && <div className="inspiration-context-summary" aria-label="当前灵感的项目与账号">{contextSummary}</div>}
    </header>

    {toolbar != null && <div className="inspiration-conversation-toolbar" aria-label="研究与经验入口">{toolbar}</div>}

    <div className="inspiration-conversation-body" ref={scrollArea} role="region" aria-label="灵感对话与当前方案" tabIndex={0} onScroll={event => {
      const element = event.currentTarget;
      nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 64;
      setShowLatest(!nearBottom.current);
    }}>
      {!turns.length && <div className="inspiration-empty-state">
        <span className="inspiration-empty-icon"><MessageSquareText size={27} aria-hidden="true"/></span>
        <h3>聊聊这次，你想做什么内容？</h3>
        <p>告诉我目标、受众，或一个还没想清楚的点子。你可以继续追问，把方案逐步聊清楚。</p>
        {suggestions.length > 0 && <><p className="inspiration-suggestions-label">点选下面的想法，只会填入输入框</p><div className="inspiration-suggestions">{suggestions.map((suggestion, index) => <button type="button" key={`${index}-${suggestion}`} disabled={disabled} onClick={() => (onSuggestion || onInput)(suggestion)}><span>{suggestion}</span><ArrowUpRight size={17} aria-hidden="true"/></button>)}</div></>}
      </div>}

      {turns.length > 0 && <ol className="inspiration-turns" aria-label="当前账号的灵感对话">{turns.map(turn => <li className="inspiration-turn" key={turn.id}>
        <div className="inspiration-user-message"><div className="inspiration-message-meta"><b>你</b><TurnTime at={turn.at}/></div><p>{turn.user}</p></div>
        <div className="inspiration-assistant-message">
          <div className="inspiration-message-meta"><Sparkles size={15} aria-hidden="true"/><b>灵感助手</b>{turn.platform && <span>{PLATFORM_LABELS[turn.platform] || turn.platform}</span>}{turn.model && <span className="inspiration-turn-model">{turn.model}</span>}<span className={`inspiration-turn-status inspiration-status-${turn.status}`}>{STATUS_LABELS[turn.status]}</span></div>
          {resultInHistory && turn.id === activeTurnId ? <div className="inspiration-current-result" aria-label="当前可编辑方案">{result}</div> : turn.reply ? <ReplyCard reply={turn.reply}/> : <p className={`inspiration-turn-notice inspiration-status-${turn.status}`}>{turn.status === 'failed' || turn.status === 'interrupted' ? '本轮结果尚未确认，请先核对已保存结果与服务记录；不会自动重发。' : turn.status === 'completed' ? '这一轮已完成，未包含可显示的方案。' : '尚未收到这一轮的方案。'}</p>}
          {turn.error && <p className="inspiration-turn-error"><CircleAlert size={15} aria-hidden="true"/><span>{turn.error}</span></p>}
        </div>
      </li>)}</ol>}

      {progress && <div className={`inspiration-progress inspiration-status-${progress.status}`} role="status" aria-live="polite" aria-atomic="true">
        <ProgressIcon status={progress.status}/><div><div className="inspiration-progress-heading"><b>{progress.stage}</b><span>{STATUS_LABELS[progress.status]}</span></div>{progress.detail && <p>{progress.detail}</p>}</div>
      </div>}

      {result != null && !resultInHistory && <section className="inspiration-current-result" aria-label="当前可编辑方案"><div className="inspiration-current-result-heading"><Sparkles size={16} aria-hidden="true"/><h3>当前可编辑方案</h3><span>调整后可交给平台 Agent</span></div>{result}</section>}
      {handoff != null && <div className="inspiration-handoff" aria-label="交接灵感方案">{handoff}</div>}
    </div>
    {showLatest && <div className="inspiration-latest-control"><button type="button" onClick={scrollToLatest}>回到最新消息 <ChevronDown size={14} aria-hidden="true"/></button></div>}

    <div className="inspiration-conversation-footer">
      {contextPanel != null && <details className="inspiration-context-options"><summary><SlidersHorizontal size={16} aria-hidden="true"/><span>资料、经验与模型</span><span className="inspiration-options-hint">高级选项</span><ChevronDown size={15} aria-hidden="true"/></summary><div className="inspiration-context-options-body">{contextPanel}</div></details>}
      <div className="inspiration-composer">
        <label htmlFor={`${id}-input`}>{turns.length ? '继续完善这个想法' : '输入你的运营需求'}</label>
        <textarea id={`${id}-input`} value={input} onChange={event => onInput(event.target.value)} onKeyDown={reviewShortcut} disabled={disabled} maxLength={4000} rows={4} placeholder="比如：这次想面向刚开始露营的新手，做一组真实、不夸大的选题……" aria-describedby={`${id}-input-help ${id}-input-count`}/>
        <div className="inspiration-composer-bottom"><div className="inspiration-composer-hints"><span id={`${id}-input-help`}>Enter 换行{onSubmitReview ? ' · Ctrl / ⌘ + Enter 打开生成确认' : ''}</span><span id={`${id}-input-count`}>{input.length} / 4000</span></div><div className="inspiration-submit-action">{submitAction}</div></div>
      </div>
      <p className="inspiration-composer-note">发送前请核对目标账号、所选资料与本次生成费用。灵感方案不会自动发布。</p>
    </div>
  </section>;
}
