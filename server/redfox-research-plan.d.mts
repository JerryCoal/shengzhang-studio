export interface RedfoxXhsResearchPlan {
  maxPagesPerKeyword: number;
  maxDetails: number;
  maxSearchRequests: number;
  maxRequests: number;
  estimatedCny: number;
}
export function redfoxXhsResearchPlan(keywordCount: number, expanded?: boolean): RedfoxXhsResearchPlan;
