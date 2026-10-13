import {z} from 'zod';
import {commentSource} from '../desktop/comment-source.mjs';
const fail = (message,status=400) => Object.assign(Error(message),{status});
export function updatePlatformDelivery(project, publicationId, input) {
  const pub=project.publications.find(p=>p.id===publicationId);
  if(!pub || pub.sample || ['published','cancelled'].includes(pub.status)) throw fail('请选择尚未发布的真实待办');
  if(pub.manualReviewRequired)throw fail('旧版投稿记录尚未核对，请先检查平台作品列表');
  const data=z.discriminatedUnion('action',[
    z.object({action:z.literal('start'),platform:z.enum(['xiaohongshu','douyin']),attemptId:z.string().uuid(),title:z.string().trim().min(1).max(100),body:z.string().max(4000)}).strict(),
    z.object({action:z.literal('receipt'),attemptId:z.string().uuid(),url:z.string().url().max(512)}).strict(),
    z.object({action:z.literal('reset'),confirmedNotPublished:z.literal(true)}).strict(),
  ]).parse(input);
  if(data.action==='start') {
    if(data.platform!==pub.platform)throw fail('助手当前平台与发布待办不一致，未提交');
    if(pub.delivery && pub.delivery.phase!=='reset') throw fail('这条待办已经尝试提交。请先在平台检查是否成功；核实未发布后才能解锁重试。',409);
    pub.delivery={phase:'submitting',attemptId:data.attemptId,startedAt:new Date().toISOString(),title:data.title,body:data.body};
  }else if(data.action==='receipt') {
    if(pub.delivery?.attemptId!==data.attemptId || !['submitting','submitted'].includes(pub.delivery.phase))throw fail('发布尝试已变化，请人工核对回执',409);
    const work=commentSource(data.url);
    if(work.platform!==pub.platform || !work.itemId || !work.canonical)throw fail('回执与发布平台不匹配');
    if(pub.delivery.phase==='submitted' && pub.delivery.url!==work.canonical)throw fail('回执链接发生冲突，请核对平台记录',409);
    pub.delivery={...pub.delivery,phase:'submitted',url:work.canonical,itemId:work.itemId,receivedAt:new Date().toISOString()};
    // API acceptance is not proof of public visibility or moderation approval.
  }else {
    if(!pub.delivery || pub.delivery.phase==='reset')throw fail('没有需要解锁的发布尝试');
    pub.deliveryHistory=[...(pub.deliveryHistory||[]),pub.delivery].slice(-20);
    pub.delivery={phase:'reset',resetAt:new Date().toISOString()};
  }
  return pub;
}
