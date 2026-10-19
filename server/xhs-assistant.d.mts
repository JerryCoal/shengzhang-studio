export type XhsAssistantMode = 'create' | 'rewrite' | 'titles' | 'title-score' | 'cover-plan' | 'note-score';
export type XhsAssistantJobStatus = 'running' | 'completed' | 'failed' | 'uncertain';
export interface XhsAssistantInput {
  mode: XhsAssistantMode; keyword: string; title: string; body: string; instruction: string;
  sampleId: string; assetId: string; expectedAssetRevision?: number | null; vision: boolean;
}
export interface XhsAssistantRunRequest extends XhsAssistantInput { requestId: string; confirmed: true; expectedModel?: string; maxReservationUsd?: number }
export interface XhsAssistantReference { sampleId: string; title: string; url: string; quote: string }
export interface XhsAssistantSampleItem {
  id: string; title: string; body: string; url: string; coverUrl: string; publishedAt: string; collectedAt: string;
  dateNote: string; excerpt: boolean;
  metrics: { likes: number | null; favorites: number | null; comments: number | null; shares: number | null; interactions: number | null };
}
export interface XhsAssistantSample {
  id: string; requestId: string; keyword: string; days: 1 | 3 | 7 | 30; status: XhsAssistantJobStatus;
  startDate: string; endDate: string; items: XhsAssistantSampleItem[]; warnings: string[];
  createdAt: string; finishedAt?: string; error?: string; reservationCny: number;
  accountId: string; accountName: string;
}
export interface XhsAssistantDimension { id: string; name: string; score: number; reason: string; weight?: number }
export interface XhsAssistantResultBase { summary: string; limitations: string[]; evidence: { sampleId: string; quote: string }[]; references: XhsAssistantReference[] }
export interface XhsAssistantCopyResult extends XhsAssistantResultBase { title: string; body: string; prompt: string; scenes: string[] }
export interface XhsAssistantTitlesResult extends XhsAssistantResultBase {
  titles: { title: string; reason: string; matchScore: number; sampleIds: string[] }[];
  scoreLabel: string;
}
export interface XhsAssistantTitleScoreResult extends XhsAssistantResultBase {
  title: string; dimensions: XhsAssistantDimension[]; totalScore: number; maxScore: 10; grade: 'S' | 'A' | 'B' | 'C'; improvements: string[]; alternatives: { title: string; reason: string }[]; scoreLabel: string;
}
export interface XhsAssistantNoteScoreResult extends XhsAssistantResultBase {
  dimensions: XhsAssistantDimension[]; totalScore: number; maxScore: 100; grade: string; improvements: string[]; strengths: string[]; keywords: string[]; scoreLabel: string;
}
export interface XhsAssistantCoverResult extends XhsAssistantResultBase {
  vision: boolean; observations: { sampleId: string; observation: string }[];
  plans: { name: string; headline: string; prompt: string; layout: string; colors: string; reason: string; sampleIds: string[] }[];
}
export type XhsAssistantResult = XhsAssistantCopyResult | XhsAssistantTitlesResult | XhsAssistantTitleScoreResult | XhsAssistantNoteScoreResult | XhsAssistantCoverResult;
export interface XhsAssistantRun {
  id: string; requestId: string; mode: XhsAssistantMode; status: XhsAssistantJobStatus;
  input: XhsAssistantInput; result?: XhsAssistantResult; stale: boolean; staleReason: string;
  model: string; provider: string; reservationUsd: number; amountUsd?: number; estimated?: boolean; usageId?: string;
  accountId: string; accountName: string; profileRevision: number; warnings: string[];
  createdAt: string; finishedAt?: string; error?: string; adoptedAt?: string; adoptedAssetId?: string; adoptedRevision?: number;
  skillTrace?: unknown; creationTrace?: unknown; knowledgeContext?: import('./content-workflow.mjs').KnowledgeContext; corpusReferences?: import('../src/types').CorpusReference[]; researchReferences?: import('./research-data.mjs').ResearchContext[];
}
export interface XhsAssistantState { samples: XhsAssistantSample[]; runs: XhsAssistantRun[] }
export interface XhsAssistantEstimate {
  mode: XhsAssistantMode; model: string; provider: string; reservationUsd: number; vision: boolean;
  imageCount: number; imageReservationUsd: number; sampleCount: number; warnings: string[];
  accountId: string; accountName: string; profileRevision: number;
}
export interface XhsAssistantStatus extends XhsAssistantState {
  modes: XhsAssistantMode[];
  models: { text: { model: string; provider: string; label: string; configured: boolean }; analysis: { model: string; provider: string; label: string; configured: boolean }; vision: { model: string; provider: string; configured: boolean; supported: boolean; reason: string } };
  redfox: { enabled: boolean; configured: boolean; reservationCny: number };
  account: { id: string; name: string; profileRevision: number } | null;
}
export const XHS_ASSISTANT_MODES: readonly XhsAssistantMode[];
export const XHS_ASSISTANT_WORKFLOWS: Record<XhsAssistantMode, string>;
export const XHS_TITLE_DIMENSIONS: readonly { id: string; name: string; weight: number }[];
export const XHS_NOTE_DIMENSIONS: readonly { id: string; name: string }[];
export function xhsAssistantOf(project: object): XhsAssistantState;
export function xhsAssistantDefinition(mode: XhsAssistantMode): { schema: object; validate(value: unknown, payload: any): XhsAssistantResult };
export function xhsAssistantInstructions(mode: XhsAssistantMode, payload?: any): string;
export function xhsSampleDateRange(days: 1 | 3 | 7 | 30, at?: number): { startDate: string; endDate: string };
export function xhsSampleItems(data: unknown, at?: number, range?: { startDate: string; endDate: string }): { items: XhsAssistantSampleItem[]; warnings: string[] };
export function safeXhsCoverUrl(value: unknown): string;
