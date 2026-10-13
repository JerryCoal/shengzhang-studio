// Independent adapter for responses already requested by the official page.
// No cookie extraction, request replay, signing code, or author profiles.
const {metricRequest,parseMetricResponse} = require('./platform-data.cjs');
function commentRequest(value, work) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !work?.itemId) return null;
    if (work.platform === 'xiaohongshu' && ['www.xiaohongshu.com','edith.xiaohongshu.com'].includes(u.hostname)) {
      const reply = u.pathname === '/api/sns/web/v2/comment/sub/page';
      if ((!reply && u.pathname !== '/api/sns/web/v2/comment/page') || u.searchParams.get('note_id') !== work.itemId) return null;
      return { platform:work.platform, itemId:work.itemId, reply, ...(reply?{parentCommentId:u.searchParams.get('root_comment_id')}: {}) };
    }
    if (work.platform === 'douyin' && u.hostname === 'www.douyin.com') {
      const reply = u.pathname === '/aweme/v1/web/comment/list/reply/';
      if ((!reply && u.pathname !== '/aweme/v1/web/comment/list/') || u.searchParams.get(reply?'item_id':'aweme_id') !== work.itemId) return null;
      return { platform:work.platform, itemId:work.itemId, reply, ...(reply?{parentCommentId:u.searchParams.get('comment_id')}: {}) };
    }
  } catch {}
  return null;
}
function parseCommentResponse(body, request) {
  if (typeof body !== 'string' || body.length > 5_000_000 || !request) return [];
  let value; try { value=JSON.parse(body); } catch { return []; }
  const xhs=request.platform==='xiaohongshu';
  if (!value || (xhs ? value.success!==true : value.status_code!==0)) return [];
  const comments=xhs?value.data?.comments:value.comments, rows=[];
  if (!Array.isArray(comments)) return rows;
  function add(item,reply,parent) {
    if (!item || rows.length>=1000) return;
    const workId=xhs?item.note_id:item.aweme_id;
    if (workId!=null && String(workId)!==request.itemId) return;
    const text=xhs?item.content:item.text, id=xhs?item.id:item.cid;
    if (typeof text!=='string'||!text.trim()||text.length>4000||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(id)) return;
    const count=Number(xhs?item.like_count:item.digg_count), rawTime=item.create_time;
    const millis=typeof rawTime==='number'?rawTime*(rawTime<1e12?1000:1):0;
    const timeLabel=millis>=946684800000&&millis<=Date.now()+86400000?new Date(millis).toISOString():'';
    const row={text,platformCommentId:id,likes:Number.isSafeInteger(count)&&count>=0&&count<=1e9?count:null,timeLabel,isReply:reply};
    if(timeLabel)row.commentAt=timeLabel;
    if(reply&&typeof parent==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(parent))row.parentCommentId=parent;
    rows.push(row);
  }
  for (const item of comments.slice(0,1000)) {
    add(item,request.reply,request.parentCommentId);
    const replies=xhs?item?.sub_comments:item?.reply_comment;
    if (Array.isArray(replies)) for(const reply of replies.slice(0,1000)) add(reply,true,xhs?item.id:item.cid);
  }
  return rows;
}
function watchCommentResponses(page,getWork) {
  const pending=new Map(); let queue=[],metric=null,closed=false,available=false,epoch=0;
  const valid=meta=>{try{const w=getWork();return w.platform===meta.platform&&w.itemId===meta.itemId;}catch{return false;}};
  const onNavigation=(_e,_url,_inPlace,main)=>{if(main){epoch++;pending.clear();queue=[];metric=null;}};
  const onMessage=async(_event,method,p)=>{
    if(closed)return;
    if(method==='Network.responseReceived') {
      if(p.response?.status!==200||pending.size>=40)return;
      let meta;try{const work=getWork();meta=commentRequest(p.response.url,work)||metricRequest(p.response.url,work);}catch{return;}
      if(meta)pending.set(p.requestId,{meta,epoch});
    } else if(method==='Network.loadingFailed')pending.delete(p.requestId);
    else if(method==='Network.loadingFinished') {
      const entry=pending.get(p.requestId);pending.delete(p.requestId);
      if(!entry||p.encodedDataLength>5_000_000||!valid(entry.meta))return;
      try {
        const data=await page.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId});
        if(closed||entry.epoch!==epoch||!valid(entry.meta))return;
        const body=data.base64Encoded?Buffer.from(data.body,'base64').toString('utf8'):data.body;
        if(entry.meta.kind==='metrics'){const next=parseMetricResponse(body,entry.meta);if(next)metric={row:next,meta:entry.meta};return;}
        const rows=parseCommentResponse(body,entry.meta);
        // Keep only a bounded, sanitized page buffer until the user starts/reads.
        queue.push(...rows.map(row=>({row,meta:entry.meta})));if(queue.length>1000)queue=queue.slice(-1000);
      } catch { /* DOM capture remains available when the browser evicts a response. */ }
    }
  };
  try {
    page.debugger.attach('1.3');available=true;
    page.debugger.on('message',onMessage);
    page.on('did-start-navigation',onNavigation);
    void page.debugger.sendCommand('Network.enable',{maxTotalBufferSize:8_000_000,maxResourceBufferSize:5_000_000}).catch(()=>{available=false;});
  } catch {}
  return { available:()=>available,metrics:()=>metric&&valid(metric.meta)?metric.row:null,drain:()=>{const rows=queue.filter(entry=>valid(entry.meta)).map(entry=>entry.row);queue=[];return rows;},close:()=>{
    closed=true;pending.clear();queue=[];
    page.removeListener('did-start-navigation',onNavigation);page.debugger?.removeListener('message',onMessage);
    try{if(page.debugger.isAttached())page.debugger.detach();}catch{}
  }};
}
module.exports={commentRequest,parseCommentResponse,watchCommentResponses};
