import { COPY_SKILLS, COPY_SKILL_VERSIONS } from './copy-skills.generated.mjs';
import { normalizeCreativeSkills, creativeSkillWorkflowIds } from './creative-skills.mjs';
import { aiSkillWorkflows, skillEntriesFor } from './ai-skill-registry.mjs';
import { resolveBuiltinSkills } from './builtin-skills.mjs';
import { SKILL_WORKFLOWS, skillWorkflowId } from './skill-workflows.mjs';

export function creativeSkillCatalog(state) {
  normalizeCreativeSkills(state);
  return {
    revision: state.skillsRevision,
    defaultEditable: true,
    workflows: aiSkillWorkflows().map(item => {
      const effective = resolveBuiltinSkills(state, item.id);
      return { ...item, skills: item.skills.map((skill, index) => ({ ...skill, ...effective[index], defaultInstructions: skill.instructions })), selectedSkillId: state.skillSelections[item.id] || '', eligibleSkillIds: state.installedSkills.filter(skill => skill.enabled && creativeSkillWorkflowIds(skill).includes(item.id)).map(skill => skill.id) };
    }),
    builtin: { id: 'builtin', name: '出厂宣传文案规则概览', description: '此处展示出厂原文；当前实际使用的规则请查看各工作步骤。以产品事实为基础，明确受众、场景、利益点与行动引导。',
      version: COPY_SKILL_VERSIONS['marketing-copywriting'],
      instructions: COPY_SKILLS['marketing-copywriting'] + '\n\n【仅小红书叠加以下规则】\n' + COPY_SKILLS['xiaohongshu-copywriting'] + '\n\n【仅抖音叠加以下规则】\n' + COPY_SKILLS['douyin-copywriting'] + '\n\n【普通文案的自然表达检查】\n' + COPY_SKILLS['natural-copy-editing'] },
    skills: state.installedSkills.map(skill => {
      const eligibleWorkflowIds = creativeSkillWorkflowIds(skill);
      const targetWorkflowLabel = skill.workflowId ? SKILL_WORKFLOWS.find(item => item.id === skill.workflowId).label : '文案步骤（原有规则）';
      return { ...structuredClone(skill), eligibleWorkflowIds, targetWorkflowLabel };
    }),
  };
}

// Store the exact applied instructions, not a mutable reference to the installed catalog.
export function creativeSkillTrace(payload, at) {
  return workflowSkillTrace('copy', payload, at);
}

export function workflowSkillTrace(stage, payload, at) {
  const entries = skillEntriesFor(stage, payload);
  const user = payload.creativeSkill ? Object.fromEntries(['id', 'name', 'version', 'workflowId', 'instructions'].filter(key => payload.creativeSkill[key] !== undefined).map(key => [key, structuredClone(payload.creativeSkill[key])])) : null;
  const selected = payload.agentContext?.skills?.map(skill => Object.fromEntries(['id', 'name', 'version', 'workflowId', 'instructions'].filter(key => skill[key] !== undefined).map(key => [key, structuredClone(skill[key])])));
  return { at, workflowId: skillWorkflowId(stage, payload), builtin: entries.map(({ id, version, instructions, workflowId, baseVersion, customized, revision, updatedAt }) => ({ id, version, instructions, ...(workflowId ? { workflowId, baseVersion, customized, ...(customized ? { revision, updatedAt } : {}) } : {}) })), user, ...(selected ? { selected } : {}), ...(payload.accountContext ? { accountContext: structuredClone(payload.accountContext) } : {}) };
}
