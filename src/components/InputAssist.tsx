import { useState } from 'react';
import { BookOpen, Plus, Search, Undo2 } from 'lucide-react';
import { activeTrendTags } from '../../server/trends.mjs';
import { searchCorpus } from '../../server/workflow.mjs';
import { promptStages, PROMPT_VERSION, mediaPrompt, type PromptStage } from '../../server/prompts.mjs';
import { useStudio } from '../context';
import { inputTags, appendInput, type AssistKind } from '../input-assist';
import type { Project, Asset, CorpusReference } from '../types';

export function InputAssist({ kind, value, onChange, maxLength, project, mode = 'instructions', disabled = false }: { kind: AssistKind; value: string; onChange: (value: string) => void; maxLength: number; project?: Project; mode?: 'instructions' | 'content'; disabled?: boolean }) {
  const { notify, busy } = useStudio();
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [query, setQuery] = useState(inputTags[kind][0]); const [results, setResults] = useState<CorpusReference[] | null>(null);
  const add = (text: string) => { try { const appended = appendInput(value, text, maxLength); const next = kind === 'query' ? appended.replace(/\n/g, ' ') : appended; if (next === value) { notify('这条内容已在输入框中'); return; } setUndo({ before: value, after: next }); onChange(next); } catch (error) { notify((error as Error).message, true); } };
  const locked = disabled || busy;
  const tags = project && ['copy','strategy'].includes(kind) ? activeTrendTags(project).filter(t => mode !== 'content' || t.kind === 'topic') : [];
  return <div className="input-assist">
    <div className="input-tags" role="group" aria-label="快捷输入建议"><span>试试这样写</span>{inputTags[kind].map(text => <button type="button" key={text} disabled={locked} title={text} onClick={() => add(text)}><Plus size={12}/>{text.split('\n')[0]}</button>)}{undo && undo.after === value && <button type="button" className="input-undo" disabled={locked} onClick={() => { onChange(undo.before); setUndo(null); }}><Undo2 size={12}/>撤销添加</button>}</div>
    {!!tags.length && <div className="trend-input-tags"><div className="input-tags" role="group" aria-label="已确认热点标签"><span>项目热点</span>{tags.map(tag=><button type="button" key={tag.id} disabled={locked} title={`${tag.sources[0]?.title || ''} · 有效至 ${new Date(tag.expiresAt).toLocaleDateString()}`} onClick={()=>add(mode === 'content' ? `#${tag.term}#` : tag.insertion)}><Plus size={12}/>{tag.label}</button>)}</div><p>{mode === 'content' ? '点选只添加话题标签，请自行核对正文中的事实。' : '点选带入话题方向与出处，不自动认定产品与新闻事件有关。'}</p></div>}
    {project && kind !== 'query' && <details className="input-rag"><summary><BookOpen size={14}/>从本项目语料库引用</summary><p>只检索当前项目已启用的文档，不调用模型。引用原文后请核对事实与语境。</p><div className="input-rag-search"><input aria-label="快速引用检索关键词" value={query} maxLength={500} disabled={locked} onChange={e => { setQuery(e.target.value); setResults(null); }} placeholder="输入产品、规格或场景关键词"/><button type="button" className="button small" disabled={locked || !query.trim()} onClick={() => setResults(searchCorpus(project, query))}><Search size={14}/>检索资料</button></div>{results && <div aria-live="polite">{results.length ? results.map(ref => <article key={`${ref.documentId}:${ref.chunk}`}><b>{ref.name} · 段落 {ref.chunk}</b><p>{ref.text}</p><button type="button" className="text-button green" disabled={locked} onClick={() => add(`[参考资料：${ref.name} · 段落 ${ref.chunk}]\n${ref.text}`)}>引用这段资料 <Plus size={13}/></button></article>) : <p>没有匹配资料。换个关键词，或到“项目语料库”导入介绍文档。</p>}</div>}</details>}
  </div>;
}

export function PromptGuide({ stage }: { stage: PromptStage }) {
  const spec = promptStages[stage];
  return <details className="prompt-guide"><summary>本步骤的输入与输出：{spec.title}</summary><dl><dt>使用什么</dt><dd>{spec.input}</dd><dt>得到什么</dt><dd>{spec.output}</dd><dt>填写重点</dt><dd>{spec.rule}</dd></dl><small>品牌事实优先；语料作为参考；生成后按词库筛选，再由你检查。规范版本 {PROMPT_VERSION}</small></details>;
}

export function MediaPromptPreview({ project, asset, purpose, prompt }: { project: Project; asset: Asset; purpose: PromptStage; prompt: string }) {
  const { state } = useStudio(); const recipe = mediaPrompt(project, asset, { purpose, prompt }, state.contentRules);
  return <details className="cover-prompt"><summary>查看本步实际提示词 · 已关联 {recipe.corpusReferences?.length || 0} 段语料</summary><pre>{recipe.prompt}</pre><small className="muted">资料按已确认策略取值，画面要求只用于本步骤。生成结果仍需人工检查。</small></details>;
}
