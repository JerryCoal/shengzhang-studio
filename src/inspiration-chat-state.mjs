const supported = [
  ['xiaohongshu', /小红书|xiaohongshu|\bxhs\b/i],
  ['douyin', /抖音|\bdouyin\b/i],
  ['instagram', /instagram|\bins\b|\big\b/i],
  ['youtube', /youtube|油管|\byt\b/i],
];

// This is a visible target suggestion, not model-based routing or publication
// permission. Ambiguous multi-platform text keeps the current explicit target.
export function suggestInspirationTarget(draft, message) {
  const mentioned = supported.filter(([, expression]) => expression.test(message)).map(([platform]) => platform);
  const platform = mentioned.length === 1 ? mentioned[0] : draft.platform;
  const changed = platform !== draft.platform;
  return {
    draft: changed ? changeInspirationTarget(draft, platform, '') : structuredClone(draft),
    changed, mentioned,
  };
}

export function changeInspirationTarget(draft, platform, accountId) {
  if (platform === draft.platform && accountId === draft.accountId) return structuredClone(draft);
  return { ...structuredClone(draft), platform, accountId, kind: platform === 'youtube' || platform === 'douyin' ? 'video' : 'image', knowledgeIds: [], experienceIds: [], referenceIds: [], idea: undefined, requirement: '' };
}

export function scopedInspirationTurns(conversation, platform, accountId) {
  return (conversation?.turns || []).filter(turn => turn.platform === platform && turn.accountId === accountId);
}

export function inspirationCanReview({ loaded, busy, input, conversation, localData = false }) {
  return loaded && !busy && !localData && !!input.trim() && input.trim().length <= 4000 && (conversation?.turns.length || 0) < 20 && !(conversation?.turns || []).some(turn => turn.status === 'pending');
}

// The editable adopted idea is authoritative, not an early conversation request
// which the user may have reversed in a later turn. Full detail stays in idea.
export function inspirationHandoffRequirement(draft, input = '') {
  if (!draft.idea) return (input.trim() || draft.requirement || '').trim();
  return `按本次已确认灵感方案制作，以资料包中最新的标题、核心表达、内容方向与完整创作提示为准；不沿用对话中已被替换的早期方案。\n主题：${draft.idea.title}\n核心表达：${draft.idea.core}`;
}

export function inspirationDraftFingerprint(draft) {
  const semantic = Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'updatedAt'));
  return JSON.stringify(semantic, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
