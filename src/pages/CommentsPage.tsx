import { useEffect, useState } from 'react';
import { ArrowRight, CheckCheck, ClipboardPaste, Download, Filter, ListChecks, MessageSquareText, Pencil, Search } from 'lucide-react';
import { useStudio } from '../context';
import { MCPCommentsDialog } from '../components/MCPCommentsDialog';
import { download, LOCAL_DATA } from '../api';
import type { Comment, Insight } from '../types';
import { Channel, date, Empty, Field, Modal, NeedProject, PageTitle, Pill } from '../components';
import { COMMENT_CATEGORIES, CATEGORY_GUIDE, commentReport, commentSummary, needsCommentReview } from '../../server/comment-analysis.mjs';
import { CommentImportDialog } from './CommentImportDialog';
import { CommentSyncPanel } from './PlatformActions';
import { AIAction } from './AIAction';
import { InsightCard } from './Insights';
import '../operations-lab.css';

const moods = { positive: '正向', neutral: '中性 / 不明确', negative: '负向' };
function CommentEditor({ comment, onClose }: { comment: Comment; onClose: () => void }) {
  const { project, run, mutate, notify, busy } = useStudio();
  const [tags, setTags] = useState(comment.tags), [sentiment, setSentiment] = useState(comment.sentiment), [irrelevant, setIrrelevant] = useState(comment.irrelevant), [note, setNote] = useState(comment.reviewNote || '');
  return <Modal title="核对评论分类" description="保留原文与分析来源，你确认的分类不会被后续 AI 分类覆盖。" onClose={onClose}>
    <blockquote className="comment-quote">{comment.text}</blockquote>
    {comment.classification && <p className="small-note">原判断：{comment.classification.reason}</p>}
    <div className="tag-options">{COMMENT_CATEGORIES.map(tag => <label key={tag} title={CATEGORY_GUIDE[tag]} className={tags.includes(tag) ? 'selected' : ''}><input type="checkbox" checked={tags.includes(tag)} onChange={e => setTags(e.target.checked ? [...tags, tag] : tags.filter(t => t !== tag))}/>{tag}</label>)}</div>
    <Field label="情绪倾向"><select value={sentiment} onChange={e => setSentiment(e.target.value as Comment['sentiment'])}>{Object.entries(moods).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
    <Field label="核对备注（可选）"><textarea rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="例如：这里是在问定价，不是抱怨价格。"/></Field>
    <label className="checkbox-row"><input type="checkbox" checked={irrelevant} onChange={e => setIrrelevant(e.target.checked)}/>无关内容：保留原文，从分析样本中排除</label>
    <div className="modal-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !tags.length || (tags.includes('其他') && tags.length > 1)} onClick={() => void run(async () => {
      await mutate(`/projects/${project!.id}/comments/${comment.id}`, 'PATCH', { tags, sentiment, irrelevant, note, expectedCorrectedAt: comment.correctedAt || null }); notify('已保存人工核对结果'); onClose();
    })}>确认并保存</button></div>{tags.includes('其他') && tags.length > 1 && <p className="small-note">“其他”用于没有明确主题的评论，请勿与其他主题同时选中。</p>}
  </Modal>;
}
function QuotedText({ comment }: { comment: Comment }) {
  const quote = comment.classification?.evidence || '', index = quote ? comment.text.indexOf(quote) : -1;
  return <p className="feedback-text">{index < 0 ? comment.text : <>{comment.text.slice(0,index)}<mark>{quote}</mark>{comment.text.slice(index+quote.length)}</>}</p>;
}
export function CommentsPage() {
  const { project, mutate, run, busy, notify, go } = useStudio();
  const [mcpOpen, setMcpOpen] = useState(false);
  const [importOpen,setImportOpen] = useState(false), [edit,setEdit] = useState<Comment|null>(null), [tab,setTab] = useState('comments');
  const [search,setSearch] = useState(''), [category,setCategory] = useState('all'), [work,setWork] = useState('all'), [platform,setPlatform] = useState('all'), [review,setReview] = useState('all'), [mood,setMood] = useState('all');
  const [from,setFrom] = useState(''), [to,setTo] = useState(''), [samples,setSamples] = useState(!!project?.sample), [page,setPage] = useState(1), [analysisId,setAnalysisId] = useState('');
  useEffect(() => setPage(1), [search,category,work,platform,review,mood,from,to,samples]);
  if (!project) return <NeedProject/>;
  const p = project, dateInvalid = !!from && !!to && from > to;
  const base = p.comments.filter(c => samples || !c.sample), totals = commentSummary(base);
  const filtered = base.filter(c => !dateInvalid && c.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (category === 'all' || c.tags.includes(category)) && (work === 'all' || c.publicationId === work) && (platform === 'all' || c.platform === platform) && (mood === 'all' || c.sentiment === mood) && (!from || Date.parse(c.importedAt) >= Date.parse(`${from}T00:00:00`)) && (!to || Date.parse(c.importedAt) <= Date.parse(`${to}T23:59:59.999`)) &&
    (review === 'all' || (review === 'needs' && needsCommentReview(c)) || (review === 'human' && !!c.correctedAt) || (review === 'ai' && !!c.classificationModel && !c.correctedAt) || (review === 'rules' && !c.classificationModel && !c.correctedAt) || (review === 'excluded' && c.irrelevant)));
  const summary = commentSummary(filtered), selectedIds = filtered.filter(c => !c.irrelevant).map(c => c.id);
  const pages = Math.max(1,Math.ceil(filtered.length/30)), currentPage = Math.min(page,pages);
  const runs = [...new Map(p.insights.map(i => [i.analysisId,i])).values()].reverse();
  const selectedRun = runs.find(i => i.analysisId === analysisId) || runs[0], insights = p.insights.filter(i => i.analysisId === selectedRun?.analysisId);
  const afterAnalysis = (value: unknown) => { const items = value as Insight[]; if (Array.isArray(items) && items[0]) setAnalysisId(items[0].analysisId); setTab('insights'); };
  return <div className="operations-lab">
    <PageTitle eyebrow="FEEDBACK WORKFLOW" title="把评论，变成下一步行动。" subtitle="先归类、再核对，让每一次内容调整都能找到原文依据。">
      <button className="button" onClick={() => go('analytics')}><ArrowRight size={16}/>运营数据</button><button className="button primary" onClick={() => setImportOpen(true)}><ClipboardPaste size={16}/>导入评论</button>{!LOCAL_DATA && <button className="button primary" onClick={() => setMcpOpen(true)}>MCP 获取评论</button>}
    </PageTitle>
    <ol className="workflow-ribbon" aria-label="评论分析工作流程">
      {[['01','导入与去重',`${totals.total} 条原文`],['02','规则与 AI 分类',`${totals.aiPending} 条可做 AI 分类`],['03','人工核对',`${totals.needsReview} 条建议核对`],['04','采用并验证',`${p.experiences.filter(e => e.active).length} 条品牌经验`]].map(([n,title,detail]) => <li key={n}><span>{n}</span><div><b>{title}</b><small>{detail}</small></div></li>)}
    </ol>
    <details className="panel collection-entry"><summary>评论来源与采集设置 <span>导入原文后自动进行本地初筛</span></summary><CommentSyncPanel/><p className="small-note">保留作品归属和原文，沿用已有去重规则。网页采集结果可能不完整，不视为平台全部评论。</p></details>
    <div className="lab-tabs" role="tablist" aria-label="评论工作区"><button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>分类工作台</button><button role="tab" aria-selected={tab === 'insights'} className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}>复盘与采用 <span>{insights.length}</span></button></div>
    {tab === 'comments' ? <>
      <section className="panel feedback-filter-panel" aria-label="评论筛选与分析范围">
        <div className="section-heading"><h2><Filter size={17}/>本次分析范围</h2><span className="small-note">按导入日期筛选</span></div>
        <div className="feedback-filters">
          <label className="searchbox"><Search size={16}/><input aria-label="搜索评论原文" placeholder="搜索评论关键词" value={search} onChange={e=>setSearch(e.target.value)}/></label>
          <select aria-label="作品范围" value={work} onChange={e=>setWork(e.target.value)}><option value="all">全部作品</option>{p.publications.filter(r => r.status === 'published').map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select>
          <select aria-label="平台范围" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="all">全部平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option></select>
          <select aria-label="主题范围" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">全部主题</option>{COMMENT_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
          <select aria-label="核对状态" value={review} onChange={e=>setReview(e.target.value)}><option value="all">全部状态</option><option value="needs">待核对</option><option value="human">人工已核对</option><option value="ai">AI 已分类</option><option value="rules">仅规则初筛</option><option value="excluded">已排除</option></select>
          <select aria-label="情绪范围" value={mood} onChange={e=>setMood(e.target.value)}><option value="all">全部情绪</option>{Object.entries(moods).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
          <label className="date-filter">从<input aria-label="导入开始日期" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="date-filter">到<input aria-label="导入结束日期" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
          <button className="text-button muted" onClick={()=>{setSearch('');setCategory('all');setWork('all');setPlatform('all');setReview('all');setMood('all');setFrom('');setTo('');}}>重置筛选</button>
        </div>
        <div className="row between wrap gap-10"><p className="small-note">选中 <b>{filtered.length}</b> 条，其中 <b>{summary.valid}</b> 条参与分析，{summary.excluded} 条无关内容已排除。</p><label className="checkbox-row"><input type="checkbox" checked={samples} onChange={e=>setSamples(e.target.checked)}/>包含示例评论</label></div>
        {dateInvalid && <p role="alert" className="error-text">开始日期不能晚于结束日期。</p>}
        <div className="analysis-actions-grid">
          <div><b>归类与理解</b><small>本地初筛免费；AI 每批最多 30 条，保留已完成的 AI 与人工分类。</small><div className="row wrap gap-8"><button className="button small" disabled={busy || !summary.aiPending} onClick={()=>void run(async()=>{const r=await mutate<{count:number}>(`/projects/${p.id}/comments/classify-rules`,'POST',{commentIds:selectedIds});notify(`已初筛 ${r.result.count} 条评论`);})}><ListChecks size={15}/>本地初筛</button><AIAction stage="classification" title="AI 语义分类" disabled={!summary.aiPending} description={`只处理当前筛选内尚未 AI 分类或人工核对的评论。本次最多 ${Math.min(30,summary.aiPending)} 条；评论与产品背景会发送给所选模型。`} path={`/projects/${p.id}/comments/classify`} body={{commentIds:selectedIds}}/></div></div>
          <div><b>归纳与复盘</b><small>只分析当前 {summary.valid} 条有效评论；{summary.needsReview} 条仍建议人工核对。</small><div className="row wrap gap-8"><button className="button small" disabled={busy || !summary.valid} onClick={()=>void run(async()=>{const r=await mutate<Insight[]>(`/projects/${p.id}/analysis`,'POST',{commentIds:selectedIds});afterAnalysis(r.result);notify('已按当前范围生成本地复盘');})}>本地规则复盘</button><AIAction stage="analysis" title="AI 语义复盘" disabled={!summary.valid || summary.valid>200} description={`分析当前筛选的 ${summary.valid} 条有效评论，生成附原文依据的建议。待核对内容也会纳入，请先检查重要分类。`} path={`/projects/${p.id}/analysis`} body={{mode:'openai',commentIds:selectedIds}} onResult={afterAnalysis}/></div>{summary.valid>200 && <small>AI 复盘每次最多 200 条，请先缩小范围。</small>}</div>
        </div>
      </section>
      <div className="feedback-board">
        <section className="panel feedback-topics"><h3>当前范围的主题分布</h3><p className="small-note">一条评论可有多个主题，占比不相加。</p><div className="topic-bars">{summary.topics.map(item=><button key={item.name} title={CATEGORY_GUIDE[item.name]} onClick={()=>setCategory(category===item.name?'all':item.name)}><span>{item.name}</span><div><i style={{width:`${summary.valid?item.count/summary.valid*100:0}%`}}/></div><b>{item.count}</b></button>)}</div><hr/><button className="review-queue-link" onClick={()=>setReview(review==='needs'?'all':'needs')}><span>待核对评论</span><strong>{summary.needsReview}</strong><ArrowRight size={16}/></button><p className="small-note">这是语义不明确或旧版缺少依据的记录数量，不是分类准确率。</p></section>
        <section aria-label="评论列表">
          <div className="section-heading"><h2>原文与分类 <small>{filtered.length} 条</small></h2><button className="button small" disabled={!filtered.length} onClick={()=>download(new Blob([JSON.stringify(commentReport(p,filtered),null,2)],{type:'application/json;charset=utf-8'}),'评论分类报告.json')}><Download size={14}/>导出当前范围</button></div>
          {filtered.length ? <><div className="feedback-list">{filtered.slice((currentPage-1)*30,currentPage*30).map(c=><article className={`panel feedback-card ${c.irrelevant?'irrelevant':''}`} key={c.id}>
            <div className="row between gap-10"><div className="row wrap gap-8"><Channel platform={c.platform} compact/><small className="muted">{p.publications.find(r=>r.id===c.publicationId)?.title || '作品记录不可用'}</small></div>{c.sample && <Pill color="gray">示例</Pill>}</div>
            <QuotedText comment={c}/><div className="row wrap gap-6">{c.tags.map(t=><Pill key={t} color="gray">{t}</Pill>)}<span className={`sentiment ${c.sentiment}`}>{moods[c.sentiment]}</span>{c.irrelevant?<Pill color="gray">已排除</Pill>:c.correctedAt?<Pill color="green">人工已核对</Pill>:needsCommentReview(c)?<Pill color="amber">待核对</Pill>:<Pill color="blue">{c.classificationModel?'AI 已分类':'规则初筛'}</Pill>}</div>
            <div className="classification-reason"><b>{c.correctedAt?'核对备注':'分类依据'}</b><span>{c.correctedAt?(c.reviewNote||'已确认当前主题、情绪和相关性。'):(c.classification?.reason||'旧版分类没有记录理由，可重新本地初筛或人工核对。')}</span></div>
            <div className="row between gap-10 wrap"><small className="muted">{date(c.importedAt,true)} 导入 · {c.correctedAt?'人工':c.classificationModel||'本地规则'}</small><button className="button small" onClick={()=>setEdit(c)}><Pencil size={14}/>{c.correctedAt?'修改核对':'核对分类'}</button></div>
            <details className="feedback-provenance"><summary>来源与采集信息</summary><p>{c.accountName} · {c.source==='douyin-api'?'抖音官方同步':c.source==='browser-page'?'网页采集（可能不完整）':c.sample?'示例数据':'手动导入'} · {c.isReply?'回复':'评论'}</p><p>发表时间：{c.commentAt?date(c.commentAt,true):c.timeLabel||'未知'} · 评论获赞：{c.likes??'未知'}</p>{c.correctedAt && c.classification && <p>原分类依据：{c.classification.reason}</p>}</details>
          </article>)}</div><div className="lab-pagination"><button className="button small" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>第 {currentPage} / {pages} 页 · 每页 30 条</span><button className="button small" disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>下一页</button></div></>:<div className="panel"><Empty title={p.comments.length?'没有符合范围的评论':'先收集第一批真实反馈'} text={p.comments.length?'调整筛选条件，或检查是否隐藏了示例评论。':'先登记作品发布结果，再导入该作品评论。'}><button className="button primary" onClick={()=>setImportOpen(true)}><MessageSquareText size={15}/>导入评论</button>{p.sample && !p.comments.length && <button className="button" disabled={busy} onClick={()=>void run(async()=>{await mutate(`/projects/${p.id}/comments/sample`);setSamples(true);notify('已加入明确标注的示例评论');})}>体验示例评论</button>}</Empty></div>}
        </section>
      </div>
    </>:<section className="review-workspace">
      <div className="section-heading"><div><h2>有依据的观察，有选择的采用</h2><p className="small-note">先查看引用原文，再决定是否带入下一轮创作。</p></div><button className="button" onClick={()=>go('planning')}><CheckCheck size={15}/>查看已采用经验</button></div>
      {selectedRun?<><div className="panel review-run"><Field label="复盘记录"><select value={selectedRun.analysisId} onChange={e=>setAnalysisId(e.target.value)}>{runs.map(i=><option key={i.analysisId} value={i.analysisId}>{date(i.createdAt,true)} · {i.source==='rules'?'本地规则':i.model} · {i.sampleSize} 条样本</option>)}</select></Field><div><b>本次记录：{selectedRun.sampleSize} 条有效评论</b><p className="small-note">{selectedRun.scope} 本记录保留生成时的分析范围，不随当前筛选改变。</p></div></div><div className="insight-grid">{insights.map(i=><InsightCard key={i.id} insight={i}/>)}</div></>:<div className="panel"><Empty title="从当前样本生成第一份复盘" text="回到分类工作台筛选评论，核对重要分类后，选择本地规则复盘或 AI 语义复盘。"><button className="button primary" onClick={()=>setTab('comments')}>去选择评论</button></Empty></div>}
    </section>}
    {mcpOpen && <MCPCommentsDialog onClose={() => setMcpOpen(false)}/>}
    {importOpen && <CommentImportDialog onClose={()=>setImportOpen(false)}/>} {edit && <CommentEditor comment={edit} onClose={()=>setEdit(null)}/>}
  </div>;
}
