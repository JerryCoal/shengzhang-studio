// One source of truth for compilation and the browser-visible built-in catalog.
export const AI_SKILLS = [
  { id: 'document-context', name: '文档资料提炼', description: '从选中文档提取带原文出处的资料卡，确认后供创作使用。' },
  { id: 'research-query', name: '近期内容检索词', description: '将项目受众与关键词转为有限的检索方向，不伪造搜索结果。' },
  { id: 'research-analysis', name: '热点参考证据分析', description: '依据原文区分观察、亮点假设及可迁移的创作参考。' },
  { id: 'marketing-strategy', name: '营销策略', description: '从确认事实提炼受众、目标与核心表达。' },
  { id: 'iteration-planning', name: '下期策划', description: '依据已采用反馈与评论，设计下一轮待验证改动。' },
  { id: 'marketing-copywriting', name: '宣传文案基础', description: '以产品事实、使用场景和明确行动构成文案。' },
  { id: 'natural-copy-editing', name: '自然表达润色', description: '减少空话与机械句式，保留事实、文风和行动引导。' },
  { id: 'xiaohongshu-copywriting', name: '小红书文案', description: '自然段落、具体场景与独立画面要求。' },
  { id: 'douyin-copywriting', name: '抖音文案与分镜', description: '开场、演示与行动引导，区分静帧与运动。' },
  { id: 'sensitive-copy-review', name: '敏感词改写', description: '仅修改已命中片段，保留事实并由程序复检。' },
  { id: 'price-context-replacement', name: '价格语义判断', description: '逐处判断价格语境，替换字词由本地词库决定。' },
  { id: 'comment-classification', name: '评论分类', description: '逐条主题、情绪、原文依据及待核对标记。' },
  { id: 'comment-insight-analysis', name: '评论复盘', description: '用真实评论支持观察与建议，不推断成交或因果。' },
  { id: 'cover-art-direction', name: '封面构图', description: '单一视觉重点、真实产品与清晰文字层级。' },
  { id: 'keyframe-continuity', name: '首尾帧连续性', description: '保持主体和场景一致，区分动作开始与结束状态。' },
  { id: 'seedance-motion', name: '视频动作与声音', description: '根据实际时长、声音开关和首尾帧生成连续动作。' },
];
