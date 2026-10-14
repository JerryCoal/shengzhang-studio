import type { CreativeSkillState, InstalledCreativeSkill } from './creative-skills.mjs';
export function creativeSkillCatalog(state: CreativeSkillState): {
  revision: number; builtin: { id: 'builtin'; name: string; description: string; version: string; instructions: string }; skills: InstalledCreativeSkill[]; workflows: import('./ai-skill-registry.mjs').SkillWorkflow[];
};
