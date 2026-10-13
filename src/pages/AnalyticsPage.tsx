import { MetricCaptureDialog } from '../components/MetricCaptureDialog';
import { hasDesktopCommentCapture } from '../desktop';
import { useState } from 'react';
import { ArrowRight, Database, Download, LineChart, Pencil, Plus } from 'lucide-react';
import { useStudio } from '../context';
import { download } from '../api';
import type { MetricSnapshot } from '../types';
import { Channel, date, Empty, Field, Modal, NeedProject, PageTitle, Pill } from '../components';
import { METRICS, latestMetricSnapshots, operatingSummary } from '../../server/operating-data.mjs';
import '../operations-lab.css';

function localTime(value: string) { const d = new Date(value); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,19); }
function MetricEditor({ row, onClose }: { row?: MetricSnapshot; onClose: () => void }) {
  const { project, mutate, run, busy, notify } = useStudio();
  const works = project!.publications.filter(p=>p.status==='published');
  const [publicationId,setPublicationId] = useState(row?.publicationId || works.find(p=>!p.sample)?.id || works[0]?.id || '');
  const [capturedAt,setCapturedAt] = useState(localTime(row?.capturedAt || new Date().toISOString())), [note,setNote] = useState(row?.note || '');
  const [values,setValues] = useState<Record<string,string>>(()=>Object.fromEntries(METRICS.map(m=>[m.key,row?.metrics[m.key]?.toString()??''])));
  return <Modal title={row?'修正这次数据记录':'记录作品数据'} description="从平台作品详情抄录累计数据，未知项留空。这里不会请求平台接口。" onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{await mutate(`/projects/${project!.id}/metrics`,'POST',{...(row?{id:row.id,expectedRevision:row.revision}:{}),publicationId,capturedAt:row && capturedAt===localTime(row.capturedAt)?row.capturedAt:new Date(capturedAt).toISOString(),metrics:Object.fromEntries(METRICS.map(m=>[m.key,values[m.key].trim()===''?null:Number(values[m.key])])),note});notify('作品数据已保存在本机');onClose();});}}>
      <Field label="已发布作品"><select required disabled={!!row} value={publicationId} onChange={e=>setPublicationId(e.target.value)}>{works.map(p=><option value={p.id} key={p.id}>{p.sample?'[示例] ':''}{p.title}</option>)}</select></Field>
      <Field label="数据采集时间" hint="填写你在平台看到这组累计数值的时间。"><input type="datetime-local" step={1} required value={capturedAt} onChange={e=>setCapturedAt(e.target.value)}/></Field>
      <div className="metric-form">{METRICS.map(m=><Field key={m.key} label={m.label} hint={m.description}><input type="number" min={0} max={1e12} step={1} inputMode="numeric" placeholder="未知，留空" value={values[m.key]} onChange={e=>setValues({...values,[m.key]:e.target.value})}/></Field>)}</div>
      <Field label="数据来源备注"><textarea rows={2} maxLength={1000} placeholder="例如：小红书创作中心，截至今天上午。" value={note} onChange={e=>setNote(e.target.value)}/></Field>
      <div className="info-box">同一作品每次新增一条采集记录。总览只取每个作品最新的一条，不把多个累计快照相加。</div>
      <div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !publicationId || !Object.values(values).some(v=>v.trim()!=='')}>保存数据</button></div>
    </form>
  </Modal>;
}
export function AnalyticsPage() {
  const { project,go } = useStudio();
  const [capturing,setCapturing]=useState(false);
  const [samples,setSamples] = useState(false), [platform,setPlatform] = useState('all'), [tab,setTab] = useState('overview'), [editing,setEditing] = useState<MetricSnapshot|'new'|null>(null);
  if (!project) return <NeedProject/>;
  const publications = project.publications.filter(p=>(samples||!p.sample) && (platform==='all'||p.platform===platform));
  const scoped = {...project,publications}, summary = operatingSummary(scoped,samples), snapshots = latestMetricSnapshots(scoped,samples);
  const ids = new Set(publications.map(p=>p.id)), history = (project.metricSnapshots||[]).filter(r=>ids.has(r.publicationId)).slice().sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));
  const works = publications.filter(p=>p.status==='published');
  return <div className="operations-lab">
    <PageTitle eyebrow="OPERATING DATA" title="让每次运营，留下可比较的数据。" subtitle="先积累作品与评论记录，再逐步连接指标、复盘和下一轮行动。">
      <>{hasDesktopCommentCapture()&&<button className="button" disabled={!project.publications.some(p=>p.status==='published'&&!p.sample&&p.url)} onClick={()=>setCapturing(true)}>从作品采集</button>}</><button className="button" onClick={()=>go('comments')}><ArrowRight size={16}/>评论分析</button><button className="button primary" disabled={!project.publications.some(p=>p.status==='published')} onClick={()=>setEditing('new')}><Plus size={16}/>记录作品数据</button>
    </PageTitle>
    <div className="panel data-scope"><div className="row wrap gap-10"><Pill color="green">本地数据空间</Pill><select aria-label="运营数据平台" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="all">全部平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option></select><label className="checkbox-row"><input type="checkbox" checked={samples} onChange={e=>setSamples(e.target.checked)}/>包含示例数据</label></div><span className="small-note">未知显示“—”；可从官方作品页采集，或手动记录。</span></div>
    <div className="lab-stat-grid">{[['已登记发布',summary.published,'个作品'],['已有数据记录',summary.recorded,`/ ${summary.published} 个作品`],['已导入评论',summary.imported,'条原文'],['有效分析样本',summary.valid,'条，排除无关内容']].map(([label,value,hint])=><article className="panel lab-stat" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</div>
    <div className="lab-tabs" role="tablist" aria-label="运营数据分类">{[['overview','作品表现'],['history','采集记录'],['sources','数据接入规划']].map(([key,label])=><button role="tab" aria-selected={tab===key} className={tab===key?'active':''} key={key} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {tab==='overview'?<>
      <section className="panel metric-overview"><div className="section-heading"><div><h2>最新记录汇总</h2><p className="small-note">每个作品仅取最新采集快照。各作品采集时间可能不同，不作为同一周期的增长比较。</p></div><LineChart size={22}/></div><div className="metric-summary-grid">{summary.metrics.map(m=><div key={m.key}><span>{m.label}</span><b>{m.total===null?'—':m.total.toLocaleString()}</b><small>已知 {m.covered} / {summary.published} 个作品</small></div>)}</div></section>
      <section className="panel"><div className="section-heading"><h2>作品数据台账</h2><span className="small-note">累计数值 · 原始口径保留</span></div>{works.length?<div className="lab-table-scroll"><table className="lab-table"><thead><tr><th>作品</th><th>采集时间</th>{METRICS.map(m=><th key={m.key}>{m.label}</th>)}<th>操作</th></tr></thead><tbody>{works.map(p=>{const row=snapshots.find(r=>r.publicationId===p.id);return <tr key={p.id}><td><div className="metric-work"><Channel platform={p.platform} compact/><b>{p.title}</b>{p.sample&&<Pill color="gray">示例</Pill>}</div></td><td>{row?date(row.capturedAt,true):'尚未记录'}</td>{METRICS.map(m=><td key={m.key}>{row?.metrics[m.key]?.toLocaleString()??'—'}</td>)}<td>{row?<button className="text-button green" onClick={()=>setEditing(row)}>修正</button>:<span className="muted">待采集</span>}</td></tr>;})}</tbody></table></div>:<Empty title="先登记第一条作品" text="发布中心回填真实作品链接后，即可在这里记录数据；示例默认不参与汇总。"><button className="button" onClick={()=>go('publish')}>前往发布中心</button></Empty>}</section>
      <div className="data-boundary"><Database size={19}/><p>评论导入量与平台评论数是不同指标；评论意向不能直接算作线索或成交。本版暂不生成转化率、ROI 或因果判断。</p></div>
    </>:tab==='history'?<section className="panel"><div className="section-heading"><div><h2>每次采集，都有时间和来源</h2><p className="small-note">当前范围 {history.length} 条记录；修正会更新该记录的版本号。</p></div><button className="button small" disabled={!history.length} onClick={()=>download(new Blob([JSON.stringify({format:'shengzhang-operating-data',version:1,project:project.brief.name,exportedAt:new Date().toISOString(),definitions:METRICS,publications:works.map(p=>({id:p.id,title:p.title,platform:p.platform,sample:!!p.sample})),snapshots:history},null,2)],{type:'application/json;charset=utf-8'}),'运营数据记录.json')}><Download size={14}/>导出记录</button></div>{history.length?<div className="metric-history">{history.map(row=><article key={row.id}><div><b>{works.find(p=>p.id===row.publicationId)?.title || '作品记录'}</b><small>{date(row.capturedAt,true)} · {row.source==='browser-page'?'网页采集 · 已核对':'手动记录 / 修正'} · 第 {row.revision} 版</small><p>{METRICS.map(m=>`${m.label} ${row.metrics[m.key]??'—'}`).join(' · ')}</p>{row.note&&<p className="muted">{row.note}</p>}</div><button className="button small" onClick={()=>setEditing(row)}><Pencil size={14}/>修正</button></article>)}</div>:<Empty title="尚未记录作品指标" text="在平台查看作品详情后，点击“记录作品数据”保存这一时间点的累计数据。"/>}</section>:<section className="panel data-roadmap"><h2>已经连接的基础，下一步需要的数据</h2><p className="small-note">以下为功能规划，未接入项不会显示模拟成绩或假装实时更新。</p>{[
      ['可用','发布与内容','作品、平台、策略版本、排期和实际发布登记已关联。'],
      ['可用','评论与复盘','评论主题、情绪、人工核对与采用建议已关联，保留原文依据。'],
      ['可用','作品表现','播放 / 阅读、点赞、评论、收藏和分享，按采集时间保存。'],
      ['可用','平台网页采集','Windows 版读取当前作品的可用互动指标，用户确认后保存。缺失指标可手动补录。'],
      ['待定义','增长与转化','需要明确曝光、点击、线索和成交的业务定义、来源及关联规则。'],
      ['待积累','趋势与实验','积累同一口径的多个时间点后，再做周期对照、异常提示和内容实验。'],
    ].map(([status,title,text])=><article key={title}><Pill color={status==='可用'?'green':status==='手动录入'?'blue':'gray'}>{status}</Pill><div><h3>{title}</h3><p>{text}</p></div></article>)}</section>}
    {capturing&&<MetricCaptureDialog onClose={()=>setCapturing(false)}/>}
    {editing && <MetricEditor row={editing==='new'?undefined:editing} onClose={()=>setEditing(null)}/>}
  </div>;
}
