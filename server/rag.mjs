import { createHash } from 'node:crypto';
import { searchCorpus } from './workflow.mjs';
import { embedTexts, estimateCny, estimateTokens, validVector, QWEN_EMBEDDING_MODEL, QWEN_EMBEDDING_DIMENSIONS, QWEN_EMBEDDING_BATCH_LIMIT, QWEN_EMBEDDING_MAX_TEXT_BYTES } from './qwen-embedding.mjs';

export { estimateCny } from './qwen-embedding.mjs';
export const RAG_MODEL = QWEN_EMBEDDING_MODEL;
export const RAG_DIMENSIONS = QWEN_EMBEDDING_DIMENSIONS;
export const RAG_MAX_CHUNKS = 200;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = chunk => JSON.stringify([chunk.documentId, chunk.chunk]);
const queryText = query => typeof query === 'string' ? query.slice(0, 500).trim() : '';
const embeddingText = chunk => `${chunk.name}\n${chunk.text}`;
export function estimateQueryCny(query) { return estimateCny(queryText(query)); }

function chunksOf(project) {
  if (!project || typeof project.id !== 'string' || !project.id || !Array.isArray(project.corpus || [])) fail('项目语料格式无效');
  const chunks = [], identities = new Set(), documents = new Set();
  for (const doc of project.corpus || []) {
    if (doc?.enabled !== true) continue;
    if (typeof doc.id !== 'string' || !doc.id || documents.has(doc.id) || typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 160 || !Array.isArray(doc.chunks)) fail('项目语料标识或分段格式无效');
    documents.add(doc.id);
    for (const item of doc.chunks) {
      if (!item || !Number.isSafeInteger(item.index) || item.index < 1 || typeof item.text !== 'string' || !item.text.trim()) fail('项目语料分段格式无效');
      const chunk = { documentId: doc.id, name: doc.name, chunk: item.index, text: item.text };
      const id = identity(chunk); if (identities.has(id)) fail('项目语料含重复段落标识');
      identities.add(id);
      chunk.hash = hash([project.id, chunk.documentId, chunk.chunk, chunk.name, chunk.text]);
      chunks.push(chunk);
    }
  }
  return chunks.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.chunk - b.chunk);
}
function fingerprintOf(project, chunks) { return hash([1, project.id, RAG_MODEL, RAG_DIMENSIONS, chunks.map(chunk => chunk.hash)]); }
function compatibleIndex(project) {
  const index = project.ragIndex;
  return !!index && index.version === 1 && index.projectId === project.id && index.model === RAG_MODEL && index.dimensions === RAG_DIMENSIONS && Array.isArray(index.entries) && index.entries.length <= RAG_MAX_CHUNKS;
}
function reusableEntries(project) {
  const entries = new Map(); if (!compatibleIndex(project)) return entries;
  const duplicates = new Set();
  for (const entry of project.ragIndex.entries) {
    if (!entry || typeof entry.documentId !== 'string' || !Number.isSafeInteger(entry.chunk) || typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || !validVector(entry.vector)) continue;
    const id = identity(entry);
    if (entries.has(id) || duplicates.has(id)) { entries.delete(id); duplicates.add(id); } else entries.set(id, entry);
  }
  return entries;
}
function isReady(project, chunks, fingerprint, entries = reusableEntries(project)) {
  return compatibleIndex(project) && project.ragIndex.fingerprint === fingerprint && project.ragIndex.entries.length === chunks.length && chunks.length <= RAG_MAX_CHUNKS && chunks.every(chunk => entries.get(identity(chunk))?.hash === chunk.hash);
}
export function indexReady(project) {
  try { const chunks = chunksOf(project); return isReady(project, chunks, fingerprintOf(project, chunks)); }
  catch { return false; }
}
export function planIndex(project) {
  const chunks = chunksOf(project), fingerprint = fingerprintOf(project, chunks), entries = reusableEntries(project);
  const changed = chunks.filter(chunk => entries.get(identity(chunk))?.hash !== chunk.hash);
  const texts = changed.map(embeddingText), invalidChunksCount = chunks.filter(chunk => Buffer.byteLength(embeddingText(chunk), 'utf8') > QWEN_EMBEDDING_MAX_TEXT_BYTES).length;
  return { model: RAG_MODEL, dimensions: RAG_DIMENSIONS, fingerprint, chunksCount: chunks.length, changedCount: changed.length, reusedCount: chunks.length - changed.length, batches: Math.ceil(changed.length / QWEN_EMBEDDING_BATCH_LIMIT), estimatedTokens: estimateTokens(texts), estimatedCny: estimateCny(texts), current: isReady(project, chunks, fingerprint, entries), withinLimit: chunks.length <= RAG_MAX_CHUNKS && !invalidChunksCount, tooLarge: chunks.length > RAG_MAX_CHUNKS, invalidChunksCount };
}
export async function buildIndex(project, { key, fetcher, onUsage } = {}) {
  const plan = planIndex(project);
  if (!plan.withinLimit) fail(plan.tooLarge ? '当前项目启用语料超过 200 段，请先停用部分文档再建立索引' : '部分语料段落过长，请重新导入分段后的文档');
  const projectId = project.id, chunks = chunksOf(project), reusable = reusableEntries(project), entries = new Map(), changed = [];
  const assertUnchanged = () => {
    if (fingerprintOf(project, chunksOf(project)) !== plan.fingerprint) throw Object.assign(new Error('语料已在索引过程中变化，请重新检查后建立索引'), { status: 409 });
  };
  for (const chunk of chunks) {
    const previous = reusable.get(identity(chunk));
    if (previous?.hash === chunk.hash) entries.set(identity(chunk), { documentId: chunk.documentId, chunk: chunk.chunk, hash: chunk.hash, vector: [...previous.vector] });
    else changed.push(chunk);
  }
  for (let start = 0; start < changed.length; start += QWEN_EMBEDDING_BATCH_LIMIT) {
    assertUnchanged();
    const batch = changed.slice(start, start + QWEN_EMBEDDING_BATCH_LIMIT);
    const { vectors } = await embedTexts(batch.map(embeddingText), { key, fetcher, onUsage });
    assertUnchanged();
    batch.forEach((chunk, i) => entries.set(identity(chunk), { documentId: chunk.documentId, chunk: chunk.chunk, hash: chunk.hash, vector: vectors[i] }));
  }
  return { version: 1, projectId, model: RAG_MODEL, dimensions: RAG_DIMENSIONS, fingerprint: plan.fingerprint, entries: chunks.map(chunk => entries.get(identity(chunk))), builtAt: new Date().toISOString() };
}
function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}
/** Ranking scores are retrieval ordering only, never confidence or a factuality guarantee. */
export async function retrieve(project, query, { key, fetcher, limit = 5, onUsage } = {}) {
  const text = queryText(query), count = Number.isInteger(limit) ? Math.max(1, Math.min(10, limit)) : 5;
  const fallback = reason => ({ results: searchCorpus(project, text, count), method: 'keyword', reason });
  if (!text) return { results: [], method: 'keyword', reason: 'empty-query' };
  if (project.ragEnabled !== true) return fallback('disabled');
  if (!indexReady(project)) return fallback(project.ragIndex ? 'stale-index' : 'missing-index');
  const chunks = chunksOf(project); if (!chunks.length) return fallback('empty-corpus');
  if (typeof key !== 'string' || !key.trim()) return fallback('missing-key');
  const fingerprint = fingerprintOf(project, chunks), entries = reusableEntries(project);
  let vector;
  try { ({ vectors: [vector] } = await embedTexts([text], { key, fetcher, onUsage })); }
  catch (error) { if (!error?.embeddingError) throw error; return fallback('query-failed'); }
  // A caller may mutate the project while the cloud request is in flight. Never reuse obsolete references.
  if (project.ragEnabled !== true) return fallback('disabled');
  if (!indexReady(project) || fingerprintOf(project, chunksOf(project)) !== fingerprint) return fallback('stale-index');
  const semantic = chunks.map(chunk => ({ chunk, score: cosine(vector, entries.get(identity(chunk)).vector) })).sort((a, b) => b.score - a.score || identity(a.chunk).localeCompare(identity(b.chunk)));
  const keyword = searchCorpus(project, text, 10), ranks = new Map();
  const add = (id, position) => ranks.set(id, (ranks.get(id) || 0) + 1 / (60 + position + 1));
  semantic.forEach((item, i) => add(identity(item.chunk), i));
  keyword.forEach((chunk, i) => add(identity(chunk), i));
  const results = chunks.map(({ hash: _, ...chunk }) => ({ ...chunk, score: ranks.get(identity(chunk)) || 0 }))
    .sort((a, b) => b.score - a.score || identity(a).localeCompare(identity(b))).slice(0, count);
  return { results, method: 'hybrid', reason: 'ready', model: RAG_MODEL, fingerprint };
}
