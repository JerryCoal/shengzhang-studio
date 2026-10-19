import { useState } from 'react';
import { BookOpen, Plus, Search, Undo2 } from 'lucide-react';
import { activeTrendTags } from '../../server/trends.mjs';
import { searchCorpus } from '../../server/workflow.mjs';
import { promptStages, PROMPT_VERSION, type PromptStage } from '../../server/prompts.mjs';
import { skillVersionsFor } from '../../server/ai-skill-registry.mjs';
import { resolveBuiltinSkills } from '../../server/builtin-skills.mjs';
import { skillWorkflowId } from '../../server/skill-workflows.mjs';
import { selectedResearchContext, type ResearchProject, type ResearchContext } from '../../server/research-data.mjs';
import { useStudio } from '../context';
import { inputTags, appendInput, type AssistKind } from '../input-assist';
import type { Project, Asset, CorpusReference } from '../types';
import { previewMediaPrompt } from '../media-prompt-preview';
import { WorkflowSkillSummary } from '../pages/CreativeSkills';

export function InputAssist({ kind, value, onChange, maxLength, project, mode = 'instructions', disabled = false }: { kind: AssistKind; value: string; onChange: (value: string) => void; maxLength: number; project?: Project; mode?: 'instructions' | 'content'; disabled?: boolean }) {
  const { notify, busy } = useStudio();
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [query, setQuery] = useState(inputTags[kind][0]); const [results, setResults] = useState<CorpusReference[] | null>(null);
  const add = (text: string) => { try { const appended = appendInput(value, text, maxLength); const next = kind === 'query' ? appended.replace(/\n/g, ' ') : appended; if (next === value) { notify('这条内容已在输入框中'); return; } setUndo({ before: value, after: next }); onChange(next); } catch (error) { notify((error as Error).message, true); } };
  const locked = disabled || busy;
  const tags = project && ['copy','strategy'].includes(kind) ? activeTrendTags(project).filter(t => mode !== 'content' || t.kind === 'topic') : [];
  const research = project && ['copy','strategy'].includes(kind) ? selectedResearchContext(project as unknown as ResearchProject) : [];
  return <div className="input-assist">
    {!!research.length && <div className="trend-input-tags"><div className="input-tags" role="group" aria-label="已选研究标签"><span>近期参考</span>{[...new Set(research.flatMap(r => r.tags))].map(tag => <button type="button" key={tag} disabled={locked} onClick={() => add(mode === 'content' ? `#${tag}#` : `围绕“${tag}”借鉴内容结构，只使用本项目已确认的事实。`)}><Plus size={12}/>{tag}</button>)}</div><p>已选的 {research.length} 个参考方向会自动用于 AI 策略和文案。外部事件不代表本产品事实；过期参考会自动停用。</p></div>}
    <div className="input-tags" role="group" aria-label="快捷输入建议"><span>试试这样写</span>{inputTags[kind].map(text => <button type="button" key={text} disabled={locked} title={text} onClick={() => add(text)}><Plus size={12}/>{text.split('\n')[0]}</button>)}{undo && undo.after === value && <button type="button" className="input-undo" disabled={locked} onClick={() => { onChange(undo.before); setUndo(null); }}><Undo2 size={12}/>撤销添加</button>}</div>
    {!!tags.length && <div className="trend-input-tags"><div className="input-tags" role="group" aria-label="已确认热点标签"><span>项目热点</span>{tags.map(tag=><button type="button" key={tag.id} disabled={locked} title={`${tag.sources[0]?.title || ''} · 有效至 ${new Date(tag.expiresAt).toLocaleDateString()}`} onClick={()=>add(mode === 'content' ? `#${tag.term}#` : tag.insertion)}><Plus size={12}/>{tag.label}</button>)}</div><p>{mode === 'content' ? '点选只添加话题标签，请自行核对正文中的事实。' : '点选带入话题方向与出处，不自动认定产品与新闻事件有关。'}</p></div>}
    {project && kind !== 'query' && <details className="input-rag"><summary><BookOpen size={14}/>从本项目语料库引用</summary><p>只检索当前项目已启用的文档，不调用模型。引用原文后请核对事实与语境。</p><div className="input-rag-search"><input aria-label="快速引用检索关键词" value={query} maxLength={500} disabled={locked} onChange={e => { setQuery(e.target.value); setResults(null); }} placeholder="输入产品、规格或场景关键词"/><button type="button" className="button small" disabled={locked || !query.trim()} onClick={() => setResults(searchCorpus(project, query))}><Search size={14}/>检索资料</button></div>{results && <div aria-live="polite">{results.length ? results.map(ref => <article key={`${ref.documentId}:${ref.chunk}`}><b>{ref.name} · 段落 {ref.chunk}</b><p>{ref.text}</p><button type="button" className="text-button green" disabled={locked} onClick={() => add(`[参考资料：${ref.name} · 段落 ${ref.chunk}]\n${ref.text}`)}>引用这段资料 <Plus size={13}/></button></article>) : <p>没有匹配资料。换个关键词，或到“项目语料库”导入介绍文档。</p>}</div>}</details>}
  </div>;
}

export function ResearchTrace({ references }: { references?: ResearchContext[] }) {
  if (!references?.length) return null;
  return <details className="panel corpus-trace"><summary>本次使用的近期创作参考（{references.length} 个方向）</summary><p className="small-note">这是生成时的记录；只借鉴主题与表达，不作为本产品的事实或效果证明。</p>{references.map(ref => <article key={ref.analysisId}><h4>{ref.title}</h4><p>借鉴方式：{ref.application}</p><p className="small-note">{ref.limitations}</p>{ref.evidence.map(e => <p key={e.referenceId + e.quote}><a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> · {new Date(e.publishedAt).toLocaleDateString()}<br/>“{e.quote}”</p>)}</article>)}</details>;
}

export function PromptGuide({ stage, platform, reviewOnly = false, reviewMode }: { stage: PromptStage; platform?: string; reviewOnly?: boolean; reviewMode?: string }) {
  const { state } = useStudio();
  const spec = promptStages[stage];
  const payload = { task: { channel: platform }, ...(reviewOnly ? { copyReview: { mode: reviewMode } } : {}) };
  const builtinSkills = stage !== 'copy' || platform || reviewOnly ? resolveBuiltinSkills(state, skillWorkflowId(stage, payload)) : undefined;
  const skills = skillVersionsFor(stage, { ...payload, builtinSkills });
  return <details className="prompt-guide"><summary>本步骤的输入与输出：{spec.title}</summary><dl><dt>使用什么</dt><dd>{spec.input}</dd><dt>得到什么</dt><dd>{spec.output}</dd><dt>填写重点</dt><dd>{spec.rule}</dd>{skills.length > 0 && <><dt>自动规则</dt><dd>本步自动规则：{skills.map(skill => `${skill.name} · v${skill.version}`).join('；')}。随当前请求加载，不额外调用模型。</dd></>}</dl><small>品牌事实优先；语料作为参考；生成结果仍需你检查。规范版本 {PROMPT_VERSION}</small></details>;
}

export function MediaPromptPreview({ project, asset, purpose, prompt, duration, generateAudio, hasProductReference }: { project: Project; asset: Asset; purpose: PromptStage; prompt: string; duration?: number; generateAudio?: boolean; hasProductReference?: boolean }) {
  const { state } = useStudio(); const { recipe, error } = previewMediaPrompt(state, project, asset, { purpose, prompt, duration, generateAudio, hasProductReference });
  return <>{!asset.contentBrief && <WorkflowSkillSummary workflowId={purpose} platform={asset.channel}/ >}{recipe ? <details className="cover-prompt"><summary>查看本步实际提示词 · 已关联 {recipe.corpusReferences?.length || 0} 段语料</summary><pre>{recipe.prompt}</pre><small className="muted">资料按本篇需求与已保存资料取值，包含本步骤规则。生成结果仍需人工检查。</small></details> : <p className="error-text" role="alert">{error}</p>}</>;
}
