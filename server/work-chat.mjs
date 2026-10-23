import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const identifier = z.string().min(1).max(160), roles = new Set(['xiaohongshu-copy','douyin-research','douyin-script']);
const scopeKey = values => [...new Set(values || [])].sort().join('\n');
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status, noCharge: true }); };
const schema = z.object({ text: z.string().trim().min(1).max(16000), accountIds: z.array(identifier).max(20).refine(ids => new Set(ids).size === ids.length), taskId: identifier.optional(), replyToRunId: identifier.optional(), intent: z.enum(['plan','images','publish']).default('plan'), idempotencyKey: z.string().min(8).max(160) }).strict();
export function publicControllerMessage(row) { return { id: row.id, role: 'user', text: row.text, intent: row.intent, projectId: row.projectId, accountIds: [...row.accountIds], rootMessageId: row.rootMessageId, ...(row.taskId ? {taskId: row.taskId} : {}), ...(row.replyToRunId ? {replyToRunId: row.replyToRunId} : {}), ...(row.planningRunId ? {planningRunId: row.planningRunId} : {}), createdAt: row.createdAt, source: 'controller-chat' }; }
export function createWorkChat({db, owner, owned, project, once, state}) {
  function accounts(ids) { const workspace = state(); if (!workspace || !Array.isArray(workspace.accounts)) fail('暂时无法核对账号范围',503); if (ids.some(id => !workspace.accounts.some(account => account.id === id))) fail('所选账号已不存在，请重新选择',409); }
  function targetTask(projectId, taskId) {
    if (!taskId) return null;
    const task = owned('task',taskId); if (task.projectId !== projectId || task.deletedAt || !roles.has(task.role)) fail('目标任务已删除或不属于当前项目',409);
    const run = owned('run',task.latestRunId); if (run.taskId !== task.id || run.projectId !== projectId) fail('目标任务运行归属不一致',409);
    return {task,run};
  }
  function planningRun(projectId, runId) { const run = owned('run',runId), task = owned('task',run.taskId); if (run.kind !== 'planning' || run.projectId !== projectId || task.projectId !== projectId || task.deletedAt) fail('只能续接当前项目中未删除的总控规划',409); return run; }
  function read(projectId,messageId) { project(projectId); const row = owned('controller-message',messageId); if (row.projectId !== projectId || row.role !== 'user') fail('总控消息不属于当前项目',409); return row; }
  function get(projectId,messageId) { const row = read(projectId,messageId); accounts(row.accountIds); targetTask(projectId,row.taskId); if (row.replyToRunId) planningRun(projectId,row.replyToRunId); return publicControllerMessage(row); }
  function send(projectId,body) {
    project(projectId); const data = schema.parse(body); accounts(data.accountIds);
    const result = once(`controller-message:${projectId}`,data.idempotencyKey,{projectId,...data},() => {
      let taskId=data.taskId||'', parent=null;
      if (data.replyToRunId) {
        const reply=planningRun(projectId,data.replyToRunId);
        if (!['succeeded','failed','cancelled'].includes(reply.status)) fail('上一轮规划尚未结束或结果待核对，请先处理原运行',409);
        const previousAccounts=reply.input?.accountIds||[];
        if (previousAccounts.length && scopeKey(previousAccounts)!==scopeKey(data.accountIds)) fail('账号范围已变化，请作为新需求发送；旧任务保持原账号',409);
        if (reply.controllerMessageId) parent=read(projectId,reply.controllerMessageId);
        const previousTaskId=reply.input?.sourcePlan?.taskId||parent?.taskId||'';
        if (taskId && previousTaskId && taskId!==previousTaskId) fail('补充回复不能改到另一项任务',409);
        taskId ||= previousTaskId;
      }
      const target=targetTask(projectId,taskId);
      if (target) { const accountId=target.task.accountId||target.run.node?.connectionAccountId||''; if (!accountId||!data.accountIds.includes(accountId)) fail('请选择目标任务原先固定的账号',409); if (data.text.length>8000) fail('单次任务修订请控制在8000字以内'); }
      const id=randomUUID(); let rootMessageId=id;
      if (parent) { const root=read(projectId,parent.rootMessageId); if (root.rootMessageId!==root.id) fail('原会话关联不完整',409); rootMessageId=root.id; }
      const row={id,ownerId:owner(),projectId,role:'user',text:data.text,intent:data.intent,accountIds:[...data.accountIds],rootMessageId,taskId,replyToRunId:data.replyToRunId||'',planningRunId:'',createdAt:new Date().toISOString(),source:'controller-chat'};
      db.put('controller-message',row); return {message:publicControllerMessage(row)};
    });
    return {message:get(projectId,result.message.id)};
  }
  function replyText(run) {
    if (run.planningQuestion) return String(run.planningQuestion).slice(0,2000);
    if (run.artifact) { const artifact=owned('artifact',`${run.artifact.id}:${run.artifact.version}`); if (artifact.projectId!==run.projectId||artifact.taskId!==run.taskId||artifact.runId!==run.id||artifact.kind!=='plan') fail('总控回执归属不一致',409); return `${artifact.candidate?'尚未采用的候选计划':'待确认计划，不代表批准执行'}\n${artifact.body||''}`.slice(0,2000); }
    return run.status==='failed'?'上一轮规划未完成，请根据补充重新拟定待确认方案。':'上一轮已结束；执行与发布仍需分别批准。';
  }
  function planningContext(projectId,message) {
    const current=read(projectId,message.id); get(projectId,current.id); if(current.intent!=='plan') fail('配图或发布消息不属于规划请求',409);
    const root=read(projectId,current.rootMessageId); if(root.rootMessageId!==root.id) fail('会话根记录不完整',409);
    const turns=[],seen=new Set([current.id]); let cursor=current;
    for(let depth=0;cursor.replyToRunId&&depth<32;depth++) {
      const run=planningRun(projectId,cursor.replyToRunId),assistant={id:`${run.id}:reply`,role:'assistant',text:replyText(run)};
      if(!run.controllerMessageId) { turns.unshift({id:`${run.id}:legacy-request`,role:'user',text:String(run.input?.goal||run.node?.requirement||'').slice(0,16000)},assistant); break; }
      const previous=read(projectId,run.controllerMessageId); if(previous.rootMessageId!==root.id||seen.has(previous.id)) fail('总控会话引用循环或归属错误',409);
      seen.add(previous.id); turns.unshift({id:`${previous.id}:request`,role:'user',text:previous.text},assistant); cursor=previous;
    }
    if(!turns.length)return [];
    let first={id:`${root.id}:request`,role:'user',text:root.text};
    if(root.replyToRunId) { const seed=planningRun(projectId,root.replyToRunId); if(!seed.controllerMessageId)first={id:`${seed.id}:legacy-request`,role:'user',text:String(seed.input?.goal||seed.node?.requirement||'')}; }
    return [first,...turns.filter(turn=>turn.id!==first.id).slice(-5)].map((turn,index)=>({role:turn.role,text:String(turn.text).slice(0,index===0?16000:2000)}));
  }
  return {send,get,planningContext};
}
