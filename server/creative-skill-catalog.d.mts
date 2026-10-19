import type { CreativeSkillState, InstalledCreativeSkill } from './creative-skills.mjs';
import type { SkillWorkflowId } from './skill-workflows.mjs';
export function creativeSkillCatalog(state: CreativeSkillState): {
  revision: number; defaultEditable: boolean; builtin: { id: 'builtin'; name: string; description: string; version: string; instructions: string }; skills: (InstalledCreativeSkill & { eligibleWorkflowIds: SkillWorkflowId[]; targetWorkflowLabel: string })[]; workflows: (import('./ai-skill-registry.mjs').SkillWorkflow & { selectedSkillId: string; eligibleSkillIds: string[] })[];
};
export type WorkflowSkillTrace = { accountContext?: import('./account-creation.mjs').AccountCreationContext; at: string; workflowId: SkillWorkflowId; builtin: { id: string; version: string; instructions: string; workflowId?: SkillWorkflowId; baseVersion?: string; customized?: boolean; revision?: number; updatedAt?: string }[]; user: Record<string, unknown> | null; selected?: Record<string, unknown>[] };
export function workflowSkillTrace(stage: string, payload: import('./ai-skill-registry.mjs').SkillPayload & { creativeSkill?: Record<string, unknown> | null; accountContext?: import('./account-creation.mjs').AccountCreationContext | null }, at: string): WorkflowSkillTrace;
export function creativeSkillTrace(payload: import('./ai-skill-registry.mjs').SkillPayload & { creativeSkill?: Record<string, unknown> | null; accountContext?: import('./account-creation.mjs').AccountCreationContext | null }, at: string): WorkflowSkillTrace;
