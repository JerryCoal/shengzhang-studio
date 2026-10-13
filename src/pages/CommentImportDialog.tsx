import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Import, Monitor, X } from 'lucide-react';
import { useStudio } from '../context';
import { Field, Modal } from '../components';
import { desktopSessionToken, hasDesktopCommentCapture, type CapturedComment, type CommentCaptureResult } from '../desktop';
import { commentSource, sameCommentWork } from '../../desktop/comment-source.mjs';
import '../comment-import.css';

export function CommentImportDialog({ onClose }: { onClose: () => void }) {
  const { project, mutate, run, busy, notify } = useStudio();
  const published = project!.publications.filter(p=>p.status==='published');
  const [publicationId,setPublicationId]=useState(published.find(p=>!p.sample)?.id||published[0]?.id||'');
  const [tab,setTab]=useState<'page'|'paste'>(hasDesktopCommentCapture()?'page':'paste');
  const [text,setText]=useState(''),[fileSource,setFileSource]=useState('paste');
  const [capture,setCapture]=useState<CommentCaptureResult|null>(null),[rows,setRows]=useState<CapturedComment[]>([]),[included,setIncluded]=useState<Set<number>>(new Set());
  const [limit,setLimit]=useState(200),[includeReplies,setIncludeReplies]=useState(false),[query,setQuery]=useState('');
  const [reading,setReading]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const mounted=useRef(true), pub=published.find(p=>p.id===publicationId);
  useEffect(()=>{ mounted.current=true; return ()=>{ mounted.current=false; void window.studioDesktop?.cancelCommentCapture?.(); }; },[]);
  let workUrl='',validUrl=false;
  try { if(pub?.url){const source=commentSource(pub.url);workUrl=source.url;validUrl=source.platform===pub.platform;} } catch { /* explain below */ }
  const clear=()=>{setCapture(null);setRows([]);setIncluded(new Set());setConfirmed(false);setError('');setQuery('');};
  async function readPage() {
    if(!pub||!validUrl||reading||!window.studioDesktop?.openCommentCapture)return;
    setReading(true);setError('');
    try {
      const result=await window.studioDesktop.openCommentCapture({url:workUrl,limit,includeReplies,sessionToken:desktopSessionToken()});
      if(!mounted.current)return;
      if(result.error)throw Error(result.error);
      if(result.cancelled)return;
      if(!result.sourceUrl||!result.rows?.length)throw Error('没有读取到文字评论，请展开评论后重试，或使用粘贴导入。');
      if(!sameCommentWork(commentSource(workUrl),commentSource(result.sourceUrl)))throw Error('读取页面与所选作品不一致，未导入。');
      setCapture(result);setRows(result.rows);setIncluded(new Set(result.rows.map((r,i)=>result.includeReplies||!r.isReply?i:-1).filter(i=>i>=0)));setConfirmed(false);setQuery('');
    } catch(e){ if(mounted.current)setError(e instanceof Error?e.message:'读取失败，请使用手动导入'); }
    finally{if(mounted.current)setReading(false);}
  }
  const selected=rows.filter((_row,i)=>included.has(i));
  return <Modal title="把评论带回工作台" description="选择自己的已发布作品，读取后先核对，再导入和去重。" onClose={()=>{void window.studioDesktop?.cancelCommentCapture?.();onClose();}} wide>
    <Field label="关联已发布作品"><select required disabled={busy||reading} value={publicationId} onChange={e=>{setPublicationId(e.target.value);clear();}}><option value="" disabled>请选择作品</option>{published.map(p=><option key={p.id} value={p.id}>{p.sample?'【示例】':''}{p.title} · {p.accountName}</option>)}</select></Field>
    {!published.length&&<p className="info-box">请先在发布中心登记自己作品的链接，再回来导入评论。</p>}
    <div className="tabbar comment-import-tabs"><button type="button" aria-pressed={tab==='page'} className={tab==='page'?'active':''} disabled={reading} onClick={()=>setTab('page')}><Monitor size={15}/>网页辅助采集</button><button type="button" aria-pressed={tab==='paste'} className={tab==='paste'?'active':''} disabled={reading} onClick={()=>setTab('paste')}><FileText size={15}/>粘贴 / 文件</button></div>
    {tab==='page'?<>
      <details className="comment-capture-guide" open={!capture}><summary>打开作品 → 登录 → 一键自动采集 → 核对导入</summary><p>在采集面板点击“开始自动采集”，程序自动滚动评论区、分批暂存。需要时可暂停或返回预览；进度不代表已获取全部评论。</p><p>{pub?.platform==='douyin'?'抖音：会打开独立作品页，可读取文字评论、回复和表情。会在独立详情页自动加载更多评论。':'小红书：自动滚动笔记内的评论区域；开启“包含回复”后自动展开回复。登录和验证码需要你在官方页面完成。'}</p><small>平台登录在独立临时窗口完成，不向工作台提供密码或 Cookie；同一次工作台登录可复用平台会话；退出工作台或应用时清理。</small></details>
      {!hasDesktopCommentCapture()&&<p className="info-box">网页不能直接读取另一网站的登录页面。请使用 Windows 应用的网页采集，或使用这里的粘贴 / 文件导入。已有抖音接口权限时也可使用评论页的官方同步。</p>}
      {pub?.sample&&<p className="info-box">示例记录不能用于采集，请先登记自己的真实作品。</p>}
      {pub&&!pub.sample&&!validUrl&&<p className="info-box">这条记录没有可用的作品详情链接，请先核对发布记录；可使用粘贴导入。</p>}
      <div className="comment-capture-options"><Field label="本次数量上限"><select value={limit} disabled={reading||busy} onChange={e=>setLimit(Number(e.target.value))}><option value={50}>50 条 · 快速查看</option><option value={200}>200 条 · 日常复盘</option><option value={1000}>1,000 条 · 分批读取</option></select></Field><label className="checkbox-row"><input type="checkbox" checked={includeReplies} disabled={reading||busy} onChange={e=>setIncludeReplies(e.target.checked)}/>自动展开并包含回复</label></div>
      <div className="row gap-10 wrap"><button className="button primary" disabled={busy||reading||!pub||pub.sample||!validUrl||!hasDesktopCommentCapture()} onClick={()=>void readPage()}><Monitor size={16}/>{reading?'采集面板已打开…':capture?'再次打开作品采集':'打开作品与采集面板'}</button>{reading&&<button className="button" onClick={()=>void window.studioDesktop?.cancelCommentCapture?.()}><X size={15}/>取消采集</button>}{validUrl&&<a className="button" href={workUrl} target="_blank" rel="noreferrer">用浏览器查看作品 <ExternalLink size={14}/></a>}</div>
      {error&&<p className="info-box error-box" role="alert">{error}</p>}
      {capture&&<div className="captured-preview"><div className="section-heading"><h3>已读取 {rows.length} 条 · 勾选 {included.size} 条</h3><div className="row gap-10 wrap"><button className="text-button" disabled={busy||reading} onClick={()=>{setIncluded(new Set(rows.map((_r,i)=>i)));setConfirmed(false);}}>全选（含回复）</button><button className="text-button" disabled={busy||reading} onClick={()=>{setIncluded(new Set(rows.map((r,i)=>!r.isReply?i:-1).filter(i=>i>=0)));setConfirmed(false);}}>仅一级评论</button><button className="text-button" disabled={busy||reading} onClick={()=>{setIncluded(new Set());setConfirmed(false);}}>全不选</button></div></div>
        <p className="small-note">{capture.mode==='selection'?'选中文本按行分段，可能混入昵称、按钮或日期，请取消勾选这些行。':capture.includeReplies?'已按本次设置勾选评论与回复，可取消不需要的内容。':'本次仅采集一级评论；需要回复时，请重新采集并开启“包含回复”。'} 无文字 / 过长内容已跳过 {capture.skipped||0} 条。图片内容未识别；日期来自平台时间字段或页面显示。</p>
        {capture.metrics&&<p className="capture-stop-note">本次同时识别到作品互动数据。可在“运营数据 → 从作品采集”中核对并记录。</p>}{capture.notice&&<p className="capture-stop-note">{capture.notice}</p>}<Field label="筛选已采集的评论"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入关键词快速核对，筛选不改变勾选结果"/></Field><div className="captured-rows">{rows.map((row,i)=>row.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())&&<label className="captured-row" key={i}><input type="checkbox" checked={included.has(i)} disabled={busy||reading} onChange={e=>{const next=new Set(included);if(e.target.checked)next.add(i);else next.delete(i);setIncluded(next);setConfirmed(false);}}/><span><span className="captured-text">{row.text}</span><small>{row.isReply?'回复':'评论'}{row.timeLabel?` · 页面日期：${row.timeLabel}`:''}{row.likes!==null?` · ${row.likes} 赞`:''}</small></span></label>)}</div>
        <label className="checkbox-row"><input type="checkbox" checked={confirmed} disabled={busy||reading} onChange={e=>setConfirmed(e.target.checked)}/><span>我已核对，这些是所选自有作品的评论，已排除混入的页面文字。</span></label>
      </div>}
      <div className="modal-actions"><button className="button" onClick={onClose}>关闭</button><button className="button primary" disabled={busy||reading||!confirmed||!selected.length||!capture?.sourceUrl} onClick={()=>void run(async()=>{const result=await mutate<{added:number;duplicates:number}>(`/projects/${project!.id}/comments/import`,'POST',{publicationId,source:'browser-page',sourceUrl:capture!.sourceUrl,mode:capture!.mode||'page',confirmed:true,rows:selected});notify(`新增 ${result.result.added} 条评论，跳过 ${result.result.duplicates} 条重复`);onClose();})}><Import size={16}/>导入所选评论</button></div>
    </>:<form onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await mutate<{added:number;duplicates:number}>(`/projects/${project!.id}/comments/import`,'POST',{publicationId,text,source:fileSource});notify(`新增 ${result.result.added} 条评论，跳过 ${result.result.duplicates} 条重复`);onClose();});}}>
      <Field label="原始评论文本" hint="每行一条评论，保留批评与投诉。"><textarea rows={9} required maxLength={120000} value={text} onChange={e=>{setText(e.target.value);setFileSource('paste');}} placeholder="这个产品的尺寸是多少？&#10;希望看到一个使用演示&#10;价格有点贵，想了解具体区别"/></Field>
      <div className="row between wrap"><label className="button file-button"><FileText size={16}/>读取 TXT / MD 文件<input aria-label="导入评论文本文件" type="file" accept=".txt,.md,text/plain" onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{if(file.size>500000)throw Error('请选择 500KB 以内的文本文件');setText(await file.text());setFileSource('file');});e.target.value='';}}/></label><small className="muted">单次最多 1,000 行</small></div><p className="small-note">记录导入时间，不推测发表时间或点赞数；同一作品内重复文字会合并。</p><div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy||!publicationId||!text.trim()}><Import size={16}/>导入并去重</button></div>
    </form>}
  </Modal>;
}
