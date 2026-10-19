import { z } from 'zod';

const identifier = z.string().min(1).max(160);
const taskSchema = z.object({
  id: identifier, workspaceKey: z.string().max(400), projectId: z.string().max(160), projectName: z.string().max(300),
  page: z.string().max(60), accountId: z.string().max(160).optional(), accountName: z.string().max(300).optional(),
  target: z.object({ assetId: identifier.optional(), publicationId: identifier.optional(), accountId: identifier.optional(), requirement: z.string().max(20000).optional(), knowledgeIds: z.array(identifier).max(200).optional(), newContent: z.boolean().optional(), tab: z.string().max(100).optional(), agentId: z.string().max(100).optional(), skillIds: z.array(identifier).max(100).optional(), model: z.string().max(100).optional(), publishingNotes: z.string().max(5000).optional() }).optional(),
  label: z.string().min(1).max(300), status: z.enum(['running', 'pausing', 'paused', 'completed', 'failed', 'interrupted']),
  stage: z.string().max(500).optional(), error: z.string().max(4000).optional(), retained: z.boolean(),
  startedAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(), finishedAt: z.number().finite().nonnegative().optional(),
  checkpoint: z.unknown().optional(),
}).strict();
const fail = message => { const error = new Error(message); error.status = 400; throw error; };

export function taskJournal(state) { return structuredClone(Array.isArray(state.taskJournal) ? state.taskJournal : []); }
export function saveTaskJournal(state, id, input) {
  const task = taskSchema.parse(input);
  if (task.id !== id) fail('任务标识不一致，请重新打开任务中心。');
  if (JSON.stringify(task).length > 150000) fail('临时进度过大，请将素材保存到项目后再继续。');
  if (task.projectId && !state.projects?.some(project => project.id === task.projectId)) fail('任务所属项目不存在，请核对项目。');
  const rows = taskJournal(state), previous = rows.find(row => row.id === id);
  if (previous && (previous.projectId !== task.projectId || previous.page !== task.page || previous.accountId !== task.accountId)) fail('任务归属不能更换，请在目标账号开始新任务。');
  const next = rows.filter(row => row.id !== id);
  next.push(task);
  // Never prune an unfinished job to make space for routine completed history.
  const unfinished = next.filter(row => ['running', 'pausing', 'paused', 'interrupted'].includes(row.status));
  const completed = next.filter(row => !unfinished.includes(row)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  if (unfinished.length > 100) fail('未完成任务过多，请先核对任务中心中的恢复记录。');
  state.taskJournal = [...unfinished, ...completed];
  return structuredClone(task);
}
export function removeTaskJournal(state, id) {
  const task = (state.taskJournal || []).find(row => row.id === id);
  if (task && ['running', 'pausing', 'paused'].includes(task.status)) fail('请先完成当前任务，再移除记录。');
  state.taskJournal = (state.taskJournal || []).filter(row => row.id !== id);
  return { ok: true };
}
export function mountTaskJournalRoutes(app, store) {
  app.get('/api/task-journal', (_req, res) => res.json(taskJournal(store.get())));
  app.put('/api/task-journal/:id', (req, res) => res.json(store.mutate(state => saveTaskJournal(state, req.params.id, req.body))));
  app.delete('/api/task-journal/:id', (req, res) => res.json(store.mutate(state => removeTaskJournal(state, req.params.id))));
}
