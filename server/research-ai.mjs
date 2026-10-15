import { z } from 'zod';
import { validateResearchAnalysis } from './research-data.mjs';
import { builtinSkillInstructions } from './ai-skill-registry.mjs';
const string = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = items => ({ type: 'array', items });
export function researchDefinition(kind) {
  if (kind === 'query') return {
    schema: object({ queries: array(string) }),
    validate: value => z.object({ queries: z.array(z.string().trim().min(2).max(100).refine(s => !/https?:|[\r\n\u0000]/i.test(s), '查询词不能包含链接或控制字符')).min(1).max(3).transform(v => [...new Set(v)]) }).strict().parse(value),
  };
  const fields = { id: string, title: string, observation: string, hypothesis: string, application: string, tags: array(string), evidence: array(object({ referenceId: string, quote: string })), limitations: string };
  if (kind === 'xhs-analysis') fields.growthAdvice = {
    ...array(object({ focus: { type: 'string', enum: ['title', 'opening', 'content', 'tags', 'engagement', 'experiment'] }, action: string, reason: string, validation: string, referenceIds: { ...array(string), minItems: 1, maxItems: 5 } })), minItems: 1, maxItems: 6,
  };
  return { schema: object({ analyses: { ...array(object(fields)), maxItems: 6 } }), validate: validateResearchAnalysis };
}
export function researchInstructions(kind) { return builtinSkillInstructions(kind === 'query' ? 'research-query' : 'research-analysis') + (kind === 'xhs-analysis' ? '\n本次为指定平台同话题内容发现；平台以 discovery.platform 为准，未给定时为小红书。每条分析必须提供 1 至 6 项 growthAdvice；每项建议包含 focus、action、reason、validation、referenceIds，引用仅限该条 evidence。建议是待测试假设，不承诺流量增长。仅使用实际给出的播放或互动指标，缺失数据不得补零或猜测；观察、可能原因与验证方法分开。' : '') + '\n按所给接口输出中文 JSON。'; }
