import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
async function loadUI(mode) {
  const compiled = await build({
    stdin: { contents: "export { KnowledgeLibrary, KnowledgeActions, KnowledgeSaveDialog } from './src/pages/KnowledgeLibrary.tsx'; export { Context } from './src/context.tsx';", resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' },
    define: { 'import.meta.env.MODE': JSON.stringify(mode), 'import.meta.env.VITE_API_BASE_URL': '""' }, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
function fixture() {
  const entry = { id: 'reference-a', revision: 2, kind: 'reference', title: '已核对的场景参考', text: '参考来源中的办公场景，不能当作产品事实。', sourceUrl: 'https://example.invalid/reference', sourceId: 'source-a', sourceType: 'manual', accountId: 'account-a', expiresAt: null, active: true, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T01:00:00Z' };
  const project = { id: 'project-a', creationSelections: { xiaohongshu: { accountId: 'account-a', presetId: '' } }, knowledge: [entry] };
  const state = { projects: [project], accounts: [{ id: 'account-a', platform: 'xiaohongshu', name: '场景账号甲' }], activities: [] };
  const fail = () => { throw new Error('SSR checks must not mutate, navigate or call a provider'); };
  const context = { project, state, busy: false, accountScope: '', target: {}, mutate: fail, run: fail, go: fail, notify: fail };
  return { entry, context };
}
const buttons = html => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, body]) => ({ text: body.replace(/<[^>]*>/g, '').trim(), disabled: /\bdisabled(?:=|\s|$)/.test(attributes) }));
function assertButton(html, label, disabled) {
  const found = buttons(html).filter(button => button.text === label);
  assert.equal(found.length, 1, `Expected one ${label} button`);
  assert.equal(found[0].disabled, disabled, `${label} disabled state`);
}

for (const mode of ['static', 'web']) {
  const { KnowledgeLibrary, KnowledgeActions, KnowledgeSaveDialog, Context } = await loadUI(mode);
  const render = (component, context, props = {}) => renderToStaticMarkup(createElement(Context.Provider, { value: context }, createElement(component, props)));

  test(`${mode}: local library opens add, experience, edit and pause while explaining encrypted storage`, () => {
    const { context } = fixture(), html = render(KnowledgeLibrary, context);
    for (const label of ['添加资料', '记录经验', '编辑', '停用', '用来创作']) assertButton(html, label, false);
    assert.match(html, /资料仅在此浏览器加密保存；带身份生成需 Windows 或团队版/);
    assert.doesNotMatch(html, /新增和编辑请在 Windows|此版本可查看历史资料/);
  });

  test(`${mode}: discovered references can be saved, kept as experience or used for a local draft`, () => {
    const { context, entry } = fixture(), html = render(KnowledgeActions, context, { source: entry });
    for (const label of ['收藏资料', '保存为经验', '用来创作']) assertButton(html, label, false);
    const explicitLock = render(KnowledgeActions, context, { source: entry, disabled: true });
    for (const button of buttons(explicitLock)) assert.equal(button.disabled, true);
  });

  test(`${mode}: local availability still respects busy state and missing content account`, () => {
    const { context, entry } = fixture();
    const busy = { ...context, busy: true };
    for (const html of [render(KnowledgeLibrary, busy), render(KnowledgeActions, busy, { source: entry })]) {
      assert(buttons(html).length > 0);
      for (const button of buttons(html)) assert.equal(button.disabled, true, button.text);
    }
    context.state.accounts = [];
    const missingAccount = render(KnowledgeLibrary, context);
    assertButton(missingAccount, '用来创作', true);
    assertButton(missingAccount, '编辑', false);
  });

  test(`${mode}: local save form permits editing but requires manual review before submitting`, () => {
    const { context, entry } = fixture();
    const html = render(KnowledgeSaveDialog, context, { source: entry, kind: 'experience', onClose() {} });
    assert.match(html, /我已核对保留的文字、来源和适用账号/);
    assert.match(html, /这是一条待验证经验/);
    assert.match(html, /<textarea\b(?![^>]*\bdisabled)[^>]*>/);
    assert.match(html, /<select\b(?![^>]*\bdisabled)[^>]*>/);
    assertButton(html, '保存', true);
    assertButton(html, '取消', false);
  });
}
