import { AI_SKILLS } from './ai-skills-manifest.mjs';
import { COPY_SKILLS, COPY_SKILL_VERSIONS } from './copy-skills.generated.mjs';

export function skillIdsFor(stage, payload = {}) {
  if (stage === 'document-context' || stage === 'research-query' || stage === 'research-analysis') return [stage];
  if (stage === 'copy') {
    if (payload.copyReview?.mode === 'semantic') return ['price-context-replacement'];
    if (payload.copyReview) return ['sensitive-copy-review'];
    const platform = { xiaohongshu: 'xiaohongshu-copywriting', douyin: 'douyin-copywriting' }[payload.task?.channel];
    return ['marketing-copywriting', ...(platform ? [platform] : []), 'natural-copy-editing'];
  }
  const id = { strategy: 'marketing-strategy', planning: 'iteration-planning', classification: 'comment-classification', analysis: 'comment-insight-analysis', cover: 'cover-art-direction', first_frame: 'keyframe-continuity', last_frame: 'keyframe-continuity', video: 'seedance-motion', 'word-review': 'sensitive-copy-review', 'price-semantic': 'price-context-replacement' }[stage];
  if (!id) throw new Error('未知 AI 规则步骤');
  return [id];
}
function entry(id) {
  const meta = AI_SKILLS.find(skill => skill.id === id);
  if (!meta || !COPY_SKILLS[id] || !COPY_SKILL_VERSIONS[id]) throw new Error(`内置规则尚未编译：${id}`);
  return { ...meta, version: COPY_SKILL_VERSIONS[id], instructions: COPY_SKILLS[id] };
}
export function skillVersionsFor(stage, payload = {}) {
  return skillIdsFor(stage, payload).map(id => { const { name, version } = entry(id); return { id, name, version }; });
}
export function builtinSkillInstructions(stage, payload = {}) {
  return skillIdsFor(stage, payload).map(id => entry(id).instructions).join('\n\n');
}
export function aiSkillWorkflows() {
  return [
    ['document-context', '文档资料提炼', '提炼可核对的事实、条件与文风，用户采纳后用于创作。'],
    ['research-query', '热点检索方向', '先生成有限查询词，再由程序采集真实来源。'],
    ['research-analysis', '热点参考分析', '引用真实来源，区分观察、亮点假设与应用建议。'],
    ['strategy', '策略规划', '从品牌与产品资料生成本轮策略。'],
    ['planning', '下期策划', '结合已采用反馈与原文依据规划下一轮。'],
    ['copy-xiaohongshu', '小红书文案', '结合平台要求与自然表达，在同次生成中整理成稿。', 'copy', { task: { channel: 'xiaohongshu' } }],
    ['copy-douyin', '抖音文案', '结合抖音分镜要求与自然表达，保留真实卖点与条件。', 'copy', { task: { channel: 'douyin' } }],
    ['word-review', '敏感词改写', '本地检查后，只交给 AI 处理需要改写的片段。'],
    ['price-semantic', '价格语义判断', 'AI 判断语境，本地程序按你的词库逐处替换。'],
    ['classification', '评论分类', '按原始评论逐条归类，模糊项留待人工核对。'],
    ['analysis', '评论复盘', '每条观察必须引用本次输入中的真实评论。'],
    ['cover', '小红书封面', '按所选构图、风格及有字或无字模式生成。'],
    ['first_frame', '视频首帧', '建立清晰的开场静态状态。'],
    ['last_frame', '视频尾帧', '保持首帧主体与场景连续，呈现结束状态。'],
    ['video', '视频生成', '遵循实际时长、声音设置和已确认首尾帧。'],
  ].map(([id, label, description, stage = id, payload = {}]) => ({ id, label, description, skills: skillIdsFor(stage, payload).map(entry) }));
}
