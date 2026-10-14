export function projectKeywords(project, now = Date.now()) {
  if (!project) return [];
  const brief = project.brief || {};
  const selected = new Set(project.research?.selectedIds || []);
  const terms = [brief.name, brief.brand, brief.product,
    ...String(brief.sellingPoints || '').split(/[，,；;、\n。]+/),
    ...(project.trends?.tags || []).filter(tag => tag.enabled && Date.parse(tag.expiresAt) > now).map(tag => tag.label),
    ...(project.research?.analyses || []).filter(row => selected.has(row.id)).flatMap(row => row.tags || []),
  ];
  return [...new Set(terms.filter(value => typeof value === 'string').map(value => value.trim().replace(/^#+/, '')).filter(value => value.length >= 2 && value.length <= 100))].slice(0, 48);
}

export function splitCopyKeywords(text, terms) {
  const words = [...new Set(terms.map(word => word.trim()).filter(word => word.length >= 2 && word.length <= 100))].sort((a, b) => b.length - a.length).slice(0, 48);
  if (!words.length) return [{ text, keyword: false }];
  const pattern = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  const parts = []; let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index, end = start + match[0].length;
    // Do not highlight AI in "daily" or a short brand inside another Latin word.
    if (/^[a-z0-9_]/i.test(match[0]) && /[a-z0-9_]/i.test(text[start - 1] || '')) continue;
    if (/[a-z0-9_]$/i.test(match[0]) && /[a-z0-9_]/i.test(text[end] || '')) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), keyword: false });
    parts.push({ text: match[0], keyword: true }); cursor = end;
  }
  if (cursor < text.length || !parts.length) parts.push({ text: text.slice(cursor), keyword: false });
  return parts;
}
