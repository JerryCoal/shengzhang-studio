import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, CircleAlert, Clapperboard, Download, Flame, Instagram, Lightbulb, Loader2, Plus, Save, Settings2, Sparkles, WandSparkles, Youtube } from 'lucide-react';
import { api, download, LOCAL_DATA } from '../api';
import { Context, useStudio } from '../context';
import { Field, NeedProject } from '../components';
import type { Asset, Page, Strategy } from '../types';
import { creativeSkillWorkflowIds } from '../../server/creative-skills.mjs';
import { KnowledgeLibrary, KnowledgePicker } from './KnowledgeLibrary';
import { ResearchPanel } from './Research';
import { StudioPage } from './ContentStudio';
import { ReviewWorkspace } from './ReviewWorkspace';
import { AIAction } from './AIAction';
import { ExternalWorkDialog } from './ExternalWorkDialog';
import { registerWorkspaceSaver } from '../workspace-save';
import '../agent-workspace.css';

export const PLATFORM_AGENTS = [
  { platform: 'xiaohongshu', page: 'xiaohongshu-agent', name: '小红书', color: '#e54868', Icon: BookOpen, description: '把真实体验写成值得收藏的图文与短视频。', hint: '场景、体验、封面与标题' },
  { platform: 'douyin', page: 'douyin-agent', name: '抖音', color: '#6860db', Icon: Clapperboard, description: '从开场到节奏，为每一个镜头安排清晰的表达。', hint: '开场、分镜、节奏与行动' },
  { platform: 'instagram', page: 'instagram-agent', name: 'Instagram', color: '#b34f9a', Icon: Instagram, description: '统一视觉气质，让图片、Reels 和账号语气相互呼应。', hint: '视觉、语气与社群互动' },
  { platform: 'youtube', page: 'youtube-agent', name: 'YouTube', color: '#dc514b', Icon: Youtube, description: '把选题发展成结构完整、可以持续追看的视频。', hint: '选题、叙事、分镜与封面' },
] as const;
type AgentPlatform = typeof PLATFORM_AGENTS[number]['platform'];
type AgentIdea = Pick<Strategy, 'title' | 'core' | 'direction' | 'prompt'>;
type AgentDraft = { requirement: string; platform: AgentPlatform; accountId: string; kind: 'image' | 'video'; knowledgeIds: string[]; experienceIds: string[]; referenceIds: string[]; skillIds: string[]; model: string; publishingNotes: string; idea?: AgentIdea; updatedAt?: string };
type DraftStore = { revision: number; drafts: Record<string, AgentDraft> };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '暂未保存，请重试';
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const fingerprint = (draft: AgentDraft) => JSON.stringify([draft.requirement || '', draft.platform || '', draft.accountId || '', draft.kind || 'image', draft.knowledgeIds || [], draft.experienceIds || [], draft.referenceIds || [], draft.skillIds || [], draft.model || '', draft.publishingNotes || '', draft.idea ? [draft.idea.title, draft.idea.core, draft.idea.direction, draft.idea.prompt] : null]);
const selectionOf = (draft: AgentDraft) => ({ platform: draft.platform, accountId: draft.accountId, model: draft.model, knowledgeIds: draft.knowledgeIds, experienceIds: draft.experienceIds, referenceIds: draft.referenceIds, skillIds: draft.skillIds, publishingNotes: draft.publishingNotes, ...(draft.idea ? { idea: draft.idea } : {}) });

// Drafts use the encrypted, member-scoped store. Save operations are serialized
// per editor so a delayed response cannot replace more recent typing.
function useAgentDraft(agentId: string, platform: AgentPlatform) {
  const { project, settings, target, notify } = useStudio();
  const key = `${project?.id || ''}:${agentId}`;
  const initial = useRef<AgentDraft>({ requirement: '', platform, accountId: '', kind: platform === 'youtube' || platform === 'douyin' ? 'video' : 'image', knowledgeIds: [], experienceIds: [], referenceIds: [], skillIds: [], model: agentId === 'inspiration' ? settings.routes.strategy : agentId === 'analysis' ? settings.routes.analysis : settings.routes.copy, publishingNotes: '' });
  const [draft, setDraft] = useState(initial.current), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [loadAttempt, setLoadAttempt] = useState(0);
  const latest = useRef(draft), saved = useRef(''), revision = useRef(0), mounted = useRef(true), ready = useRef(false), queue = useRef<Promise<void>>(Promise.resolve());
  latest.current = draft;
  const save = useCallback((keepalive = false) => {
    const operation = async () => {
      if (!ready.current || !project || fingerprint(latest.current) === saved.current) return;
      const snapshot = { ...latest.current }, snapshotKey = fingerprint(snapshot);
      if (mounted.current) { setSaving(true); setError(''); }
      try {
        let result: DraftStore | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { result = await api<DraftStore>('/agent-workspace', 'PUT', { expectedRevision: revision.current, key, draft: snapshot }, { keepalive }); break; }
          catch (failure) {
            if (attempt === 2 || !/版本|冲突|revision|更新/i.test(errorMessage(failure))) throw failure;
            const current = await api<DraftStore>('/agent-workspace');
            if (current.drafts[key] && fingerprint(current.drafts[key]) !== saved.current) throw new Error('此 Agent 的草稿已在另一窗口修改。当前输入已保留，请先复制输入再重新打开页面核对。');
            revision.current = current.revision;
          }
        }
        if (result) { revision.current = result.revision; saved.current = snapshotKey; }
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
      const restored = { ...initial.current, ...store.drafts[key], ...(target.requirement ? { requirement: target.requirement } : {}), ...(target.accountId ? { accountId: target.accountId } : {}), ...(target.knowledgeIds ? { knowledgeIds: target.knowledgeIds } : {}) };
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
  const update = (values: Partial<AgentDraft>) => setDraft(current => ({ ...current, ...values }));
  return { draft, update, loaded, saving, error, save, retry: () => loaded ? void save().catch(() => {}) : setLoadAttempt(value => value + 1), dirty: fingerprint(draft) !== saved.current };
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
  const { project, state, busy, mutate, run, notify, go } = useStudio();
  const form = useAgentDraft('inspiration', 'xiaohongshu'), { draft, update } = form;
  const [section, setSection] = useState('brief'), [researchSeed, setResearchSeed] = useState<{ keywords: string; platform: AgentPlatform } | null>(null);
  const request = useRef({ fingerprint: '', id: crypto.randomUUID() });
  if (!project) return null;
  const locked = busy || !form.loaded;
  const hotspotIntent = /热点|热帖|爆帖|爆款|趋势|hot\s?topic|trending/i.test(draft.requirement);
  const accounts = state.accounts.filter(account => account.platform === draft.platform);
  const selectedResearch = project.research?.analyses.filter(item => draft.referenceIds.includes(item.id) || project.research?.selectedIds.includes(item.id)) || [];
  const startResearch = () => { setResearchSeed({ keywords: draft.requirement.replace(/帮我|分析一下|热点分析|热点帖子|热点|爆款|爆帖|请/g, '').trim().slice(0, 30) || project.brief.product.slice(0, 30), platform: draft.platform }); setSection('research'); };
  async function handoff() {
    if (!project) return;
    await form.save();
    const values = { ...selectionOf(draft), requirement: draft.requirement, kind: draft.kind, fromAgent: 'inspiration', skillIds: [], referenceIds: [...new Set([...draft.referenceIds, ...(project.research?.selectedIds || [])])] };
    const valueKey = JSON.stringify(values); if (valueKey !== request.current.fingerprint) request.current = { fingerprint: valueKey, id: crypto.randomUUID() };
    const response = await mutate<Asset>(`/projects/${project.id}/agent-handoffs`, 'POST', { ...values, requestId: request.current.id });
    const destination = PLATFORM_AGENTS.find(agent => agent.platform === draft.platform)!;
    notify(`资料包已交给${destination.name} Agent，可继续调整与制作`); go(destination.page, project.id, { assetId: response.result.id, tab: 'brief', accountId: draft.accountId });
  }
  return <div className="agent-workspace"><AgentHeader title="灵感 Agent" description="说说这次想做什么。把热点、项目资料和验证过的经验，变成下一篇的起点。" active={0} icon={Sparkles}/>
    {LOCAL_DATA && <p className="info-box">浏览器版可保存需求、管理经验与交接草稿；热点读取与带账号资料的 Agent AI 生成请使用 Windows 完整版或团队版。</p>}
    <div className="agent-platform-rail">{PLATFORM_AGENTS.map(({ platform, page, name, color, Icon, hint }) => <button key={platform} onClick={() => go(page, project.id)} style={{ '--agent-color': color } as CSSProperties}><span className="agent-platform-icon"><Icon size={19}/></span><span><b>{name} Agent</b><small>{hint}</small></span><ArrowRight size={15}/></button>)}</div>
    <div className="agent-tabbar" role="tablist" aria-label="灵感工作区">{[['brief', '运营需求'], ['research', '热点与参考'], ['experience', '经验库']].map(([id, label]) => <button role="tab" aria-selected={section === id} key={id} onClick={() => setSection(id)}>{label}</button>)}<SavedState form={form}/></div>
    <div hidden={section !== 'brief'}><div className="agent-composer-layout"><section className="panel agent-composer"><div className="agent-section-heading"><span className="agent-step-number">01</span><div><h2>这次，你想推动什么？</h2><p>明确受众、主题、目标与限制，Agent 会沿着你的方向展开。</p></div></div><textarea className="agent-main-input" aria-label="运营需求" rows={6} maxLength={4000} disabled={locked} value={draft.requirement} onChange={event => update({ requirement: event.target.value, idea: undefined })} placeholder="例如：为咖啡品牌的小红书账号策划一组通勤主题内容。先分析最近的同类热门帖子，沿用我选中的真实测评经验，语气轻松，重点展示便携和口感。"/>
      <div className="agent-two-fields"><Field label="目标平台"><select value={draft.platform} disabled={locked} onChange={event => update({ platform: event.target.value as AgentPlatform, accountId: '', knowledgeIds: [], kind: ['youtube', 'douyin'].includes(event.target.value) ? 'video' : 'image' })}>{PLATFORM_AGENTS.map(agent => <option key={agent.platform} value={agent.platform}>{agent.name}</option>)}</select></Field><Field label="目标账号"><select value={draft.accountId} disabled={locked} onChange={event => update({ accountId: event.target.value, knowledgeIds: [] })}><option value="">先形成灵感，交接前再选择</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field></div>
      <ModelAndSkills draft={draft} update={update} workflow="strategy" disabled={locked}/>
      {hotspotIntent && <div className="agent-intent"><Flame size={18}/><span>已识别热点研究需求。先选择读取账号、范围和来源，再确认采集与分析。</span><button className="button small" disabled={locked} onClick={startResearch}>进入热点研究 <ArrowRight size={14}/></button></div>}
      <div className="agent-composer-footer"><span>草稿自动保存 · 生成前核对模型与费用</span><AIAction stage="strategy" title="生成灵感方案" description="根据本次需求、明确选中的经验和项目事实，生成可调整的内容方向。" path={`/projects/${project.id}/strategies`} body={{ mode: 'openai', stage: 'strategy', instruction: draft.requirement, agentInput: { ...selectionOf(draft), referenceIds: [...new Set([...draft.referenceIds, ...(project.research?.selectedIds || [])])] } }} modelOverride={draft.model} disabled={locked || LOCAL_DATA || !draft.requirement.trim()} onResult={result => { const value = result as Strategy; update({ idea: { title: value.title, core: value.core, direction: value.direction, prompt: value.prompt } }); }}/></div>
    </section><aside className="panel agent-context-card"><div className="agent-section-heading"><span className="agent-step-number">02</span><div><h2>给灵感一点依据</h2><p>选中的经验优先，按账号保留适用范围。</p></div></div><SelectedExperience draft={draft} update={update} disabled={locked}/>{selectedResearch.length > 0 && <div className="agent-picked-research"><b>已确认的热点分析</b>{selectedResearch.map(item => <p key={item.id}><Check size={13}/>{item.title}</p>)}</div>}<button className="text-button" onClick={() => setSection('experience')}>管理资料与团队共享经验 <ArrowRight size={13}/></button></aside></div>
    {draft.idea && <section className="panel agent-idea-result"><div className="agent-section-heading"><Sparkles size={20}/><div><h2>灵感方案已就绪</h2><p>调整后交给平台 Agent，继续写文案、补充素材与制作画面。</p></div><span className="agent-result-badge">待你确认</span></div><Field label="灵感标题"><input maxLength={200} value={draft.idea.title} onChange={event => update({ idea: { ...draft.idea!, title: event.target.value } })}/></Field><div className="agent-two-fields"><Field label="核心表达"><textarea rows={4} maxLength={2000} value={draft.idea.core} onChange={event => update({ idea: { ...draft.idea!, core: event.target.value } })}/></Field><Field label="内容方向"><textarea rows={4} maxLength={4000} value={draft.idea.direction} onChange={event => update({ idea: { ...draft.idea!, direction: event.target.value } })}/></Field></div><details><summary>展开创作提示</summary><Field label="创作提示"><textarea rows={5} maxLength={16000} value={draft.idea.prompt} onChange={event => update({ idea: { ...draft.idea!, prompt: event.target.value } })}/></Field></details></section>}
    <section className="panel agent-handoff"><div><span className="agent-eyebrow">NEXT · 平台创作</span><h2>{draft.idea ? '带着这份灵感，开始制作' : '想法已经清晰？直接开始制作'}</h2><p>资料、经验与发布要求一起交接，每篇内容绑定独立账号。</p></div><div className="agent-handoff-options"><Field label="内容形式"><select disabled={locked} value={draft.kind} onChange={event => update({ kind: event.target.value as 'image' | 'video' })}><option value="image" disabled={draft.platform === 'youtube'}>图文</option><option value="video">视频</option></select></Field><Field label="发布要求（可选）"><input maxLength={2000} value={draft.publishingNotes} disabled={locked} onChange={event => update({ publishingNotes: event.target.value })} placeholder="期望发布时间、标签、审核重点…"/></Field><button className="button primary" disabled={locked || !draft.requirement.trim() || !accounts.some(account => account.id === draft.accountId)} onClick={() => void run(handoff)}>交给{PLATFORM_AGENTS.find(agent => agent.platform === draft.platform)?.name} Agent <ArrowRight size={16}/></button></div>{!draft.accountId && <p className="small-note">交接前请选择目标账号。{!accounts.length && <button className="text-button" onClick={() => go('projects')}>添加平台账号</button>}</p>}</section></div>
    {section === 'research' && <div className="agent-research"><p className="agent-inline-note"><Flame size={16}/>读取范围和费用将在开始前确认。收藏或确认的分析可带回灵感需求继续创作。</p><ResearchPanel key={researchSeed ? `${researchSeed.platform}:${researchSeed.keywords}` : 'saved'} initialKeywords={researchSeed?.keywords} initialPlatform={researchSeed?.platform || draft.platform}/><button className="button primary" onClick={() => { update({ referenceIds: project.research?.selectedIds || [] }); setSection('brief'); }}>带回已确认的热点分析 <ArrowRight size={15}/></button></div>}
    {section === 'experience' && <KnowledgeLibrary/>}
  </div>;
}
