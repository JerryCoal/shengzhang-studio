import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const names = ['sensitive-copy-review', 'xiaohongshu-copywriting', 'price-context-replacement'];
const skills = Object.fromEntries(names.map(name => [name, readFileSync(`skills/${name}/SKILL.md`, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()]));
const output = '// Generated from skills/*/SKILL.md by scripts/compile-copy-skills.mjs.\nexport const COPY_SKILLS = ' + JSON.stringify(skills, null, 2) + ';\n';
if (process.argv.includes('--check')) {
  if (readFileSync('server/copy-skills.generated.mjs', 'utf8') !== output) throw new Error('Skills 已更新，请先运行 node scripts/compile-copy-skills.mjs');
} else {
  mkdirSync('server', { recursive: true }); writeFileSync('server/copy-skills.generated.mjs', output);
}
