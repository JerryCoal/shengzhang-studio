import { z } from 'zod';

export const COMMENT_WORKFLOW_VERSION = 'comments-1.0';
export const COMMENT_CATEGORIES = ['购买咨询', '价格顾虑', '使用疑问', '体验反馈', '内容建议', '其他'];
export const CATEGORY_GUIDE = {
  '购买咨询': '询问购买、报名、试用或联系入口；不代表已经购买。',
  '价格顾虑': '询问价格、优惠、收费或评价性价比；问价格不等于负面情绪。',
  '使用疑问': '询问操作、规格、兼容性、适用条件或使用方法。',
  '体验反馈': '对实际体验、产品表现或服务提出肯定、批评或问题。',
  '内容建议': '提出想看的内容、演示、选题或表达方式。',
  '其他': '没有明确匹配的主题，包括只有表情、含糊回应或需补充上下文的评论。',
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const patterns = [
  ['购买咨询', /怎么买|哪里买|购买|下单|购买链接|求链接|求入口|怎么报名|如何报名|想试用|想买|哪里有|怎么领/],
  ['价格顾虑', /价格|价钱|多少钱|收费|免费|贵|便宜|优惠|折扣|性价比|费用|预算|\d+\s*[元块]|¥|￥/],
  ['使用疑问', /尺寸|大小|多大|携带|怎么|如何|能不能|可以|多少水|毫升|重量|兼容|支持.*(?:吗|哪些|什么)|有哪些功能|登录|安装|操作/],
  ['体验反馈', /喜欢|不错|好喝|用了|用过(?!程)|难用|好用|失望|漏水|坏了|太差|投诉|卡顿|闪退|体验|售后|满意/],
  ['内容建议', /希望|建议|拍一个|拍一下|演示|展示|想看|教程|多拍|讲讲|能否介绍/],
];
export function classifyComment(text) {
  const hits = patterns.flatMap(([category, pattern]) => { const hit = text.match(pattern); return hit ? [{ category, quote: hit[0] }] : []; });
  // Negation and sarcasm need context. Do not turn “不贵” into a negative review.
  const ambiguous = /不(?:太|算|是|怎么)?(?:贵|好|差|难用|便宜)|没.*(?:想象|那么)|可真|呵呵|反话|但是|不过|虽然/.test(text);
  const negative = /不喜欢|太贵|好贵|有点贵|贵了|失望|难用|坏了|漏水|投诉|闪退|太差/.test(text);
  const positive = /喜欢|不错|好喝|好用|满意|很棒|赞/.test(text.replace(/不(?:太|怎么)?喜欢/g, ''));
  const mixed = negative && positive;
  const needsReview = ambiguous || mixed || !hits.length || text.trim().length < 5;
  return {
    tags: hits.length ? hits.map(h => h.category) : ['其他'],
    sentiment: ambiguous || mixed ? 'neutral' : negative ? 'negative' : positive ? 'positive' : 'neutral',
    classification: { version: COMMENT_WORKFLOW_VERSION, method: 'rules', at: new Date().toISOString(), needsReview,
      reason: ambiguous || mixed ? '存在否定、转折或混合情绪，建议结合原文核对。' : hits.length ? `命中本地线索：${hits.map(h => `${h.category}「${h.quote}」`).join('、')}。仅为初筛。` : '没有明确的主题线索，保留为其他，等待人工或 AI 判断。',
      evidence: hits[0]?.quote || '',
    },
  };
}
export function needsCommentReview(comment) {
  return !comment.irrelevant && !comment.correctedAt && (comment.classification?.needsReview ?? true);
}
// An omitted selection preserves legacy callers. An explicit empty selection must never select everything.
export function selectCommentScope(project, input = {}) {
  const { commentIds } = z.object({ commentIds: z.array(z.string().min(1).max(100)).max(10000).optional() }).parse(input || {});
  if (commentIds === undefined) return project.comments.filter(c => !c.irrelevant);
  const wanted = new Set(commentIds), known = new Set(project.comments.map(c => c.id));
  if ([...wanted].some(id => !known.has(id))) throw fail('所选评论已变化或不属于本项目，请刷新后重新选择', 409);
  return project.comments.filter(c => wanted.has(c.id) && !c.irrelevant);
}
export function applyRuleClassification(project, input = {}) {
  const comments = selectCommentScope(project, input).filter(c => !c.correctedAt && !c.classificationModel);
  for (const comment of comments) Object.assign(comment, classifyComment(comment.text));
  return { count: comments.length, needsReview: comments.filter(needsCommentReview).length, version: COMMENT_WORKFLOW_VERSION };
}
export function correctComment(project, id, input) {
  const c = project.comments.find(c => c.id === id);
  if (!c) throw fail('评论不存在', 404);
  const data = z.object({ tags: z.array(z.enum(COMMENT_CATEGORIES)).min(1).max(6).optional(), sentiment: z.enum(['positive','neutral','negative']).optional(), irrelevant: z.boolean().optional(), note: z.string().trim().max(1000).optional(), expectedCorrectedAt: z.string().nullable().optional() }).strict().parse(input);
  if (data.expectedCorrectedAt !== undefined && data.expectedCorrectedAt !== (c.correctedAt || null)) throw fail('这条评论已在另一处校正，请重新打开', 409);
  if (!['tags','sentiment','irrelevant','note'].some(key => data[key] !== undefined)) throw fail('请填写要校正的分类');
  if (data.tags?.includes('其他') && data.tags.length > 1) throw fail('其他不能与具体主题同时选择');
  const { expectedCorrectedAt, note, ...changes } = data;
  Object.assign(c, changes, { tags: [...new Set(changes.tags || c.tags)], correctedAt: new Date().toISOString(), reviewNote: note ?? c.reviewNote ?? '' });
  // Keep AI/rule provenance as well as the human correction.
  return c;
}
export function commentSummary(comments) {
  const valid = comments.filter(c => !c.irrelevant);
  return { total: comments.length, valid: valid.length, excluded: comments.length - valid.length,
    needsReview: valid.filter(needsCommentReview).length, reviewed: valid.filter(c => c.correctedAt).length,
    aiPending: valid.filter(c => !c.correctedAt && !c.classificationModel).length,
    topics: COMMENT_CATEGORIES.map(name => ({ name, count: valid.filter(c => c.tags.includes(name)).length })),
    sentiment: ['positive','neutral','negative'].map(name => ({ name, count: valid.filter(c => c.sentiment === name).length })),
  };
}
export function commentReport(project, comments) {
  const summary = commentSummary(comments);
  return { format: 'shengzhang-comment-report', version: 1, exportedAt: new Date().toISOString(), project: project.brief.name,
    scope: '仅当前筛选的已导入评论，不代表平台全部评论。主题可多选；评论条数不等于人数或销量。', summary,
    comments: comments.map(c => ({ id: c.id, publicationId: c.publicationId, work: project.publications.find(p => p.id === c.publicationId)?.title || '', platform: c.platform, text: c.text, tags: c.tags, sentiment: c.sentiment, irrelevant: c.irrelevant, sample: !!c.sample, source: c.source, importedAt: c.importedAt, commentAt: c.commentAt, classification: c.classification || null, classificationModel: c.classificationModel || null, correctedAt: c.correctedAt || null, reviewNote: c.reviewNote || '' })) };
}
