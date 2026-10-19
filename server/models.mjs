import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicJSON } from './vault.mjs';
export const MODELS = {
  'glm-5.3': { provider: 'glm', label: 'GLM-5.3', inputPrice: 1.143, outputPrice: 4, priceNote: '2026-10-19 官方 8/28 元每百万 token，按约 7 元/美元折算，未计缓存折扣', description: '智谱旗舰文字模型，适合灵感策略和复盘；始终开启思考' },
  'glm-5.3-flash': { provider: 'glm', label: 'GLM-5.3 Flash', inputPrice: 0.115, outputPrice: 0.4, priceNote: '2026-10-19 官方 0.8/2.8 元每百万 token，按约 7 元/美元折算，未计临时折扣', description: '适合日常文案和评论分类；本工作站按文字模式接入' },
  'glm-4.7-flash': { provider: 'glm', label: 'GLM-4.7 Flash · 免费', inputPrice: 0, outputPrice: 0, priceNote: '2026-10-19 官方免费文本模型，速率和免费政策以智谱为准', description: '适合试用与轻量文字任务，关闭思考以加快结构化生成' },
  'qwen-plus': { provider: 'qwen', label: 'Qwen Plus', inputPrice: 0.12, outputPrice: 0.3, priceNote: '北京地域非思考模式、短上下文预算估算；人民币价格按约 7 元/美元折算，仅用于预算提醒', description: '适合中文策略、文案与复盘；使用非思考模式保证结构化输出' },
  'qwen-flash': { provider: 'qwen', label: 'Qwen Flash', inputPrice: 0.022, outputPrice: 0.22, priceNote: '北京地域非思考模式、短上下文预算估算；人民币价格按约 7 元/美元折算，仅用于预算提醒', description: '低成本处理评论分类与日常文案' },
  'gpt-5.4': { provider: 'openai', label: 'GPT-5.4', inputPrice: 2.5, outputPrice: 15, description: '适合复杂策划、约束协调和迭代判断' },
  'gpt-5.4-mini': { provider: 'openai', label: 'GPT-5.4 mini', inputPrice: 0.75, outputPrice: 4.5, description: '平衡内容质量、速度和费用' },
  'gpt-5.4-nano': { provider: 'openai', label: 'GPT-5.4 nano', inputPrice: 0.2, outputPrice: 1.25, description: '适合标签、情绪等简单结构化任务' },
  'deepseek-flash': { provider: 'deepseek', label: 'DeepSeek Flash', inputPrice: 0.3, outputPrice: 1.2, priceNote: '按高峰、输入缓存未命中单价估算；实际账单可能更低', description: '低成本处理文案、评论分类和日常复盘' },
  'deepseek-v4-pro': { provider: 'deepseek', label: 'DeepSeek V4 Pro', inputPrice: 1.32, outputPrice: 3.96, priceNote: '按高峰、输入缓存未命中单价估算；实际账单可能更低', description: '适合需要综合判断的策略与下期策划' },
};
export const STAGES = [
  { id: 'strategy', label: '宣传策略', model: 'gpt-5.4', effort: 'medium', maxTokens: 4500, reason: '同时考虑品牌、受众、渠道与事实约束，优先保证方向质量。' },
  { id: 'planning', label: '下期策划', model: 'gpt-5.4', effort: 'medium', maxTokens: 4500, reason: '结合已采用的反馈重新规划，需要更强的综合判断。' },
  { id: 'copy', label: '文案与分镜', model: 'gpt-5.4-mini', effort: 'low', maxTokens: 3500, reason: '在已确认策略内写标题、正文和分镜，兼顾质量与响应速度。' },
  { id: 'classification', label: '评论标签与情绪', model: 'gpt-5.4-nano', effort: 'low', maxTokens: 7000, reason: '固定类别的批量识别使用小模型；保留人工校正。' },
  { id: 'analysis', label: '评论复盘', model: 'gpt-5.4-mini', effort: 'medium', maxTokens: 4500, reason: '从评论中提取观察、原文依据与可验证建议。' },
];
export const DEFAULT_ROUTES = Object.fromEntries(STAGES.map(s => [s.id, s.model]));
export const DEEPSEEK_ROUTES = Object.fromEntries(STAGES.map(s => [s.id, ['strategy', 'planning'].includes(s.id) ? 'deepseek-v4-pro' : 'deepseek-flash']));
export const routesSchema = z.object(Object.fromEntries(STAGES.map(s => [s.id, z.enum(Object.keys(MODELS))]))).strict();
export function createModelStore(file) {
  let routes = { ...DEFAULT_ROUTES };
  if (file) { try { routes = routesSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw new Error('模型配置文件无效，请检查 model-settings.json'); } }
  return { get: () => ({ ...routes }), save(value) { const next = routesSchema.parse(value); if (file) atomicJSON(file, next); routes = next; return this.get(); } };
}
export function stageConfig(stage, routes) {
  if (stage === 'document-context') return { ...stageConfig('strategy', routes), id: stage, label: '项目资料提炼', maxTokens: 7000 };
  const definition = STAGES.find(s => s.id === stage), model = routes[stage], metadata = MODELS[model];
  const thinking = ['strategy', 'planning', 'analysis'].includes(stage);
  return { ...definition, model, ...metadata, ...(metadata.provider === 'deepseek' ? { thinking, maxTokens: thinking ? 8000 : definition.maxTokens } : {}), ...(metadata.provider === 'glm' && model.startsWith('glm-5.3') ? { maxTokens: Math.max(12000, definition.maxTokens) } : {}) };
}
