import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCreativeSkills, previewCreativeSkill, installCreativeSkill, setCreativeSkillEnabled, removeCreativeSkill, resolveCreativeSkill, CREATIVE_SKILL_MAX_BYTES, CREATIVE_SKILL_MAX_COUNT } from '../server/creative-skills.mjs';

const source = (extra = '', body = '# 校园招募\n围绕真实校园场景，用清晰短句介绍服务。保留价格和限制。') => `---\nname: campus-copy\ndescription: 校园招募宣传文案\nversion: 1.0.0\n${extra}---\n\n${body}`;
const install = (state, text = source(), options = {}) => installCreativeSkill(state, { fileName: 'SKILL.md', text, expectedRevision: state.skillsRevision || 0, confirmed: true, ...options });
const resolve = (state, id, options = {}) => resolveCreativeSkill(state, { skillId: id, stage: 'copy', platform: 'xiaohongshu', ...options });

test('preview reads common Markdown metadata without evaluating tools or fetching resources', () => {
  const preview = previewCreativeSkill({ fileName: 'SKILL.md', text: '\ufeff' + source('platforms: [xiaohongshu, douyin]\nstages: [copy]\nallowed-tools: [shell, browser]\nmetadata:\n  command: powershell secret.ps1\n', '# 正文\n[示例](../scripts/private.md) 只作文字参考。\n```sh\ncurl https://example.com\n```').replaceAll('\n', '\r\n') });
  assert.equal(preview.name, 'campus-copy'); assert.equal(preview.version, '1.0.0');
  assert.deepEqual(preview.platforms, ['xiaohongshu', 'douyin']); assert.deepEqual(preview.stages, ['copy']);
  assert.match(preview.instructions, /curl https:\/\/example.com/); assert.doesNotMatch(preview.instructions, /allowed-tools/);
  assert(preview.warnings.some(value => value.includes('不执行'))); assert(preview.warnings.some(value => value.includes('allowed-tools')));
  assert(!preview.sourceText.includes('\r')); assert(!preview.sourceText.startsWith('\ufeff'));
});

test('metadata supports quoted fields, folded descriptions and indented platform lists', () => {
  const preview = previewCreativeSkill({ fileName: '规则.md', text: '---\nname: "校园文案"\ndescription: >-\n  先介绍受众。\n  再说明条件。\nversion: \'2.1.0-beta\'\nplatforms:\n  - xiaohongshu\nstages: copy\n---\n不要编造体验。✨[笑哭R]❤️' });
  assert.equal(preview.description, '先介绍受众。 再说明条件。'); assert.equal(preview.name, '校园文案'); assert.equal(preview.version, '2.1.0-beta'); assert.deepEqual(preview.platforms, ['xiaohongshu']); assert.match(preview.instructions, /✨\[笑哭R\]❤️/);
  const plain = previewCreativeSkill({ fileName: '本地规则.md', text: '# 沟通风格\n用简洁短句。' });
  assert.equal(plain.name, '沟通风格'); assert.equal(plain.version, '1.0.0'); assert.deepEqual(plain.platforms, ['xiaohongshu', 'douyin']);
  const nested = previewCreativeSkill({ fileName: 'SKILL.md', text: '---\nname: brand-copy\ndescription: 品牌内容\nmetadata:\n  version: 2026.10.14\n  author: studio\n  tools:\n    version: fake-deep-version\n---\n基于真实事实写作。' });
  assert.equal(nested.version, '2026.10.14'); assert(nested.warnings.some(value => value.includes('metadata.author')));
  assert.throws(() => previewCreativeSkill({ fileName: 'SKILL.md', text: source('metadata:\n  version: 2.0.0\n') }), /不一致/);
  assert.throws(() => previewCreativeSkill({ fileName: 'SKILL.md', text: source('metadata:\n  version: 1.0.0\n  version: 1.0.0\n') }), /重复/);
});

test('preview rejects malformed metadata, unsupported scope, unsafe file names and oversized UTF-8', () => {
  for (const fileName of ['rules.py', 'rules.zip', '../SKILL.md', 'C:\\SKILL.md', '.md', 'folder/rules.md', 'bad\0.md']) assert.throws(() => previewCreativeSkill({ fileName, text: source() }));
  for (const text of [source('name: repeated\n'), source('stages: [analysis]\n'), source('platforms: [unsupported-platform]\n'), source('platforms: []\n'), source('version: bad version\n'), source('description: !tag value\n'), '---\nname: missing-close', '---\nname: empty\n---', source('', 'bad\0text'), source('', 'bad\ufffdtext'), source('platforms: [xiaohongshu\n'), source('name: "bad\\nname"\n')]) assert.throws(() => previewCreativeSkill({ fileName: 'SKILL.md', text }));
  assert.throws(() => previewCreativeSkill({ fileName: 'SKILL.md', text: '汉'.repeat(CREATIVE_SKILL_MAX_BYTES / 3 + 1) }), /24 KB/);
  assert.throws(() => previewCreativeSkill({ fileName: 'SKILL.md', text: 'unpaired\ud800' }), /Unicode/);
  assert.throws(() => previewCreativeSkill({ fileName: 'SKILL.md', text: source(), command: 'run' }));
});

test('installation requires preview confirmation and optimistic revision; duplicate versions never overwrite', () => {
  const state = {};
  assert.throws(() => install(state, source(), { confirmed: false }));
  const first = install(state); assert.equal(state.skillsRevision, 1); assert.equal(state.installedSkills.length, 1); assert.equal(first.enabled, true);
  assert.throws(() => install(state, source(), { expectedRevision: 0 }), /另一处更新/);
  assert.throws(() => install(state), /已经安装/);
  assert.throws(() => install(state, source('', '新的规则，同名同版本不能覆盖。')), /同名同版本/);
  assert.throws(() => install(state, source().replace('campus-copy', 'CAMPUS-COPY') + '\n增加一行'), /同名同版本/);
  const second = install(state, source().replace('version: 1.0.0', 'version: 1.1.0'));
  assert.notEqual(first.id, second.id); assert.equal(state.skillsRevision, 2); assert.equal(state.installedSkills.length, 2);
  first.instructions = 'mutated'; assert.notEqual(state.installedSkills[0].instructions, first.instructions);
});

test('selection respects enabled state and platform, returns independent snapshots surviving deletion', () => {
  const state = {}, skill = install(state, source('platforms: xiaohongshu\n'));
  assert.equal(resolve(state, ''), null); assert.equal(resolve(state, undefined), null);
  const snapshot = resolve(state, skill.id);
  assert.throws(() => resolve(state, skill.id, { platform: 'douyin' }), /不适用/);
  assert.throws(() => resolve(state, skill.id, { stage: 'analysis' }), /不适用/);
  const disabled = setCreativeSkillEnabled(state, skill.id, { enabled: false, expectedRevision: 1 });
  assert.equal(disabled.enabled, false); assert.throws(() => resolve(state, skill.id), /停用/);
  assert.throws(() => setCreativeSkillEnabled(state, skill.id, { enabled: true, expectedRevision: 1 }), /另一处更新/);
  setCreativeSkillEnabled(state, skill.id, { enabled: true, expectedRevision: 2 });
  snapshot.platforms.push('douyin'); assert.deepEqual(resolve(state, skill.id).platforms, ['xiaohongshu']);
  removeCreativeSkill(state, skill.id, { expectedRevision: 3 });
  assert.equal(state.installedSkills.length, 0); assert.equal(state.skillsRevision, 4); assert.match(snapshot.sourceText, /校园招募/);
  assert.throws(() => resolve(state, skill.id), /删除或不存在/);
});

test('workspace users stay isolated and malformed or tampered stored records cannot enter a prompt', () => {
  const one = {}, two = {}, skill = install(one);
  normalizeCreativeSkills(two); assert.deepEqual(two.installedSkills, []); assert.throws(() => resolve(two, skill.id), /不存在/);
  const before = structuredClone(one);
  one.installedSkills[0].instructions = 'changed outside source'; assert.throws(() => resolve(one, skill.id), /不一致/);
  one.installedSkills[0] = before.installedSkills[0]; one.installedSkills[0].installedAt = 'invalid'; assert.throws(() => resolve(one, skill.id), /安装记录不完整/);
  for (const bad of [null, [], { installedSkills: {} }, { skillsRevision: -1 }, { skillsRevision: 0.5 }]) assert.throws(() => normalizeCreativeSkills(bad));
  assert.throws(() => normalizeCreativeSkills({ installedSkills: [null], skillsRevision: 0 }), /损坏/);
  assert.throws(() => removeCreativeSkill(two, '__proto__', { expectedRevision: 0 }), /不存在/);
  assert.equal(Object.getPrototypeOf(two), Object.prototype);
});

test('bounded catalog and browser-compatible module have no filesystem, process or network execution', async () => {
  const state = {};
  for (let index = 0; index < CREATIVE_SKILL_MAX_COUNT; index++) install(state, source().replace('name: campus-copy', `name: campus-${index}`));
  assert.throws(() => install(state, source()), /最多安装/); assert.equal(state.skillsRevision, CREATIVE_SKILL_MAX_COUNT);
  const module = await readFile(new URL('../server/creative-skills.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /from ['"]node:|(?<!\.)\b(?:eval|fetch|require|exec|spawn)\s*\(|new Function\s*\(/);
});
