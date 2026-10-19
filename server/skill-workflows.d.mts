export type SkillWorkflowId = 'xhs-creator' | 'xhs-title-score' | 'xhs-cover' | 'xhs-note-analyzer' | 'brief-import' | 'document-context' | 'research-query' | 'web-search' | 'research-analysis' | 'strategy' | 'planning' | 'copy-xiaohongshu' | 'copy-douyin' | 'copy-tiktok' | 'copy-youtube' | 'copy-instagram' | 'word-review' | 'price-semantic' | 'classification' | 'analysis' | 'cover' | 'first_frame' | 'last_frame' | 'video';
export type SkillWorkflowDefinition = Readonly<{ id: SkillWorkflowId; label: string; description: string; stage: string; platform?: import('./platform-catalog.mjs').MatrixPlatform }>;
export const SKILL_WORKFLOW_IDS: readonly SkillWorkflowId[];
export const SKILL_WORKFLOWS: readonly SkillWorkflowDefinition[];
export function skillWorkflowId(stage: string, payload?: { task?: { channel?: string }; copyReview?: { mode?: string } | null }): SkillWorkflowId;
