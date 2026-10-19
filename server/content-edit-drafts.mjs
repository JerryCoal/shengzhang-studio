import { z } from 'zod';
import { assetAccountId } from './workspace-view.mjs';

const id = z.string().min(1).max(160);
const fields = { title: z.string().max(200), body: z.string().max(8000), requirement: z.string().max(4000), knowledgeIds: z.array(id).max(200) };
const schema = z.object({ projectId: id, assetId: id, accountId: z.string().max(160), base: z.object({ revision: z.number().int().nonnegative(), ...fields }).strict(), ...fields }).strict();
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
export const contentEditDraftKey = (projectId, assetId, accountId = '') => JSON.stringify([projectId, assetId, accountId]);
export function readContentEditDraft(state, key) { return structuredClone((state.contentEditDrafts || []).find(row => row.key === key) || null); }
function checkRevision(current, expectedRevision) {
  if ((current?.revision || null) !== expectedRevision) fail('临时编辑已在另一窗口更新，当前输入仍在本页，请复制保留后重新打开。');
}
export function saveContentEditDraft(state, key, input) {
  const { expectedRevision, draft } = z.object({ expectedRevision: z.string().uuid().nullable(), draft: schema }).strict().parse(input);
  if (key !== contentEditDraftKey(draft.projectId, draft.assetId, draft.accountId)) fail('临时编辑的项目、内容或账号不一致。');
  if (JSON.stringify(draft).length > 150000) fail('临时编辑过大，请先另存正文。');
  const asset = state.projects?.find(row => row.id === draft.projectId)?.assets?.find(row => row.id === draft.assetId);
  if (!asset) fail('临时编辑所属内容已移除，当前输入仍在本页，请复制保留。');
  const boundAccount = assetAccountId(asset);
  if (boundAccount !== draft.accountId) fail('内容的绑定账号已变化，当前输入不会存入另一个账号，请复制保留。');
  const rows = state.contentEditDrafts || [], current = readContentEditDraft(state, key);
  checkRevision(current, expectedRevision);
  if (!current && rows.length >= 200) fail('临时编辑已达上限，请保存或清理其他内容后继续。');
  // A stale base revision is deliberately retained as a recoverable conflict;
  // this endpoint never mutates the shared asset or submits a generation job.
  const result = { key, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...draft };
  state.contentEditDrafts = [...rows.filter(row => row.key !== key), result];
  return structuredClone(result);
}
export function removeContentEditDraft(state, key, input) {
  const { expectedRevision } = z.object({ expectedRevision: z.string().uuid().nullable() }).strict().parse(input);
  checkRevision(readContentEditDraft(state, key), expectedRevision);
  state.contentEditDrafts = (state.contentEditDrafts || []).filter(row => row.key !== key);
  return { ok: true };
}
export function mountContentEditDraftRoutes(app, store) {
  app.get('/api/content-edit-drafts/:key', (req, res) => res.json(readContentEditDraft(store.get(), req.params.key)));
  app.put('/api/content-edit-drafts/:key', (req, res) => res.json(store.mutate(state => saveContentEditDraft(state, req.params.key, req.body))));
  app.delete('/api/content-edit-drafts/:key', (req, res) => res.json(store.mutate(state => removeContentEditDraft(state, req.params.key, req.body))));
}
