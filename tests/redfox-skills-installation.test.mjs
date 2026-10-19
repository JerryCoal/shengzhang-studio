import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { PLATFORM_IDS } from '../server/platform-catalog.mjs';
import { creativeSkillCatalog, workflowSkillTrace } from '../server/creative-skill-catalog.mjs';
import { builtinSkillInstructions, skillIdsFor, skillVersionsFor } from '../server/ai-skill-registry.mjs';
import { resolveBuiltinSkills, setBuiltinSkill, resetBuiltinSkill } from '../server/builtin-skills.mjs';
import { normalizeCreativeSkills, installCreativeSkill, setWorkflowSkill, resolveWorkflowSkill } from '../server/creative-skills.mjs';
import { saveAccountCreationProfile, saveProjectCreationSelection, resolveAccountCreation } from '../server/account-creation.mjs';
import { COPY_SKILLS, COPY_SKILL_VERSIONS } from '../server/copy-skills.generated.mjs';

const workflows = [
  ['xhs-creator', 'redfox-xiaohongshu-creator'],
  ['xhs-title-score', 'redfox-xiaohongshu-title-score'],
  ['xhs-cover', 'redfox-xiaohongshu-cover'],
  ['xhs-note-analyzer', 'redfox-xiaohongshu-note-analyzer'],
];
const install = (state, workflowId, marker) => installCreativeSkill(state, {
  fileName: 'SKILL.md', text: `# ${marker}\n${marker}的独立补充规则。`, workflowId,
  expectedRevision: state.skillsRevision || 0, confirmed: true,
});
const profile = (skillSelections = {}) => ({
  expectedRevision: 0, identityMarkdown: '仅用于测试的账号身份。', identityFileName: '身份.md',
  presets: [{ id: 'daily', name: '日常方案', topic: '日常观察', instruction: '', skillSelections }], defaultPresetId: 'daily',
});

test('all four Redfox adaptations are ready-to-use compiled defaults with distinct workflow catalog entries', () => {
  const state = {}, catalog = creativeSkillCatalog(state);
  assert.equal(catalog.defaultEditable, true);
  assert.equal(state.installedSkills.length, 0, 'factory installation does not consume imported Skill slots');
  assert.equal(state.skillsRevision, 0, 'reading the newly available catalog is not an edit');
  for (const [workflowId, skillId] of workflows) {
    const matches = catalog.workflows.filter(item => item.id === workflowId);
    assert.equal(matches.length, 1, workflowId);
    const row = matches[0];
    assert.deepEqual(skillIdsFor(workflowId), [skillId]);
    assert.equal(row.selectedSkillId, '');
    assert.equal(row.skills.length, 1);
    const skill = row.skills[0];
    assert.equal(skill.id, skillId); assert.equal(skill.workflowId, workflowId);
    assert.equal(skill.version, COPY_SKILL_VERSIONS[skillId]);
    assert.equal(skill.instructions, COPY_SKILLS[skillId]);
    assert.equal(skill.defaultInstructions, COPY_SKILLS[skillId]);
    assert.equal(skill.customized, false); assert(skill.instructions.trim().length > 100);
    assert.equal(builtinSkillInstructions(workflowId), skill.instructions);
    assert.deepEqual(skillVersionsFor(workflowId), [{ id: skillId, name: skill.name, version: skill.version }]);
  }
});

for (const [workflowId, skillId] of workflows) test(`${workflowId}: edited defaults drive prompts and traces, reset restores factory, running snapshots remain exact`, () => {
  const state = {}, factory = COPY_SKILLS[skillId], otherFactory = Object.fromEntries(workflows.filter(([id]) => id !== workflowId).map(([id]) => [id, resolveBuiltinSkills(state, id)]));
  const instructions = `PRIVATE_${workflowId}\n只使用本账号事实，输出真实建议。\r\n保留换行与尾空格  `;
  const changed = setBuiltinSkill(state, { workflowId, skillId, instructions, expectedRevision: 0 });
  const snapshot = resolveBuiltinSkills(state, workflowId), payload = { builtinSkills: snapshot };
  const visible = creativeSkillCatalog(state).workflows.find(row => row.id === workflowId).skills[0];
  assert.equal(visible.instructions, instructions); assert.equal(visible.defaultInstructions, factory);
  assert.equal(visible.customized, true); assert.equal(visible.version, changed.version);
  assert.equal(builtinSkillInstructions(workflowId, payload), instructions);
  const trace = workflowSkillTrace(workflowId, payload, '2026-10-18T00:00:00Z');
  assert.equal(trace.workflowId, workflowId); assert.equal(trace.builtin[0].instructions, instructions);
  assert.equal(trace.builtin[0].version, skillVersionsFor(workflowId, payload)[0].version);
  assert.throws(() => resetBuiltinSkill(state, { workflowId, skillId, expectedRevision: 0 }), error => error.status === 409);
  for (const [otherId, original] of Object.entries(otherFactory)) assert.deepEqual(resolveBuiltinSkills(state, otherId), original);
  const reset = resetBuiltinSkill(state, { workflowId, skillId, expectedRevision: 1 });
  assert.equal(reset.instructions, factory); assert.equal(reset.customized, false); assert.equal(state.skillsRevision, 2);
  assert.equal(creativeSkillCatalog(state).workflows.find(row => row.id === workflowId).skills[0].customized, false);
  assert.equal(builtinSkillInstructions(workflowId), factory); assert.equal(COPY_SKILLS[skillId], factory);
  assert.equal(builtinSkillInstructions(workflowId, payload), instructions, 'a running task retains its saved rule');
  assert.deepEqual(workflowSkillTrace(workflowId, payload, trace.at), trace);
  assert(Object.isFrozen(snapshot)); assert(Object.isFrozen(snapshot[0]));
  for (const [otherId] of workflows.filter(([id]) => id !== workflowId)) assert.throws(() => builtinSkillInstructions(otherId, payload), /快照/);
});

test('adding four factory workflows preserves existing imports, selected copy rules, overrides and account presets', () => {
  const state = seedState();
  const legacy = installCreativeSkill(state, { fileName: '旧规则.md', text: '# 旧版本文案规则\n延续原来的文风。', expectedRevision: state.skillsRevision || 0, confirmed: true });
  setWorkflowSkill(state, { workflowId: 'copy-xiaohongshu', skillId: legacy.id, expectedRevision: state.skillsRevision });
  setWorkflowSkill(state, { workflowId: 'copy-douyin', skillId: legacy.id, expectedRevision: state.skillsRevision });
  setBuiltinSkill(state, { workflowId: 'copy-xiaohongshu', skillId: 'marketing-copywriting', instructions: '旧工作区独立默认规则。', expectedRevision: state.skillsRevision });
  state.accounts = [{ id: 'existing-account', name: '原有账号', platform: 'xiaohongshu' }];
  saveAccountCreationProfile(state, 'existing-account', profile({ 'copy-xiaohongshu': legacy.id }));
  const before = structuredClone(state);
  normalizeCreativeSkills(state);
  const catalog = creativeSkillCatalog(state);
  for (const key of ['skillsRevision', 'installedSkills', 'skillSelections', 'builtinSkillOverrides', 'accounts']) assert.deepEqual(state[key], before[key], key);
  for (const [workflowId] of workflows) {
    const row = catalog.workflows.find(item => item.id === workflowId);
    assert.equal(row.selectedSkillId, ''); assert.deepEqual(row.eligibleSkillIds, [], 'legacy copy-only imports cannot silently move into a new step');
    assert.equal(resolveWorkflowSkill(state, workflowId), null);
  }
  assert.equal(resolveWorkflowSkill(state, 'copy-xiaohongshu').id, legacy.id);
  assert.equal(resolveWorkflowSkill(state, 'copy-douyin').id, legacy.id);
});

test('non-Xiaohongshu account presets reject every Redfox step, including explicit built-in-only overrides', () => {
  const state = seedState(); state.accounts = PLATFORM_IDS.map(platform => ({ id: `account-${platform}`, name: platform, platform }));
  for (const account of state.accounts) saveAccountCreationProfile(state, account.id, profile());
  const skills = new Map(workflows.map(([id]) => [id, install(state, id, `CUSTOM_${id}`)]));
  for (const account of state.accounts.filter(row => row.platform !== 'xiaohongshu')) for (const [workflowId] of workflows) for (const skillId of ['', skills.get(workflowId).id]) {
    const before = structuredClone(account.creationProfile);
    assert.throws(() => saveAccountCreationProfile(state, account.id, { ...profile({ [workflowId]: skillId }), expectedRevision: before.revision }), error => error.status === 400 && /只适用于小红书账号/.test(error.message), `${account.platform}/${workflowId}/${skillId || 'builtin'}`);
    assert.deepEqual(account.creationProfile, before, 'a rejected write cannot replace identity, presets or revision');
  }
});

test('Xiaohongshu account presets can choose each new step without overriding another account or global selection', () => {
  const state = seedState(), project = state.projects[0]; confirmStrategy(project, project.strategies[0].id);
  state.accounts = [{ id: 'account-a', name: '小红书甲', platform: 'xiaohongshu' }, { id: 'account-b', name: '小红书乙', platform: 'xiaohongshu' }];
  const accountSelections = {};
  for (const [workflowId] of workflows) {
    const global = install(state, workflowId, `GLOBAL_${workflowId}`), custom = install(state, workflowId, `ACCOUNT_A_${workflowId}`);
    setWorkflowSkill(state, { workflowId, skillId: global.id, expectedRevision: state.skillsRevision });
    accountSelections[workflowId] = custom.id;
  }
  saveAccountCreationProfile(state, 'account-a', profile(accountSelections));
  saveAccountCreationProfile(state, 'account-b', profile());
  const globalSelections = structuredClone(state.skillSelections);
  for (const accountId of ['account-a', 'account-b']) {
    saveProjectCreationSelection(state, project, { platform: 'xiaohongshu', accountId, expectedRevision: project.revision });
    for (const [workflowId] of workflows) {
      const result = resolveAccountCreation(state, project, 'xiaohongshu', workflowId);
      assert.equal(result.creativeSkill.id, accountId === 'account-a' ? accountSelections[workflowId] : globalSelections[workflowId]);
      assert.equal(result.accountContext.accounts[0].accountId, accountId);
      assert.equal(result.hasAccountSkillOverride, accountId === 'account-a');
    }
  }
  assert.deepEqual(state.skillSelections, globalSelections);
});
