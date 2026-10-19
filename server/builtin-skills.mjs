import { z } from 'zod';
import { skillEntriesFor } from './ai-skill-registry.mjs';
import { SKILL_WORKFLOW_IDS } from './skill-workflows.mjs';

// Editable defaults are workspace data. This module is also used in the local
// browser store; Markdown never grants filesystem, network or tool execution.
export const BUILTIN_SKILL_MAX_BYTES = 24 * 1024;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const workflow = z.enum(SKILL_WORKFLOW_IDS);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const version = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u);
const overrideSchema = z.object({ instructions: z.string().min(1).max(BUILTIN_SKILL_MAX_BYTES), baseVersion: version, revision: revision.refine(value => value > 0), updatedAt: z.iso.datetime() }).strict();
const targetSchema = z.object({ workflowId: workflow, skillId: z.string().min(1).max(100), expectedRevision: revision }).strict();
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function validateInstructions(value) {
  if (typeof value !== 'string' || !value.trim()) fail('默认规则正文不能为空');
  if (new TextEncoder().encode(value).byteLength > BUILTIN_SKILL_MAX_BYTES) fail('默认规则正文不能超过 24 KB');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(value) || Array.from(value).some(char => { const code = char.codePointAt(0); return code >= 0xd800 && code <= 0xdfff; })) fail('默认规则正文包含无效字符，请使用 UTF-8 文本');
  return value;
}

function factorySkill(workflowId, skillId) {
  workflow.parse(workflowId);
  const skill = skillEntriesFor(workflowId).find(item => item.id === skillId);
  if (!skill) fail('该内置规则不属于当前工作步骤');
  return skill;
}

export function normalizeBuiltinSkills(state) {
  if (!isRecord(state)) fail('工作区数据格式有误');
  state.skillsRevision ??= 0;
  if (!Number.isSafeInteger(state.skillsRevision) || state.skillsRevision < 0) fail('Skills 版本记录有误，请检查工作区备份');
  state.builtinSkillOverrides ??= {};
  if (!isRecord(state.builtinSkillOverrides)) fail('默认规则记录格式有误，请检查工作区备份');
  for (const [workflowId, overrides] of Object.entries(state.builtinSkillOverrides)) {
    if (!SKILL_WORKFLOW_IDS.includes(workflowId) || !isRecord(overrides)) fail('默认规则工作步骤记录有误，请检查工作区备份');
    for (const [skillId, item] of Object.entries(overrides)) {
      factorySkill(workflowId, skillId);
      if (!overrideSchema.safeParse(item).success) fail('默认规则记录损坏，请检查工作区备份');
      validateInstructions(item.instructions);
    }
  }
  return state;
}

function matchingRevision(state, expectedRevision) {
  normalizeBuiltinSkills(state);
  if (state.skillsRevision !== expectedRevision) fail('Skills 已在另一处更新，请刷新后重试', 409);
  if (state.skillsRevision >= Number.MAX_SAFE_INTEGER - 1) fail('Skills 版本已超出可保存范围');
}

export function resolveBuiltinSkills(state, workflowId) {
  workflow.parse(workflowId);
  normalizeBuiltinSkills(state);
  const overrides = state.builtinSkillOverrides[workflowId] || {};
  return Object.freeze(skillEntriesFor(workflowId).map(skill => {
    const saved = overrides[skill.id];
    return Object.freeze({ workflowId, id: skill.id, name: skill.name,
      version: saved ? `${saved.baseVersion}+local.${saved.revision}` : skill.version,
      instructions: saved ? saved.instructions : skill.instructions,
      baseVersion: saved ? saved.baseVersion : skill.version, customized: !!saved,
      ...(saved ? { revision: saved.revision, updatedAt: saved.updatedAt } : {}),
    });
  }));
}

export function setBuiltinSkill(state, input) {
  const data = targetSchema.extend({ instructions: z.string().min(1).max(BUILTIN_SKILL_MAX_BYTES) }).strict().parse(input);
  const instructions = validateInstructions(data.instructions);
  const factory = factorySkill(data.workflowId, data.skillId);
  matchingRevision(state, data.expectedRevision);
  const current = state.builtinSkillOverrides[data.workflowId]?.[data.skillId];
  if (current?.instructions !== instructions) {
    state.skillsRevision++;
    state.builtinSkillOverrides[data.workflowId] ??= {};
    state.builtinSkillOverrides[data.workflowId][data.skillId] = { instructions, baseVersion: factory.version, revision: state.skillsRevision, updatedAt: new Date().toISOString() };
  }
  return resolveBuiltinSkills(state, data.workflowId).find(item => item.id === data.skillId);
}

export function resetBuiltinSkill(state, input) {
  const data = targetSchema.parse(input);
  factorySkill(data.workflowId, data.skillId);
  matchingRevision(state, data.expectedRevision);
  const overrides = state.builtinSkillOverrides[data.workflowId];
  if (overrides && Object.hasOwn(overrides, data.skillId)) {
    delete overrides[data.skillId];
    if (!Object.keys(overrides).length) delete state.builtinSkillOverrides[data.workflowId];
    state.skillsRevision++;
  }
  return resolveBuiltinSkills(state, data.workflowId).find(item => item.id === data.skillId);
}
