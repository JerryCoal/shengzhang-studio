import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AI_SKILLS } from '../server/ai-skills-manifest.mjs';
const names = AI_SKILLS.map(skill => skill.id);
const files = Object.fromEntries(names.map(name => [name, readFileSync(`skills/${name}/SKILL.md`, 'utf8')]));
const skills = Object.fromEntries(names.map(name => [name, files[name].replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()]));
const versions = Object.fromEntries(names.map(name => [name, files[name].match(/^\s+version:\s*["']?([^\s"']+)/m)?.[1] || '1']));
const output = '// Generated from skills/*/SKILL.md by scripts/compile-copy-skills.mjs.\nexport const COPY_SKILLS = ' + JSON.stringify(skills, null, 2) + ';\nexport const COPY_SKILL_VERSIONS = ' + JSON.stringify(versions, null, 2) + ';\n';
if (process.argv.includes('--check')) {
  if (readFileSync('server/copy-skills.generated.mjs', 'utf8') !== output) throw new Error('Skills 已更新，请先运行 node scripts/compile-copy-skills.mjs');
} else {
  mkdirSync('server', { recursive: true }); writeFileSync('server/copy-skills.generated.mjs', output);
}
