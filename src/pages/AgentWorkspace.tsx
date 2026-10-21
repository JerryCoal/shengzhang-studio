import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, CircleAlert, Clapperboard, Download, Instagram, Lightbulb, Loader2, Plus, Save, Settings2, Sparkles, WandSparkles, Youtube } from 'lucide-react';
import { api, download, LOCAL_DATA } from '../api';
import { Context, useStudio } from '../context';
import { Field, NeedProject } from '../components';
import type { Asset, Page, Strategy } from '../types';
import { creativeSkillWorkflowIds } from '../../server/creative-skills.mjs';
import { KnowledgePicker } from './KnowledgeLibrary';
import { StudioPage } from './ContentStudio';
import { ReviewWorkspace } from './ReviewWorkspace';
import { InspirationChatWork } from './InspirationChatWork';
import { ExternalWorkDialog } from './ExternalWorkDialog';
import { registerWorkspaceSaver } from '../workspace-save';
import type { InspirationConversation as InspirationConversationState } from '../../server/inspiration-conversation.mjs';
import { changeInspirationTarget } from '../inspiration-chat-state.mjs';
import '../agent-workspace.css';

export const PLATFORM_AGENTS = [
  { platform: 'xiaohongshu', page: 'xiaohongshu-agent', name: '小红书', color: '#e54868', Icon: BookOpen, description: '把真实体验写成值得收藏的图文与短视频。', hint: '场景、体验、封面与标题' },
  { platform: 'douyin', page: 'douyin-agent', name: '抖音', color: '#6860db', Icon: Clapperboard, description: '从开场到节奏，为每一个镜头安排清晰的表达。', hint: '开场、分镜、节奏与行动' },
  { platform: 'instagram', page: 'instagram-agent', name: 'Instagram', color: '#b34f9a', Icon: Instagram, description: '统一视觉气质，让图片、Reels 和账号语气相互呼应。', hint: '视觉、语气与社群互动' },
  { platform: 'youtube', page: 'youtube-agent', name: 'YouTube', color: '#dc514b', Icon: Youtube, description: '把选题发展成结构完整、可以持续追看的视频。', hint: '选题、叙事、分镜与封面' },
] as const;
export type AgentPlatform = typeof PLATFORM_AGENTS[number]['platform'];
type AgentIdea = Pick<Strategy, 'title' | 'core' | 'direction' | 'prompt'>;
export type AgentDraft = { requirement: string; platform: AgentPlatform; accountId: string; kind: 'image' | 'video'; knowledgeIds: string[]; experienceIds: string[]; referenceIds: string[]; skillIds: string[]; model: string; publishingNotes: string; idea?: AgentIdea; conversation?: InspirationConversationState; updatedAt?: string };
export type AgentDraftForm = ReturnType<typeof useAgentDraft>;
type DraftStore = { revision: number; drafts: Record<string, AgentDraft> };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '暂未保存，请重试';
const currentSession = () => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('studio-session'); } catch { return null; } };
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const fingerprint = (draft: AgentDraft) => JSON.stringify([draft.requirement || '', draft.platform || '', draft.accountId || '', draft.kind || 'image', draft.knowledgeIds || [], draft.experienceIds || [], draft.referenceIds || [], draft.skillIds || [], draft.model || '', draft.publishingNotes || '', draft.idea ? [draft.idea.title, draft.idea.core, draft.idea.direction, draft.idea.prompt] : null, draft.conversation || null]);
const selectionOf = (draft: AgentDraft) => ({ platform: draft.platform, accountId: draft.accountId, model: draft.model, knowledgeIds: draft.knowledgeIds, experienceIds: draft.experienceIds, referenceIds: draft.referenceIds, skillIds: draft.skillIds, publishingNotes: draft.publishingNotes, ...(draft.idea ? { idea: draft.idea } : {}) });

// Drafts use the encrypted, member-scoped store. Save operations are serialized
// per editor so a delayed response cannot replace more recent typing.
function useAgentDraft(agentId: string, platform: AgentPlatform) {
  const { project, settings, state, target, notify } = useStudio();
  const key = `${project?.id || ''}:${agentId}`;
  const initial = useRef<AgentDraft>({ requirement: '', platform, accountId: '', kind: platform === 'youtube' || platform === 'douyin' ? 'video' : 'image', knowledgeIds: [], experienceIds: [], referenceIds: [], skillIds: [], model: agentId === 'inspiration' ? settings.routes.strategy : agentId === 'analysis' ? settings.routes.analysis : settings.routes.copy, publishingNotes: '' });
  const [draft, setDraft] = useState(initial.current), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [loadAttempt, setLoadAttempt] = useState(0);
  const latest = useRef(draft), saved = useRef(''), revision = useRef(0), mounted = useRef(true), ready = useRef(false), queue = useRef<Promise<void>>(Promise.resolve());
  const session = useRef(currentSession());
  const assertSession = () => { if (agentId === 'inspiration' && currentSession() !== session.current) throw new Error('登录身份已变化。原对话仍属于原用户，请重新打开灵感页。'); };
  latest.current = draft;
  const save = useCallback((keepalive = false) => {
    const operation = async () => {
      if (!ready.current || !project || fingerprint(latest.current) === saved.current) return;
      assertSession();
      const snapshot = { ...latest.current }, snapshotKey = fingerprint(snapshot);
      if (mounted.current) { setSaving(true); setError(''); }
      try {
        let result: DraftStore | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { assertSession(); result = await api<DraftStore>('/agent-workspace', 'PUT', { expectedRevision: revision.current, key, draft: snapshot }, { keepalive }); assertSession(); break; }
          catch (failure) {
            assertSession();
            if (attempt === 2 || !/版本|冲突|revision|更新/i.test(errorMessage(failure))) throw failure;
            assertSession(); const current = await api<DraftStore>('/agent-workspace'); assertSession();
            if (current.drafts[key] && fingerprint(current.drafts[key]) !== saved.current) throw new Error('此 Agent 的草稿已在另一窗口修改。当前输入已保留，请先复制输入再重新打开页面核对。');
            revision.current = current.revision;
          }
        }
        assertSession();
        if (result) {
          revision.current = result.revision;
          const stored = { ...initial.current, ...result.drafts[key] };
          saved.current = fingerprint(stored);
          if (mounted.current && fingerprint(latest.current) === snapshotKey) { latest.current = stored; setDraft(stored); }
        }
      } catch (failure) { if (mounted.current) setError(errorMessage(failure)); throw failure; }
      finally { if (mounted.current) setSaving(false); }
    };
    queue.current = queue.current.catch(() => {}).then(operation);
    return queue.current;
  }, [key, project?.id]);
  useEffect(() => {
    mounted.current = true; let active = true;
    void api<DraftStore>('/agent-workspace').then(store => {
      if (!active) return;
      revision.current = store.revision;
      const base = { ...initial.current, ...store.drafts[key] };
      const destination = target.accountId ? state.accounts.find(account => account.id === target.accountId) : undefined;
      const changedInspiration = agentId === 'inspiration' && destination && destination.id !== base.accountId;
      const scoped = changedInspiration && ['xiaohongshu', 'douyin', 'instagram', 'youtube'].includes(destination.platform) ? changeInspirationTarget(base, destination.platform as AgentPlatform, destination.id) : base;
      const restored = { ...scoped, ...(target.requirement ? { requirement: target.requirement } : {}), ...(!changedInspiration && target.accountId ? { accountId: target.accountId } : {}), ...(!changedInspiration && target.knowledgeIds ? { knowledgeIds: target.knowledgeIds } : {}) };
      latest.current = restored; saved.current = store.drafts[key] ? fingerprint(store.drafts[key]) : fingerprint(initial.current); ready.current = true; setDraft(restored); setLoaded(true); setError('');
    }).catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; mounted.current = false; void save(true).catch(() => {}); };
  }, [key, notify, save, loadAttempt]);
  useEffect(() => { if (!loaded || fingerprint(draft) === saved.current) return; const timer = setTimeout(() => { void save().catch(() => {}); }, 650); return () => clearTimeout(timer); }, [draft, loaded, save]);
  useEffect(() => registerWorkspaceSaver(() => save(true)), [save]);
  useEffect(() => {
    const exit = (event: BeforeUnloadEvent) => { if (!ready.current || fingerprint(latest.current) === saved.current) return; void save(true).catch(() => {}); event.preventDefault(); event.returnValue = ''; };
    const hidden = () => { if (document.visibilityState === 'hidden') void save(true).catch(() => {}); };
    window.addEventListener('beforeunload', exit); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('beforeunload', exit); document.removeEventListener('visibilitychange', hidden); };
  }, [save]);
  const update = (values: Partial<AgentDraft>) => { const next = { ...latest.current, ...values }; latest.current = next; setDraft(next); };
  const reload = async () => {
    await queue.current.catch(() => {}); assertSession();
    const store = await api<DraftStore>('/agent-workspace'); assertSession();
    if (!mounted.current) return;
    const next = { ...initial.current, ...store.drafts[key] };
    revision.current = store.revision; saved.current = fingerprint(next); latest.current = next;
    setDraft(next); setError(''); return next;
  };
  return { draft, update, loaded, saving, error, save, reload, retry: () => loaded ? void save().catch(() => {}) : setLoadAttempt(value => value + 1), dirty: fingerprint(draft) !== saved.current };
}

function FlowSteps({ active }: { active: number }) {
  return <div className="agent-flow" aria-label="运营工作流">{['灵感与经验', '平台创作', '发布交付', '结果与复盘'].map((step, index) => <span key={step} className={index === active ? 'is-current' : index < active ? 'is-done' : ''}><i>{index < active ? <Check size={12}/> : String(index + 1).padStart(2, '0')}</i>{step}{index < 3 && <ChevronRight size={14}/>}</span>)}</div>;
}
function SavedState({ form }: { form: ReturnType<typeof useAgentDraft> }) {
  return <div className={'agent-save-state' + (form.error ? ' has-error' : '')} role="status">{form.error ? <><CircleAlert size={14}/><span>{form.loaded ? '草稿未保存' : '进度未读取'}：{form.error}</span><button className="text-button" onClick={form.retry}>重试</button></> : form.saving ? <><Loader2 size={14} className="spin"/>正在保存进度</> : !form.loaded ? <><Loader2 size={14} className="spin"/>读取上次进度</> : form.dirty ? <><Save size={14}/>待保存</> : <><Check size={14}/>进度已保存</>}</div>;
}
function AgentHeader({ title, description, active, color, icon: Icon }: { title: string; description: string; active: number; color?: string; icon: typeof Sparkles }) {
  return <><FlowSteps active={active}/><header className="agent-page-header" style={{ '--agent-color': color || '#5366d8' } as CSSProperties}><div className="agent-page-icon"><Icon size={25}/></div><div><span className="agent-eyebrow">SHENGZHANG STUDIO · AGENT WORKSPACE</span><h1>{title}</h1><p>{description}</p></div></header></>;
}
function ModelAndSkills({ draft, update, workflow, disabled }: { draft: AgentDraft; update: (patch: Partial<AgentDraft>) => void; workflow: string; disabled: boolean }) {
  const { settings, state, go } = useStudio();
  const skills = (state.installedSkills || []).filter(skill => skill.enabled && creativeSkillWorkflowIds(skill).some(id => id === workflow));
  const unavailable = draft.skillIds.filter(id => !skills.some(skill => skill.id === id));
  return <div className="agent-model-skills"><Field label="文字模型"><select aria-label="此 Agent 文字模型" disabled={disabled} value={draft.model} onChange={event => update({ model: event.target.value })}>{Object.entries(settings.models).map(([id, model]) => <option key={id} value={id}>{model.label}</option>)}</select></Field><details className="agent-skills"><summary><WandSparkles size={14}/>Skills <span>默认规则{draft.skillIds.length ? ` + ${draft.skillIds.length} 项` : ''}</span></summary><p className="small-note">默认规则始终生效；可叠加多个适用此 Agent 的自装规则。</p>{skills.map(skill => <label className="checkbox-row" key={skill.id}><input type="checkbox" checked={draft.skillIds.includes(skill.id)} disabled={disabled || !draft.skillIds.includes(skill.id) && draft.skillIds.length >= 5} onChange={() => update({ skillIds: toggle(draft.skillIds, skill.id) })}/><span>{skill.name}<small>v{skill.version} · {skill.description}</small></span></label>)}{!skills.length && <p className="small-note">尚未导入此步骤的 Skills。可先使用内置规则。</p>}{unavailable.length > 0 && <p className="error-text">{unavailable.length} 项已选 Skills 不再适用。<button className="text-button" onClick={() => update({ skillIds: draft.skillIds.filter(id => !unavailable.includes(id)) })}>移除</button></p>}<button type="button" className="text-button" onClick={() => { sessionStorage.setItem('studio-settings-section', 'skills'); go('settings'); }}><Settings2 size={13}/>导入 Skills / 改写默认规则</button></details></div>;
}
function SelectedExperience({ draft, update, disabled }: { draft: AgentDraft; update: (patch: Partial<AgentDraft>) => void; disabled: boolean }) {
  const { project } = useStudio();
  if (!project) return null;
  const historical = project.experiences.filter(item => item.active);
  return <div className="agent-experience-picker"><KnowledgePicker accountId={draft.accountId} selectedIds={draft.knowledgeIds} onChange={knowledgeIds => update({ knowledgeIds })} disabled={disabled}/>{historical.length > 0 && <details><summary>历史复盘经验 · {historical.length} 条</summary>{historical.map(item => <label className="checkbox-row" key={item.id}><input type="checkbox" checked={draft.experienceIds.includes(item.id)} disabled={disabled || !draft.experienceIds.includes(item.id) && draft.experienceIds.length >= 5} onChange={() => update({ experienceIds: toggle(draft.experienceIds, item.id) })}/><span>{item.text}</span></label>)}</details>}<p className="agent-priority-note"><Lightbulb size={14}/>主动选中的经验优先指导表达；项目已核实事实与本次要求始终保留。</p></div>;
}
export function PlatformAgent({ platform }: { platform: AgentPlatform }) {
  const { project } = useStudio(), agent = PLATFORM_AGENTS.find(item => item.platform === platform)!;
  if (!project) return <><AgentHeader title={`${agent.name} Agent`} description={agent.description} active={1} color={agent.color} icon={agent.Icon}/><NeedProject/></>;
  return <PlatformWork key={`${project.id}:${platform}`} platform={platform}/>;
}
function PlatformWork({ platform }: { platform: AgentPlatform }) {
  const context = useStudio(), { project, state, busy, target, run, mutate, go, notify, accountScope } = context;
  const agent = PLATFORM_AGENTS.find(item => item.platform === platform)!;
  const form = useAgentDraft(platform, platform), { draft, update } = form;
  const [composing, setComposing] = useState(false), request = useRef({ fingerprint: '', id: crypto.randomUUID() });
  const selected = project?.assets.find(asset => asset.id === target.assetId && asset.channel === platform);
  useEffect(() => {
    if (form.loaded && selected) update({ model: selected.agentPacket?.model || context.settings.routes.copy, skillIds: selected.agentPacket?.skillIds || [] });
  }, [selected?.id, form.loaded]);
  if (!project) return null;
  const accounts = state.accounts.filter(account => account.platform === platform), locked = busy || !form.loaded;
  const assets = project.assets.filter(asset => asset.channel === platform);
  const scopedProject = { ...project, assets };
  const model = draft.model || context.settings.routes.copy;
  const agentContext = { ...context, project: scopedProject, agentInput: selected?.contentBrief ? { model, skillIds: draft.skillIds, accountId: selected.contentBrief.accountId, platform } : undefined, accountScope: accounts.some(account => account.id === accountScope) ? accountScope : '', target: { ...target, newContent: false }, go: (page: Page, projectId?: string, detail = {}) => go(page === 'studio' ? agent.page : ['comments', 'analytics', 'planning'].includes(page) ? 'analysis-agent' : page, projectId, detail) };
  async function create() {
    await form.save();
    const values = { ...selectionOf(draft), requirement: draft.requirement, kind: draft.kind, platform, fromAgent: platform, accountId: draft.accountId || target.accountId };
    const valueKey = JSON.stringify(values); if (request.current.fingerprint !== valueKey) request.current = { fingerprint: valueKey, id: crypto.randomUUID() };
    const response = await mutate<Asset>(`/projects/${project!.id}/agent-handoffs`, 'POST', { ...values, requestId: request.current.id });
    setComposing(false); notify('内容草稿已创建，继续生成或导入已有图文视频'); go(agent.page, project!.id, { assetId: response.result.id, tab: 'copy', accountId: values.accountId });
  }
  return <div className="agent-workspace" style={{ '--agent-color': agent.color } as CSSProperties}><AgentHeader title={`${agent.name} Agent`} description={agent.description} active={1} color={agent.color} icon={agent.Icon}/><div className="agent-platform-toolbar"><div><span className="agent-platform-status"><span/>{assets.length} 份内容</span><SavedState form={form}/></div><div className="row gap-8"><button className="button" onClick={() => go('inspiration', project.id)}><Lightbulb size={15}/>返回灵感</button><button className="button primary" disabled={busy} onClick={() => setComposing(!composing)}><Plus size={15}/>{composing ? '收起需求' : '新建内容'}</button></div></div>
    {LOCAL_DATA && <p className="info-box">浏览器版支持保存需求、资料交接与手动编辑；带账号身份的 Agent AI 生成请使用 Windows 完整版或团队版。</p>}
    {selected?.agentPacket && <section className="agent-received-packet"><Check size={17}/><div><b>已收到创作资料包</b><span>{selected.contentBrief?.requirement || '账号、资料与经验已绑定到本篇'}</span>{selected.agentPacket.publishingNotes && <small>发布要求：{selected.agentPacket.publishingNotes}</small>}</div><span>{state.accounts.find(account => account.id === selected.contentBrief?.accountId)?.name || '已绑定创作账号'}</span></section>}
    <section className="panel agent-runtime-controls"><ModelAndSkills draft={{ ...draft, model }} update={update} workflow={`copy-${platform}`} disabled={locked}/><p className="small-note">这里的模型与 Skills 用于本平台的下一次文案生成。图片与视频在制作步骤选择 Seedream / Seedance。</p></section>
    {composing && <section className="panel agent-platform-composer"><div className="agent-section-heading"><Sparkles size={19}/><div><h2>新内容需求</h2><p>可接着灵感调整，也可以直接描述新的想法。</p></div></div><Field label="这篇想表达什么？"><textarea rows={5} maxLength={4000} disabled={locked} value={draft.requirement} onChange={event => update({ requirement: event.target.value })} placeholder="写下主题、读者、语气与重点；已有图文视频可以在草稿里导入。"/></Field><div className="agent-two-fields"><Field label="创作账号"><select value={draft.accountId} disabled={locked} onChange={event => update({ accountId: event.target.value, knowledgeIds: [] })}><option value="">选择目标账号</option>{accounts.map(account => <option value={account.id} key={account.id}>{account.name}</option>)}</select></Field><Field label="内容形式"><select value={draft.kind} disabled={locked} onChange={event => update({ kind: event.target.value as 'image' | 'video' })}><option value="image" disabled={platform === 'youtube'}>图文</option><option value="video">视频</option></select></Field></div><SelectedExperience draft={draft} update={update} disabled={locked}/><Field label="发布要求"><input maxLength={2000} value={draft.publishingNotes} disabled={locked} onChange={event => update({ publishingNotes: event.target.value })} placeholder="期望发布时间、标签、审核重点…"/></Field>{!accounts.length && <p className="info-box">此平台还没有账号。<button className="text-button" onClick={() => go('projects')}>添加账号</button></p>}<div className="agent-composer-footer"><span>创建草稿不会调用模型</span><button className="button primary" disabled={locked || !draft.requirement.trim() || !accounts.some(account => account.id === draft.accountId)} onClick={() => void run(create)}>建立草稿，开始制作 <ArrowRight size={15}/></button></div></section>}
    <Context.Provider value={agentContext}><StudioPage embedded onNewContent={() => setComposing(true)}/></Context.Provider>
  </div>;
}
export function AnalysisAgent() {
  const { project } = useStudio();
  if (!project) return <><AgentHeader title="结果分析 Agent" description="让每一次发布，都为下一次创作留下依据。" active={3} icon={Lightbulb}/><NeedProject/></>;
  return <AnalysisWork key={project.id}/>;
}
function AnalysisWork() {
  const context = useStudio(), { project, go } = context;
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);
  const form = useAgentDraft('analysis', 'xiaohongshu');
  const analysisModel = form.draft.model || context.settings.routes.analysis;
  const analysisContext = { ...context, agentInput: { model: analysisModel, skillIds: form.draft.skillIds }, settings: { ...context.settings, routes: { ...context.settings.routes, analysis: analysisModel, classification: analysisModel } },
    mutate: <T,>(path: string, method = 'POST', body?: unknown) => {
      const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      const modelRequest = /\/comments\/classify$/.test(path) || /\/analysis$/.test(path) && input.mode === 'openai';
      return context.mutate<T>(path, method, modelRequest ? { ...input, modelOverride: analysisModel } : body);
    },
    go: (page: Page, id?: string, detail = {}) => go(['comments', 'analytics', 'planning'].includes(page) ? 'analysis-agent' : page, id, detail),
  };
  if (!project) return <><AgentHeader title="结果分析 Agent" description="让每一次发布，都为下一次创作留下依据。" active={3} icon={Lightbulb}/><NeedProject/></>;
  function findWork() {
    const input = url.trim().replace(/\/$/, ''), work = project!.publications.find(item => item.url?.replace(/\/$/, '') === input || item.id === input);
    if (work) { setError(''); go('analysis-agent', project!.id, { publicationId: work.id, tab: 'metrics' }); }
    else setError('当前项目还未登记这篇作品。先登记链接、标题与实际发布账号，再选择采集数据。');
  }
  return <div className="agent-workspace">
    <AgentHeader title="结果分析 Agent" description="选择作品，核对真实指标与反馈。由你决定哪些结论值得保留、分享和再次尝试。" active={3} icon={Lightbulb}/>
    <section className="panel agent-analysis-entry"><div><h2>从一篇作品开始复盘</h2><p>粘贴已登记的作品链接，或在下方选择作品。之前在平台发布的作品可先登记。</p></div><form onSubmit={event => { event.preventDefault(); findWork(); }}><input aria-label="作品链接或记录编号" value={url} onChange={event => setUrl(event.target.value)} placeholder="粘贴作品链接或记录编号"/><button className="button primary" disabled={!url.trim()}>查看作品 <ArrowRight size={15}/></button></form>{error && <p className="error-text" role="alert">{error}</p>}<button className="text-button" disabled={context.busy} onClick={() => setRegistering(true)}><Plus size={14}/>登记外部已发布作品</button></section>
    <section className="panel agent-runtime-controls"><ModelAndSkills draft={form.draft} update={form.update} workflow="analysis" disabled={context.busy || !form.loaded}/><SavedState form={form}/><p className="small-note">模型用于本页 AI 分类与复盘；所选 Skills 用于复盘结论。先检查数据，再确认需要的分析。</p></section>
    <div className="agent-analysis-actions"><span>数据采集 → 用户确认分析 → 筛选经验 → 下次选用</span><button className="button small" disabled={!project.knowledge?.some(item => item.kind === 'experience' && item.active)} onClick={() => { const entries = project.knowledge?.filter(item => item.kind === 'experience' && item.active) || []; download(new Blob([`# ${project.brief.name} · 运营经验\n\n${entries.map(entry => `## ${entry.title}\n\n${entry.text}\n\n账号：${entry.accountId || '项目共享'}\n来源：${entry.sourceUrl || entry.sourceType}\n更新：${entry.updatedAt}`).join('\n\n---\n\n')}`], { type: 'text/markdown;charset=utf-8' }), `${project.brief.name}-运营经验.md`); }}><Download size={14}/>导出保留的经验</button></div>
    <Context.Provider value={analysisContext}><div className="agent-review-body"><ReviewWorkspace/></div></Context.Provider>
    {registering && <ExternalWorkDialog initialUrl={url} onClose={() => setRegistering(false)} onRegistered={(id, accountId) => { setError(''); go('analysis-agent', project.id, { publicationId: id, accountId, tab: 'metrics' }); }}/>} 
  </div>;
}
export function InspirationAgent() {
  const { project } = useStudio();
  if (!project) return <><AgentHeader title="灵感 Agent" description="从一个想法开始，让账号矩阵持续生长。" active={0} icon={Sparkles}/><NeedProject/></>;
  return <InspirationWork key={project.id}/>;
}
function InspirationWork() {
  const form = useAgentDraft('inspiration', 'xiaohongshu');
  return <div className="agent-workspace"><FlowSteps active={0}/><InspirationChatWork form={form} platforms={PLATFORM_AGENTS} savedState={<SavedState form={form}/>} renderModels={(draft, disabled) => <ModelAndSkills draft={draft} update={form.update} workflow="strategy" disabled={disabled}/>} renderExperience={(draft, disabled) => <SelectedExperience draft={draft} update={form.update} disabled={disabled}/>} /></div>;
}
