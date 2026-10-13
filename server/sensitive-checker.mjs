// Literal matching only. Offsets are UTF-16 [start, end), suitable for JS text fields.
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const actionOf = rule => rule.action || 'replace';
export function scanText(text, rules, field = 'body') {
  const selected = rules.filter(r => r.enabled && r.term).slice().sort((a, b) => b.term.length - a.term.length);
  if (!selected.length) return [];
  const pattern = new RegExp(selected.map(r => escape(r.term)).join('|'), 'giu');
  return Array.from(text.matchAll(pattern), match => {
    const rule = selected.find(r => new RegExp(`^${escape(r.term)}$`, 'iu').test(match[0]));
    const start = match.index, end = start + match[0].length;
    return { ruleId: rule.id, field, original: match[0], replacement: rule.replacement, action: actionOf(rule), risk: rule.risk || 'A', start, end, context: text.slice(Math.max(0, start - 20), end + 20) };
  }).filter(hit => hit.action !== 'allow');
}
export function copyFields(input) {
  const fields = Object.fromEntries(['title', 'core', 'direction', 'body', 'prompt'].filter(k => typeof input[k] === 'string').map(k => [k, input[k]]));
  if (Array.isArray(input.scenes)) input.scenes.forEach((s, i) => { fields[`分镜${i + 1}`] = String(s); });
  return fields;
}
export const scanCopy = (input, rules) => Object.entries(copyFields(input)).flatMap(([field, text]) => scanText(text, rules, field));
export function applyFixed(text, matches) {
  let value = text;
  for (const hit of matches.slice().reverse()) if (hit.action === 'replace') value = value.slice(0, hit.start) + hit.replacement + value.slice(hit.end);
  return value;
}
// RFC 4180 quoting, also used for pipe-delimited TXT. No executable regular expressions.
function rowsOf(text, delimiter) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } } else value += c; }
    else if (c === '"' && !value && !closed) quoted = true;
    else if (c === delimiter || c === '\n' || c === '\r') {
      row.push(value); value = ''; closed = false;
      if (c !== delimiter) { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed || c === '"') throw new Error('引号格式错误，请使用成对双引号，内部双引号写成两个'); value += c; }
  }
  if (quoted) throw new Error('有未闭合的双引号');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
export function parseRules(text, format = 'txt') {
  if (text.length > 200000) throw new Error('词库文件过大，最多 20 万字符');
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\uFFFD')) throw new Error('文件编码无法识别，请另存为 UTF-8');
  const rows = rowsOf(text, format === 'csv' ? ',' : '|'), rules = [], seen = new Set();
  rows.forEach((raw, i) => {
    if (raw.every(x => !x.trim()) || /^#(?:\s|$)/.test(raw[0].trim())) return;
    let row = raw;
    if (format !== 'csv' && raw.length === 1 && raw[0].includes('=')) { const at = raw[0].indexOf('='); row = [raw[0].slice(0, at), 'replace', raw[0].slice(at + 1), 'A']; }
    if (['敏感词', 'term'].includes(row[0]) && ['处理方式', 'action'].includes(row[1])) return;
    const [term, action, replacement, risk, enabled] = row.map(v => v.trim());
    if (![4, 5].includes(row.length) || !term || term.length > 60 || !['replace', 'rewrite', 'allow', 'semantic'].includes(action) || replacement.length > 120 || !/^[A-Za-z0-9_-]{1,20}$/.test(risk) || (enabled !== undefined && !['true', 'false'].includes(enabled)) || [term, replacement].some(v => /[\r\n\u0000]/.test(v))) throw new Error(`第 ${i + 1} 条格式有误：敏感词|replace/rewrite/allow/semantic|推荐替换|风险类型`);
    const key = term.toLowerCase(); if (seen.has(key)) throw new Error(`词库内有重复词条：${term}`); seen.add(key);
    rules.push({ id: globalThis.crypto.randomUUID(), term, action, replacement, risk, enabled: enabled !== 'false' });
  });
  if (rules.length > 500) throw new Error('最多导入 500 条词条');
  if (!rules.length) throw new Error('文件中没有有效词条');
  return rules;
}
export function serializeRules(rules, format = 'txt') {
  const delimiter = format === 'csv' ? ',' : '|';
  const quote = s => { const value = String(s); return /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replaceAll('"', '""')}"` : value; };
  return '\uFEFF' + [['敏感词', '处理方式', '推荐替换', '风险类型', 'enabled'], ...rules.map(r => [r.term, actionOf(r), r.replacement, r.risk || 'A', r.enabled])].map(row => row.map(quote).join(delimiter)).join('\r\n');
}
export function mergeRules(existing, incoming) {
  const seen = new Set(existing.map(r => r.term.toLowerCase()));
  const added = incoming.filter(r => !seen.has(r.term.toLowerCase()));
  if (existing.length + added.length > 500) throw new Error('合并后超过 500 条，请先精简词库');
  return { rules: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
}
