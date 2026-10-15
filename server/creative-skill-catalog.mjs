import { COPY_SKILLS, COPY_SKILL_VERSIONS } from './copy-skills.generated.mjs';
import { normalizeCreativeSkills } from './creative-skills.mjs';
import { aiSkillWorkflows, skillIdsFor } from './ai-skill-registry.mjs';

export function creativeSkillCatalog(state) {
  normalizeCreativeSkills(state);
  return {
    revision: state.skillsRevision,
    workflows: aiSkillWorkflows(),
    builtin: { id: 'builtin', name: '平台内置宣传文案', description: '以产品事实为基础，明确受众、场景、利益点与行动引导；按目标平台自动叠加小红书或抖音写作规范。',
      version: COPY_SKILL_VERSIONS['marketing-copywriting'],
      instructions: COPY_SKILLS['marketing-copywriting'] + '\n\n【仅小红书叠加以下规则】\n' + COPY_SKILLS['xiaohongshu-copywriting'] + '\n\n【仅抖音叠加以下规则】\n' + COPY_SKILLS['douyin-copywriting'] + '\n\n【普通文案的自然表达检查】\n' + COPY_SKILLS['natural-copy-editing'] },
    skills: structuredClone(state.installedSkills),
  };
}

// Store the exact applied instructions, not a mutable reference to the installed catalog.
export function creativeSkillTrace(payload, at) {
  const ids = skillIdsFor('copy', payload);
  return { at, builtin: ids.map(id => ({ id, version: COPY_SKILL_VERSIONS[id], instructions: COPY_SKILLS[id] })), user: structuredClone(payload.creativeSkill || null) };
}
