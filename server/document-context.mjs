import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const DOCUMENT_CONTEXT_MAX_CHARS = 24000;
export const DOCUMENT_CONTEXT_MAX_DOCUMENTS = 8;
export const DOCUMENT_CONTEXT_KINDS = ['fact', 'audience', 'use_case', 'price_terms', 'brand_rule', 'style_note'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const purposeOf = doc => doc.purpose || 'product_facts';
const evidenceSchema = z.object({ documentId: z.string().min(1).max(100), chunk: z.number().int().positive(), quote: z.string().trim().min(4).max(600) }).strict();
const resultSchema = z.object({
  items: z.array(z.object({ kind: z.enum(DOCUMENT_CONTEXT_KINDS), text: z.string().trim().min(1).max(500), evidence: z.array(evidenceSchema).min(1).max(2) }).strict()).max(20),
  missing: z.array(z.string().trim().min(1).max(300)).max(8),
}).strict();
const str = { type: 'string' };
const obj = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
export const documentContextDefinition = {
  instructions: '仅输出 items、missing。items 每项含 kind、text、evidence；evidence 每项含 documentId、chunk、quote。quote 必须逐字来自对应输入段落。没有依据的字段放 missing，不生成事实。',
  schema: obj({ items: { type: 'array', items: obj({ kind: { type: 'string', enum: DOCUMENT_CONTEXT_KINDS }, text: str, evidence: { type: 'array', items: obj({ documentId: str, chunk: { type: 'integer' }, quote: str }) } }) }, missing: { type: 'array', items: str } }),
  validate: validateDocumentContext,
};

function sourceDocuments(project, ids) {
  const selected = z.array(z.string().min(1).max(100)).min(1).max(DOCUMENT_CONTEXT_MAX_DOCUMENTS).parse(ids);
  if (new Set(selected).size !== selected.length) fail('请勿重复选择同一份文档');
  return [...selected].sort().map(id => {
    const doc = (project.corpus || []).find(item => item.id === id);
    if (!doc || !doc.enabled) fail('所选文档已删除或停用，请重新选择', 409);
    return { id: doc.id, name: doc.name, purpose: purposeOf(doc), text: doc.text, chunks: doc.chunks };
  });
}
const fingerprint = docs => createHash('sha256').update(JSON.stringify(docs)).digest('hex');
export function documentContextPayload(project, ids) {
  const documents = sourceDocuments(project, ids);
  if (documents.reduce((n, doc) => n + doc.text.length, 0) > DOCUMENT_CONTEXT_MAX_CHARS) fail('每次资料提炼最多 24,000 字符，请减少选择或拆分文档；不会截断后假装已读全文');
  const sourceFingerprint = fingerprint(documents);
  return { project: { brand: project.brief.brand, product: project.brief.product, goal: project.brief.goal }, contextRevision: project.documentContext?.revision || 0, sourceFingerprint,
    documents: documents.map(({ text: _, ...doc }) => doc) };
}
export function validateDocumentContext(value, payload) {
  const result = resultSchema.parse(value);
  for (const item of result.items) for (const evidence of item.evidence) {
    const doc = payload.documents.find(doc => doc.id === evidence.documentId);
    const chunk = doc?.chunks.find(chunk => chunk.index === evidence.chunk);
    if (!chunk || !chunk.text.includes(evidence.quote)) fail('资料卡引用没有对应原文，结果未保存；请重新提炼或人工整理', 502);
    const allowed = doc.purpose === 'style_sample' ? ['style_note'] : doc.purpose === 'brand_guidelines' ? ['brand_rule'] : ['fact', 'audience', 'use_case', 'price_terms'];
    if (!allowed.includes(item.kind)) fail('资料用途与提炼结果不符，文风样本不能成为产品事实', 502);
  }
  return result;
}
export function saveDocumentContextCandidate(project, value, model, payload) {
  const checked = validateDocumentContext(value, payload);
  const candidateId = randomUUID();
  const candidate = { id: candidateId, model, createdAt: new Date().toISOString(), sourceFingerprint: payload.sourceFingerprint, documentIds: payload.documents.map(doc => doc.id),
    items: checked.items.map((item, i) => ({ ...item, id: `${candidateId}:${i + 1}`, evidence: item.evidence.map(e => {
      const doc = payload.documents.find(doc => doc.id === e.documentId), chunk = doc.chunks.find(chunk => chunk.index === e.chunk);
      return { ...e, name: doc.name, purpose: doc.purpose, ...(chunk.page ? { page: chunk.page } : {}), ...(chunk.heading ? { heading: chunk.heading } : {}) };
    }) })), missing: checked.missing };
  project.documentContext = { ...project.documentContext, revision: (project.documentContext?.revision || 0) + 1, candidate };
  return candidate;
}
export function documentContextCurrent(project, card) {
  if (!card) return false;
  try { return fingerprint(sourceDocuments(project, card.documentIds)) === card.sourceFingerprint; } catch { return false; }
}
export function documentContextStatus(project) {
  const context = project.documentContext || { revision: 0 };
  return { ...context, candidateCurrent: documentContextCurrent(project, context.candidate), adoptedCurrent: documentContextCurrent(project, context.adopted) };
}
export function adoptDocumentContext(project, input) {
  const data = z.object({ candidateId: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative(), itemIds: z.array(z.string().min(1).max(100)).min(1).max(20), confirmed: z.literal(true) }).strict().parse(input);
  const context = project.documentContext;
  if (!context || context.revision !== data.expectedRevision || context.candidate?.id !== data.candidateId) fail('资料卡已更新，请重新核对后采纳', 409);
  if (!documentContextCurrent(project, context.candidate)) fail('来源文档已变化，请重新提炼后采纳', 409);
  const ids = new Set(data.itemIds), items = context.candidate.items.filter(item => ids.has(item.id));
  if (items.length !== data.itemIds.length || ids.size !== data.itemIds.length) fail('采纳条目无效，请重新选择');
  context.adopted = { ...structuredClone(context.candidate), items: structuredClone(items), adoptedAt: new Date().toISOString() };
  context.revision++;
  return documentContextStatus(project);
}
export function clearAdoptedDocumentContext(project, input) {
  const { expectedRevision } = z.object({ expectedRevision: z.number().int().nonnegative() }).strict().parse(input);
  if ((project.documentContext?.revision || 0) !== expectedRevision) fail('资料卡已更新，请刷新后再操作', 409);
  project.documentContext = { ...project.documentContext, revision: expectedRevision + 1 };
  delete project.documentContext.adopted;
  return documentContextStatus(project);
}
export function adoptedDocumentContext(project) {
  const card = project.documentContext?.adopted;
  if (!documentContextCurrent(project, card)) return null;
  const { id, adoptedAt, items, missing } = card;
  return { id, adoptedAt, items: structuredClone(items), missing: [...missing] };
}
export function documentStyleReferences(project) {
  // Style is a separate input and never participates in the factual retrieval index.
  const adopted = adoptedDocumentContext(project);
  const acceptedIds = new Set((adopted?.items || []).filter(item => item.kind === 'style_note').flatMap(item => item.evidence.map(source => source.documentId)));
  return (project.corpus || []).filter(doc => acceptedIds.has(doc.id) && doc.enabled && doc.purpose === 'style_sample').slice(0, 3).map(doc => ({
    documentId: doc.id, name: doc.name, purpose: 'style_sample', text: doc.text.slice(0, 1200), excerpt: doc.text.length > 1200,
  }));
}
