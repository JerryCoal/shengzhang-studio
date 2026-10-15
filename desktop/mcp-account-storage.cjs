const { mkdir, realpath, readFile, writeFile, rename, stat, readdir } = require('node:fs/promises');
const { join, relative, isAbsolute, sep } = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const validAccountId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const contained = (root, path) => { const name = relative(root, path); return name === '' || (name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name)); };
let sidPromise;
const protectedDirectories = new Set();
function run(file, args) { return new Promise((accept, reject) => execFile(file, args, { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 16384 }, (error, stdout) => error ? reject(Error('无法保护本机平台账号目录，请检查当前 Windows 用户的目录权限')) : accept(stdout))); }
async function protectDirectory(directory) {
  if (process.platform !== 'win32' || protectedDirectories.has(directory)) return;
  const system = join(process.env.SystemRoot || 'C:/Windows', 'System32');
  sidPromise ||= run(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']).then(output => { const sid = output.match(/S-1-5-\d+(?:-\d+)+/i)?.[0]; if (!sid) throw Error('无法核对本机账号目录权限'); return sid; });
  const sid = await sidPromise;
  await run(join(system, 'icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
  protectedDirectories.add(directory);
}
async function accountDirectory(root, scope, platform, accountId = 'default') {
  if (!validAccountId(accountId)) throw Error('平台账号编号无效');
  let actual = root;
  await mkdir(actual, { recursive: true, mode: 0o700 }); actual = await realpath(actual);
  for (const part of [scope, platform, ...(accountId === 'default' ? [] : ['accounts', accountId])]) {
    const next = join(actual, part); await mkdir(next, { recursive: true, mode: 0o700 });
    const resolved = await realpath(next); if (!contained(actual, resolved)) throw Error('外部服务数据目录无效，请检查本地应用目录'); actual = resolved;
  }
  // Preserve the legacy default account directory in place; never copy/delete cookies.
  await protectDirectory(actual);
  return actual;
}
async function readMetadata(directory) {
  const file = join(directory, 'launcher.json');
  try {
    const actual = await realpath(file); if (!contained(directory, actual)) throw Error();
    if ((await stat(actual)).size > 16384) throw Error();
    const value = JSON.parse(await readFile(actual, 'utf8'));
    if (value?.version !== 1 || typeof value.executable !== 'string' || !isAbsolute(value.executable) || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw Error();
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw Error('已保存的 MCP 启动信息无法读取，请重新选择程序；原登录资料仍保留'); }
}
async function saveMetadata(directory, value) {
  const temporary = join(directory, `launcher-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ version: 1, executable: value.executable, port: value.port }), { mode: 0o600, flag: 'wx' });
  await rename(temporary, join(directory, 'launcher.json'));
}
async function loginDataPresent(directory, platform) {
  // Inspect existence only. The application never reads or logs upstream cookies.
  const candidates = platform === 'xiaohongshu' ? ['cookies.json'] : ['accounts', 'browser', 'cookies'];
  for (const name of candidates) { try { const path = await realpath(join(directory, name)); if (contained(directory, path) && await stat(path)) return true; } catch {} }
  return false;
}
async function loginDataUpdatedAt(directory, platform) {
  if (platform !== 'xiaohongshu') return undefined;
  try {const path=join(directory,'cookies.json');if(await realpath(path)!==path)return undefined;const info=await stat(path);return info.isFile()?info.mtime.toISOString():undefined;}catch{return undefined;}
}
async function savedPorts(root, scope, platform) {
  const directory = await accountDirectory(root, scope, platform), ports = new Set();
  const original = await readMetadata(directory).catch(() => null); if (original) ports.add(original.port);
  let entries; try { entries = await readdir(join(directory, 'accounts'), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return ports; throw error; }
  for (const entry of entries.slice(0, 100)) if (entry.isDirectory() && validAccountId(entry.name)) {
    const child = await realpath(join(directory, 'accounts', entry.name));
    if (!contained(directory, child)) throw Error('外部服务数据目录无效');
    const metadata = await readMetadata(child).catch(() => null); if (metadata) ports.add(metadata.port);
  }
  return ports;
}
async function prepareRuntimeDirectory(directory) {
  const temporary = join(directory, 'temp'); await mkdir(temporary, { recursive: true, mode: 0o700 });
  if (await realpath(temporary) !== temporary) throw Error('平台账号临时目录不能使用外部链接');
  for (const name of ['cookies.json', 'accounts', 'browser', 'cookies']) {
    const expected = join(directory, name);
    try { if (await realpath(expected) !== expected) throw Error('平台账号登录目录不能使用外部链接；原资料未修改'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
module.exports = { accountDirectory, readMetadata, saveMetadata, loginDataPresent, loginDataUpdatedAt, validAccountId, savedPorts, prepareRuntimeDirectory };
