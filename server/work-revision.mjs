import { z } from 'zod';
const identifier = z.string().min(1).max(160);
export const revisionReferenceSchema = z.object({ taskId: identifier, artifactId: identifier, version: z.number().int().positive() }).strict();
export const currentArtifactSchema = revisionReferenceSchema.extend({ nodeId: identifier, runId: identifier, projectId: identifier, accountId: identifier, kind: z.enum(['copy','script']), title: z.string().max(200), body: z.string().max(8000), prompt: z.string().max(8000), scenes: z.array(z.string().max(1000)).max(3) }).strict();
const fail = message => { throw Object.assign(Error(message), { status: 409, noCharge: true }); };
/** Read only the authoritative task's adopted manuscript; never private messages. */
export function readWorkRevision({ db, owned, projectId, node, taskId, reference, requireCurrent = true }) {
  if (!reference) return null;
  const ref = revisionReferenceSchema.parse(reference);
  if (!taskId || ref.taskId !== taskId || ref.artifactId !== taskId) fail('修订来源必须是当前任务自己的成果');
  const task = owned('task', taskId);
  if (task.projectId !== projectId || task.nodeId !== node.id || task.role !== node.role || task.accountId !== node.accountId || requireCurrent && task.deletedAt) fail('修订来源的任务、项目或固定账号不一致');
  const kind = node.role === 'xiaohongshu-copy' ? 'copy' : node.role === 'douyin-script' ? 'script' : '';
  if (!kind) fail('当前稿件修订仅适用于图文文案或视频脚本');
  const head = db.get('artifact-head', taskId);
  if (!head || head.ownerId !== task.ownerId || requireCurrent && head.version !== ref.version) fail('当前稿件版本已变化，请重新核对修改要求');
  const artifact = owned('artifact', `${ref.artifactId}:${ref.version}`), sourceRun = owned('run', artifact.runId);
  if (artifact.candidate || artifact.kind !== kind || artifact.taskId !== taskId || artifact.projectId !== projectId || artifact.accountId !== node.accountId || sourceRun.taskId !== taskId || sourceRun.projectId !== projectId || sourceRun.node?.role !== node.role || sourceRun.node?.accountId !== node.accountId) fail('修订来源不是当前任务已经采用的对应账号稿件');
  if (typeof artifact.body !== 'string' || artifact.body.length > 8000 || typeof artifact.title !== 'string' || artifact.title.length > 200) fail('当前稿件超出本轮修订范围，请先缩短稿件；本次未发起收费请求');
  return currentArtifactSchema.parse({ ...ref, nodeId: node.id, runId: sourceRun.id, projectId, accountId: node.accountId, kind, title: artifact.title, body: artifact.body, prompt: artifact.structured?.prompt || '', scenes: artifact.structured?.scenes || [] });
}
export function revisionMetadata(source) { if (!source) return null; const { body, prompt, scenes, ...metadata } = source; return metadata; }
