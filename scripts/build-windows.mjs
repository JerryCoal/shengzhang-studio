import { createRequire } from 'node:module';
import { resolve, join, sep, dirname } from 'node:path';
import { mkdirSync, cpSync, writeFileSync, renameSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const output = resolve('outputs/windows/Shengzhang-Studio-1.0.0');
const electronZip = resolve('.tools/electron-v44.3.0-win32-x64.zip');
if (!existsSync(electronZip)) throw new Error('Download and verify the official Electron distribution first');
mkdirSync(output, { recursive: true });
if (!existsSync(join(output, 'ShengzhangStudio.exe'))) {
  const archive = readFileSync(electronZip);
  if (createHash('sha256').update(archive).digest('hex') !== '26bf9a617d58d81772b3d68305d59ee48272969c15083c06db634a77358a8d9d') throw new Error('Official Electron checksum mismatch');
  const zip = await JSZip.loadAsync(archive);
  for (const item of Object.values(zip.files)) {
    const target = resolve(output, item.name);
    if (!target.startsWith(output + sep)) throw new Error('Invalid archive path');
    if (item.dir) mkdirSync(target, { recursive: true });
    else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, await item.async('nodebuffer')); }
  }
  renameSync(join(output, 'electron.exe'), join(output, 'ShengzhangStudio.exe'));
}
const appDirectory = join(output, 'resources', 'app'); mkdirSync(appDirectory, { recursive: true });
const compiled = await build({ entryPoints: ['server/windows.mjs'], outfile: join(appDirectory, 'backend.cjs'), platform: 'node', target: 'node24', format: 'cjs', bundle: true, minify: false, sourcemap: false, legalComments: 'eof', metafile: true });
const distOutput = resolve(appDirectory, 'dist');
if (!distOutput.startsWith(output + sep)) throw new Error('Invalid build output path');
if (existsSync(distOutput)) rmSync(distOutput, { recursive: true });
cpSync('dist', join(appDirectory, 'dist'), { recursive: true });
cpSync('desktop/main.cjs', join(appDirectory, 'main.cjs'));
cpSync('docs/UPGRADE-1.0.0.md', join(output, '新版功能与使用说明.md'));
cpSync('docs/PROMPT-WORKFLOW.md', join(output, '提示词与输入辅助说明.md'));
writeFileSync(join(appDirectory, 'package.json'), JSON.stringify({ name: 'shengzhang-studio', productName: '生长 AI 运营工作台', version: '1.0.0', main: 'main.cjs', private: true }, null, 2));
const runtime = join(output, 'resources', 'runtime'); mkdirSync(runtime, { recursive: true });
const runtimeNode = join(runtime, 'node.exe');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
if (!existsSync(runtimeNode) || digest(runtimeNode) !== digest(process.execPath)) cpSync(process.execPath, runtimeNode);
if (existsSync('.tools/node-LICENSE.txt')) cpSync('.tools/node-LICENSE.txt', join(runtime, 'LICENSE.txt'));
const licenses = new Map();
for (const input of Object.keys(compiled.metafile.inputs).filter(path => path.includes('node_modules/'))) {
  let directory = dirname(resolve(input));
  while (directory.includes('node_modules') && !existsSync(join(directory, 'package.json'))) directory = dirname(directory);
  if (licenses.has(directory) || !existsSync(join(directory, 'package.json'))) continue;
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].find(file => existsSync(join(directory, file)));
  licenses.set(directory, `${pkg.name} ${pkg.version}\n${license ? readFileSync(join(directory, license), 'utf8') : `License: ${pkg.license || 'See package source'}`}\n`);
}
writeFileSync(join(appDirectory, 'THIRD-PARTY-LICENSES.txt'), [...licenses.values()].join('\n--------------------\n'));
writeFileSync(join(output, '开始使用.txt'), '生长 AI 运营工作台 · Windows 完整版 1.0.0\r\n\r\n1. 请完整解压这个文件夹，然后双击 ShengzhangStudio.exe。\r\n2. 第一次打开，注册本地用户。不同用户的项目和密钥分别加密保存。\r\n3. 登录后可在工作台点击“开始免费练习”；左侧“使用指南”或 F1 可随时查看教学。\r\n4. 在“连接与设置”填写所需的 OpenAI / DeepSeek 文本密钥、OpenAI / Seedream 图片密钥及 Seedance 视频密钥，并检查连接。\r\n5. 抖音自动发布和评论同步需要你已有的开放平台应用权限及账号授权。\r\n6. 关闭窗口会缩到系统托盘，让任务继续运行；从托盘选择“退出并停止后台任务”可完全退出。\r\n7. 菜单“工作台 → 在浏览器中打开”可使用完整 Web 页面。\r\n\r\n数据位于 %LOCALAPPDATA%\\ShengzhangStudio，更新应用不会覆盖数据。牢记本地登录密码，密码无法找回。导出备份不含 API 密钥。\r\n\r\n静态网站中的用户与本机应用分别保存；不会自动同步。模型调用按服务商账户计费，请先配置项目预算。\r\n');
console.log(JSON.stringify({ directory: output, executable: join(output, 'ShengzhangStudio.exe'), bundledNode: process.version }));
