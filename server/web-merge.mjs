import { removeLocalDocumentData } from './local-document-privacy.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyed = rows => rows.every(row => isRecord(row) && typeof row.id === 'string') && new Set(rows.map(row => row.id)).size === rows.length;
// The browser omits skill snapshots from network payloads. Reattach only an
// exact locally known asset version before the existing conflict checks run.
// A new trace returned by generation always wins over this restoration step.
function restoreLocalSkillTraces(snapshot, current) {
  const restored = structuredClone(snapshot);
  for (const project of restored.projects || []) {
    const localProject = current.projects?.find(value => value.id === project.id);
    if (!localProject) continue;
    for (const asset of project.assets || []) {
      const localAsset = localProject.assets?.find(value => value.id === asset.id);
      if (!localAsset) continue;
      const candidates = [localAsset, ...(localAsset.history || [])];
      for (const version of [asset, ...(asset.history || [])]) for (const key of ['skillTrace', 'researchReferences', 'documentContextSnapshot', 'styleReferencesSnapshot']) {
        if (Object.hasOwn(version, key)) continue;
        const known = candidates.find(value => value.revision === version.revision && value.title === version.title && value.body === version.body && Object.hasOwn(value, key));
        if (known) version[key] = structuredClone(known[key]);
      }
    }
    for (const strategy of project.strategies || []) {
      const known = localProject.strategies?.find(value => value.id === strategy.id && value.version === strategy.version && value.title === strategy.title && value.core === strategy.core && value.prompt === strategy.prompt);
      for (const key of ['researchReferences', 'documentContextSnapshot', 'styleReferencesSnapshot']) {
        if (!Object.hasOwn(strategy, key) && known && Object.hasOwn(known, key)) strategy[key] = structuredClone(known[key]);
      }
    }
  }
  return restored;
}
// Apply only fields changed by this operation. Edits made meanwhile stay local.
function merge(base, remote, current) {
  if (same(base, remote)) return structuredClone(current);
  if (same(base, current)) return structuredClone(remote);
  if (same(remote, current)) return structuredClone(current);
  if ([base, remote, current].every(Array.isArray) && [base, remote, current].every(keyed)) {
    const before = new Map(base.map(v => [v.id, v])), after = new Map(remote.map(v => [v.id, v]));
    const result = current.flatMap(value => {
      if (!before.has(value.id)) return [value];
      if (!after.has(value.id)) { if (!same(value, before.get(value.id))) throw new Error('结果与本地编辑冲突'); return []; }
      return [merge(before.get(value.id), after.get(value.id), value)];
    });
    for (const value of remote) if (!before.has(value.id)) {
      const existing = result.find(v => v.id === value.id);
      if (existing && !same(existing, value)) throw new Error('结果与本地编辑冲突');
      if (!existing) result.push(structuredClone(value));
    }
    return result;
  }
  if ([base, remote, current].every(isRecord)) {
    const result = structuredClone(current);
    for (const key of new Set([...Object.keys(base), ...Object.keys(remote)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效结果字段');
      if (key === 'revision' && [base[key], remote[key], current[key]].every(Number.isInteger)) { result[key] = Math.max(current[key], remote[key]) + (same(base[key], remote[key]) ? 0 : 1); continue; }
      if (key === 'updatedAt' && [base[key], remote[key], current[key]].every(v => typeof v === 'string')) { result[key] = [remote[key], current[key]].sort().at(-1); continue; }
      const value = merge(base[key], remote[key], current[key]);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  throw new Error('结果与本地编辑冲突');
}
export function mergeRelayState(base, remote, current) {
  base = structuredClone(base); remote = structuredClone(remote);
  removeLocalDocumentData(base); removeLocalDocumentData(remote);
  base = restoreLocalSkillTraces(base, current);
  remote = restoreLocalSkillTraces(remote, current);
  const next = structuredClone(current);
  for (const key of ['projects', 'accounts']) next[key] = merge(base[key], remote[key], current[key]);
  const old = new Set(base.activities.map(a => a.id));
  next.activities = [...remote.activities.filter(a => !old.has(a.id)), ...current.activities].filter((v, i, rows) => rows.findIndex(row => row.id === v.id) === i).slice(0, 100);
  return next;
}
