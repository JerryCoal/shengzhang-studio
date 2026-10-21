import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newProject, addAccount } from '../server/domain.mjs';
import { DEFAULT_ROUTES, MODELS } from '../server/models.mjs';

// These are SSR and callback simulations, not a browser/DOM acceptance test.
// Only the container's hooks are replayed. Its child components and markup use
// React's real server renderer. All mutations and background jobs are local mocks.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({
  stdin: { contents: "export { InspirationChatWork } from './src/pages/InspirationChatWork.tsx'; export { PlatformAgent, AnalysisAgent, PLATFORM_AGENTS } from './src/pages/AgentWorkspace.tsx'; export { InspirationConversation } from './src/components/InspirationConversation.tsx'; export { Modal, Field } from './src/components.tsx'; export { Context } from './src/context.tsx';", resolveDir: process.cwd(), loader: 'tsx' },
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
  useEffect(effect, dependencies) { if (!hooks) return React.useEffect(effect, dependencies); },
  useContext(context) { return hooks ? hooks.context : React.useContext(context); },
};
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, name => name === 'react' ? hookReact : require(name));
const { InspirationChatWork, PlatformAgent, AnalysisAgent, PLATFORM_AGENTS, InspirationConversation, Modal, Field, Context } = module.exports;
const element = React.createElement;
const idea = { title: '已核对的露营灵感', core: '真实露营准备', direction: '写给刚开始露营的新手', prompt: '按已选素材继续创作' };
const completed = (accountId, extra = {}) => ({ id: crypto.randomUUID(), user: '当前账号的已有需求', at: '2026-10-20T02:00:00Z', platform: 'xiaohongshu', accountId, model: 'qwen-plus', status: 'completed', reply: idea, ...extra });

function fixture(patch = {}) {
  const project = newProject({ name: '独立测试项目', brand: '演示品牌', product: '露营用品', type: 'daily', goal: '真实分享', audience: '新手', sellingPoints: '已知用途', facts: '', requirements: '不编造', channels: ['xiaohongshu'], deadline: '2027-01-01', budgetUsd: 10 });
  const state = { projects: [project], accounts: [], activities: [], installedSkills: [], skillsRevision: 0 };
  const account = addAccount(state, { platform: 'xiaohongshu', name: '主创作账号' });
  const otherAccount = addAccount(state, { platform: 'xiaohongshu', name: '另一个账号' });
  const youtubeAccount = addAccount(state, { platform: 'youtube', name: '视频账号' });
  const calls = { updates: [], saves: 0, reloads: 0, mutations: [], jobs: [], navigations: [], checkpoints: [], notifications: [] };
  const form = {
    draft: { requirement: '已确认的初始需求', platform: 'xiaohongshu', accountId: account.id, kind: 'image', knowledgeIds: [], experienceIds: [], referenceIds: [], skillIds: [], model: 'qwen-plus', publishingNotes: '', conversation: { version: 1, id: crypto.randomUUID(), input: '请把这次选题再具体一些', turns: [] }, ...patch },
    loaded: true, saving: false, error: '', dirty: false,
    update(values) { calls.updates.push(structuredClone(values)); form.draft = { ...form.draft, ...values }; },
    async save() { calls.saves++; },
    async reload() { calls.reloads++; return structuredClone(form.draft); },
    retry() {},
  };
  const context = {
    state, project, settings: { routes: { ...DEFAULT_ROUTES, strategy: 'qwen-plus' }, models: MODELS, providers: { qwen: { configured: true } }, openaiConfigured: false },
    busy: false, target: {}, scope: { projectIds: [project.id], accountIds: [] }, accountScope: '',
    setScope() {}, setAccountScope() {}, startProject() {},
    go(...values) { calls.navigations.push(values); }, notify(...values) { calls.notifications.push(values); },
    async refresh() {},
    run(work) { const job = Promise.resolve().then(work); calls.jobs.push(job); return job; },
    runBackground(label, work, target) { const job = work({ async checkpoint(stage, data) { calls.checkpoints.push({ stage, data }); } }); calls.jobs.push(job); return job; },
    async mutate(path, method, body) {
      calls.mutations.push({ path, method, body: structuredClone(body) });
      if (path.endsWith('/strategies')) {
        form.draft = { ...form.draft, idea, conversation: { ...form.draft.conversation, turns: form.draft.conversation.turns.map(turn => turn.id === body.inspirationTurn.turnId ? { ...turn, status: 'completed', reply: idea, submittedAt: '2026-10-20T03:00:00Z' } : turn) } };
        return { result: { id: 'mock-strategy', ...idea }, state };
      }
      assert(path.endsWith('/agent-handoffs'), `Unexpected mutation: ${path}`);
      return { result: { id: 'mock-asset' }, state };
    },
  };
  const props = { form, platforms: PLATFORM_AGENTS, savedState: element('span', {}, '草稿已保存'), renderModels: (_draft, disabled) => element('select', { 'aria-label': '测试模型选择', disabled, defaultValue: 'qwen-plus' }, element('option', { value: 'qwen-plus' }, 'Qwen Plus')), renderExperience: (_draft, disabled) => element('button', { disabled }, '测试已选经验') };
  const owner = { values: [], cursor: 0, context };
  function renderTree() {
    assert.equal(hooks, null);
    hooks = owner; owner.cursor = 0;
    try { return InspirationChatWork(props); } finally { hooks = null; }
  }
  const html = tree => renderToStaticMarkup(element(Context.Provider, { value: context }, tree || renderTree()));
  return { project, state, account, otherAccount, youtubeAccount, calls, form, context, props, renderTree, html };
}

function findAll(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found;
  if (predicate(node)) found.push(node);
  React.Children.forEach(node.props.children, child => findAll(child, predicate, found));
  return found;
}
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return React.isValidElement(node) ? textOf(node.props.children) : '';
}
const button = (tree, text) => { const found = findAll(tree, node => node.type === 'button' && textOf(node).includes(text)); assert.equal(found.length, 1, `Expected one button '${text}', found ${found.length}`); return found[0]; };
const chat = tree => { const found = findAll(tree, node => node.type === InspirationConversation); assert.equal(found.length, 1); return found[0]; };
const modal = (tree, title) => findAll(tree, node => node.type === Modal && node.props.title === title)[0];
const fieldControl = (tree, label, type = 'select') => { const field = findAll(tree, node => node.type === Field && node.props.label === label)[0]; assert(field, `Missing field '${label}'`); const control = findAll(field, node => node.type === type)[0]; assert(control); return control; };
const drain = async f => { for (const job of f.calls.jobs) await job; await Promise.resolve(); };

test('initial inspiration page is conversation-first with collapsed advanced controls and bottom input', () => {
  const f = fixture({ idea }); const html = f.html();
  assert.match(html, /class="inspiration-conversation"/);
  assert.match(html, /<details class="inspiration-context-options">/);
  assert.match(html, /资料、经验与模型/);
  assert.match(html, /<details class="inspiration-reply-prompt"><summary>直接编辑这份方案/);
  assert.match(html, /交给小红书 Agent 继续制作/);
  assert.match(html, /热点与参考/); assert.match(html, /资料与经验/);
  assert(html.indexOf('inspiration-conversation-body') < html.indexOf('class="inspiration-composer"'));
  assert(html.indexOf('inspiration-context-options') < html.indexOf('class="inspiration-composer"'));
  assert.doesNotMatch(html, /<details[^>]*open=|agent-inspiration-tabs|确认这一轮灵感对话/);
  assert.equal(f.calls.mutations.length, 0); assert.equal(f.calls.saves, 0);
});

test('rendered history excludes other accounts and platforms, including their errors and replies', () => {
  const f = fixture();
  f.form.draft.conversation.turns = [completed(f.account.id), completed(f.otherAccount.id, { user: '另一个账号私人需求', reply: { ...idea, title: '另一账号专属方案' }, error: '另一账号私有错误' }), completed(f.account.id, { platform: 'youtube', user: '不同平台私人需求' })];
  const html = f.html();
  assert.match(html, /当前账号的已有需求/); assert.match(html, /当前目标 1 轮对话/);
  assert.match(html, /其他账号历史已隔离/);
  assert.doesNotMatch(html, /另一个账号私人需求|另一账号专属方案|另一账号私有错误|不同平台私人需求/);
  f.form.draft.accountId = '';
  f.form.draft.conversation.turns.push(completed('', { user: '项目通用需求' }));
  const generic = f.html();
  assert.match(generic, /项目通用需求/); assert.doesNotMatch(generic, /当前账号的已有需求/);
});

test('opening and cancelling fee review calls neither save nor generation, including closing the dialog', () => {
  const f = fixture(), before = structuredClone(f.form.draft);
  chat(f.renderTree()).props.onSubmitReview();
  let tree = f.renderTree(); let review = modal(tree, '确认这一轮灵感对话'); assert(review);
  const html = f.html(tree);
  assert.match(html, /Qwen Plus/); assert.match(html, /主创作账号/); assert.match(html, /每百万 token/); assert.match(html, /确认费用并发送/);
  button(review, '取消').props.onClick();
  assert.equal(modal(f.renderTree(), '确认这一轮灵感对话'), undefined);
  chat(f.renderTree()).props.onSubmitReview(); review = modal(f.renderTree(), '确认这一轮灵感对话');
  review.props.onClose();
  assert.equal(modal(f.renderTree(), '确认这一轮灵感对话'), undefined);
  assert.deepEqual(f.form.draft, before); assert.equal(f.calls.saves, 0); assert.equal(f.calls.mutations.length, 0); assert.equal(f.calls.jobs.length, 0);
});

test('platform suggestion remains a review proposal and cancellation does not change account or data', () => {
  const f = fixture({ idea, knowledgeIds: ['private-knowledge'], experienceIds: ['private-experience'] });
  f.form.draft.conversation.input = '改成 YouTube 的主题';
  const before = structuredClone(f.form.draft);
  chat(f.renderTree()).props.onSubmitReview();
  const tree = f.renderTree(), review = modal(tree, '确认这一轮灵感对话');
  assert.match(f.html(tree), /建议切换为YouTube/);
  button(review, '取消').props.onClick();
  assert.deepEqual(f.form.draft, before); assert.equal(f.calls.mutations.length, 0);
});

test('pending result locks input, new conversation and handoff; review callbacks cannot bypass the guard', () => {
  const f = fixture({ idea });
  f.form.draft.conversation.turns = [completed(f.account.id, { status: 'pending', reply: undefined, submittedAt: '2026-10-20T02:00:01Z' })];
  const c = chat(f.renderTree());
  assert.equal(c.props.disabled, true); assert.equal(c.props.submitAction.props.disabled, true);
  assert.equal(button(c.props.actions, '新对话').props.disabled, true);
  assert.equal(button(c.props.handoff, '确认交接').props.disabled, true);
  c.props.onSubmitReview();
  assert.equal(modal(f.renderTree(), '确认这一轮灵感对话'), undefined);
  assert.match(f.html(), /本轮请求仍待核对/);
  assert.doesNotMatch(f.html(), /核对并取消未提交等待/);
  assert.equal(f.calls.mutations.length, 0);
});

test('20 stored turns disable new generation but retain an explicit, cancellable new-conversation action', () => {
  const f = fixture(); f.form.draft.conversation.turns = Array.from({ length: 20 }, () => completed(f.account.id));
  const c = chat(f.renderTree());
  assert.equal(c.props.submitAction.props.disabled, true);
  assert.equal(button(c.props.actions, '新对话').props.disabled, false);
  c.props.onSubmitReview(); assert.equal(modal(f.renderTree(), '确认这一轮灵感对话'), undefined);
  button(c.props.actions, '新对话').props.onClick();
  const tree = f.renderTree(), reset = modal(tree, '开启新的灵感对话？'); assert(reset);
  assert.match(f.html(tree), /当前对话已保存 20 轮/); assert.match(f.html(tree), /导出文件为明文/);
  button(reset, '取消').props.onClick();
  assert.equal(f.form.draft.conversation.turns.length, 20); assert.equal(f.calls.saves, 0);
});

test('explicit new-conversation confirmation saves fresh input state without deleting project content', async () => {
  const f = fixture({ idea }); f.form.draft.conversation.turns = [completed(f.account.id)];
  const originalId = f.form.draft.conversation.id, originalProject = structuredClone(f.project);
  button(chat(f.renderTree()).props.actions, '新对话').props.onClick();
  button(modal(f.renderTree(), '开启新的灵感对话？'), '确认开启新对话').props.onClick(); await drain(f);
  assert.notEqual(f.form.draft.conversation.id, originalId); assert.deepEqual(f.form.draft.conversation.turns, []);
  assert.equal(f.form.draft.conversation.input, ''); assert.equal(f.form.draft.idea, undefined);
  assert.equal(f.calls.saves, 1); assert.equal(f.calls.mutations.length, 0); assert.deepEqual(f.project, originalProject);
});

test('generic idea handoff requires an explicitly selected matching account and sends only a creation packet', async () => {
  const f = fixture({ accountId: '', idea });
  let c = chat(f.renderTree());
  assert.equal(button(c.props.handoff, '确认交接').props.disabled, true);
  const select = fieldControl(c.props.handoff, '交接目标账号'); assert.equal(select.props.disabled, false); assert.equal(select.props.value, '');
  select.props.onChange({ target: { value: f.otherAccount.id } });
  c = chat(f.renderTree()); assert.equal(button(c.props.handoff, '确认交接').props.disabled, false);
  button(c.props.handoff, '确认交接').props.onClick(); await drain(f);
  assert.equal(f.calls.mutations.length, 1);
  const sent = f.calls.mutations[0];
  assert.equal(sent.path, `/projects/${f.project.id}/agent-handoffs`); assert.equal(sent.method, 'POST');
  assert.equal(sent.body.accountId, f.otherAccount.id); assert.equal(sent.body.platform, 'xiaohongshu'); assert.equal(sent.body.fromAgent, 'inspiration');
  assert.deepEqual(sent.body.idea, idea); assert.deepEqual(sent.body.skillIds, []); assert.equal(sent.body.conversation, undefined);
  assert.deepEqual(f.calls.navigations[0], ['xiaohongshu-agent', f.project.id, { assetId: 'mock-asset', tab: 'brief', accountId: f.otherAccount.id }]);
});

test('private idea handoff cannot silently switch account; changing target clears private selection and current idea', () => {
  const f = fixture({ idea, knowledgeIds: ['private-k'], experienceIds: ['private-e'], referenceIds: ['private-r'] });
  f.form.draft.conversation.turns = [completed(f.account.id)];
  const c = chat(f.renderTree()), handoffSelect = fieldControl(c.props.handoff, '交接目标账号');
  assert.equal(handoffSelect.props.disabled, true); assert.equal(handoffSelect.props.value, f.account.id);
  fieldControl(c.props.contextPanel, '创作账号').props.onChange({ target: { value: f.otherAccount.id } });
  assert.equal(f.form.draft.accountId, f.otherAccount.id); assert.equal(f.form.draft.idea, undefined);
  for (const field of ['knowledgeIds', 'experienceIds', 'referenceIds']) assert.deepEqual(f.form.draft[field], []);
  assert.equal(f.form.draft.requirement, ''); assert.equal(f.form.draft.conversation.turns.length, 1);
  assert.equal(chat(f.renderTree()).props.turns.length, 0); assert.equal(f.calls.mutations.length, 0);
});

test('explicit fee confirmation submits once through mocked background work and adopts stored server reply', async () => {
  const f = fixture();
  chat(f.renderTree()).props.onSubmitReview();
  const confirm = button(modal(f.renderTree(), '确认这一轮灵感对话'), '确认费用并发送');
  confirm.props.onClick(); confirm.props.onClick(); await drain(f);
  assert.equal(f.calls.jobs.length, 1); assert.equal(f.calls.mutations.length, 1); assert.equal(f.calls.saves, 1); assert.equal(f.calls.reloads, 1);
  const request = f.calls.mutations[0];
  assert.equal(request.path, `/projects/${f.project.id}/strategies`); assert.equal(request.body.instruction, '请把这次选题再具体一些');
  assert.equal(request.body.agentInput.accountId, f.account.id); assert.equal(request.body.agentInput.model, 'qwen-plus');
  assert.equal(f.form.draft.conversation.turns.length, 1); assert.equal(f.form.draft.conversation.turns[0].status, 'completed');
  assert.deepEqual(f.form.draft.idea, idea); assert.equal(f.form.draft.conversation.input, '');
  assert(f.calls.checkpoints.some(item => item.stage.includes('需求已保存')));
  assert(f.calls.checkpoints.some(item => item.stage.includes('方案与对话已保存')));
  assert.match(f.html(), /本轮方案已保存/);
});

test('changing the reviewed input invalidates the confirmation rather than silently sending new content', () => {
  const f = fixture(); chat(f.renderTree()).props.onSubmitReview();
  f.form.draft = { ...f.form.draft, conversation: { ...f.form.draft.conversation, input: '已经改变的新要求' } };
  button(modal(f.renderTree(), '确认这一轮灵感对话'), '确认费用并发送').props.onClick();
  assert.match(f.html(), /输入、账号或模型已经变化/); assert.equal(f.calls.mutations.length, 0); assert.equal(f.calls.saves, 0);
});

test('switching login after opening fee review prevents a request under the new session', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  let token = 'mock-member-one';
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => token } });
  try {
    const f = fixture(); chat(f.renderTree()).props.onSubmitReview();
    token = 'mock-member-two';
    button(modal(f.renderTree(), '确认这一轮灵感对话'), '确认费用并发送').props.onClick();
    assert.equal(f.calls.mutations.length, 0); assert.equal(f.calls.saves, 0); assert.equal(f.calls.jobs.length, 0);
    assert.match(f.html(), /输入、账号或模型已经变化/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage;
  }
});

test('all platform and analysis agents retain their original workspaces without a chat composer', () => {
  const f = fixture();
  for (const platform of PLATFORM_AGENTS) {
    const html = renderToStaticMarkup(element(Context.Provider, { value: f.context }, element(PlatformAgent, { platform: platform.platform })));
    assert(html.includes(`${platform.name} Agent`)); assert.match(html, /agent-runtime-controls/); assert.match(html, /新建内容/);
    assert.doesNotMatch(html, /inspiration-composer|当前账号的灵感对话|确认这一轮灵感对话/);
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  // Analytics checks for its optional desktop capture bridge during render.
  // Supply an absent bridge, not a simulated browser or capture implementation.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try {
    const analysis = renderToStaticMarkup(element(Context.Provider, { value: f.context }, element(AnalysisAgent)));
    assert.match(analysis, /agent-analysis-entry/); assert.match(analysis, /作品链接或记录编号/); assert.match(analysis, /agent-review-body/);
    assert.doesNotMatch(analysis, /inspiration-composer|当前账号的灵感对话|确认这一轮灵感对话/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
  }
});

test('long-history layout keeps composer outside the bounded scroll area and uses only scoped overflow rules', async () => {
  const f = fixture({ idea }); f.form.draft.conversation.turns = Array.from({ length: 20 }, (_, index) => completed(f.account.id, { user: `第 ${index + 1} 轮` }));
  const c = chat(f.renderTree());
  // The render structure is observable; actual pixel layout/scroll positioning is not asserted here.
  const html = f.html();
  assert.equal(c.props.turns.length, 20); assert.match(html, /aria-label="灵感对话与当前方案" tabindex="0"/);
  assert(html.indexOf('inspiration-conversation-body') < html.indexOf('inspiration-conversation-footer'));
  const css = await readFile(new URL('../src/inspiration-conversation.css', import.meta.url), 'utf8');
  assert.match(css, /\.inspiration-conversation \.inspiration-conversation-body \{[^}]*max-height: 62svh;[^}]*overflow-y: auto/);
  assert.match(css, /\.inspiration-conversation \.inspiration-composer textarea \{[^}]*min-width: 0;[^}]*max-width: 100%/);
  assert.doesNotMatch(css, /position:\s*fixed|width:\s*100vw/);
});
