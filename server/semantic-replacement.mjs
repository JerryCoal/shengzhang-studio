import { scanCopy, applyFixed, copyFields } from './sensitive-checker.mjs';
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export const numberSignature = text => JSON.stringify(String(text).match(/[0-9０-９]+(?:[.,．，][0-9０-９]+)*/gu) || []);
export function validateSemanticRule(rule) {
  if (rule.action !== 'semantic') return;
  if (!rule.replacement.trim()) fail('语义替换需要填写你指定的替换词，不能留空删除');
  if (numberSignature(rule.term) !== numberSignature(rule.replacement)) fail('语义替换不能增加、删除或更改数字，请只设置字词的替换');
}
export function semanticCandidates(draft, rules) {
  return scanCopy(draft, rules).filter(m => m.action === 'semantic').map((m, index) => ({ ...m, id: `m${index + 1}` }));
}
export function semanticResult(draft, rules, decisions) {
  const matches = semanticCandidates(draft, rules);
  if (decisions.length !== matches.length || new Set(decisions.map(d => d.id)).size !== matches.length || matches.some(m => !decisions.some(d => d.id === m.id))) fail('语义判断缺少位置或包含未知位置，原文已保留');
  const rows = matches.map(m => ({ ...m, ...decisions.find(d => d.id === m.id) }));
  if (rows.some(r => !['replace','keep','uncertain'].includes(r.decision))) fail('语义判断类型无效，原文已保留');
  const value = { ...draft };
  for (const field of ['title', 'body']) {
    const selected = rows.filter(r => r.field === field && r.decision === 'replace').map(r => ({ ...r, action: 'replace' }));
    value[field] = applyFixed(draft[field], selected);
    if (value[field].length > (field === 'title' ? 200 : 8000)) fail('语义替换后的文案过长，请缩短替换词');
    if (numberSignature(value[field]) !== numberSignature(draft[field])) fail('替换会改变数字或数字的连接方式，原文已保留，请修改替换词');
  }
  if (!value.title.trim()) fail('替换后标题为空，请修改词条');
  // Move acknowledged non-price spans to their positions in the candidate text.
  const kept = rows.filter(r => r.decision === 'keep').map(r => {
    const delta = rows.filter(p => p.field === r.field && p.decision === 'replace' && p.end <= r.start).reduce((sum,p) => sum + p.replacement.length - (p.end-p.start),0);
    return { ...r, start: r.start + delta, end: r.end + delta };
  });
  const remaining = scanCopy(value, rules).filter(m => !kept.some(k => k.field === m.field && k.ruleId === m.ruleId && k.start === m.start && k.end === m.end));
  return { candidate: value, semanticReview: { decisions: rows, scope: 'price', source: draft }, review: { at: new Date().toISOString(), hits: [], matches, source: copyFields(draft), remaining, checked: true, rulesCount: rules.filter(r => r.enabled).length, status: remaining.length ? 'needs-review' : 'clean' } };
}
