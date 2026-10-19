import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, hkdfSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dpapi, createVault } from './vault.mjs';
import { seal, unseal } from './crypto-box.mjs';
import { createStore } from './store.mjs';
import { createTeamStore } from './team-store.mjs';

const exec = promisify(execFile);
export async function restrictTeamDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const { stdout } = await exec('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = stdout.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('无法确认主机运行用户，尚未创建团队密钥');
    await exec('icacls.exe', [resolve(directory), '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
  } else chmodSync(directory, 0o700);
}

export async function openTeamStorage({ dataDirectory, transform = dpapi, protectWithDPAPI = process.platform === 'win32', restrictDirectory = true }) {
  const directory = resolve(dataDirectory);
  if (restrictDirectory) await restrictTeamDirectory(directory);
  else mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyFile = resolve(directory, 'master.key');
  let master;
  if (existsSync(keyFile)) {
    try {
      const saved = JSON.parse(readFileSync(keyFile, 'utf8'));
      if (saved.version !== 1 || saved.protection !== (protectWithDPAPI ? 'dpapi-current-user' : 'file-permissions')) throw new Error('Unexpected key format');
      const bytes = Buffer.from(saved.ciphertext, 'base64');
      try { master = protectWithDPAPI ? await transform('unprotect', bytes) : Buffer.from(bytes); } finally { bytes.fill(0); }
      if (master.length !== 32) throw new Error('Invalid key length');
    } catch { master?.fill(0); throw new Error('团队主密钥无法解锁。请使用原主机运行用户和完整备份；原文件已保留。'); }
  } else {
    if (existsSync(resolve(directory, 'workspace.sqlite')) || existsSync(resolve(directory, 'users.sqlite'))) throw new Error('团队数据已存在但缺少 master.key，请恢复完整备份；不会生成新密钥覆盖旧数据。');
    master = randomBytes(32);
    const protectedBytes = protectWithDPAPI ? await transform('protect', master) : Buffer.from(master);
    try { writeFileSync(keyFile, JSON.stringify({ version: 1, protection: protectWithDPAPI ? 'dpapi-current-user' : 'file-permissions', ciphertext: protectedBytes.toString('base64') }), { flag: 'wx', mode: 0o600 }); }
    finally { protectedBytes.fill(0); }
  }
  const workspaceKey = Buffer.from(hkdfSync('sha256', master, 'team-v1', 'workspace', 32));
  const credentialKey = Buffer.from(hkdfSync('sha256', master, 'team-v1', 'credentials', 32));
  master.fill(0);
  let base;
  try { base = createStore(resolve(directory, 'workspace.sqlite'), { key: workspaceKey, scope: 'team-v1' }); }
  catch (error) { credentialKey.fill(0); throw error; }
  finally { workspaceKey.fill(0); }
  const store = createTeamStore(base);
  const vault = name => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid vault name');
    const item = createVault(resolve(directory, 'private', `${name}.json`), { supported: true, transform: async (action, value) => action === 'protect' ? seal(value, credentialKey, `team-v1:${name}`) : unseal(value, credentialKey, `team-v1:${name}`) });
    return { ...item, status: () => ({ ...item.status(), protection: protectWithDPAPI ? '团队加密保险箱 · 主机 Windows 用户保护' : '团队加密保险箱 · 主机文件权限保护' }) };
  };
  return { store, vault, close: () => { store.close(); credentialKey.fill(0); } };
}
