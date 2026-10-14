import { HighlightedCopy } from '../components/CopyCheckPanel';
import { InputAssist } from '../components/InputAssist';
import { CorpusRag } from '../components/CorpusRag';
import { useEffect, useState } from 'react';
import { BookOpen, FileText, Search, Upload, Trash2 } from 'lucide-react';
import { useStudio } from '../context';
import { api, IS_STATIC, IS_WEB } from '../api';
import { readDocument } from '../document-text';
import { corpusQuery, searchCorpus } from '../../server/workflow.mjs';
import { Empty, Field, Modal, NeedProject, PageTitle } from '../components';
import type { CorpusDocument, CorpusReference, CorpusRagStatus, CorpusSearchResult, CopyReview } from '../types';

export function RetrievalResults({ results, method, note }: { results: CorpusReference[]; method?: 'hybrid' | 'keyword'; note?: string }) {
  const recordedMethod = method || results.find(reference => reference.method)?.method;
  return <><div className="retrieval-status"><span className="retrieval-method">{recordedMethod === 'hybrid' ? '语义 + 关键词' : recordedMethod === 'keyword' ? '本地关键词' : '检索方式未记录'}</span>{note && <p className="small-note">{note}</p>}</div><div className="retrieval-results">{results.map(ref => <article key={`${ref.documentId}:${ref.chunk}`}><b><FileText size={15}/>{ref.name} · 段落 {ref.chunk}</b><p>{ref.text}</p></article>)}</div></>;
}
export function CopyReviewNote({ review }: { review?: CopyReview }) {
  if (!review) return null;
  const hits = review.hits.length ? review.hits : review.previousHits || [];
  const pending = review.remaining || [];
  return <details className="copy-review"><summary>{pending.length ? '上次自检 · ' + pending.length + ' 处命中或语义候选' : hits.length ? '敏感词自检 · 有固定替换记录' : '上次检查未命中'}</summary><p>按词库匹配并复检，请核对语义。到“编辑与自检”处理当前文案；以下原文位置为本次检查快照。</p>{Object.entries(review.source || {}).map(([field, text]) => <div key={field}><b>{field === 'body' ? '正文' : field === 'title' ? '标题' : field}</b><HighlightedCopy text={text} matches={(review.matches || []).filter(m => m.field === field)}/></div>)}{hits.map((hit, i) => <div key={i}><b>{hit.original}</b> → <span>{hit.replacement || '删除该词'}</span><small>{hit.field} · {hit.count} 处</small></div>)}{pending.map((hit, i) => <p key={'pending-' + i}>待复核：{hit.original} · {hit.field} · {hit.action === 'semantic' ? '价格语义候选，需在编辑与自检中判断' : hit.action === 'rewrite' ? '需要上下文改写' : '替换后仍命中'} · {hit.risk}</p>)}</details>;
}
export function GenerationWorkflow() { return <div className="generation-workflow" aria-label="生成工作流程"><span>1 检索项目语料</span><span>2 生成策略与文案</span><span>3 本地筛查与固定替换</span><span>4 复检，疑难词按需 AI 改写</span></div>; }

export function CorpusPage() {
  const { project, settings, mutate, run, runBackground, busy, notify, refresh } = useStudio();
  const [open, setOpen] = useState(false), [reading, setReading] = useState(false);
  const [name, setName] = useState(''), [text, setText] = useState(''); const [importError, setImportError] = useState('');
  const [format, setFormat] = useState<CorpusDocument['format']>('paste');
  const [query, setQuery] = useState(project ? corpusQuery(project) : '');
  const [results, setResults] = useState<CorpusReference[] | null>(null), [preview, setPreview] = useState<CorpusDocument | null>(null), [deleting, setDeleting] = useState<CorpusDocument | null>(null);
  const [ragStatus, setRagStatus] = useState<CorpusRagStatus | null>(null);
  const [searchMethod, setSearchMethod] = useState<'hybrid' | 'keyword'>('keyword'), [searchNote, setSearchNote] = useState('');
  const localOnly = IS_STATIC || IS_WEB || !!settings.browserStorage;
  useEffect(() => { setQuery(project ? corpusQuery(project) : ''); setResults(null); setSearchNote(''); setRagStatus(null); setPreview(null); setDeleting(null); }, [project?.id]);
  if (!project) return <NeedProject/>;
  const documents = project.corpus || [];
  return <>
    <PageTitle title="项目语料库" subtitle="把介绍文档保存在当前项目，生成前检索相关段落并保留出处。"><button className="button primary" onClick={() => { setName(''); setText(''); setImportError(''); setFormat('paste'); setOpen(true); }}><Upload size={17}/>导入项目介绍</button></PageTitle>
    <GenerationWorkflow/>
    <CorpusRag key={project.id} project={project} onStatusChange={setRagStatus}/>
    <section className="panel corpus-search"><div className="section-heading"><h2><Search size={18}/>查询语料库</h2><span>{documents.filter(d => d.enabled).length} 份参与检索</span></div><form onSubmit={e => { e.preventDefault(); void runBackground('查询项目语料', async () => { const value: CorpusSearchResult = localOnly || !ragStatus ? { results: searchCorpus(project, query), method: 'keyword', note: !localOnly ? '未确认语义索引状态，本次仅使用本地关键词。' : undefined } : await api<CorpusSearchResult>(`/projects/${project.id}/corpus/search`, 'POST', { query }); setResults(value.results); setSearchMethod(value.method === 'hybrid' ? 'hybrid' : 'keyword'); setSearchNote(value.note || ''); if (!localOnly && ragStatus) await refresh(); }); }}><Field label="想查找什么"><input value={query} maxLength={500} placeholder="例如：产品规格、使用步骤、品牌定位" onChange={e => { setQuery(e.target.value); setResults(null); }}/></Field><InputAssist kind="query" value={query} onChange={v => { setQuery(v); setResults(null); }} maxLength={500}/><button className="button primary" disabled={busy || !query.trim()}><Search size={16}/>查询相关段落</button></form><p className="small-note">{!localOnly && ragStatus?.enabled && ragStatus.ready ? '语义检索已启用：查询问题会发送至阿里云并可能计费，结合本地关键词返回最多 5 段；原文与出处仍从当前项目取值。' : '当前使用本地关键词匹配，最多返回 5 段，不为本次查询调用外部模型。'} 只检索当前项目已启用的文档。</p>{results && <><RetrievalResults results={results} method={searchMethod} note={searchNote}/>{!results.length && <p className="empty-search">没有找到相关段落，请换一个说法或补充文档。</p>}</>}</section>
    <div className="section-heading"><h2>已保存的介绍文档</h2><span className="muted">{documents.length} / 50 份</span></div>
    {documents.length ? <div className="corpus-list">{documents.map(doc => <article className="panel corpus-document" key={doc.id}><div><FileText size={24}/><h3>{doc.name}</h3><small>{doc.format.toUpperCase()} · {doc.text.length.toLocaleString()} 字符 · {doc.chunks.length} 段 · {new Date(doc.importedAt).toLocaleDateString('zh-CN')}</small><p>{doc.text.slice(0, 130)}{doc.text.length > 130 ? '…' : ''}</p></div><div className="row gap-12 wrap"><label className="checkbox-row"><input type="checkbox" checked={doc.enabled} disabled={busy} onChange={e => { const enabled = e.target.checked; void run(async () => { await mutate(`/projects/${project.id}/corpus/${doc.id}`, 'PATCH', { enabled }); setResults(null); }); }}/><span>参与检索</span></label><button className="button small" onClick={() => setPreview(doc)}><BookOpen size={15}/>查看正文</button><button className="icon-button" disabled={busy} aria-label={`删除语料 ${doc.name}`} onClick={() => setDeleting(doc)}><Trash2 size={16}/></button></div></article>)}</div> : <div className="panel"><Empty title="把项目资料放进来" text="支持 TXT、MD、DOCX 和文字型 PDF，也可以直接粘贴介绍。保存提取的正文与来源，原文件保留在你的文件夹。"/></div>}
    {open && <Modal title="导入项目介绍文档" description="在本机提取正文，检查后再保存到项目语料库。" onClose={() => { if (!reading) setOpen(false); }} wide><label className="button file-button"><Upload size={16}/>{reading ? '正在读取文档…' : '选择介绍文档'}<input type="file" aria-label="选择项目介绍文档" accept=".txt,.md,.docx,.pdf" disabled={reading} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setReading(true); setImportError(''); try { const result = await readDocument(file); setName(file.name); setText(result.text); setFormat(result.format); } catch (error) { setImportError(error instanceof Error ? error.message : '文档读取失败'); } finally { setReading(false); } }}/></label><p className="small-note">单文件 8 MB，正文最多 30 万字符。PDF 最多 100 页；扫描件需先转为文字。</p><div role="alert" className="error-text">{importError}</div><Field label="语料名称"><input value={name} maxLength={160} onChange={e => setName(e.target.value)} placeholder="例如：咖啡产品介绍 2026年9月"/></Field><Field label="正文预览与补充"><textarea value={text} rows={12} maxLength={300000} onChange={e => setText(e.target.value)} placeholder="也可以直接粘贴项目介绍…"/></Field><p className="small-note">导入先保存在当前项目。生成文案时发送检索命中的段落；如另行确认建立 Qwen 语义索引，已启用文档的必要正文也会发送至阿里云。产品事实与冲突信息仍需人工核对。</p><div className="modal-actions"><button className="button" disabled={reading} onClick={() => setOpen(false)}>取消</button><button className="button primary" disabled={busy || reading || !name.trim() || !text.trim()} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/corpus`, 'POST', { name, text, format }); setOpen(false); setResults(null); notify('介绍文档已保存，生成前会检索相关段落'); })}>确认导入语料</button></div></Modal>}
    {preview && <Modal title={preview.name} onClose={() => setPreview(null)} wide><pre className="corpus-fulltext">{preview.text}</pre></Modal>}
    {deleting && <Modal title="删除这份语料" description="以后生成时不再检索它；已保存策略的引用快照仍然保留。" onClose={() => setDeleting(null)}><p>{deleting.name}</p><div className="modal-actions"><button className="button" onClick={() => setDeleting(null)}>保留</button><button className="button danger" disabled={busy} onClick={() => void run(async () => { await mutate(`/projects/${project.id}/corpus/${deleting.id}`, 'DELETE'); setDeleting(null); setResults(null); })}>删除语料</button></div></Modal>}
  </>;
}
