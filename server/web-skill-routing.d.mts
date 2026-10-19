import type { SkillWorkflowId } from './skill-workflows.mjs';
export function webSkillWorkflowId(state: { projects?: { id: string; assets?: { id: string; channel: string }[] }[] }, path: string, body?: unknown): SkillWorkflowId | null;
