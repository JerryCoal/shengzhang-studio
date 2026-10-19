import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.mjs';
import { BUILTIN_SKILL_MAX_BYTES, normalizeBuiltinSkills, resolveBuiltinSkills, setBuiltinSkill, resetBuiltinSkill } from '../server/builtin-skills.mjs';
import { normalizeCreativeSkills, installCreativeSkill, setWorkflowSkill } from '../server/creative-skills.mjs';
import { builtinSkillInstructions, skillVersionsFor, skillEntriesFor } from '../server/ai-skill-registry.mjs';
import { creativeSkillCatalog, workflowSkillTrace } from '../server/creative-skill-catalog.mjs';
import { COPY_SKILLS, COPY_SKILL_VERSIONS } from '../server/copy-skills.generated.mjs';

const target = { workflowId: 'copy-xiaohongshu', skillId: 'marketing-copywriting' };
const save = (state, instructions, changes = {}) => setBuiltinSkill(state, { ...target, instructions, expectedRevision: state.skillsRevision || 0, ...changes });
const reset = (state, changes = {}) => resetBuiltinSkill(state, { ...target, expectedRevision: state.skillsRevision || 0, ...changes });

test('old workspaces initialize empty default overrides without changing factory text', () => {
  const factory = structuredClone(COPY_SKILLS), state = { schemaVersion: 1 };
  normalizeCreativeSkills(state);
  assert.deepEqual(state.builtinSkillOverrides, {}); assert.equal(state.skillsRevision, 0); assert.equal(state.schemaVersion, 1);
  const snapshot = resolveBuiltinSkills(state, target.workflowId);
  assert.equal(snapshot[0].instructions, COPY_SKILLS[target.skillId]); assert.equal(snapshot[0].version, COPY_SKILL_VERSIONS[target.skillId]);
  assert.equal(snapshot[0].customized, false); assert.equal(snapshot[0].workflowId, target.workflowId);
  assert(Object.isFrozen(snapshot)); assert(snapshot.every(Object.isFrozen));
  assert.deepEqual(COPY_SKILLS, factory);
});

test('save and reset use a shared optimistic revision and never change another workflow', () => {
  const state = {}, other = {}, factory = COPY_SKILLS[target.skillId];
  const first = save(state, '只用真实校园场景。\n保留条件。');
  assert.equal(state.skillsRevision, 1); assert.equal(first.version, `${first.baseVersion}+local.1`); assert.equal(first.customized, true);
  assert.equal(resolveBuiltinSkills(state, 'copy-douyin')[0].instructions, factory);
  assert.equal(resolveBuiltinSkills(other, target.workflowId)[0].instructions, factory);
  assert.throws(() => save(state, '过期保存', { expectedRevision: 0 }), error => error.status === 409);
  assert.throws(() => reset(state, { expectedRevision: 0 }), error => error.status === 409);
  save(state, first.instructions); assert.equal(state.skillsRevision, 1, 'identical save is a no-op');
  const restored = reset(state); assert.equal(state.skillsRevision, 2); assert.equal(restored.instructions, factory); assert.equal(restored.customized, false);
  assert.deepEqual(state.builtinSkillOverrides, {});
  reset(state); assert.equal(state.skillsRevision, 2, 'already-factory reset is a no-op');
  const again = save(state, first.instructions); assert.equal(again.version, `${first.baseVersion}+local.3`);
  assert.equal(first.version, `${first.baseVersion}+local.1`);
});

test('the shared keyframe builtin stays independent for first and last frame', () => {
  const state = {};
  save(state, '首帧独立构图', { workflowId: 'first_frame', skillId: 'keyframe-continuity' });
  save(state, '尾帧保持人物位置', { workflowId: 'last_frame', skillId: 'keyframe-continuity' });
  reset(state, { workflowId: 'first_frame', skillId: 'keyframe-continuity' });
  assert.equal(resolveBuiltinSkills(state, 'first_frame')[0].instructions, COPY_SKILLS['keyframe-continuity']);
  assert.equal(resolveBuiltinSkills(state, 'last_frame')[0].instructions, '尾帧保持人物位置');
});

test('installed and default Skill writes conflict through the same revision', () => {
  const state = {};
  save(state, '默认偏好');
  const installed = installCreativeSkill(state, { fileName: 'SKILL.md', text: '# 细节偏好\n多用短句。', workflowId: target.workflowId, expectedRevision: 1, confirmed: true });
  assert.equal(state.skillsRevision, 2);
  assert.throws(() => reset(state, { expectedRevision: 1 }), error => error.status === 409);
  setWorkflowSkill(state, { workflowId: target.workflowId, skillId: installed.id, expectedRevision: 2 });
  assert.equal(state.skillsRevision, 3);
  assert.throws(() => save(state, '不能覆盖其他编辑', { expectedRevision: 2 }), error => error.status === 409);
  assert.equal(resolveBuiltinSkills(state, target.workflowId)[0].instructions, '默认偏好');
});

test('validation rejects empty/oversized/invalid UTF-8 and out-of-scope targets without changing a saved version', () => {
  const state = {}; save(state, '有效规则'); const before = structuredClone(state);
  const bad = ['', ' \n\t ', '\0', '\ufffd', '\ud800', '汉'.repeat(BUILTIN_SKILL_MAX_BYTES / 3 + 1), 'a'.repeat(BUILTIN_SKILL_MAX_BYTES + 1)];
  for (const instructions of bad) assert.throws(() => save(state, instructions));
  for (const changes of [{ workflowId: 'not-a-workflow' }, { workflowId: '__proto__' }, { skillId: 'seedance-motion' }, { skillId: '__proto__' }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { command: 'run' }]) assert.throws(() => save(state, '有效', changes));
  assert.deepEqual(state, before);
  const exact = save(state, '汉'.repeat(BUILTIN_SKILL_MAX_BYTES / 3));
  assert.equal(new TextEncoder().encode(exact.instructions).byteLength, BUILTIN_SKILL_MAX_BYTES);
});

test('backup normalization validates scopes and complete saved records, preserving older base versions', () => {
  const state = {}; save(state, '旧版本规则');
  state.builtinSkillOverrides[target.workflowId][target.skillId].baseVersion = '0.9.0';
  state.builtinSkillOverrides[target.workflowId][target.skillId].updatedAt = '2026-10-18T00:00:00Z';
  const backup = JSON.parse(JSON.stringify(state)); normalizeCreativeSkills(backup);
  assert.equal(resolveBuiltinSkills(backup, target.workflowId)[0].version, '0.9.0+local.1');
  assert.equal(skillVersionsFor('copy', { task: { channel: 'xiaohongshu' }, builtinSkills: resolveBuiltinSkills(backup, target.workflowId) })[0].version, '0.9.0+local.1');
  const bad = [[], { bad: {} }, { [target.workflowId]: [] }, { [target.workflowId]: { 'seedance-motion': state.builtinSkillOverrides[target.workflowId][target.skillId] } }];
  for (const builtinSkillOverrides of bad) assert.throws(() => normalizeBuiltinSkills({ builtinSkillOverrides }));
  for (const change of [{ instructions: ' ' }, { instructions: '\ud800' }, { baseVersion: '' }, { revision: -1 }, { updatedAt: 'yesterday' }, { extra: true }]) {
    const broken = structuredClone(state); Object.assign(broken.builtinSkillOverrides[target.workflowId][target.skillId], change);
    assert.throws(() => normalizeCreativeSkills(broken));
  }
});

test('running prompt/version/trace use the exact frozen snapshot after edits, reset and reload', () => {
  const state = {}; save(state, '第一版\r\n完整保留换行与尾空格  ');
  const snapshot = resolveBuiltinSkills(state, target.workflowId), serialized = JSON.stringify(snapshot);
  const payload = { task: { channel: 'xiaohongshu' }, builtinSkills: snapshot };
  const prompt = builtinSkillInstructions('copy', payload), versions = skillVersionsFor('copy', payload), trace = workflowSkillTrace('copy', payload, '2026-10-18T00:00:00.000Z');
  assert.throws(() => { snapshot[0].instructions = '改写'; }); assert.throws(() => snapshot.pop());
  save(state, '第二版'); reset(state);
  assert.equal(JSON.stringify(snapshot), serialized); assert.equal(builtinSkillInstructions('copy', payload), prompt);
  assert.deepEqual(skillVersionsFor('copy', { ...payload, builtinSkills: JSON.parse(serialized) }), versions);
  assert.deepEqual(workflowSkillTrace('copy', payload, trace.at), trace);
  assert.equal(trace.builtin[0].instructions, '第一版\r\n完整保留换行与尾空格  ');
  assert.equal(trace.builtin[0].version, versions[0].version);
});

test('registry rejects truncated, wrong-scope, reordered or corrupt snapshots instead of silently falling back', () => {
  const state = {}, snapshot = resolveBuiltinSkills(state, target.workflowId);
  const payload = builtinSkills => ({ task: { channel: 'xiaohongshu' }, builtinSkills });
  for (const saved of [null, [], snapshot.slice(1), [...snapshot].reverse(), resolveBuiltinSkills(state, 'copy-douyin'), snapshot.map((item, index) => index === 0 ? { ...item, workflowId: 'copy-douyin' } : item), snapshot.map((item, index) => index === 0 ? { ...item, instructions: '' } : item)]) assert.throws(() => skillEntriesFor('copy', payload(saved)), /快照/);
  assert.throws(() => skillEntriesFor('strategy', { builtinSkills: snapshot }), /快照/);
  assert.throws(() => skillEntriesFor('copy', { builtinSkills: snapshot }), /平台/);
  assert.equal(builtinSkillInstructions('copy'), builtinSkillInstructions('copy', { builtinSkills: undefined }));
  assert.equal(skillVersionsFor('copy').length, 2);
});

test('catalog, prompt, versions and trace agree, while factory source remains untouched', () => {
  const state = {}; save(state, '编辑后的小红书规则');
  const catalog = creativeSkillCatalog(state), visible = catalog.workflows.find(item => item.id === target.workflowId).skills;
  const payload = { task: { channel: 'xiaohongshu' }, builtinSkills: resolveBuiltinSkills(state, target.workflowId) };
  assert.equal(catalog.defaultEditable, true); assert.match(catalog.builtin.description, /出厂/);
  assert.equal(visible[0].defaultInstructions, COPY_SKILLS[target.skillId]); assert.equal(visible[0].customized, true); assert(visible[0].updatedAt);
  assert.equal(visible.map(item => item.instructions).join('\n\n'), builtinSkillInstructions('copy', payload));
  assert.deepEqual(visible.map(({ id, name, version }) => ({ id, name, version })), skillVersionsFor('copy', payload));
  assert.deepEqual(visible.map(({ id, version, instructions }) => ({ id, version, instructions })), workflowSkillTrace('copy', payload, 'now').builtin.map(({ id, version, instructions }) => ({ id, version, instructions })));
  visible[0].instructions = '外部修改目录'; assert.equal(resolveBuiltinSkills(state, target.workflowId)[0].instructions, '编辑后的小红书规则');
});

test('Markdown remains literal browser-compatible data without execution capabilities', async () => {
  const state = {}, text = '# 规则\n```js\nprocess.exit(1)\n```\n[引用](file:///private.txt)\n$(Invoke-WebRequest example.com)';
  const result = save(state, text); assert.equal(result.instructions, text);
  const source = await readFile(new URL('../server/builtin-skills.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]node:|(?<!\.)\b(?:eval|fetch|require|exec|spawn)\s*\(|new Function\s*\(/);
});

test('real encrypted SQLite persists exact defaults through reopen and keeps personal workspaces isolated', t => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-builtin-skills-'));
  const opened = new Set();
  const open = (filename, key, scope) => { const store = createStore(join(directory, filename), { key, scope }); opened.add(store); return store; };
  const close = store => { store.close(); opened.delete(store); };
  t.after(() => {
    for (const store of opened) store.close();
    const target = resolve(directory), parent = resolve(tmpdir()) + sep;
    if (!target.startsWith(parent) || !target.split(sep).at(-1).startsWith('studio-builtin-skills-')) throw new Error('Unexpected temporary test cleanup directory');
    rmSync(target, { recursive: true, force: true });
  });
  const keyA = randomBytes(32), keyB = randomBytes(32);
  const textA = `BUILTIN_PRIVATE_A_${randomBytes(12).toString('hex')}\n个人甲的独立默认规则。\r\n保留精确文本。`;
  const textB = `BUILTIN_PRIVATE_B_${randomBytes(12).toString('hex')}\n个人乙的独立默认规则。`;
  let alpha = open('alpha.sqlite', keyA, 'personal-alpha'), beta = open('beta.sqlite', keyB, 'personal-beta');
  const original = alpha.mutate(state => save(state, textA));
  beta.mutate(state => save(state, textB));
  const before = alpha.get();
  assert.throws(() => alpha.mutate(state => { save(state, '未提交的中间修改'); save(state, '\0'); }));
  assert.deepEqual(alpha.get().builtinSkillOverrides, before.builtinSkillOverrides);
  assert.equal(alpha.get().skillsRevision, before.skillsRevision);
  for (const file of readdirSync(directory)) {
    const bytes = readFileSync(join(directory, file));
    assert.equal(bytes.includes(Buffer.from(textA)), false); assert.equal(bytes.includes(Buffer.from(textB)), false);
    assert.equal(bytes.includes(Buffer.from('builtinSkillOverrides')), false);
  }
  close(alpha); close(beta);
  const wrongKey = open('alpha.sqlite', keyB, 'personal-alpha'); assert.throws(() => wrongKey.get()); close(wrongKey);
  const wrongScope = open('alpha.sqlite', keyA, 'personal-beta'); assert.throws(() => wrongScope.get()); close(wrongScope);
  alpha = open('alpha.sqlite', keyA, 'personal-alpha'); beta = open('beta.sqlite', keyB, 'personal-beta');
  assert.deepEqual(resolveBuiltinSkills(alpha.get(), target.workflowId)[0], original);
  assert.equal(resolveBuiltinSkills(beta.get(), target.workflowId)[0].instructions, textB);
  assert.equal(alpha.get().skillsRevision, 1); assert.equal(beta.get().skillsRevision, 1);
  const backup = JSON.parse(JSON.stringify(alpha.get())); normalizeCreativeSkills(backup);
  assert.deepEqual(resolveBuiltinSkills(backup, target.workflowId)[0], original);
  alpha.mutate(state => reset(state)); close(alpha);
  alpha = open('alpha.sqlite', keyA, 'personal-alpha');
  assert.equal(resolveBuiltinSkills(alpha.get(), target.workflowId)[0].customized, false);
  assert.equal(alpha.get().skillsRevision, 2);
  assert.equal(resolveBuiltinSkills(beta.get(), target.workflowId)[0].instructions, textB);
  assert.equal(original.instructions, textA);
});
