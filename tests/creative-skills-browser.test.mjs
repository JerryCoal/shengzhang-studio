import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { indexedDB } from 'fake-indexeddb';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
globalThis.indexedDB = indexedDB;
globalThis.window = Object.assign(new EventTarget(), { indexedDB, isSecureContext: true });
Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, _options, work) => work({}) } }, configurable: true });
const compiled = await build({ stdin: { contents: "export { localAPI } from './src/local-api.ts'; export { webAPI } from './src/web-api.ts'; export { registerLocal, loginLocal, lockLocalWorkspace, readLocalState } from './src/local-vault.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { localAPI: api, webAPI, readLocalState, registerLocal, loginLocal, lockLocalWorkspace } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('Skills preview, install, stale revision, disable and delete persist in isolated browser users', async () => {
  const text = '---\nname: 校园写作\ndescription: 清楚介绍真实用途\nmetadata:\n  version: "1.0"\nplatforms: [xiaohongshu]\n---\n先写大学生自习场景。保留 Emoji ✨ 和 [赞R]。';
  await registerLocal('Skills甲', 'local-skills-password-123');
  const initial = await api('/creative-skills', 'GET');
  assert.equal(initial.revision, 0); assert.equal(initial.skills.length, 0); assert.match(initial.builtin.instructions, /title/);
  const preview = await api('/creative-skills/preview', 'POST', { fileName: 'SKILL.md', text });
  assert.equal(preview.version, '1.0'); assert.equal((await api('/creative-skills', 'GET')).revision, 0);
  const installed = await api('/creative-skills', 'POST', { fileName: 'SKILL.md', text, expectedRevision: 0, confirmed: true });
  const id = installed.result.id;
  assert.equal(installed.state.installedSkills.length, 1); assert.equal(installed.result.enabled, true);
  await assert.rejects(api(`/creative-skills/${id}`, 'DELETE', { expectedRevision: 0 }), /另一处更新/);
  lockLocalWorkspace(); await registerLocal('Skills乙', 'local-skills-password-456');
  assert.equal((await api('/creative-skills', 'GET')).skills.length, 0);
  await assert.rejects(api(`/creative-skills/${id}`, 'DELETE', { expectedRevision: 0 }), /不存在/);
  lockLocalWorkspace(); await loginLocal('Skills甲', 'local-skills-password-123');
  let catalog = await api('/creative-skills', 'GET');
  assert.equal(catalog.skills[0].sourceText, text); assert.equal(catalog.revision, 1);
  const changed = await api(`/creative-skills/${id}`, 'PATCH', { expectedRevision: 1, enabled: false });
  assert.equal(changed.state.skillsRevision, 2); assert.equal(changed.result.enabled, false);
  const removed = await api(`/creative-skills/${id}`, 'DELETE', { expectedRevision: 2 });
  assert.equal(removed.state.installedSkills.length, 0); assert.equal(removed.state.skillsRevision, 3);
  assert.equal((await api('/creative-skills', 'GET')).builtin.instructions, initial.builtin.instructions);
  const originalFetch = globalThis.fetch; let sent = 0;
  globalThis.fetch = async () => { sent++; throw Error('Unapproved transmission'); };
  try {
    const p = (await api('/state', 'GET')).projects[0];
    await assert.rejects(webAPI(`/projects/${p.id}/assets/local/copy`, 'POST', { skillId: id, expectedRevision: 1 }), /尚未启用自装 Skills/);
    assert.equal(sent, 0); assert.equal((await readLocalState()).webPrivate?.pending, undefined);
  } finally { globalThis.fetch = originalFetch; }
  lockLocalWorkspace();
});
