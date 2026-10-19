import { REDFOX_SOCIAL_OPERATIONS } from './redfox-social-catalog.mjs';

// Shared by the confirmation UI and collector. Details are a whole-run budget,
// not an allowance for each keyword. Zero is useful while a form is being edited.
export function redfoxXhsResearchPlan(keywordCount, expanded = false) {
  const count = Number.isFinite(keywordCount) ? Math.max(0, Math.min(3, Math.floor(keywordCount))) : 0;
  const maxPagesPerKeyword = expanded === true ? 2 : 1;
  const maxDetails = count && expanded === true ? 3 : 0;
  const maxSearchRequests = count * maxPagesPerKeyword;
  const estimatedCny = maxSearchRequests * REDFOX_SOCIAL_OPERATIONS['social.search.xiaohongshu'].priceCny
    + maxDetails * REDFOX_SOCIAL_OPERATIONS['social.detail.xiaohongshu'].priceCny;
  return { maxPagesPerKeyword, maxDetails, maxSearchRequests, maxRequests: maxSearchRequests + maxDetails, estimatedCny: Math.round(estimatedCny * 10000) / 10000 };
}
