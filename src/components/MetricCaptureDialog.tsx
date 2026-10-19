import {useEffect,useRef,useState} from 'react';
import {useStudio} from '../context';
import {Field,Modal} from '../components';
import {desktopSessionToken,type CommentCaptureResult} from '../desktop';
import {METRICS} from '../../server/operating-data.mjs';
import {commentSource,sameCommentWork} from '../../desktop/comment-source.mjs';

export function MetricCaptureDialog({onClose}:{onClose:()=>void}) {
  const {project,mutate,run,busy,notify,target}=useStudio();
  const works=project!.publications.filter(p=>p.status==='published'&&!p.sample&&p.url);
  const [publicationId,setPublicationId]=useState(works.find(p=>p.id===target.publicationId)?.id||works[0]?.id||''),[capture,setCapture]=useState<CommentCaptureResult|null>(null);
  const [reading,setReading]=useState(false),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false);
  const mounted=useRef(true),pub=works.find(p=>p.id===publicationId);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void window.studioDesktop?.cancelCommentCapture?.();};},[]);
  async function read(){
    if(!pub)return;setReading(true);setMessage('');setConfirmed(false);setCapture(null);
    try{
      const result=await window.studioDesktop!.openCommentCapture({url:pub.url,limit:50,includeReplies:false,sessionToken:desktopSessionToken()});
      if(!mounted.current||result.cancelled)return;
      if(result.error)throw Error(result.error);
      if(!result.metrics||!result.sourceUrl)throw Error('平台本次未提供可识别的作品数据。请使用“记录作品数据”手动填写，未知项留空。');
      const work=commentSource(result.sourceUrl);
      if(!sameCommentWork(commentSource(pub.url),work)||work.itemId!==result.metrics.itemId||pub.platform!==result.metrics.platform)throw Error('采集数据与所选作品不一致，已停止导入');
      setCapture(result);
    }catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:'未能读取作品数据');}
    finally{if(mounted.current)setReading(false);}
  }
  return <Modal title="采集作品数据" description="打开自己的作品，登录后点击“读取作品数据”，返回核对再保存。只收集该作品的累计指标。" onClose={onClose}>
    <Field label="已发布作品"><select value={publicationId} disabled={reading||busy} onChange={e=>{setPublicationId(e.target.value);setCapture(null);setConfirmed(false);}}>{works.map(p=><option key={p.id} value={p.id}>{p.title} · {p.accountName}</option>)}</select></Field>
    <p className="small-note">小红书通常仅提供互动数据；阅读 / 播放量取决于页面返回字段，缺失时显示“—”。不会将近似显示的“1 万+”推算为精确数值。</p>
    <button className="button" disabled={!pub||reading||busy} onClick={()=>void read()}>{reading?'作品窗口已打开…':'打开作品并采集'}</button>
    {message&&<p className="info-box" role="status">{message}</p>}
    {capture?.metrics&&<><div className="metric-summary-grid">{METRICS.map(m=><div key={m.key}><span>{m.label}</span><b>{capture.metrics!.metrics[m.key]?.toLocaleString()??'—'}</b></div>)}</div><p className="small-note">采集时间：{new Date(capture.metrics.capturedAt).toLocaleString()}</p><label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对这是所选自有作品的数据</label></>}
    <div className="modal-actions"><button className="button" onClick={onClose}>关闭</button><button className="button primary" disabled={busy||reading||!confirmed||!capture?.metrics} onClick={()=>void run(async()=>{await mutate(`/projects/${project!.id}/metrics`,'POST',{publicationId,capturedAt:capture!.metrics!.capturedAt,metrics:capture!.metrics!.metrics,source:'browser-page',sourceUrl:capture!.sourceUrl,confirmed:true,note:'来自官方作品页面返回的数据，经用户核对'});notify('作品数据已保存为独立快照');onClose();})}>保存这次采集</button></div>
  </Modal>;
}
