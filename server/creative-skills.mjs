import { z } from 'zod';

// This module is shared by the desktop server and browser. Imported Markdown is
// data: no file is extracted, dependency fetched, script evaluated or tool run.
export const CREATIVE_SKILL_MAX_BYTES = 24 * 1024;
export const CREATIVE_SKILL_MAX_COUNT = 30;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const bytes = value => new TextEncoder().encode(value).byteLength;
const normalized = value => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
const fields = new Set(['name', 'description', 'version', 'platforms', 'stages']);
const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const revision = z.number().int().nonnegative();
const inputSchema = z.object({ fileName: z.string().trim().min(1).max(180), text: z.string().min(1).max(CREATIVE_SKILL_MAX_BYTES) }).strict();
const storedSchema = z.object({
  id: identifier, name: z.string().min(1).max(80), description: z.string().min(1).max(600), version: z.string().min(1).max(40),
  platforms: z.array(z.enum(['xiaohongshu', 'douyin'])).min(1).max(2), stages: z.array(z.literal('copy')).length(1),
  instructions: z.string().min(1).max(CREATIVE_SKILL_MAX_BYTES), sourceText: z.string().min(1).max(CREATIVE_SKILL_MAX_BYTES), sourceFile: z.string().min(1).max(180),
  warnings: z.array(z.string().max(3000)).max(10), enabled: z.boolean(), installedAt: z.string().max(40),
});
const plain = (text, max, label) => {
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) fail(`${label}不能为空、过长或包含控制字符`);
  return text;
};

function scalar(raw) {
  const text = raw.trim();
  if (text.startsWith('"')) {
    try { const value = JSON.parse(text); if (typeof value === 'string') return value.trim(); } catch { /* Reject ambiguous YAML rather than evaluating it. */ }
    fail('Skill 元信息中的双引号字符串格式有误');
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) fail('Skill 元信息中的单引号字符串格式有误');
    return text.slice(1, -1).replace(/''/g, "'").trim();
  }
  if (/^[!&*]/u.test(text)) fail('Skill 元信息不支持 YAML 标签、锚点或引用');
  return text.replace(/\s+#.*$/u, '').trim();
}

function list(raw, fallback, choices, label) {
  if (raw === undefined) return [...fallback];
  const text = raw.trim();
  if (text.startsWith('[') !== text.endsWith(']')) fail(`${label}列表格式有误`);
  const values = (text.startsWith('[') ? text.slice(1, -1) : text).split(',').map(value => scalar(value));
  if (!values.length || values.some(value => !choices.includes(value))) fail(`${label}不支持该值`);
  return [...new Set(values)];
}

function parseFrontmatter(source) {
  if (!source.startsWith('---\n')) return { metadata: Object.create(null), body: source, ignored: [], hasMetadata: false };
  const lines = source.split('\n'), end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) fail('Skill 顶部元信息缺少结束的 ---');
  const metadata = Object.create(null), ignored = [], seen = new Set();
  let nestedVersion;
  for (let index = 1; index < end; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]{0,60}):(?:\s+(.*)|\s*)$/u.exec(line);
    if (!match) fail('Skill 元信息请使用 name、description、version、platforms、stages 字段');
    const key = match[1].toLowerCase();
    if (seen.has(key)) fail(`Skill 元信息字段 ${key} 重复`);
    seen.add(key);
    let raw = match[2] || '';
    const following = [];
    while (index + 1 < end && (!lines[index + 1].trim() || /^ +\S/u.test(lines[index + 1]))) following.push(lines[++index]);
    if (key === 'metadata') {
      if (raw) fail('metadata 请使用缩进字段格式，例如 metadata: 换行后填写 version');
      const present = following.filter(value => value.trim());
      const indent = present.length ? Math.min(...present.map(value => /^ +/u.exec(value)[0].length)) : 0;
      const nestedSeen = new Set();
      for (const value of present) {
        const depth = /^ +/u.exec(value)[0].length;
        if (depth !== indent || value.trimStart().startsWith('#')) continue;
        const entry = /^([A-Za-z][A-Za-z0-9_-]{0,60}):(?:\s+(.*)|\s*)$/u.exec(value.trim());
        if (!entry) fail('metadata 请使用简单字段，不支持执行声明或复杂 YAML');
        const nestedKey = entry[1].toLowerCase();
        if (nestedSeen.has(nestedKey)) fail(`Skill 元信息字段 metadata.${nestedKey} 重复`);
        nestedSeen.add(nestedKey);
        if (nestedKey === 'version') nestedVersion = scalar(entry[2] || '');
        else ignored.push(`metadata.${nestedKey}`);
      }
      continue;
    }
    if (!fields.has(key)) { ignored.push(key); continue; }
    if (/^[|>][-+]?$/u.test(raw)) {
      if (!following.length) fail(`Skill 元信息字段 ${key} 缺少正文`);
      if (key !== 'description') fail('只有 description 支持多行文本');
      raw = following.map(value => value.trim()).filter(Boolean).join(' ');
    } else if (!raw && following.some(value => value.trim())) {
      if (!['platforms', 'stages'].includes(key) || following.some(value => value.trim() && !/^ +- +\S/u.test(value))) fail('Skill 元信息不支持嵌套对象');
      raw = following.filter(value => value.trim()).map(value => value.replace(/^ +- +/u, '')).join(',');
    } else if (following.some(value => value.trim())) fail('Skill 元信息缩进不正确');
    metadata[key] = ['platforms', 'stages'].includes(key) ? raw : scalar(raw);
  }
  if (nestedVersion !== undefined) {
    if (metadata.version !== undefined && metadata.version !== nestedVersion) fail('顶层 version 与 metadata.version 不一致，请只保留一个明确版本');
    metadata.version = nestedVersion;
  }
  return { metadata, body: lines.slice(end + 1).join('\n').trim(), ignored, hasMetadata: true };
}

export function previewCreativeSkill(input) {
  const data = inputSchema.parse(input);
  if (!/\.md$/iu.test(data.fileName) || /[\\/:\u0000-\u001f\u007f]/u.test(data.fileName) || data.fileName === '.md') fail('请选择本地 .md 文件，不接受目录、脚本或压缩包');
  if (bytes(data.text) > CREATIVE_SKILL_MAX_BYTES) fail('Skill 文件不能超过 24 KB，请只保留稳定的创作规则');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(data.text)) fail('Skill 文件包含无效字符，请使用 UTF-8 保存');
  if (Array.from(data.text).some(char => { const code = char.codePointAt(0); return code >= 0xd800 && code <= 0xdfff; })) fail('Skill 文件包含无效 Unicode 字符，请使用 UTF-8 保存');
  const sourceText = data.text.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n').trim();
  const { metadata, body, ignored, hasMetadata } = parseFrontmatter(sourceText);
  if (!body.trim()) fail('Skill 缺少创作规则正文');
  const heading = /^# +(.+)$/mu.exec(body)?.[1].trim();
  const name = plain(metadata.name ?? heading ?? data.fileName.replace(/\.md$/iu, ''), 80, 'Skill 名称');
  const description = plain(metadata.description ?? '用户导入的宣传文案创作规则', 600, 'Skill 描述');
  const version = plain(metadata.version ?? '1.0.0', 40, 'Skill 版本');
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(version)) fail('Skill 版本请使用数字、字母、点或短横线，例如 1.0.0');
  const platforms = list(metadata.platforms, ['xiaohongshu', 'douyin'], ['xiaohongshu', 'douyin'], '适用平台');
  const stages = list(metadata.stages, ['copy'], ['copy'], '适用步骤');
  const warnings = ['仅使用本文件正文作为文案表达偏好，不执行脚本、工具调用或外部链接，也不自动读取关联文件。'];
  if (!hasMetadata) warnings.push('未填写顶部元信息，已从标题或文件名取名，版本默认为 1.0.0。');
  if (ignored.length) warnings.push(`未使用的元信息字段：${ignored.join('、').slice(0, 1800)}。`);
  return { name, description, version, platforms, stages, instructions: body.trim(), sourceText, sourceFile: data.fileName, warnings };
}

export function normalizeCreativeSkills(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('工作区数据格式有误');
  state.installedSkills ??= [];
  state.skillsRevision ??= 0;
  if (!Array.isArray(state.installedSkills) || state.installedSkills.length > CREATIVE_SKILL_MAX_COUNT || !Number.isSafeInteger(state.skillsRevision) || state.skillsRevision < 0) fail('已安装 Skill 数据格式有误，请检查工作区备份');
  if (state.installedSkills.some(skill => !storedSchema.safeParse(skill).success) || new Set(state.installedSkills.map(skill => skill.id)).size !== state.installedSkills.length) fail('已安装 Skill 记录损坏或重复，请检查工作区备份');
  return state;
}

function matchingRevision(state, expectedRevision) {
  normalizeCreativeSkills(state);
  if (state.skillsRevision !== expectedRevision) fail('Skills 已在另一处更新，请刷新后重试', 409);
}

function locate(state, id) {
  identifier.parse(id);
  const skill = state.installedSkills.find(item => item?.id === id);
  if (!skill) fail('该 Skill 已删除或不存在，请重新选择', 409);
  return skill;
}

export function installCreativeSkill(state, input) {
  const data = z.object({ fileName: inputSchema.shape.fileName, text: inputSchema.shape.text, expectedRevision: revision, confirmed: z.literal(true) }).strict().parse(input);
  matchingRevision(state, data.expectedRevision);
  const preview = previewCreativeSkill({ fileName: data.fileName, text: data.text });
  if (state.installedSkills.length >= CREATIVE_SKILL_MAX_COUNT) fail('最多安装 30 个 Skill，请先删除不再使用的规则');
  if (state.installedSkills.some(item => item.sourceText === preview.sourceText)) fail('这份 Skill 已经安装，请勿重复导入', 409);
  if (state.installedSkills.some(item => normalized(item.name) === normalized(preview.name) && normalized(item.version) === normalized(preview.version))) fail('同名同版本 Skill 已存在；修改版本号后导入，或先删除旧版本', 409);
  const skill = { ...preview, id: `skill-${globalThis.crypto.randomUUID()}`, enabled: true, installedAt: new Date().toISOString() };
  state.installedSkills.push(skill); state.skillsRevision++;
  return structuredClone(skill);
}

export function setCreativeSkillEnabled(state, id, input) {
  const data = z.object({ enabled: z.boolean(), expectedRevision: revision }).strict().parse(input);
  matchingRevision(state, data.expectedRevision);
  const skill = locate(state, id);
  if (skill.enabled !== data.enabled) { skill.enabled = data.enabled; state.skillsRevision++; }
  return structuredClone(skill);
}

export function removeCreativeSkill(state, id, input) {
  const data = z.object({ expectedRevision: revision }).strict().parse(input);
  matchingRevision(state, data.expectedRevision); locate(state, id);
  state.installedSkills = state.installedSkills.filter(skill => skill.id !== id); state.skillsRevision++;
  return { ok: true };
}

export function resolveCreativeSkill(state, input) {
  const { skillId, stage, platform } = z.object({ skillId: identifier.or(z.literal('')).optional(), stage: z.string().max(40), platform: z.enum(['xiaohongshu', 'douyin']) }).strict().parse(input);
  if (!skillId) return null;
  normalizeCreativeSkills(state);
  const skill = locate(state, skillId);
  if (skill.enabled !== true) fail('该 Skill 已停用，请重新选择', 409);
  const preview = previewCreativeSkill({ fileName: skill.sourceFile, text: skill.sourceText });
  for (const key of ['name', 'description', 'version', 'platforms', 'stages', 'instructions']) {
    if (JSON.stringify(skill[key]) !== JSON.stringify(preview[key])) fail('Skill 内容与安装记录不一致，请重新导入', 409);
  }
  if (!preview.stages.includes(stage) || !preview.platforms.includes(platform)) fail('该 Skill 不适用于当前平台或步骤，请重新选择', 409);
  if (!z.iso.datetime().safeParse(skill.installedAt).success) fail('Skill 安装记录不完整，请重新导入', 409);
  return structuredClone({ ...preview, id: skill.id, installedAt: skill.installedAt });
}
