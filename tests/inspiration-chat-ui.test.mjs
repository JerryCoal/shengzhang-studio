import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Children, createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const postcss = createRequire(require.resolve('vite'))('postcss');
const compiled = await build({
  entryPoints: ['src/components/InspirationConversation.tsx'], bundle: true,
  platform: 'node', format: 'cjs', write: false, packages: 'external',
  loader: { '.css': 'empty' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { InspirationConversation, isInspirationReviewShortcut } = module.exports;
const base = { turns: [], input: '', onInput() {}, submitAction: createElement('button', { type: 'button' }, '确认本次生成') };
const reply = { title: '新手露营选题', core: '先讨论真实经历\n不编造效果', direction: '分享装备准备过程', prompt: '按实际素材写作' };
const turn = { id: 'turn-1', user: '给新手写什么？', status: 'completed', at: '2026-10-20T09:12:00Z', platform: 'xiaohongshu', accountId: 'account-private-id', model: 'qwen-plus', reply };
const render = props => renderToStaticMarkup(createElement(InspirationConversation, { ...base, ...props }));

function collectElements(node, predicate, output = []) {
  if (!isValidElement(node)) return output;
  if (predicate(node)) output.push(node);
  Children.forEach(node.props.children, child => collectElements(child, predicate, output));
  return output;
}
function capture(props = {}) {
  let tree;
  function Capture() { tree = InspirationConversation({ ...base, ...props }); return tree; }
  renderToStaticMarkup(createElement(Capture));
  return tree;
}

test('empty conversation exposes named composer and fill-only suggestions without fake progress', () => {
  const html = render({});
  assert.match(html, /灵感 Agent/);
  assert.match(html, /聊聊这次，你想做什么内容/);
  assert.match(html, /只会填入输入框/);
  assert.match(html, /<label for="([^"]+)">输入你的运营需求<\/label>/);
  assert.match(html, /<textarea[^>]*maxLength="4000"[^>]*rows="4"/);
  assert.match(html, /Enter 换行/);
  assert.match(html, /不会自动发布/);
  assert.doesNotMatch(html, /role="status"|inspiration-progress-spinner|0%|搜索中|思考过程/);
  assert.doesNotMatch(html, /Ctrl \/ ⌘ \+ Enter/);
});

test('history renders multiple user/assistant turns and preserves plain text safely', () => {
  const html = render({ turns: [turn, { ...turn, id: 'turn-2', user: '<script>unsafe()</script>\n请更具体', reply: { ...reply, title: '<img src=x onerror=unsafe()>' } }] });
  assert.equal((html.match(/class="inspiration-turn"/g) || []).length, 2);
  assert.match(html, /当前账号的灵感对话/);
  assert.match(html, /核心想法/);
  assert.match(html, /内容方向/);
  assert.match(html, /查看创作提示/);
  assert.match(html, /qwen-plus/);
  assert.match(html, /小红书/);
  assert.match(html, /<time dateTime="2026-10-20T09:12:00Z">/);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=unsafe\(\)&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x|account-private-id|聊聊这次/);
});

test('missing replies show explicit pending/interrupted/failed states without claiming completion', () => {
  const html = render({ turns: [
    { id: 'pending', user: '需求甲', status: 'pending' },
    { id: 'interrupted', user: '需求乙', status: 'interrupted' },
    { id: 'failed', user: '需求丙', status: 'failed', error: '服务不可用 <retry>' },
  ] });
  assert.match(html, /等待处理/);
  assert.match(html, /尚未收到这一轮的方案/);
  assert.match(html, /本轮结果尚未确认/);
  assert.match(html, /请先核对已保存结果与服务记录；不会自动重发/);
  assert.match(html, /服务不可用 &lt;retry&gt;/);
  assert.doesNotMatch(html, /已完成|inspiration-reply-card/);
});

test('only provided progress is announced and pause is not presented as generation success', () => {
  const html = render({ progress: { stage: '等待用户确认费用', detail: '尚未调用模型服务', status: 'paused' } });
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /等待用户确认费用/);
  assert.match(html, /尚未调用模型服务/);
  assert.match(html, /已暂停/);
  assert.doesNotMatch(html, /正在搜索|整理完成|inspiration-progress-spinner/);
  const running = render({ progress: { stage: '已提交模型请求', status: 'running' } });
  assert.match(running, /inspiration-progress-spinner/);
  assert.match(running, /已提交模型请求/);
});

test('all integration slots remain visible except advanced options which start collapsed', () => {
  const textSlot = text => createElement('span', {}, text);
  const html = render({
    contextSummary: textSlot('项目甲 · 账号乙'), toolbar: textSlot('热点研究入口 · 经验库入口'),
    actions: textSlot('新开对话入口'), contextPanel: textSlot('原有模型经验资料组件'),
    result: textSlot('可编辑的当前方案'), handoff: textSlot('交给小红书 Agent'),
  });
  for (const text of ['项目甲 · 账号乙', '热点研究入口 · 经验库入口', '新开对话入口', '原有模型经验资料组件', '可编辑的当前方案', '交给小红书 Agent', '确认本次生成']) assert(html.includes(text), text);
  assert.match(html, /<details class="inspiration-context-options">/);
  assert.match(html, /资料、经验与模型/);
  assert.match(html, /aria-label="当前可编辑方案"/);
  assert.doesNotMatch(html, /<details class="inspiration-context-options" open/);
});

test('editable latest result can replace one history reply without duplication', () => {
  const result = createElement('div', {}, '唯一的编辑器');
  const html = render({ turns: [turn], activeTurnId: turn.id, result });
  assert.equal((html.match(/唯一的编辑器/g) || []).length, 1);
  assert.doesNotMatch(html, /新手露营选题/);
  const unmatched = render({ turns: [turn], activeTurnId: 'not-found', result });
  assert.equal((unmatched.match(/唯一的编辑器/g) || []).length, 1);
  assert.match(unmatched, /新手露营选题/);
  assert.match(unmatched, /当前可编辑方案/);
});

test('suggestions only fill input, preserve explicit onSuggestion override, and never submit', () => {
  const changes = [], suggestions = [];
  let reviewed = 0;
  const tree = capture({ suggestions: ['先明确目标'], onInput: value => changes.push(value), onSubmitReview: () => reviewed++ });
  const button = collectElements(tree, element => element.type === 'button' && element.props.onClick)[0];
  button.props.onClick();
  assert.deepEqual(changes, ['先明确目标']);
  assert.equal(reviewed, 0);
  const override = capture({ suggestions: ['再选一个方向'], onInput: value => changes.push(value), onSuggestion: value => suggestions.push(value) });
  collectElements(override, element => element.type === 'button' && element.props.onClick)[0].props.onClick();
  assert.deepEqual(suggestions, ['再选一个方向']);
  assert.deepEqual(changes, ['先明确目标']);
});

test('review shortcut accepts Ctrl or Cmd Enter and rejects Enter, IME, and modified alternatives', () => {
  const key = { key: 'Enter', ctrlKey: false, metaKey: false };
  assert.equal(isInspirationReviewShortcut({ ...key, ctrlKey: true }), true);
  assert.equal(isInspirationReviewShortcut({ ...key, metaKey: true }), true);
  for (const event of [key, { ...key, ctrlKey: true, isComposing: true }, { ...key, metaKey: true, keyCode: 229 }, { ...key, ctrlKey: true, shiftKey: true }, { ...key, ctrlKey: true, altKey: true }, { ...key, key: 'a', ctrlKey: true }]) assert.equal(isInspirationReviewShortcut(event), false);
});

test('composer handler only opens review for nonempty enabled input and is IME safe', () => {
  let reviewed = 0, prevented = 0;
  const invoke = (props = {}, key = {}) => {
    const tree = capture({ input: '调整这个方案', onSubmitReview: () => reviewed++, ...props });
    const textarea = collectElements(tree, element => element.type === 'textarea')[0];
    textarea.props.onKeyDown({ key: 'Enter', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: () => prevented++, ...key });
  };
  invoke();
  assert.equal(reviewed, 1); assert.equal(prevented, 1);
  invoke({}, { ctrlKey: false });
  invoke({}, { nativeEvent: { isComposing: true, keyCode: 13 } });
  invoke({}, { nativeEvent: { isComposing: false, keyCode: 229 } });
  invoke({ input: '  \n ' });
  invoke({ disabled: true });
  invoke({ onSubmitReview: undefined });
  assert.equal(reviewed, 1); assert.equal(prevented, 1);
  const html = render({ disabled: true, onSubmitReview() {} });
  assert.match(html, /<textarea[^>]*disabled=""/);
  assert.match(html, /Ctrl \/ ⌘ \+ Enter 打开生成确认/);
});

test('presentation component has no service calls, timers, simulated progress, or HTML injection', async () => {
  const source = await readFile(new URL('../src/components/InspirationConversation.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|setTimeout|setInterval|requestAnimationFrame)\s*\(|dangerouslySetInnerHTML|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /from ['"].*(?:api|context|AIAction|agent-workspace)/);
});

test('conversation styles are isolated, fluid on narrow screens, and honor reduced motion', async () => {
  const css = await readFile(new URL('../src/inspiration-conversation.css', import.meta.url), 'utf8');
  const root = postcss.parse(css);
  root.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) assert(selector.startsWith('.inspiration-conversation'), `Unscoped selector: ${selector}`);
  });
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /textarea \{[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: 100%;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /inspiration-progress-spinner \{ animation: none; \}/);
  assert.match(css, /max-height: 62svh; overflow-y: auto/);
  assert.match(css, /max-height: 56svh/);
  assert.doesNotMatch(css, /(?:position:\s*fixed|height:\s*100vh|overflow:\s*hidden|width:\s*100vw)/);
});
