import { createRequire } from 'node:module';
import { resolve, join, dirname, sep, relative } from 'node:path';
import { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 team package using its Windows Node runtime');
const outputBase = resolve('outputs/team');
const output = resolve(outputBase, `Shengzhang-Studio-Team-${version}`);
if (!output.startsWith(outputBase + sep)) throw new Error('Invalid release path');
// Refuse to overwrite a running or previously modified package.
if (existsSync(output)) throw new Error(`Release directory already exists; choose a new version or move the reviewed build aside: ${output}`);
const releaseDocuments = ['UPGRADE', 'RELEASE', 'DEVELOPMENT-HANDOFF', 'VALIDATION'].map(name => `docs/${name}-${version}.md`);
for (const file of ['dist/index.html', 'server/team.mjs', '.tools/team-runtime/caddy.exe', '.tools/team-runtime/caddy-release.json', 'docs/TEAM-DEPLOYMENT-1.25.0.md', ...releaseDocuments]) if (!existsSync(file)) throw new Error(`Missing build input: ${file}`);
const digest = (file, algorithm = 'sha256') => createHash(algorithm).update(readFileSync(file)).digest('hex');
const caddy = JSON.parse(readFileSync('.tools/team-runtime/caddy-release.json', 'utf8'));
if (caddy.version !== '2.11.7' || digest('.tools/team-runtime/caddy.exe') !== '5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a') throw new Error('Verified official Caddy runtime is missing');
for (const directory of ['server', 'scripts', 'config', 'runtime']) mkdirSync(join(output, directory), { recursive: true });
const compiled = await build({ entryPoints: ['server/team.mjs'], outfile: join(output, 'server/team.mjs'), platform: 'node', target: 'node24', format: 'esm', bundle: true, minify: false, sourcemap: false, legalComments: 'eof', metafile: true, banner: { js: "import { createRequire as __teamCreateRequire } from 'node:module'; const require = __teamCreateRequire(import.meta.url);" } });
cpSync('server/image-watermark-check.ps1', join(output, 'server/image-watermark-check.ps1'));
cpSync('dist', join(output, 'dist'), { recursive: true });
cpSync('vendor/redfox-community', join(output, 'vendor', 'redfox-community'), { recursive: true });
cpSync('skills', join(output, 'skills'), { recursive: true });
for (const name of ['start-team.ps1', 'stop-team.ps1', 'team-supervisor.mjs']) {
  if (name.endsWith('.ps1')) writeFileSync(join(output, 'scripts', name), '\uFEFF' + readFileSync(join('scripts', name), 'utf8').replace(/^\uFEFF/, ''));
  else cpSync(join('scripts', name), join(output, 'scripts', name));
}
cpSync('config/Caddyfile.team', join(output, 'config/Caddyfile.team'));
cpSync(process.execPath, join(output, 'runtime/node.exe'));
cpSync('.tools/team-runtime/caddy.exe', join(output, 'runtime/caddy.exe'));
cpSync('.tools/team-runtime/caddy-release.json', join(output, 'runtime/caddy-release.json'));
cpSync('.tools/team-runtime/CADDY-LICENSE', join(output, 'runtime/CADDY-LICENSE.txt'));
if (existsSync('.tools/node-LICENSE.txt')) cpSync('.tools/node-LICENSE.txt', join(output, 'runtime/NODE-LICENSE.txt'));
writeFileSync(join(output, '团队部署与使用说明.md'), readFileSync('docs/TEAM-DEPLOYMENT-1.25.0.md', 'utf8').replaceAll('1.25.0', version));
if (existsSync(`docs/REDFOX-TEST-REPORT-${version}.md`)) for (const name of ['Redfox测试版功能报告.md', `REDFOX-TEST-REPORT-${version}.md`]) cpSync(`docs/REDFOX-TEST-REPORT-${version}.md`, join(output, name));
for (const file of releaseDocuments) cpSync(file, join(output, relative('docs', file)));
cpSync('docs/GLM-SETUP.md', join(output, 'GLM-SETUP.md'));
cpSync('docs/LOCAL-QWEN-SETUP.md', join(output, 'LOCAL-QWEN-SETUP.md'));
if (existsSync(`docs/SERVER-EXTENSION-${version}.md`)) cpSync(`docs/SERVER-EXTENSION-${version}.md`, join(output, `SERVER-EXTENSION-${version}.md`));
const licenses = new Map();
for (const input of Object.keys(compiled.metafile.inputs).filter(path => path.includes('node_modules/'))) {
  let directory = dirname(resolve(input));
  while (directory.includes('node_modules') && !existsSync(join(directory, 'package.json'))) directory = dirname(directory);
  if (licenses.has(directory) || !existsSync(join(directory, 'package.json'))) continue;
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].find(name => existsSync(join(directory, name)));
  licenses.set(directory, `${pkg.name} ${pkg.version}\n${license ? readFileSync(join(directory, license), 'utf8') : `License: ${pkg.license || 'See package source'}`}\n`);
}
writeFileSync(join(output, 'THIRD-PARTY-LICENSES.txt'), [...licenses.values()].join('\n--------------------\n'));
writeFileSync(join(output, 'package.json'), JSON.stringify({ name: 'shengzhang-studio-team', productName: 'Shengzhang Studio 自媒体运营工作站', author: 'JCoal', version, private: true, type: 'module' }, null, 2));
writeFileSync(join(output, 'Start-Team.cmd'), '@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\start-team.ps1" %*\r\npause\r\n');
writeFileSync(join(output, 'Stop-Team.cmd'), '@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\stop-team.ps1" %*\r\npause\r\n');
writeFileSync(join(output, '开始使用.txt'), `Shengzhang Studio 自媒体运营工作站 · 团队版 v${version}\r\nJCoal 开发\r\n\r\n1. 升级前停止旧团队服务并备份。完整解压，先阅读“团队部署与使用说明.md”、RELEASE-${version}.md 和 VALIDATION-${version}.md。\r\n2. 主机双击 Start-Team.cmd，默认仅开启 https://localhost。按说明核验并安装本包生成的根证书；首次初始化码在 %LOCALAPPDATA%\\ShengzhangStudioTeam\\setup.code。\r\n3. 管理员创建成员；其他电脑访问按部署说明指定局域网地址。账号、项目、角色权限和成员私有任务继续隔离。\r\n4. 在“总控”描述目标并核对计划。免费规则草案不调用模型；AI 规划费用单独确认，生成建议后还须另外批准业务任务、账号与额度。\r\n5. 在“任务”查看真实活动、成果版本与任务对话；独立任务可并行，依赖任务使用固定成果版本。候选须明确采用；发送消息不自动重跑或发布。\r\n6. “进展”保留完成、失败及待核对通知。暂停只在安全检查点生效；外部已发送请求可能继续计费，结果未知不自动重发。\r\n7. 原有灵感、各平台创作、发布与复盘流程保留。只迁入实际存在的旧检查点，不补造历史、不删除旧素材，也不自动恢复收费任务。\r\n8. 管理员在“连接与设置”配置文字模型及图片视频服务；GLM、本地 Qwen 见对应指南。Redfox 为可选扩展，保存密钥不自动开启路由。\r\n9. 发布和共享文档写入仍须遵守原有权限及明确确认。“资料”可导出含任务历史的私有业务备份，不含密钥；恢复到独立新数据库后重新核对。\r\n10. 浏览器关闭不会停止团队服务。停止主机前核对未完成任务并运行 Stop-Team.cmd；不可用旧程序继续写入已升级的新数据库。\r\n\r\n本包不修改防火墙、DNS、开机启动或系统服务，不读取或迁移已有个人工作区。主机需保持开机且当前 Windows 用户保持登录；实际外部服务能力和费用以权限、回执与账单为准。\r\n`);
const files = [];
function scan(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error('Links are not allowed in release'); if (entry.isDirectory()) scan(path); else files.push(path); } }
scan(output);
const names = files.map(path => relative(output, path).replaceAll('\\', '/'));
if (names.some(name => /(?:^|\/)(?:data|private|profiles|logs|run)(?:\/|$)|master\.key|setup\.code|\.sqlite(?:-|$)|\.env(?:\.|$)/i.test(name))) throw new Error('Private runtime data found in release');
const manifest = { version, builtAt: new Date().toISOString(), node: process.version, caddy, files: files.map(path => ({ path: relative(output, path).replaceAll('\\', '/'), sha256: digest(path) })) };
writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
files.push(join(output, 'release-manifest.json'));
const zip = new JSZip();
for (const path of files) zip.file(`${relative(outputBase, output)}/${relative(output, path).replaceAll('\\', '/')}`, readFileSync(path));
const zipPath = resolve('outputs', `Shengzhang-Studio-Team-${version}-windows-x64.zip`);
writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
writeFileSync(`${zipPath}.sha256`, `${digest(zipPath)}  ${relative(resolve('outputs'), zipPath)}\n`);
console.log(JSON.stringify({ directory: output, zip: zipPath, sha256: digest(zipPath), files: files.length, node: process.version, caddy: caddy.version }));
