import { PLATFORM_IDS } from './platform-catalog.mjs';

// Stable workflow identifiers are independent of providers and model names.
// Connection checks, login and mechanical collection do not run an AI Skill.
export const SKILL_WORKFLOWS = Object.freeze([
  { id: 'xhs-creator', label: 'Redfox 小红书创作', description: '在内容制作的小红书创作助手中生成笔记或改写。' },
  { id: 'xhs-title-score', label: 'Redfox 标题生成与评分', description: '生成候选标题，或显示六维参考评分、等级和建议。' },
  { id: 'xhs-cover', label: 'Redfox 封面方案', description: '分析样本并提供三套方案，采纳后进入已有封面制作。' },
  { id: 'xhs-note-analyzer', label: 'Redfox 笔记诊断', description: '显示正文四维评分及改进建议，由用户决定是否改写。' },
  { id: 'brief-import', label: '项目概要导入', description: '从介绍文档提取带原文依据的概要，逐项确认后填入。' },
  { id: 'document-context', label: '文档资料提炼', description: '提炼可核对的事实、条件与文风，用户采纳后用于创作。' },
  { id: 'research-query', label: '热点检索方向', description: '先生成有限查询词，再由程序采集真实来源。' },
  { id: 'web-search', label: '联网新闻搜索', description: '用于千问联网搜索，保留可核对的新闻来源。Redfox 按关键词检索，不使用这份规则。' },
  { id: 'research-analysis', label: '热点参考分析', description: '引用真实来源，区分观察、亮点假设与应用建议。' },
  { id: 'strategy', label: '策略规划', description: '从品牌与产品资料生成本轮策略。' },
  { id: 'planning', label: '下期策划', description: '结合已采用反馈与原文依据规划下一轮。' },
  { id: 'copy-xiaohongshu', label: '小红书文案', description: '结合平台要求与自然表达，在同次生成中整理成稿。', stage: 'copy', platform: 'xiaohongshu' },
  { id: 'copy-douyin', label: '抖音文案', description: '结合抖音分镜要求与自然表达，保留真实卖点与条件。', stage: 'copy', platform: 'douyin' },
  { id: 'copy-tiktok', label: 'TikTok 文案', description: '围绕目标受众与开场信息撰写短视频文案，保留真实条件。', stage: 'copy', platform: 'tiktok' },
  { id: 'copy-youtube', label: 'YouTube 文案', description: '明确视频看点、内容结构与行动提示，保持信息可信。', stage: 'copy', platform: 'youtube' },
  { id: 'copy-instagram', label: 'Instagram 文案', description: '结合图片或短视频场景表达卖点，避免空泛与过度承诺。', stage: 'copy', platform: 'instagram' },
  { id: 'word-review', label: '敏感词改写', description: '本地检查后，只交给 AI 处理需要改写的片段。' },
  { id: 'price-semantic', label: '价格语义判断', description: 'AI 判断语境，本地程序按你的词库逐处替换。' },
  { id: 'classification', label: '评论分类', description: '按原始评论逐条归类，模糊项留待人工核对。' },
  { id: 'analysis', label: '评论复盘', description: '每条观察必须引用本次输入中的真实评论。' },
  { id: 'cover', label: '宣传封面', description: '按所选构图、风格及有字或无字模式生成。' },
  { id: 'first_frame', label: '视频首帧', description: '建立清晰的开场静态状态。' },
  { id: 'last_frame', label: '视频尾帧', description: '保持首帧主体与场景连续，呈现结束状态。' },
  { id: 'video', label: '视频生成', description: '遵循实际时长、声音设置和已确认首尾帧。' },
].map(item => Object.freeze({ ...item, stage: item.stage || item.id })));

export const SKILL_WORKFLOW_IDS = Object.freeze(SKILL_WORKFLOWS.map(item => item.id));

export function skillWorkflowId(stage, payload = {}) {
  if (stage === 'copy') {
    if (payload.copyReview?.mode === 'semantic') return 'price-semantic';
    if (payload.copyReview) return 'word-review';
    const platform = payload.task?.channel;
    if (!PLATFORM_IDS.includes(platform)) throw Object.assign(new Error('文案 Skill 缺少明确的目标平台'), { status: 400 });
    return `copy-${platform}`;
  }
  if (!SKILL_WORKFLOW_IDS.includes(stage)) throw Object.assign(new Error('未知 AI Skill 工作步骤'), { status: 400 });
  return stage;
}
