export type ResearchKind = 'web' | 'xiaohongshu' | 'rss';
export type ResearchRisk = 'review' | 'unverified';
export type ResearchMetric = { value: number | null; raw: string; approximate: boolean };
export type XhsDiscovery = { timeRange: 'week' | 'month' | 'all'; sortBy: 'general' | 'likes' | 'favorites' | 'comments'; noteType: 'all' | 'image' | 'video' };
export type XhsDiscoveryRanking = {
  sampleRank: number; sortBy: XhsDiscovery['sortBy']; sortValue: number | null; matchedKeywords: string[];
  visibleInteractions: number | null; knownMetrics: ('likes' | 'comments' | 'favorites' | 'shares')[]; approximate: boolean;
};
export type ResearchGrowthAdvice = {
  focus: 'title' | 'opening' | 'content' | 'tags' | 'engagement' | 'experiment'; action: string; reason: string; validation: string; referenceIds: string[];
};
export type ResearchReference = {
  id: string; kind: ResearchKind; title: string; url: string; text: string;
  noteType?: 'image' | 'video' | 'unknown';
  publishedAt: string; collectedAt: string; dateBasis: string; sourceName: string;
  metrics: Record<'likes' | 'comments' | 'favorites' | 'shares', ResearchMetric>;
  risk: ResearchRisk; riskReason: string;
  discoveryRanking?: XhsDiscoveryRanking;
};
export type RawResearchReference = {
  kind: ResearchKind; externalId?: string; title: string; url?: string; text: string;
  noteType?: 'image' | 'video' | 'unknown';
  publishedAt?: string | number; collectedAt?: string | number; dateBasis?: string; sourceName?: string;
  metrics?: Partial<Record<'likes' | 'comments' | 'favorites' | 'shares', number | string | null | ResearchMetric>> | null;
};
export type ResearchEvidence = { referenceId: string; quote: string };
export type ResearchAnalysis = {
  id: string; title: string; observation: string; hypothesis: string; application: string;
  tags: string[]; evidence: ResearchEvidence[]; limitations: string; risk: ResearchRisk; riskReason: string;
  discovery?: XhsDiscovery; growthAdvice?: ResearchGrowthAdvice[];
};
export type ResearchReport = { sourceId: string; name: string; status: 'ok' | 'failed' | 'skipped'; count: number; message: string };
export type ResearchState = {
  revision: number; references: ResearchReference[]; analyses: ResearchAnalysis[]; selectedIds: string[];
  reports: ResearchReport[]; queries: string[]; acknowledgedIds?: string[]; selectedAt?: string;
  pendingReferences?: { title: string; url: string; reason: string }[];
  keywords?: string[]; blockTerms?: string[]; genericTerms?: string[];
  settings?: { keywords?: string[]; blockTerms?: string[]; genericTerms?: string[] };
  [key: string]: unknown;
};
export type ResearchProject = { id: string; research?: ResearchState; trends?: { settings?: { blockTerms?: string[]; genericTerms?: string[] } } };
export type ResearchContext = {
  analysisId: string; title: string; observation: string; hypothesis: string; application: string;
  tags: string[]; limitations: string; risk: ResearchRisk; riskReason: string;
  discovery?: XhsDiscovery; growthAdvice?: ResearchGrowthAdvice[];
  evidence: { referenceId: string; title: string; url: string; publishedAt: string; dateBasis: string; quote: string }[];
};
export type ResearchCorpus = {
  id: string;
  corpus: { id: string; name: string; text: string; enabled: true; format: 'external-reference'; importedAt: string;
    chunks: { index: number; text: string }[]; referenceId: string; sourceUrl: string; publishedAt: string; dateBasis: string; kind: ResearchKind }[];
};
export const RESEARCH_WEEK: number;
export const RESEARCH_MAX_REFERENCES: number;
export const RESEARCH_MAX_TEXT: number;
export function cleanReferences(raw: RawResearchReference[], options?: { keywords?: string[]; blockTerms?: string[]; genericTerms?: string[]; at?: number | string | Date; discovery?: XhsDiscovery }): {
  references: ResearchReference[];
  excluded: Record<'invalid' | 'unsafeUrl' | 'missingDate' | 'uncertainDate' | 'future' | 'expired' | 'noteType' | 'emptyContent' | 'dispute' | 'blocked' | 'duplicate' | 'limit', number>;
};
export function rankXhsReferences(references: ResearchReference[], options?: { keywords?: string[]; sortBy?: XhsDiscovery['sortBy'] }): ResearchReference[];
export function researchOf(project?: { research?: ResearchState }): ResearchState;
export function researchCorpus(projectOrReferences: ResearchProject | ResearchReference[], projectId?: string): ResearchCorpus;
export function validateResearchAnalysis(value: unknown, payload: { references: ResearchReference[]; keywords?: string[]; blockTerms?: string[]; genericTerms?: string[]; discovery?: XhsDiscovery }): { analyses: ResearchAnalysis[] };
export function selectResearch(project: ResearchProject, input: { expectedRevision: number; analysisIds: string[]; acknowledgedIds?: string[]; confirmed: true }, at?: number | string | Date | { at?: number | string | Date }): ResearchState;
export function selectedResearchContext(project: ResearchProject, at?: number | string | Date): ResearchContext[];
