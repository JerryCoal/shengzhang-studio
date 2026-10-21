export type ResearchPlatform = 'xiaohongshu' | 'douyin' | 'tiktok' | 'youtube' | 'instagram';
export type ResearchKind = 'web' | 'rss' | ResearchPlatform;
export type ResearchRisk = 'review' | 'unverified';
export type ResearchMetric = { value: number | null; raw: string; approximate: boolean };
export type XhsDiscovery = { timeRange: 'week' | 'month' | 'all'; sortBy: 'general' | 'views' | 'likes' | 'favorites' | 'comments' | 'shares'; noteType: 'all' | 'image' | 'video'; platform?: ResearchPlatform };
export type XhsDiscoveryRanking = {
  sampleRank: number; sortBy: XhsDiscovery['sortBy']; sortValue: number | null; matchedKeywords: string[];
  visibleInteractions: number | null; knownMetrics: ('likes' | 'comments' | 'favorites' | 'shares')[]; approximate: boolean;
};
export type ResearchGrowthAdvice = {
  focus: 'title' | 'opening' | 'content' | 'tags' | 'engagement' | 'experiment'; action: string; reason: string; validation: string; referenceIds: string[];
};
export type ResearchReference = {
  imageEvidence?: import('./research-image-evidence.mjs').ResearchImageEvidence;
  id: string; kind: ResearchKind; title: string; url: string; text: string;
  noteType?: 'image' | 'video' | 'unknown';
  publishedAt: string; collectedAt: string; dateBasis: string; sourceName: string;
  sourceAccountId?: string; sourceAccountName?: string;
  metrics: Record<'likes' | 'comments' | 'favorites' | 'shares', ResearchMetric> & { views?: ResearchMetric };
  risk: ResearchRisk; riskReason: string;
  discoveryRanking?: XhsDiscoveryRanking;
  topicRanking?: { platform: ResearchPlatform; metric: string; sortBy: XhsDiscovery['sortBy']; sampleRank: number | null; matchedKeywords: string[]; relevant: boolean; value: number | null; approximate: boolean; knownSamples: number; relevantSamples: number; sampleMedian: number | null; comparison: string };
};
export type RawResearchReference = {
  imageEvidence?: import('./research-image-evidence.mjs').ResearchImageEvidence;
  kind: ResearchKind; externalId?: string; title: string; url?: string; text: string;
  noteType?: 'image' | 'video' | 'unknown';
  publishedAt?: string | number; collectedAt?: string | number; dateBasis?: string; sourceName?: string;
  sourceAccountId?: string; sourceAccountName?: string;
  metrics?: Partial<Record<'views' | 'likes' | 'comments' | 'favorites' | 'shares', number | string | null | ResearchMetric>> | null;
};
export type ResearchEvidence = { referenceId: string; quote: string };
export type ResearchAnalysis = {
  id: string; title: string; observation: string; hypothesis: string; application: string;
  tags: string[]; evidence: ResearchEvidence[]; limitations: string; risk: ResearchRisk; riskReason: string;
  discovery?: XhsDiscovery; growthAdvice?: ResearchGrowthAdvice[];
};
export type ResearchExcluded = Record<'invalid' | 'unsafeUrl' | 'missingDate' | 'uncertainDate' | 'future' | 'expired' | 'noteType' | 'emptyContent' | 'dispute' | 'blocked' | 'duplicate' | 'limit', number>;
export type ResearchCollectionStats = Record<'rawCount' | 'normalizedCount' | 'invalidCount' | 'duplicateCount' | 'missingDateCount' | 'emptyContentCount' | 'searchRequests' | 'detailRequests', number>;
export type ResearchReport = { sourceId: string; name: string; status: 'ok' | 'failed' | 'skipped'; count: number; message: string; stats?: ResearchCollectionStats };
export type ResearchSummary = {
  runId: string; mode: 'collected' | 'reused'; candidateCount: number; eligibleCount: number; pendingCount: number; analysisCount: number;
  sourceReports: number; failedSources: number; excluded: ResearchExcluded;
  collection: { coverage: 'complete' | 'partial' | 'unavailable'; reportCount: number } & { [K in keyof ResearchCollectionStats]: number | null };
};
export type ResearchState = {
  revision: number; references: ResearchReference[]; analyses: ResearchAnalysis[]; selectedIds: string[];
  reports: ResearchReport[]; queries: string[]; acknowledgedIds?: string[]; selectedAt?: string;
  summary?: ResearchSummary;
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
export const RESEARCH_EXCLUDED_KEYS: readonly (keyof ResearchExcluded)[];
export const RESEARCH_COLLECTION_STATS: readonly (keyof ResearchCollectionStats)[];
export function cleanReferences(raw: RawResearchReference[], options?: { keywords?: string[]; blockTerms?: string[]; genericTerms?: string[]; at?: number | string | Date; discovery?: XhsDiscovery }): {
  references: ResearchReference[];
  excluded: ResearchExcluded;
};
export function researchSummary(input: { runId: string; mode?: 'collected' | 'reused'; raw?: unknown[]; cleaned?: { references?: ResearchReference[]; excluded?: ResearchExcluded }; reports?: ResearchReport[]; pendingReferences?: { title: string; url: string; reason: string }[]; analysisCount?: number }): ResearchSummary;
export function researchEmptyReason(summary: ResearchSummary): string;
export function rankXhsReferences(references: ResearchReference[], options?: { keywords?: string[]; sortBy?: XhsDiscovery['sortBy'] }): ResearchReference[];
export function researchOf(project?: { research?: ResearchState }): ResearchState;
export function researchCorpus(projectOrReferences: ResearchProject | ResearchReference[], projectId?: string): ResearchCorpus;
export function validateResearchAnalysis(value: unknown, payload: { references: ResearchReference[]; keywords?: string[]; blockTerms?: string[]; genericTerms?: string[]; discovery?: XhsDiscovery }): { analyses: ResearchAnalysis[] };
export function selectResearch(project: ResearchProject, input: { expectedRevision: number; analysisIds: string[]; acknowledgedIds?: string[]; confirmed: true }, at?: number | string | Date | { at?: number | string | Date }): ResearchState;
export function selectedResearchContext(project: ResearchProject, at?: number | string | Date): ResearchContext[];
