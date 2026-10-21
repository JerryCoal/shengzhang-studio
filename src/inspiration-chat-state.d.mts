import type { AgentDraft } from './pages/AgentWorkspace';
import type { InspirationConversation, InspirationTurn } from '../server/inspiration-conversation.mjs';
export function suggestInspirationTarget(draft: AgentDraft, message: string): { draft: AgentDraft; changed: boolean; mentioned: string[] };
export function changeInspirationTarget(draft: AgentDraft, platform: AgentDraft['platform'], accountId: string): AgentDraft;
export function scopedInspirationTurns(conversation: InspirationConversation | undefined, platform: string, accountId: string): InspirationTurn[];
export function inspirationCanReview(input: { loaded: boolean; busy: boolean; input: string; conversation?: InspirationConversation; localData?: boolean }): boolean;
export function inspirationHandoffRequirement(draft: AgentDraft, input?: string): string;
export function inspirationDraftFingerprint(draft: AgentDraft): string;
