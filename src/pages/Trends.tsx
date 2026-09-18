import { useEffect, useState } from 'react';
import { Check, ExternalLink, Flame, RefreshCw, Tag, X } from 'lucide-react';
import { useStudio } from '../context';
import { Empty, Field, NeedProject, PageTitle, Pill } from '../components';
import { IS_STATIC } from '../api';
import { trendsOf, COMMON_WORDS, type TrendsState, type TrendSettings } from '../../server/trends.mjs';
import { NEWS_SOURCES, NEWS_CATEGORIES, KEYWORD_SUGGESTIONS } from '../../server/news-sources.mjs';
const words = (text: string) => [...new Set(text.split(/[,，、;；\n]+/).map(s=>s.trim()).filter(Boolean))];
const date = (text?: string) => text ? new Date(text).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '尚未采集';
export function TrendsPage() { const { project }=useStudio(); return project ? <ProjectTrends key={project.id}/> : <NeedProject/>; }
function ProjectTrends() {
  const {project,run,mutate,busy,notify,go}=useStudio();const p=project!, current=trendsOf(p);
  const [keywords,setKeywords]=useState(current.settings.keywords.join('，'));
  const [sourceIds,setSources]=useState(current.settings.sourceIds);
  const [blocked,setBlocked]=useState(current.settings.blockTerms.join('\n'));
  const [generic,setGeneric]=useState(current.settings.genericTerms.join('\n'));
  const [chosen,setChosen]=useState<string[]>([]),[ack,setAck]=useState<string[]>([]);
  useEffect(()=>{setChosen([]);setAck([]);},[current.runId]);
  const toggle=(list:string[],value:string)=>list.includes(value)?list.filter(v=>v!==value):[...list,value];
  const settings:TrendSettings={keywords:words(keywords),sourceIds,blockTerms:words(blocked),genericTerms:words(generic)};
  const valid=settings.keywords.length>0&&settings.keywords.length<=12&&settings.keywords.every(k=>k.length<=30)&&sourceIds.length>0;
  const dirty=JSON.stringify(settings)!==JSON.stringify(current.settings);
  const save=async()=>{const saved=await mutate<TrendsState>(`/projects/${p.id}/trends/settings`,'PUT',{expectedRevision:current.revision,settings});return saved.result;};
  const riskPending=chosen.some(id=>current.candidates.find(c=>c.id===id)?.risk==='review'&&!ack.includes(id));
  return <>
    <PageTitle eyebrow="NEWS TO IDEAS" title="找到值得借鉴的话题。" subtitle="近七天中文新闻 → 项目匹配 → 人工挑选 → 文案标签。采集与筛选不调用付费模型。"/>
    <div className="trend-workflow"><span>1 选择关键词</span><span>2 更新新闻</span><span>3 确认候选</span><span>4 使用标签</span></div>
    <section className="panel trend-settings">
      <div className="section-heading"><h2>这次关注什么？</h2><Pill color="green">当前项目独立保存</Pill></div>
      <Field label="项目宣传关键词" hint="1–12 个，每个最多 30 字；用逗号分隔。推荐填写受众、使用场景和行业，不必只填品牌名称。"><textarea rows={2} maxLength={500} value={keywords} disabled={busy} onChange={e=>setKeywords(e.target.value)} placeholder="例如：学习搭子，大学生，校园社交"/></Field>
      <div className="trend-keywords" role="group" aria-label="选择宣传关键词">{[...new Set([p.brief.product,...KEYWORD_SUGGESTIONS])].filter(k=>k.length<=30).map(k=><button type="button" key={k} className={settings.keywords.includes(k)?'selected':''} aria-pressed={settings.keywords.includes(k)} disabled={busy} onClick={()=>setKeywords(toggle(settings.keywords,k).join('，'))}>{settings.keywords.includes(k)?<Check size={13}/>:null}{k}</button>)}</div>
      <fieldset className="trend-sources"><legend>中文新闻来源</legend>{NEWS_SOURCES.map(s=><label key={s.id}><input type="checkbox" checked={sourceIds.includes(s.id)} disabled={busy} onChange={()=>setSources(toggle(sourceIds,s.id))}/><span>{s.name}<small>{NEWS_CATEGORIES[s.category]}</small></span></label>)}</fieldset>
      <details className="trend-filters"><summary>管理禁用词与通用词过滤</summary><p className="small-note">含争议信号的报道不进入推荐。人物、品牌和作品名称保留为待确认候选；规则不能代替权利核查。</p><div className="service-fields"><Field label="禁用词" hint="已知有纠纷、未授权或本项目不适合的词，一行一个；包含该词的候选会被排除。"><textarea rows={4} maxLength={3200} value={blocked} disabled={busy} onChange={e=>setBlocked(e.target.value)}/></Field><Field label="补充通用词" hint="一行一个；只过滤完全相同的候选词，不阻止它作为检索关键词。"><textarea rows={4} maxLength={3200} value={generic} disabled={busy} onChange={e=>setGeneric(e.target.value)}/></Field></div><p className="small-note">内置过滤 {COMMON_WORDS.length} 个通用词，例如“热点、新闻、学习、社交、科技”。“学习搭子”等更具体的组合仍可入选。</p></details>
      {IS_STATIC&&<p className="info-box">采集新闻需要 Windows 完整版或已连接后端的网页版。已有标签仍可离线使用。</p>}
      <div className="trend-actions"><button className="button primary" disabled={busy||!valid||IS_STATIC} onClick={()=>void run(async()=>{const saved=dirty?await save():current;await mutate(`/projects/${p.id}/trends/refresh`,'POST',{expectedRevision:saved.revision});notify('新闻已更新，请检查来源与候选热点');})}><RefreshCw size={16}/>{busy?'处理中…':'更新近七天热点'}</button><button className="button" disabled={busy||!valid||!dirty} onClick={()=>void run(async()=>{await save();notify('筛选设置已保存，并重新筛选本地新闻');})}>仅保存并重新筛选</button><small>{settings.keywords.length}/12 个关键词 · 上次更新 {date(current.updatedAt)}</small></div>
    </section>
    {current.updatedAt&&<section className="panel trend-coverage"><div><h3>本次采集范围</h3><p>{date(current.windowStart)} — {date(current.updatedAt)} · {current.articles.length} 条去重新闻 · {current.matchedArticles||0} 条匹配 · {current.filteredDisputes||0} 条含争议信号已排除</p></div><div className="trend-report">{current.reports.map(r=><span key={r.sourceId} title={r.message} className={r.status==='ok'?'':'failed'}>{r.name}：{r.status==='ok'?`${r.count} 条`:'本次未能读取'}</span>)}</div><p className="small-note">仅覆盖所选来源公开返回的条目，不代表全网热榜或完整七天档案。保留仍在七天内的历史采集；缺少发布日期、未来日期和过期条目不参与排名。正文只保存短摘录，不抓取登录或付费内容。</p></section>}
    <section className="trend-results"><div className="section-heading"><div><h2><Flame size={20}/> 匹配候选</h2><p className="muted">最多挑选 5 个。评分是本地规则估算，反映项目匹配、时效与来源覆盖。</p></div><span>{chosen.length}/5 已选</span></div>
      {!current.candidates.length?<div className="panel"><Empty title={current.updatedAt?'没有符合条件的候选热点':'先选关键词，再更新近七天热点'} text={current.updatedAt?'换一组受众或场景关键词，或检查来源状态。没有合适内容时不会用大众化词汇凑数。':'你确认过的热点才会变成文案输入建议。'}/></div>:<div className="trend-cards">{current.candidates.map(c=><article className={`panel trend-card ${chosen.includes(c.id)?'chosen':''}`} key={c.id}>
        <div className="trend-card-top"><label><input type="checkbox" disabled={busy||dirty||(!chosen.includes(c.id)&&chosen.length>=5)} checked={chosen.includes(c.id)} onChange={()=>setChosen(toggle(chosen,c.id))}/><strong>{c.term}</strong></label><span>{c.score}<small>匹配分</small></span></div>
        <p className="trend-match">关联：{c.matches.map(m=>m.via===m.keyword?m.keyword:`${m.keyword} → ${m.via}`).join('、')}</p><div className="trend-meta"><span>{c.articleCount} 篇相关报道</span><span>{c.sourceCount} 家来源</span><span>最近 {date(c.latestAt)}</span></div>
        <details><summary>为什么推荐？查看信息与出处</summary><p className="small-note">关键词 {c.parts.relevance}/65 · 时效 {c.parts.freshness}/20 · 来源 {c.parts.sources}/10 · 报道覆盖 {c.parts.coverage}/5。仅出现一篇时属于话题线索，尚不能认定为广泛热点。</p>{c.articleIds.map(id=>current.articles.find(a=>a.id===id)).filter(Boolean).map(a=><div className="trend-article" key={a!.id}><a href={a!.url} target="_blank" rel="noreferrer">{a!.title}<ExternalLink size={12}/></a><small>{a!.source} · {date(a!.publishedAt)} · {a!.extraction==='page'?'网页摘录':'订阅摘要'}</small><p>{a!.excerpt||'来源未提供摘要，请打开原文核对。'}</p></div>)}</details>
        <div className={`trend-risk ${c.risk==='review'?'review':''}`}><b>{c.risk==='review'?'涉及名称风险 · 需单独确认':'权利状态未核实'}</b><p>{c.riskReason}</p>{c.risk==='review'&&<label><input type="checkbox" disabled={busy||dirty} checked={ack.includes(c.id)} onChange={()=>setAck(toggle(ack,c.id))}/>我已核对该名称的使用条件，并确认本次采用</label>}</div>
      </article>)}</div>}
      {current.candidates.length>0&&<div className="panel trend-selection"><span>{dirty?'设置尚未保存，请先重新筛选候选。':riskPending?'请先逐项确认已选候选的名称风险。':'选择后生成话题标签与场景切入标签，不自动改写文案。'}</span><button className="button primary" disabled={busy||dirty||!chosen.length||riskPending} onClick={()=>void run(async()=>{await mutate(`/projects/${p.id}/trends/select`,'POST',{runId:current.runId,candidateIds:chosen,acknowledgedIds:ack,confirmed:true});notify('标签已保存，可到 AI 文案输入框点选使用');})}><Tag size={16}/>确认选择并生成标签</button></div>}
    </section>
    <section className="panel trend-library"><div className="section-heading"><div><h2>已确认的文案标签</h2><p className="muted">到策略、AI 文案或正文编辑框下方点选。过期或禁用标签不会继续推荐。</p></div><button className="button small" onClick={()=>go('studio',p.id)}>去编写文案</button></div>{current.tags.length?<div className="trend-saved-tags">{current.tags.map(t=><div key={t.id}><span><Tag size={14}/>{t.label}</span><small>{date(t.expiresAt)} 到期 · {Date.parse(t.expiresAt)<=Date.now()?'已过期':t.enabled?'已启用':'已停用'}</small><button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await mutate(`/projects/${p.id}/trends/tags/${t.id}`,'PUT',{enabled:!t.enabled});})}>{t.enabled?<X size={13}/>:<Check size={13}/>} {t.enabled?'停用':'启用'}</button></div>)}</div>:<p className="muted">暂无标签。先确认上方候选热点，标签会保存在本项目。</p>}</section>
  </>;
}
