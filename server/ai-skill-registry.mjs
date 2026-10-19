import { AI_SKILLS } from './ai-skills-manifest.mjs';
import { z } from 'zod';
import { COPY_SKILLS, COPY_SKILL_VERSIONS } from './copy-skills.generated.mjs';
import { SKILL_WORKFLOWS, skillWorkflowId } from './skill-workflows.mjs';
export { skillWorkflowId } from './skill-workflows.mjs';
const snapshotDate = z.iso.datetime();

export function skillIdsFor(stage, payload = {}) {
  const community = { 'xhs-creator': 'redfox-xiaohongshu-creator', 'xhs-title-score': 'redfox-xiaohongshu-title-score', 'xhs-cover': 'redfox-xiaohongshu-cover', 'xhs-note-analyzer': 'redfox-xiaohongshu-note-analyzer' }[stage];
  if (community) return [community];
  if (stage === 'brief-import') return ['project-brief-import'];
  if (stage === 'web-search') return ['web-news-search'];
  if (stage.startsWith('copy-')) {
    if (!SKILL_WORKFLOWS.some(item => item.id === stage && item.platform)) throw new Error('未知 AI 规则步骤');
    return skillIdsFor('copy', { ...payload, task: { ...payload.task, channel: stage.slice(5) } });
  }
  if (stage === 'document-context' || stage === 'research-query' || stage === 'research-analysis') return [stage];
  if (stage === 'copy') {
    if (payload.copyReview?.mode === 'semantic') return ['price-context-replacement'];
    if (payload.copyReview) return ['sensitive-copy-review'];
    const platform = { xiaohongshu: 'xiaohongshu-copywriting', douyin: 'douyin-copywriting' }[payload.task?.channel];
    return ['marketing-copywriting', ...(platform ? [platform] : []), 'natural-copy-editing'];
  }
  const id = { strategy: 'marketing-strategy', planning: 'iteration-planning', classification: 'comment-classification', analysis: 'comment-insight-analysis', cover: 'cover-art-direction', first_frame: 'keyframe-continuity', last_frame: 'keyframe-continuity', video: 'seedance-motion', 'word-review': 'sensitive-copy-review', 'price-semantic': 'price-context-replacement' }[stage];
  if (!id) throw new Error('未知 AI 规则步骤');
  return [id];
}
function entry(id) {
  const meta = AI_SKILLS.find(skill => skill.id === id);
  if (!meta || !COPY_SKILLS[id] || !COPY_SKILL_VERSIONS[id]) throw new Error(`内置规则尚未编译：${id}`);
  return { ...meta, version: COPY_SKILL_VERSIONS[id], instructions: COPY_SKILLS[id] };
}
// A supplied snapshot is authoritative for the whole step: never silently mix
// old task instructions with today's defaults or accept another platform's set.
export function skillEntriesFor(stage, payload = {}) {
  if (payload.builtinSkills === undefined) return skillIdsFor(stage, payload).map(entry);
  const fail = () => { throw Object.assign(new Error('默认规则快照与当前工作步骤不一致或已损坏，请重新开始该任务'), { status: 400 }); };
  const workflowId = skillWorkflowId(stage, payload), ids = skillIdsFor(workflowId);
  const snapshots = payload.builtinSkills;
  if (!Array.isArray(snapshots) || snapshots.length !== ids.length) fail();
  return snapshots.map((saved, index) => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.workflowId !== workflowId || saved.id !== ids[index]) fail();
    for (const key of ['name', 'version', 'baseVersion']) if (typeof saved[key] !== 'string' || !saved[key].trim() || saved[key].length > (key === 'name' ? 160 : 140) || /[\u0000-\u001f\u007f]/u.test(saved[key])) fail();
    if (typeof saved.customized !== 'boolean' || typeof saved.instructions !== 'string' || !saved.instructions.trim() || new TextEncoder().encode(saved.instructions).byteLength > 24 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(saved.instructions)) fail();
    if (Array.from(saved.instructions).some(char => { const code = char.codePointAt(0); return code >= 0xd800 && code <= 0xdfff; })) fail();
    if (saved.customized && (!Number.isSafeInteger(saved.revision) || saved.revision < 1 || !snapshotDate.safeParse(saved.updatedAt).success || saved.version !== `${saved.baseVersion}+local.${saved.revision}`)) fail();
    if (!saved.customized && (saved.version !== saved.baseVersion || saved.revision !== undefined || saved.updatedAt !== undefined)) fail();
    // Select known fields only; never propagate arbitrary data from a backup.
    return { ...entry(saved.id), workflowId, name: saved.name, version: saved.version, instructions: saved.instructions, baseVersion: saved.baseVersion, customized: saved.customized,
      ...(saved.customized ? { revision: saved.revision, updatedAt: saved.updatedAt } : {}),
    };
  });
}
export function skillVersionsFor(stage, payload = {}) {
  return skillEntriesFor(stage, payload).map(({ id, name, version }) => ({ id, name, version }));
}
export function builtinSkillInstructions(stage, payload = {}) {
  return skillEntriesFor(stage, payload).map(skill => skill.instructions).join('\n\n');
}
export function aiSkillWorkflows() {
  return SKILL_WORKFLOWS.map(({ id, label, description, stage, platform }) => ({ id, label, description, skills: skillIdsFor(stage, platform ? { task: { channel: platform } } : {}).map(entry) }));
}
