import type { ResearchReference, XhsDiscovery } from './research-data.mjs';
export const RESEARCH_PLATFORMS: readonly string[];
export const RESEARCH_PLATFORM_NAMES: Record<string, string>;
export const TOPIC_SORTS: readonly string[];
export function rankTopicReferences(references: ResearchReference[], options?: { keywords?: string[]; sortBy?: XhsDiscovery['sortBy']; platform?: string; limit?: number }): { references: ResearchReference[]; analysisReferences: ResearchReference[]; summary: { platform: string; metric: string; total: number; related: number; unrelated: number; knownMetrics: number; unknownMetrics: number; sampleMedian: number | null; analyzed: number; note: string } };
