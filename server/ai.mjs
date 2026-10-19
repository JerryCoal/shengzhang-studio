import { z } from 'zod';
import { CATEGORY_GUIDE } from './comment-analysis.mjs';
import { openAIResponseError, openAINetworkError } from './openai-errors.mjs';
import { generateDeepSeek, deepseekInstructions } from './deepseek.mjs';
import { generateQwen } from './qwen.mjs';
import { generateGLM } from './glm.mjs';
import { assert, strategyTextSchema, categories } from './domain.mjs';
import { textInstructions } from './prompts.mjs';
import { documentContextDefinition } from './document-context.mjs';
import { normalizeStructuredVision, structuredVisionContent, structuredVisionReservation } from './structured-vision.mjs';
const string = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = items => ({ type: 'array', items });
const definitions = {
  'document-context': documentContextDefinition,
  strategy: { instructions: '输出 title（主题）、core（核心表达）、direction（渠道与分镜方向）、prompt（完整制作要求）。', schema: object({ title: string, core: string, direction: string, prompt: string }), validate: value => strategyTextSchema.parse(value) },
  copy: { instructions: '根据已确认策略，为指定内容写 title、body、prompt 与三个 scenes 分镜。维持产品事实与渠道。', schema: object({ title: string, body: string, prompt: string, scenes: array(string) }), validate: value => z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(8000), prompt: z.string().max(8000), scenes: z.array(z.string().min(1).max(1000)).length(3) }).parse(value) },
  classification: { instructions: `逐条返回 id、tags（可多选）、sentiment、reason、evidence、needsReview。每个输入 id 恰好返回一次，使用所给枚举。分类定义：${JSON.stringify(CATEGORY_GUIDE)}`, schema: object({ comments: array(object({ id: string, tags: array({ type: 'string', enum: categories }), sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] }, reason: string, evidence: string, needsReview: { type: 'boolean' } })) }), validate(value, payload) {
    const result = z.object({ comments: z.array(z.object({ id: z.string(), tags: z.array(z.enum(categories)).min(1).max(6), sentiment: z.enum(['positive', 'neutral', 'negative']), reason: z.string().trim().min(1).max(400), evidence: z.string().max(4000), needsReview: z.boolean() })).max(60) }).parse(value);
    const ids = new Set(result.comments.map(c => c.id));
    assert(ids.size === payload.comments.length && result.comments.length === payload.comments.length && payload.comments.every(c => ids.has(c.id)), '评论分类结果缺少原文或包含无效引用', 502);
    assert(result.comments.every(c => c.evidence && payload.comments.find(p => p.id === c.id)?.text.includes(c.evidence)), '分类理由没有引用原文中的真实片段', 502);
    for (const comment of result.comments) if (comment.tags.length > 1) comment.tags = comment.tags.filter(t => t !== '其他');
    return result;
  } },
  analysis: { instructions: '总结 1 至 6 条有依据的复盘建议。每条含 category、title、observation、recommendation、evidenceIds（仅给定评论ID）。不编造统计、用户行为或因果。样本少时明确待验证。', schema: object({ insights: array(object({ category: { type: 'string', enum: categories }, title: string, observation: string, recommendation: string, evidenceIds: array(string) })) }), validate(value, payload) {
    const result = z.object({ insights: z.array(z.object({ category: z.enum(categories), title: z.string().min(1).max(200), observation: z.string().min(1).max(2000), recommendation: z.string().min(1).max(2000), evidenceIds: z.array(z.string()).min(1).max(200) })).min(1).max(6) }).parse(value);
    const ids = new Set(payload.comments.map(c => c.id)); assert(result.insights.every(i => i.evidenceIds.every(id => ids.has(id))), '复盘结果引用了不存在的评论', 502); return result;
  } },
};
const reviewDefinition = { instructions: '仅修订 copyReview 中的 title 和 body。保留无关段落与事实，返回 title、body。', schema: object({ title: string, body: string }), validate: value => z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(8000) }).parse(value) };
const semanticDefinition = { instructions: '逐条返回 decisions，字段为 id、decision（replace/keep/uncertain）、reason。不返回文案。', schema: object({ decisions: array(object({ id: string, decision: { type: 'string', enum: ['replace','keep','uncertain'] }, reason: string })) }), validate(value, payload) {
  const result = z.object({ decisions: z.array(z.object({ id: z.string().max(30), decision: z.enum(['replace','keep','uncertain']), reason: z.string().trim().min(1).max(240) }).strict()).max(40) }).strict().parse(value);
  const ids = new Set(result.decisions.map(r=>r.id));
  assert(ids.size === payload.copyReview.matches.length && result.decisions.length === ids.size && payload.copyReview.matches.every(m=>ids.has(m.id)), '语义判断缺少位置或包含无效位置', 502);
  return result;
} };
const definitionFor = (stage, payload = {}) => stage === 'copy' && payload.copyReview?.mode === 'semantic' ? semanticDefinition : stage === 'copy' && payload.copyReview ? reviewDefinition : definitions[stage === 'planning' ? 'strategy' : stage];
export function estimateReservation(payload, config) {
  const definition = definitionFor(config.id || 'strategy', payload);
  const base = textInstructions(config.id || 'strategy', payload) + definition.instructions;
  return estimateStructuredReservation(payload, config, definition, base);
}
export function estimateStructuredReservation(payload, config, definition, base) {
  const vision = structuredVisionReservation(config);
  const instructions = ['deepseek', 'qwen', 'glm'].includes(config.provider) ? deepseekInstructions(base, definition) : base;
  const inputUpperBound = Buffer.byteLength(instructions + JSON.stringify(providerPayload(payload)), 'utf8') + 2500 + vision.inputTokens + vision.textInputUpperBound;
  return (inputUpperBound * config.inputPrice + (config.maxTokens || 4500) * config.outputPrice) / 1e6;
}
export function tokenCost(usage, config) { if (!usage || ![usage.input_tokens, usage.output_tokens].every(n => Number.isInteger(n) && n >= 0)) return null; return (usage.input_tokens * config.inputPrice + usage.output_tokens * config.outputPrice) / 1e6; }
async function officialRequest(path, key, init, fetcher) {
  try {
    const response = await fetcher(`https://api.openai.com/v1/${path}`, { ...init, redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw await openAIResponseError(response);
    return response;
  } catch (error) { if (error.status) throw error; throw openAINetworkError(); }
}
export async function verifyModels(key, models, fetcher = fetch) {
  const response = await officialRequest('models', key, { method: 'GET' }, fetcher);
  let data; try { data = await response.json(); } catch { throw Object.assign(new Error('模型列表响应无效，请稍后重试。'), { status: 502 }); }
  assert(Array.isArray(data.data), '模型列表响应无效', 502);
  const available = new Set(data.data.map(m => m.id));
  return { checkedAt: new Date().toISOString(), models: [...new Set(models)].map(model => ({ model, available: available.has(model) })), note: '密钥验证通过。模型列表仅表示可见性，不保证生成权限、账户余额或实际效果；未发起付费生成。' };
}
export async function generateStage(payload, config, fetcher = fetch) {
  const definition = definitionFor(config.id, payload);
  return generateStructured(payload, config, definition, textInstructions(config.id, payload) + definition.instructions, fetcher);
}
function providerPayload(payload) {
  // The resolved rules already appear in system instructions. Keep their frozen
  // snapshot for local traces, without paying to send the same text twice.
  const { builtinSkills, ...input } = payload;
  return input;
}
export async function generateStructured(payload, config, definition, instructions, fetcher = fetch) {
  const visionInputs = normalizeStructuredVision(config);
  assert(config.apiKey, '请先在设置页保存 API 密钥', 400);
  const input = providerPayload(payload);
  if (config.provider === 'deepseek') return generateDeepSeek(input, { ...config, visionInputs }, definition, instructions, fetcher);
  if (config.provider === 'qwen') return generateQwen(input, config, definition, instructions, fetcher);
  if (config.provider === 'glm') return generateGLM(input, config, definition, instructions, fetcher);
  const content = structuredVisionContent(input, { ...config, visionInputs });
  const response = await officialRequest('responses', config.apiKey, { method: 'POST', body: JSON.stringify({ model: config.model, store: false, reasoning: { effort: config.effort }, max_output_tokens: config.maxTokens, instructions, input: visionInputs.length ? [{ role: 'user', content }] : content, text: { format: { type: 'json_schema', name: `marketing_${config.id}`, strict: true, schema: definition.schema } } }) }, fetcher);
  let result; try { result = await response.json(); } catch { throw Object.assign(new Error('模型响应无法读取，请重试。'), { status: 502 }); }
  const usage = result.usage;
  try { assert(result.status === 'completed', '模型未完成', 502); const output = (result.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join(''); return { value: definition.validate(JSON.parse(output), payload), usage }; }
  catch { throw Object.assign(new Error('模型结果不完整或引用不符合要求。现有内容已保留。'), { status: 502, usage }); }
}
