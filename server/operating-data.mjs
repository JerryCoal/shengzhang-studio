import { z } from 'zod';
import {commentSource,sameCommentWork} from '../desktop/comment-source.mjs';

export const METRICS = [
  { key: 'views', label: '播放 / 阅读量', description: '按对应平台作品详情填写，不与曝光量混用。' },
  { key: 'likes', label: '点赞数', description: '作品累计点赞数，不是评论获赞总和。' },
  { key: 'comments', label: '平台评论数', description: '平台展示的累计数，可能与已导入的评论条数不同。' },
  { key: 'favorites', label: '收藏数', description: '平台未提供时留空。' },
  { key: 'shares', label: '分享数', description: '平台未提供时留空。' },
];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const metricsSchema = z.object(Object.fromEntries(METRICS.map(({ key }) => [key, z.number().int().min(0).max(1e12).nullable()]))).strict();
export function saveMetricSnapshot(project, input, clock = Date.now) {
  const data = z.object({ id: z.string().max(100).optional(), expectedRevision: z.number().int().min(1).optional(), publicationId: z.string().max(100), capturedAt: z.string().datetime({ offset: true }), metrics: metricsSchema, note: z.string().trim().max(1000).default(''), source:z.enum(['manual','browser-page']).default('manual'), sourceUrl:z.string().max(8192).optional(), confirmed:z.literal(true).optional() }).strict().parse(input);
  const publication = project.publications.find(p => p.id === data.publicationId);
  if (!publication || publication.status !== 'published') throw fail('请先登记作品发布结果，再记录运营数据');
  let sourceUrl;
  if(data.source==='browser-page') {
    if(!data.confirmed||publication.sample||data.id)throw fail('请核对真实作品后新增网页采集记录');
    try {const expected=commentSource(publication.url),actual=commentSource(data.sourceUrl);if(!sameCommentWork(expected,actual)||!actual.itemId||actual.platform!==publication.platform)throw Error();sourceUrl=actual.canonical;}catch{throw fail('采集数据与所选作品不一致');}
  }
  const time = Date.parse(data.capturedAt);
  if (time > clock() + 300000) throw fail('数据采集时间不能在未来');
  if (publication.publishedAt && time < Date.parse(publication.publishedAt)) throw fail('数据采集时间不能早于作品发布时间');
  if (!Object.values(data.metrics).some(value => value !== null)) throw fail('至少填写一项实际数据，未知项请留空');
  const rows = project.metricSnapshots || [];
  const existing = data.id && rows.find(r => r.id === data.id);
  if (data.id && (!existing || existing.revision !== data.expectedRevision || existing.publicationId !== data.publicationId)) throw fail('数据记录已变化，请重新打开后修改', 409);
  if (rows.some(r => r.id !== data.id && r.publicationId === data.publicationId && Date.parse(r.capturedAt) === time)) throw fail('该作品在此时间已有数据记录，请修改原记录或选择新的采集时间', 409);
  if (!existing && rows.length >= 5000) throw fail('本项目已有 5000 条数据记录，请先导出整理');
  const row = { id: existing?.id || globalThis.crypto.randomUUID(), revision: (existing?.revision || 0) + 1, publicationId: data.publicationId, capturedAt: new Date(time).toISOString(), metrics: data.metrics, note: data.note, source: 'manual', schemaVersion: 1, createdAt: existing?.createdAt || new Date(clock()).toISOString(), updatedAt: new Date(clock()).toISOString() };
  row.source=data.source;if(sourceUrl)row.sourceUrl=sourceUrl;
  if (existing) Object.assign(existing, row); else { project.metricSnapshots ||= []; project.metricSnapshots.push(row); }
  return row;
}
export function latestMetricSnapshots(project, includeSamples = false) {
  const ids = new Set(project.publications.filter(p => p.status === 'published' && (includeSamples || !p.sample)).map(p => p.id));
  const latest = new Map();
  for (const row of project.metricSnapshots || []) if (ids.has(row.publicationId) && (!latest.has(row.publicationId) || Date.parse(row.capturedAt) > Date.parse(latest.get(row.publicationId).capturedAt))) latest.set(row.publicationId, row);
  return [...latest.values()];
}
export function operatingSummary(project, includeSamples = false) {
  const publications = project.publications.filter(p => p.status === 'published' && (includeSamples || !p.sample));
  const ids = new Set(publications.map(p => p.id));
  const comments = project.comments.filter(c => ids.has(c.publicationId) && (includeSamples || !c.sample));
  const latest = latestMetricSnapshots(project, includeSamples);
  return { published: publications.length, recorded: latest.length, imported: comments.length, valid: comments.filter(c => !c.irrelevant).length,
    // Keep coverage per metric. Never add cumulative snapshots together or coerce unknown to zero.
    metrics: METRICS.map(m => { const values = latest.map(r => r.metrics[m.key]).filter(v => typeof v === 'number'); return { ...m, covered: values.length, total: values.length ? values.reduce((a,b) => a+b,0) : null }; }),
  };
}
