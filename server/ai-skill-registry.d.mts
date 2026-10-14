export type SkillPayload = { task?: { channel?: string }; copyReview?: { mode?: string } | null };
export type SkillVersion = { id: string; name: string; version: string };
export type SkillWorkflow = { id: string; label: string; description: string; skills: (SkillVersion & { description: string; instructions: string })[] };
export function skillIdsFor(stage: string, payload?: SkillPayload): string[];
export function skillVersionsFor(stage: string, payload?: SkillPayload): SkillVersion[];
export function builtinSkillInstructions(stage: string, payload?: SkillPayload): string;
export function aiSkillWorkflows(): SkillWorkflow[];
