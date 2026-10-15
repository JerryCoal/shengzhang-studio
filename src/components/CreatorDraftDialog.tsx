import { hasBuiltinPageAssistant } from '../../server/platform-catalog.mjs';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Monitor, X } from 'lucide-react';
import { Modal, Field, Channel } from '../components';
import { hasDesktopCreator, desktopSessionToken, type PublicationReceipt } from '../desktop';
import { useStudio } from '../context';
import { prepareExport } from '../export';
import type { Asset, Publication } from '../types';
import { CREATOR_URLS } from '../../server/content-export.mjs';

export function CreatorDraftDialog({content,onClose}:{content:Asset|Publication;onClose:()=>void}) {
  const {project,state,mutate,refresh,run,busy}=useStudio();
  const platform='channel' in content?content.channel:content.platform;
  const accounts=state.accounts.filter(a=>a.platform===platform);
  const [accountId,setAccountId]=useState('accountId' in content?content.accountId:accounts[0]?.id||'');
  const [recordId,setRecordId]=useState('accountId' in content?content.id:'');
  const record=project?.publications.find(p=>p.id===recordId);
  const [receipt,setReceipt]=useState<PublicationReceipt|null>(null),[checked,setChecked]=useState(false);
  const locked=record?.delivery&&record.delivery.phase!=='reset',url=receipt?.url||record?.delivery?.url;
  const [title,setTitle]=useState(content.title),[body,setBody]=useState(content.body),[opening,setOpening]=useState(false),[message,setMessage]=useState('');
  const mounted=useRef(true),maxTitle=20;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void window.studioDesktop?.cancelCreatorDraft?.();};},[]);
  const supported=['image/png','image/jpeg','image/webp','video/mp4'].includes(content.mime);
  const valid=title.trim()&&[...title].length<=maxTitle&&[...body].length<=1000&&supported&&accountId;
  async function open(){
    setOpening(true);setMessage('');
    try {
      if(!project)throw Error('请先选择项目');
      if(!hasBuiltinPageAssistant(platform))throw Error('此平台请使用 MCP 投送或导出素材包后在官方平台发布');
      const prepared=await prepareExport(content,content.mime==='image/webp'?'png':'original');
      let id=recordId;
      if(!id&&'channel' in content){
        const existing=project.publications.find(p=>p.assetId===content.id&&p.assetRevision===content.revision&&p.accountId===accountId&&p.status!=='cancelled');
        if(existing?.status==='published')throw Error('此版本已经登记发布，请查看已有作品，避免重复投稿');
        id=existing?.id||(await mutate<Publication>(`/projects/${project.id}/publications`,'POST',{assetId:content.id,accountId,scheduledAt:new Date().toISOString()})).result.id;
        setRecordId(id);
      }
      const result=await window.studioDesktop!.openCreatorDraft({platform,title,body,mime:prepared.mime,mediaData:prepared.mediaData,sessionToken:desktopSessionToken(),projectId:project.id,publicationId:id});
      if(!mounted.current)return;
      if(result.error)throw Error(result.error);
      if(result.receipt){setReceipt(result.receipt);setMessage('平台已返回提交回执。请核对实际账号和审核状态，再登记为已发布。');}
      else if(result.attempted)setMessage('本条已尝试提交，但未取得可核验回执。请先查看官方作品列表；确认没有发布成功后才可解锁重试。');
      else if(!result.cancelled)setMessage('草稿操作已结束。只有点击并确认“提交发布”才会由助手点击发布按钮；手动发布的作品可回填链接登记。');
      await refresh();
    }catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:'未能打开发布助手，请使用导出素材。');}
    finally{if(mounted.current)setOpening(false);}
  }
  return <Modal title="官方页面发布助手" description="登录 → 自动上传与填写 → 核对并确认提交 → 保存回执。计划时间只作待办，不会无人值守定时投稿。" onClose={onClose} wide>
    <Field label="关联发布账号" hint="这是工作台的记录名称，请同时核对官方页面实际登录的账号。首次打开助手会建立发布待办。"><select disabled={opening||!!recordId} value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></Field>
    <div className="creator-draft-preview"><div className="creator-draft-media">{content.mime.startsWith('image/')?<img src={content.mediaData} alt="本次发布素材"/>:<video src={content.mediaData} controls preload="metadata"/>}</div><div><Channel platform={platform}/><Field label={`本次标题 · ${[...title].length} / ${maxTitle}`} hint="可在这里缩短标题；修改仅用于本次上传，不覆盖成品。"><input disabled={opening} value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label={`本次正文 · ${[...body].length} / 1000`} hint="话题和 @ 提及请在平台选择对应条目；纯文字不一定会成为有效标签。"><textarea rows={8} disabled={opening} value={body} onChange={e=>setBody(e.target.value)}/></Field></div></div>
    {!supported&&<p className="info-box">当前格式尚不能直接上传。请在“导出素材”中转换图片为 PNG / JPG；视频需使用 MP4。原始成品保留。</p>}
    <p className="small-note">同一次工作台登录中，发布与采集可复用平台登录。退出工作台、刷新主窗口或退出应用后清理；不会把平台密码或 Cookie 写入项目文件。</p>
    {message&&<p role="status" className="info-box">{message}</p>}
    {url&&<p className="info-box"><a href={url} target="_blank" rel="noreferrer">打开平台返回的作品链接 <ExternalLink size={14}/></a> · 平台接受提交不等于审核通过。</p>}
    {locked&&!opening&&record?.status!=='published'&&<div className="info-box"><p>{record?.delivery?.phase==='submitted'?'提交回执已保存，请核对后登记结果。':'此待办有一次结果未确定的提交。请先检查平台作品列表。'}</p><label className="checkbox-row"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>{url?'我已核对链接的作品与本次内容、账号一致，确认发布成功':'我已检查平台，确认本条没有发布成功，可以重新尝试'}</label><button className="button small" disabled={!checked||busy} onClick={()=>void run(async()=>{if(url){await mutate(`/projects/${project!.id}/publications/${recordId}/confirm`,'POST',{url,confirmed:true});onClose();}else{await mutate(`/projects/${project!.id}/publications/${recordId}/delivery`,'POST',{action:'reset',confirmedNotPublished:true});setChecked(false);setMessage('已解锁，请确认原因后重新操作。');}})}>{url?'登记发布结果':'解锁这条待办'}</button></div>}
    {!hasDesktopCreator()&&<p className="info-box">应用内发布助手需要新版 Windows 桌面端；浏览器版可继续导出素材并前往官方创作中心。</p>}
    <div className="modal-actions"><a className="button" href={CREATOR_URLS[platform]} target="_blank" rel="noreferrer">浏览器打开 <ExternalLink size={14}/></a>{opening?<button className="button" onClick={()=>void window.studioDesktop?.cancelCreatorDraft()}><X size={15}/>关闭助手</button>:<button className="button" onClick={onClose}>返回</button>}<button className="button primary" disabled={opening||!valid||!hasDesktopCreator()||!hasBuiltinPageAssistant(platform)} onClick={()=>void open()}><Monitor size={16}/>{opening?'正在官方页面操作…':'打开官方发布助手'}</button></div>
  </Modal>;
}
