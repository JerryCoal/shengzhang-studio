import { z } from 'zod';
import { validateResearchAnalysis } from './research-data.mjs';
import { builtinSkillInstructions } from './ai-skill-registry.mjs';
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = items => ({ type: 'array', items });
export function researchDefinition(kind) {
  if (kind === 'query') return {
    schema: object({ queries: { ...array({ ...string(100), minLength: 2 }), minItems: 1, maxItems: 3 } }),
    validate: value => z.object({ queries: z.array(z.string().trim().min(2).max(100).refine(s => !/https?:|[\r\n\u0000]/i.test(s), '查询词不能包含链接或控制字符')).min(1).max(3).transform(v => [...new Set(v)]) }).strict().parse(value),
  };
  const fields = { id: string(100), title: string(180), observation: string(1200), hypothesis: string(1200), application: string(1200),
    tags: { ...array(string(50)), maxItems: 12 }, evidence: { ...array(object({ referenceId: string(160), quote: string(400) })), minItems: 1, maxItems: 5 }, limitations: string(1200) };
  if (kind === 'xhs-analysis') fields.growthAdvice = {
    ...array(object({ focus: { type: 'string', enum: ['title', 'opening', 'content', 'tags', 'engagement', 'experiment'] }, action: string(800), reason: string(800), validation: string(800), referenceIds: { ...array(string(160)), minItems: 1, maxItems: 5 } })), minItems: 1, maxItems: 6,
  };
  return { schema: object({ analyses: { ...array(object(fields)), maxItems: 6 } }), validate: validateResearchAnalysis };
}
export function researchInstructions(kind, payload = {}) {
  return builtinSkillInstructions(kind === 'query' ? 'research-query' : 'research-analysis', payload)
    + (kind !== 'query' ? '\n输出完整且简洁的 JSON：通常生成 2 至 3 条有证据的分析，证据不足可减少或返回 analyses: []，不要为凑数量扩写。id 用 a1、a2 等互不重复的短标识。每条的 observation、hypothesis、application、limitations 各用 1 至 2 句话，建议每段不超过 100 字；tags 用 1 至 5 个具体主题词。evidence 通常 1 至 2 项，referenceId 必须逐字照抄 references 中的 id，不能用序号、链接或 externalId 替代；quote 从对应 title 或 text 中复制一个不超过 100 字的连续原文片段，不拼接标题和正文，不加引号、删改文字或插入省略号。格式示例的占位内容不是真实证据。' : '')
    + (kind === 'xhs-analysis' ? '\n本次为指定平台同话题内容发现；平台以 discovery.platform 为准，未给定时为小红书。每条分析必须提供 growthAdvice，通常 1 至 2 项、最多 6 项；每项包含 focus、action、reason、validation、referenceIds，每个文本字段用一句话、建议不超过 80 字，referenceIds 仅限该条 evidence 中的 referenceId。建议是待测试假设，不承诺流量增长。仅使用实际给出的播放或互动指标，缺失数据不得补零或猜测；观察、可能原因与验证方法分开。' : '')
    + '\n图片边界：imageEvidence 只包含来源图片链接、描述或来源已提供的分析，本次文本模型没有查看图片。图片未显示或链接不可用不代表整篇文字无效；继续使用已核实标题正文与指标。不得把图片链接或来源描述说成自己亲眼看见，不猜测画面、配色、人物或构图；引用已有图片分析时标明来源转述、尚未重新核图。'
    + '\n按所给接口输出中文 JSON，不输出 Markdown 或额外解释。';
}
