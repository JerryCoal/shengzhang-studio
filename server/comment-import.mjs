import { z } from 'zod';
import { commentSource, sameCommentWork } from '../desktop/comment-source.mjs';

const rowSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  platformCommentId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
  parentCommentId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
  commentAt: z.string().datetime().refine(v=>Date.parse(v)>=946684800000&&Date.parse(v)<=Date.now()+86400000).optional(),
  likes: z.number().int().min(0).max(1000000000).nullable().default(null),
  timeLabel: z.string().max(100).default(''),
  isReply: z.boolean().default(false),
}).strict();
const schema = z.object({ publicationId: z.string(), source: z.enum(['browser-page', 'mcp', 'redfox']), sourceUrl: z.string().max(8192), confirmed: z.literal(true), mode: z.enum(['page', 'selection']), rows: z.array(rowSchema).min(1).max(1000) }).strict();
const normalized = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function importCapturedComments(p, input, { assert, id, now, classify, touch, verifiedProvider }) {
  const data = schema.parse(input);
  assert(data.source !== 'redfox' || verifiedProvider === 'redfox', '请从 Redfox 读取预览确认导入');
  assert(data.rows.reduce((n,r)=>n+r.text.length,0) <= 120000, '本次评论过多，请分批导入');
  const pub = p.publications.find(r => r.id === data.publicationId);
  assert(pub?.status === 'published' && !pub.sample, '请先登记自己作品的发布结果，再采集评论');
  let source, expected;
  try { source = commentSource(data.sourceUrl); expected = commentSource(pub.url); }
  catch { assert(false, '作品链接无效，请核对发布记录'); }
  assert(sameCommentWork(expected, source) && source.platform === pub.platform, '采集页面与所选作品不一致，请检查作品链接');
  const existing = p.comments.filter(c => c.publicationId === pub.id);
  const ids = new Map(existing.filter(c=>c.platformCommentId).map(c=>[c.platformCommentId,c]));
  const texts = new Map(existing.map(c=>[normalized(c.text),c]));
  let added = 0, duplicates = 0, updated = 0;
  for (const row of data.rows) {
    const key = normalized(row.text), textMatch = texts.get(key);
    const old = row.platformCommentId ? ids.get(row.platformCommentId) || (!textMatch?.platformCommentId ? textMatch : undefined) : textMatch;
    if (old) {
      duplicates++;
      // Imported raw text and human classifications are immutable on repeated collection.
      if (row.platformCommentId && !old.platformCommentId) { old.platformCommentId = row.platformCommentId; ids.set(row.platformCommentId, old); }
      if (['browser-page', 'mcp', 'redfox'].includes(old.source)) {
        if (row.likes !== null) old.likes = row.likes;
        if (row.parentCommentId) old.parentCommentId = row.parentCommentId;
        if (row.commentAt) old.commentAt = row.commentAt;
        old.lastSeenAt = now(); updated++;
      }
      continue;
    }
    const comment = { id: id(), publicationId: pub.id, strategyId: pub.strategyId, accountName: pub.accountName, platform: pub.platform, text: row.text, ...classify(row.text), source: data.source, sourceUrl: source.canonical, collectionMode: data.mode, importedAt: now(), commentAt: null, likes: row.likes, timeLabel: row.timeLabel, isReply: row.isReply, irrelevant: false, sample: false, ...(row.platformCommentId ? { platformCommentId: row.platformCommentId } : {}) };
    if(row.commentAt)comment.commentAt=row.commentAt;
    if (pub.accountId) comment.accountId = pub.accountId;
    if (data.source === 'redfox') comment.provider = 'redfox';
    if(row.parentCommentId)comment.parentCommentId=row.parentCommentId;
    p.comments.push(comment); texts.set(key,comment); if(row.platformCommentId) ids.set(row.platformCommentId,comment); added++;
  }
  pub.commentCapture = { at: now(), sourceUrl: source.canonical, count: data.rows.length, mode: data.mode, partial: true };
  p.lastImportAt = now(); touch(p);
  return { added, duplicates, updated };
}
