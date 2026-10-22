import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { creativeSkillCatalog } from '../server/creative-skill-catalog.mjs';
import { installCreativeSkill, updateCreativeSkill, previewCreativeSkill, CREATIVE_SKILL_MAX_BYTES } from '../server/creative-skills.mjs';

// Replay container hooks and callbacks; child markup uses React's real renderer.
// All persistence and API responses stay in memory, with no external requests.
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({
  stdin: { contents: "export { CreativeSkillsSettings } from './src/pages/CreativeSkills.tsx'; export { Context } from './src/context.tsx'; export { Modal, Field } from './src/components.tsx';", resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env.MODE': '"development"', 'import.meta.env.VITE_API_BASE_URL': '""' }, logLevel: 'silent',
});
let hooks = null;
const hookReact = {
  ...React,
  useState(initial) {
    if (!hooks) return React.useState(initial);
    const owner = hooks, index = owner.cursor++;
    if (!Object.hasOwn(owner.values, index)) owner.values[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.values[index], value => { owner.values[index] = typeof value === 'function' ? value(owner.values[index]) : value; }];
  },
  useRef(initial) {
    if (!hooks) return React.useRef(initial);
    const index = hooks.cursor++;
    if (!Object.hasOwn(hooks.values, index)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useId() { return hooks ? 'skills-test' : React.useId(); },
  useEffect(effect, dependencies) {
    if (!hooks) return React.useEffect(effect, dependencies);
    const index = hooks.cursor++, prior = hooks.values[index];
    if (!prior || dependencies.some((value, i) => !Object.is(value, prior[i]))) hooks.effects.push(effect);
    hooks.values[index] = dependencies;
  },
  useContext(context) { return hooks ? hooks.context : React.useContext(context); },
};
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, name => name === 'react' ? hookReact : require(name));
const { CreativeSkillsSettings, Context, Modal, Field } = module.exports;
const originalText = '---\nname: 校园风格\ndescription: 真实校园场景\nversion: 1.0\n---\n先写真实使用场景。';
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  const state = {}, skill = installCreativeSkill(state, { fileName: '校园.md', text: originalText, workflowId: 'copy-xiaohongshu', expectedRevision: 0, confirmed: true });
  const calls = [], control = { mutationError: '', refreshError: '' };
  const context = {
    settings: {}, busy: false, notify() {},
    async mutate(path, method, body) {
      calls.push({ path, method, body: structuredClone(body) });
      if (control.mutationError) throw Error(control.mutationError);
      const result = method === 'PUT' ? updateCreativeSkill(state, path.split('/').at(-1), body) : installCreativeSkill(state, body);
      return { result, state: structuredClone(state) };
    },
  };
  const prior = { fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, requestAnimationFrame: globalThis.requestAnimationFrame };
  globalThis.sessionStorage = { getItem() { return null; } };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.fetch = async (path, options) => {
    if (path === '/api/creative-skills/preview') return Response.json(previewCreativeSkill(JSON.parse(options.body)));
    assert.equal(path, '/api/creative-skills');
    if (control.refreshError) throw Error(control.refreshError);
    return Response.json(creativeSkillCatalog(state));
  };
  t.after(() => Object.assign(globalThis, prior));
  const owner = { context, values: [], effects: [], cursor: 0 };
  function tree() {
    assert.equal(hooks, null); hooks = owner; owner.cursor = 0;
    let result;
    try { result = CreativeSkillsSettings(); } finally { hooks = null; }
    for (const effect of owner.effects.splice(0)) effect();
    return result;
  }
  const html = () => renderToStaticMarkup(React.createElement(Context.Provider, { value: context }, tree()));
  tree(); await settle();
  return { state, skill, control, calls, tree, html };
}
function findAll(node, predicate, result = []) {
  if (!React.isValidElement(node)) return result;
  if (predicate(node)) result.push(node);
  React.Children.forEach(node.props.children, child => findAll(child, predicate, result));
  return result;
}
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return React.isValidElement(node) ? textOf(node.props.children) : '';
}
const findOne = (tree, predicate) => { const result = findAll(tree, predicate); assert.equal(result.length, 1); return result[0]; };
const button = (tree, label) => findOne(tree, node => node.type === 'button' && (node.props['aria-label'] === label || textOf(node) === label));
const editor = tree => findAll(tree, node => node.type === Modal && node.props.title.startsWith('编辑导入 Skills'))[0];
const textInput = tree => findOne(tree, node => node.type === 'textarea' && node.props['aria-label'] === '导入 Skills 原文');

test('imported Skills expose an editor that saves the existing record and refreshes its visible content', async t => {
  const f = await fixture(t);
  assert.match(f.html(), /aria-label="编辑 Skills 校园风格"/);
  const edit = button(f.tree(), '编辑 Skills 校园风格'); assert.equal(edit.props.disabled, false); edit.props.onClick();
  let dialog = editor(f.tree()); assert(dialog); assert.equal(textInput(dialog).props.value, originalText);
  assert.equal(button(dialog, '保存 Skills').props.disabled, true);
  const edited = originalText.replace('先写真实使用场景。', '先写真实需求，再说明边界。');
  textInput(dialog).props.onChange({ target: { value: edited } });
  dialog = editor(f.tree()); assert.equal(button(dialog, '保存 Skills').props.disabled, false);
  button(dialog, '保存 Skills').props.onClick(); await settle();
  assert.equal(editor(f.tree()), undefined); assert.equal(f.state.installedSkills.length, 1);
  assert.equal(f.state.installedSkills[0].id, f.skill.id); assert.equal(f.state.installedSkills[0].sourceText, edited);
  assert.deepEqual(f.calls[0], { path: `/creative-skills/${f.skill.id}`, method: 'PUT', body: { fileName: '校园.md', text: edited, expectedRevision: 1 } });
  assert.match(f.html(), /先写真实需求，再说明边界。/);
});

test('failed edits retain their draft, require explicit discard, and reject empty or oversized UTF-8 content', async t => {
  const f = await fixture(t); button(f.tree(), '编辑 Skills 校园风格').props.onClick();
  const edited = originalText + '\n补充重要约束。';
  textInput(editor(f.tree())).props.onChange({ target: { value: edited } });
  f.control.mutationError = '保存失败，请重试'; button(editor(f.tree()), '保存 Skills').props.onClick(); await settle();
  let dialog = editor(f.tree()); assert.equal(textInput(dialog).props.value, edited); assert.match(f.html(), /保存失败，请重试/);
  button(dialog, '取消').props.onClick(); dialog = editor(f.tree());
  assert(dialog); assert.match(textOf(dialog), /本次修改尚未保存/); button(dialog, '继续编辑').props.onClick();
  textInput(editor(f.tree())).props.onChange({ target: { value: '汉'.repeat(CREATIVE_SKILL_MAX_BYTES / 3 + 1) } });
  dialog = editor(f.tree()); assert.equal(button(dialog, '保存 Skills').props.disabled, true); assert.match(textOf(dialog), /超过 24 KB/);
  textInput(dialog).props.onChange({ target: { value: ' ' } }); assert.equal(button(editor(f.tree()), '保存 Skills').props.disabled, true);
  assert.equal(f.calls.length, 1); assert.equal(f.state.installedSkills[0].sourceText, originalText);
});

test('concurrent changes preserve the draft and prevent saving it over a newer rule after refresh', async t => {
  const f = await fixture(t); button(f.tree(), '编辑 Skills 校园风格').props.onClick();
  const draft = originalText + '\n我的草稿。'; textInput(editor(f.tree())).props.onChange({ target: { value: draft } });
  updateCreativeSkill(f.state, f.skill.id, { fileName: '校园.md', text: originalText + '\n另一处已保存。', expectedRevision: 1 });
  button(editor(f.tree()), '保存 Skills').props.onClick(); await settle();
  f.tree(); let dialog = editor(f.tree());
  assert.equal(textInput(dialog).props.value, draft); assert.equal(button(dialog, '保存 Skills').props.disabled, true);
  assert.match(textOf(dialog), /规则列表已更新/);
  button(dialog, '重新读取列表版本').props.onClick(); await settle(); dialog = editor(f.tree());
  assert.equal(textInput(dialog).props.value, draft); assert.equal(button(dialog, '保存 Skills').props.disabled, true);
  assert.match(f.state.installedSkills[0].sourceText, /另一处已保存/);
});

test('a failed install after preview keeps the original input and reviewed installation for retry', async t => {
  const f = await fixture(t); button(f.tree(), '导入 Skills').props.onClick();
  findOne(f.tree(), node => node.type === 'select' && node.props['aria-label'] === '导入 Skills 的工作步骤').props.onChange({ target: { value: 'planning' } });
  const inputField = findOne(f.tree(), node => node.type === Field && node.props.label === 'Markdown 原文');
  findOne(inputField, node => node.type === 'textarea').props.onChange({ target: { value: originalText } });
  button(f.tree(), '预览安装内容').props.onClick(); await settle();
  assert.match(f.html(), /核对即将安装的原文/);
  f.control.mutationError = '暂时无法保存'; button(f.tree(), '确认安装到此步骤').props.onClick(); await settle();
  const currentField = findOne(f.tree(), node => node.type === Field && node.props.label === 'Markdown 原文');
  assert.equal(findOne(currentField, node => node.type === 'textarea').props.value, originalText);
  assert.equal(button(f.tree(), '确认安装到此步骤').props.disabled, false); assert.match(f.html(), /暂时无法保存/);
  assert.equal(f.state.installedSkills.length, 1);
});
