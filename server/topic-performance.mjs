export const RESEARCH_PLATFORMS = ['xiaohongshu', 'douyin', 'tiktok', 'youtube', 'instagram'];
export const RESEARCH_PLATFORM_NAMES = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' };
export const TOPIC_SORTS = ['general', 'views', 'likes', 'favorites', 'comments', 'shares'];
const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
const containsTerm = (text, term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`${/^[a-z0-9_]/u.test(term) ? '(?:^|[^a-z0-9_])' : ''}${escaped}${/[a-z0-9_]$/u.test(term) ? '(?=$|[^a-z0-9_])' : ''}`, 'u').test(text);
};
const count = value => Number.isSafeInteger(value?.value) && value.value >= 0 ? value.value : null;
const knownFirst = (a, b) => a === null ? b === null ? 0 : 1 : b === null ? -1 : b - a;

// All comparisons are inside one platform and the returned sample. No sum of
// partially visible counters and no cross-platform "virality score" is created.
export function rankTopicReferences(references, { keywords = [], sortBy = 'general', platform = 'xiaohongshu', limit = 10 } = {}) {
  if (!RESEARCH_PLATFORMS.includes(platform) || !TOPIC_SORTS.includes(sortBy)) throw Object.assign(new Error('同话题内容研究的来源或排序无效'), { status: 400 });
  if (!Array.isArray(references)) throw Object.assign(new Error('研究样本必须是列表'), { status: 400 });
  const terms = [...new Set(keywords.filter(term => typeof term === 'string').map(normalized).filter(Boolean))].slice(0, 30);
  const rows = references.filter(reference => reference?.kind === platform).map(reference => {
    const title = normalized(reference.title), text = normalized(reference.text);
    // Deliberately use the user's concrete phrases. Unmatched results remain
    // visible for review, but never silently become "same-topic" AI evidence.
    const matchedKeywords = terms.filter(term => containsTerm(title, term) || containsTerm(text, term));
    return { reference, matchedKeywords, titleMatches: matchedKeywords.filter(term => containsTerm(title, term)).length };
  });
  const related = rows.filter(row => row.matchedKeywords.length);
  const metric = sortBy === 'general' ? platform !== 'xiaohongshu' && related.some(row => count(row.reference.metrics?.views) !== null) ? 'views' : 'likes' : sortBy;
  const known = related.map(row => count(row.reference.metrics?.[metric])).filter(value => value !== null).sort((a, b) => a - b);
  const median = known.length >= 5 ? known.length % 2 ? known[(known.length - 1) / 2] : (known[known.length / 2 - 1] + known[known.length / 2]) / 2 : null;
  rows.sort((a, b) => Number(!!b.matchedKeywords.length) - Number(!!a.matchedKeywords.length)
    || knownFirst(count(a.reference.metrics?.[metric]), count(b.reference.metrics?.[metric]))
    || b.matchedKeywords.length - a.matchedKeywords.length || b.titleMatches - a.titleMatches
    || Date.parse(b.reference.publishedAt) - Date.parse(a.reference.publishedAt) || a.reference.id.localeCompare(b.reference.id));
  let sampleRank = 0;
  const ranked = rows.map(({ reference, matchedKeywords }) => {
    const value = count(reference.metrics?.[metric]), relevant = matchedKeywords.length > 0;
    return { ...reference, topicRanking: {
      platform, metric, sortBy, sampleRank: relevant && value !== null ? ++sampleRank : null,
      matchedKeywords, relevant, value, approximate: !!reference.metrics?.[metric]?.approximate,
      knownSamples: known.length, relevantSamples: related.length, sampleMedian: median,
      comparison: !relevant ? 'topic-unverified' : value === null ? 'metric-unavailable' : known.length < 5 ? 'small-sample' : 'sample-only',
    } };
  });
  // Unknown metric rows may explain useful wording, but do not displace known
  // high-performing related samples. They are explicitly labelled in the UI/AI.
  const eligible = ranked.filter(reference => reference.topicRanking.relevant), maximum = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 10;
  // Reserve at most two lower-ranked, known-metric peers for contrast when
  // enough samples exist. This is descriptive comparison, not an experiment.
  const peers = eligible.filter(reference => reference.topicRanking.value !== null);
  const comparisonCount = Math.min(2, maximum - 1), comparison = comparisonCount && eligible.length > maximum && peers.length > maximum ? peers.slice(-comparisonCount) : [];
  const ids = new Set(comparison.map(reference => reference.id));
  const leaders = eligible.filter(reference => !ids.has(reference.id)).slice(0, maximum - comparison.length);
  const analysisReferences = [...leaders, ...comparison].map(reference => ({ ...reference, analysisRole: ids.has(reference.id) ? 'comparison-sample' : reference.topicRanking.value === null ? 'missing-metric' : 'leading-sample' }));
  return { references: ranked, analysisReferences, summary: { platform, metric, total: rows.length, related: related.length, unrelated: rows.length - related.length,
    knownMetrics: known.length, unknownMetrics: related.length - known.length, sampleMedian: median, analyzed: analysisReferences.length,
    note: '先核对同话题，再按同一平台的单项可见指标排序。未命中关键词的候选不进入分析；可添加同义词后重试。只代表本次返回样本，播放量、曝光量和互动量不能互换。' } };
}
