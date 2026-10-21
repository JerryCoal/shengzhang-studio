import { removeLocalDocumentData } from './local-document-privacy.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyed = rows => rows.every(row => isRecord(row) && typeof row.id === 'string') && new Set(rows.map(row => row.id)).size === rows.length;
const omitted = (value, known, keys) => { for (const key of keys) if (!Object.hasOwn(value, key) && Object.hasOwn(known, key)) value[key] = structuredClone(known[key]); };
const mediaKeys = ['recipe', 'creativeSkill', 'builtinSkills', 'userSkillVersions', 'skillTrace', 'accountContext', 'creationTrace', 'knowledgeContext'];
function restoreLocalMedia(asset, localAsset) {
  const cover = asset.aiCover, localCover = localAsset.aiCover;
  if (cover?.id && cover.id === localCover?.id && cover.assetRevision === localCover.assetRevision && same(cover.input, localCover.input)) {
    omitted(cover, localCover, [...mediaKeys, 'prompt', 'promptVersion', 'skillVersions']);
  }
  const production = asset.aiProduction, localProduction = localAsset.aiProduction;
  if (!production?.id || production.id !== localProduction?.id || production.assetRevision !== localProduction.assetRevision) return;
  omitted(production, localProduction, mediaKeys);
  for (const frame of production.frames || []) {
    const known = localProduction.frames?.find(item => item.id === frame.id && item.role === frame.role && item.prompt === frame.prompt && item.model === frame.model && item.mediaData === frame.mediaData);
    if (known) omitted(frame, known, mediaKeys);
  }
}
function removeLocalOnlyRecords(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) removeLocalOnlyRecords(item); return; }
  delete value.briefImports;
  delete value.localQwenConnection;
  // The browser relay cannot create these local-only assistant records. Ignore
  // supplied values before restoring our own exact matching local versions.
  delete value.xhsAssistant;
  delete value.xhsCoverPlan;
  delete value.knowledge;
  delete value.knowledgeContext;
  delete value.contentBrief;
  delete value.contentRequests;
  for (const key of ['contentEditDrafts', 'agentWorkspace', 'agentContext', 'agentPacket', 'agentHandoffs', 'taskJournal']) delete value[key];
  delete value.localContentOnly;
  for (const item of Object.values(value)) removeLocalOnlyRecords(item);
}
// The browser omits skill snapshots from network payloads. Reattach only an
// exact locally known asset version before the existing conflict checks run.
// A new trace returned by generation always wins over this restoration step.
function restoreLocalSkillTraces(snapshot, current) {
  const restored = structuredClone(snapshot);
  for (const project of restored.projects || []) {
    const localProject = current.projects?.find(value => value.id === project.id);
    if (!localProject) continue;
    omitted(project, localProject, ['xhsAssistant', 'knowledge', 'contentRequests', 'agentHandoffs']);
    for (const asset of localProject.assets || []) if (asset.contentBrief && !project.assets?.some(row => row.id === asset.id)) (project.assets ||= []).push(structuredClone(asset));
    for (const strategy of localProject.strategies || []) if (strategy.source === 'direct' && !project.strategies?.some(row => row.id === strategy.id)) (project.strategies ||= []).push(structuredClone(strategy));
    for (const asset of project.assets || []) {
      const localAsset = localProject.assets?.find(value => value.id === asset.id);
      if (!localAsset) continue;
      // A relay cannot change a local direct draft or its bound identity and
      // private requirements. Restore that entire asset before the merge.
      if (localAsset.contentBrief) { Object.keys(asset).forEach(key => delete asset[key]); Object.assign(asset, structuredClone(localAsset)); continue; }
      if (asset.revision === localAsset.revision && asset.title === localAsset.title && asset.body === localAsset.body) omitted(asset, localAsset, ['xhsCoverPlan']);
      restoreLocalMedia(asset, localAsset);
      const candidates = [localAsset, ...(localAsset.history || [])];
      for (const version of [asset, ...(asset.history || [])]) for (const key of ['skillTrace', 'creationTrace', 'researchReferences', 'documentContextSnapshot', 'styleReferencesSnapshot', 'knowledgeContext']) {
        if (Object.hasOwn(version, key)) continue;
        const known = candidates.find(value => value.revision === version.revision && value.title === version.title && value.body === version.body && Object.hasOwn(value, key));
        if (known) version[key] = structuredClone(known[key]);
      }
    }
    for (const strategy of project.strategies || []) {
      const localDirect = localProject.strategies?.find(value => value.id === strategy.id && value.source === 'direct');
      if (localDirect) { Object.keys(strategy).forEach(key => delete strategy[key]); Object.assign(strategy, structuredClone(localDirect)); continue; }
      const known = localProject.strategies?.find(value => value.id === strategy.id && value.version === strategy.version && value.title === strategy.title && value.core === strategy.core && value.prompt === strategy.prompt);
      for (const key of ['skillTrace', 'creationTrace', 'researchReferences', 'documentContextSnapshot', 'styleReferencesSnapshot', 'knowledgeContext', 'agentContext']) {
        if (!Object.hasOwn(strategy, key) && known && Object.hasOwn(known, key)) strategy[key] = structuredClone(known[key]);
      }
    }
    for (const usage of project.usage || []) {
      const known = localProject.usage?.find(value => value.id === usage.id && value.stage === usage.stage && value.model === usage.model && value.at === usage.at);
      if (known) omitted(usage, known, ['skillTrace', 'userSkillVersions']);
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
  removeLocalOnlyRecords(base); removeLocalOnlyRecords(remote);
  base = restoreLocalSkillTraces(base, current);
  remote = restoreLocalSkillTraces(remote, current);
  const next = structuredClone(current);
  for (const key of ['projects', 'accounts']) next[key] = merge(base[key], remote[key], current[key]);
  const old = new Set(base.activities.map(a => a.id));
  next.activities = [...remote.activities.filter(a => !old.has(a.id)), ...current.activities].filter((v, i, rows) => rows.findIndex(row => row.id === v.id) === i).slice(0, 100);
  return next;
}
