import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readWorkspaceRoute, writeWorkspaceRoute } from '../src/workspace-route.mjs';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({ stdin: { contents: "export { PlanReview, PlanningAction, WorkStatusBadge, ArtifactEditor, ExperienceCapture, ControllerPage, PlanningNextStep, DeleteWorkTaskButton } from './src/pages/WorkControl'; export { WorkDispatch } from './src/components/WorkDispatch'; export { Context } from './src/context'; export { statusLabel, activeWork, attentionWork, refinementAccountIds, deliverWorkNotification, prepareWorkMedia } from './src/work-control';", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' }, define: { 'import.meta.env.MODE': '"test"', 'import.meta.env.VITE_API_BASE_URL': '""' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { PlanReview, PlanningAction, WorkStatusBadge, ArtifactEditor, ExperienceCapture, ControllerPage, PlanningNextStep, DeleteWorkTaskButton, WorkDispatch, Context, statusLabel, activeWork, attentionWork, refinementAccountIds, deliverWorkNotification, prepareWorkMedia } = module.exports;
globalThis.sessionStorage = { getItem() { return 'SYNTHETIC_SESSION'; } };
const context = { state: { accounts: [{ id: 'a', name: '校园 A', platform: 'xiaohongshu' }, { id: 'b', name: '品牌 B', platform: 'douyin' }], projects: [] }, project: { id: 'p' }, settings: { routes: { strategy: 'test-model' }, models: { 'test-model': { label: '合成模型' } } }, target: {}, go() { throw new Error('SSR cannot navigate'); }, notify() {}, scope: { projectIds: ['p'], accountIds: [] } };
const render = (Component, props) => renderToStaticMarkup(createElement(Context.Provider, { value: context }, createElement(Component, props)));
const plan = { id: 'plan', projectId: 'p', version: 1, status: 'draft', goal: '研究后做脚本', estimateUSD: 0.03, nodes: [{ id: 'xhs', title: '校园图文', role: 'xiaohongshu-copy', accountId: 'a', requirement: '核对真实事实', dependsOn: [], model: 'test-model', budgetUSD: 0, estimateUSD: 0.01 }, { id: 'research', title: '同话题研究', role: 'douyin-research', accountId: '', connectionAccountId: 'b', requirement: '保留来源', dependsOn: [], model: 'test-model', budgetUSD: 0, estimateUSD: 0.01 }, { id: 'script', title: '品牌脚本', role: 'douyin-script', accountId: 'b', requirement: '依赖研究', dependsOn: ['research'], model: 'test-model', budgetUSD: 0, estimateUSD: 0.01 }] };

test('new deep links preserve exact task/run/artifact/event while dropping private text', () => {
  const target = { taskId: 'task/一', runId: 'run?x', artifactId: 'artifact&a', artifactVersion: '3', eventId: 'event#5', planId: 'plan-1', goal: 'PRIVATE_GOAL', token: 'PRIVATE_TOKEN' };
  const hash = writeWorkspaceRoute('tasks', '项目 p', target), route = readWorkspaceRoute(hash);
  assert.equal(route.page, 'controller'); assert.equal(route.target.artifactVersion, '3'); assert.equal(route.target.taskId, 'task/一'); assert.doesNotMatch(hash, /PRIVATE|goal|token/);
  for (const page of ['controller', 'tasks', 'accounts', 'materials', 'studio', 'publish', 'inspiration']) assert.equal(readWorkspaceRoute(writeWorkspaceRoute(page)).page, page === 'tasks' ? 'controller' : page);
});
test('states distinguish waiting, unknown and saved results without inventing progress', () => {
  assert.equal(statusLabel('waiting_dependencies'), '等待前置成果'); assert.equal(statusLabel('needs_reconciliation'), '结果待核对'); assert.equal(activeWork('waiting_dependencies'), true); assert.equal(attentionWork('needs_reconciliation'), true); assert.equal(activeWork('succeeded'), false);
  assert.match(render(WorkStatusBadge, { status: 'needs_reconciliation' }), /结果待核对/);
  assert.doesNotMatch(render(WorkStatusBadge, { status: 'queued' }), /思考|\d+%|已完成/);
});
test('plan confirmation prepares tasks without implying paid dispatch approval', () => {
  const html = render(PlanReview, { plan, onChanged() {} });
  assert.match(html, /校园 A/); assert.match(html, /品牌 B/); assert.match(html, /项目共享研究/); assert.match(html, /等待：同话题研究/); assert.match(html, /只生成草稿，不发布/); assert.match(html, /确认计划只建立待批准任务，不发送模型请求/);
  assert.match(html, /确认计划，准备逐项派工/); assert.doesNotMatch(html, /确认计划并排队|本次批准总额度/);
});
test('approved plan is immutable until an explicit new-version edit', () => {
  const html = render(PlanReview, { plan: { ...plan, status: 'approved' }, onChanged() {} });
  assert.match(html, /运行中的任务仍使用原输入/); assert.doesNotMatch(html, /确认计划并排队/);
});

test('dispatch starts without implicit Skills consent and keeps payment disabled until inputs restore and quote is checked', () => {
  const html = render(WorkDispatch, {
    task: { id: 'task', title: '校园文案', role: 'xiaohongshu-copy', projectId: 'p', accountId: 'a', accountName: '校园 A' },
    run: { id: 'run', taskId: 'task', projectId: 'p', status: 'pending_approval', revision: 1, node: plan.nodes[0], dispatch: { ready: true, workflowId: 'copy-xiaohongshu' } },
    onClose() {}, onApproved() {},
  });
  assert.match(html, /总控下发的指令 · 可直接修改/);
  assert.match(html, /本次只用默认规则，不使用额外 Skill/);
  assert.match(html, /校园 A/);
  assert.doesNotMatch(html, /checked=""/);
  const approve = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g).find(item => item.includes('批准本次派工'));
  assert.match(approve, /disabled=""/);
  assert.match(html, /后续 Agent 会再次请你确认/);
});
test('AI planning starts with free estimate and does not imply execution approval', () => {
  const html = render(PlanningAction, { goal: '未来课堂', accountIds: ['a'] });
  assert.match(html, /估算 AI 规划费用（不调用模型）/); assert.doesNotMatch(html, /确认规划费用并生成建议|已开始|正在思考/);
});
test('artifact content is escaped; candidate adoption is explicit and history remains', () => {
  const html = render(ArtifactEditor, { artifact: { id: 'task', taskId: 'task', runId: 'run', version: 2, headVersion: 1, title: '<script>unsafe()</script>', body: '第一行\n第二行 <img src=x>', kind: 'copy', candidate: true }, projectId: 'p', headVersion: 1, onSaved() {} });
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/); assert.match(html, /&lt;img src=x&gt;/); assert.match(html, /明确采用候选成果/); assert.match(html, /不代表已发布/); assert.doesNotMatch(html, /<script>|<img src=x>/);
});
test('main navigation preserves legacy entry points and static mode degrades honestly', async () => {
  const app = await readFile('src/App.tsx', 'utf8'), view = await readFile('src/pages/WorkControl.tsx', 'utf8'), helpers = await readFile('src/work-control.ts', 'utf8');
  for (const label of ['总控', '账号', '资料']) assert.ok(app.includes(`label: '${label}'`));
  assert.match(app, /历史与交付/); assert.match(app, /case 'publish'/); assert.match(app, /case 'analysis-agent'/); assert.match(view, /此版本不运行后台任务引擎/); assert.match(view, /if \(LOCAL_DATA\) return <LocalWorkNotice/);
  assert.match(helpers, /session\.current !== workSession\(\)/); assert.match(helpers, /registerWorkspaceSaver/);
});
test('controller waits for owner-scoped restoration and offers durable conversation history', async () => {
  const html = render(ControllerPage, {}), source = await readFile('src/pages/WorkControl.tsx', 'utf8'), helpers = await readFile('src/work-control.ts', 'utf8');
  assert.match(html, /id="work-goal"[^>]*disabled=""/); assert.match(html, /正在恢复总控输入/); assert.match(html, /aria-label="总控对话历史"/);
  assert.match(source, /controller-messages/); assert.match(source, /items\.slice\(-20\)/); assert.match(source, /model=\{saved\.value\.model/);
  assert.match(helpers, /controller-view/); assert.match(helpers, /scope\.session !== workSession\(\)/); assert.match(helpers, /scope\.epoch === epoch/); assert.match(helpers, /pendingVersions/); assert.match(helpers, /registerWorkspaceSaver\(save\)/);
});
test('experience capture is initially collapsed, requires source selection and never claims validation', async () => {
  const html = render(ExperienceCapture, { artifact: { id: 'artifact', version: 3, kind: 'research', taskId: 'task', runId: 'run', title: '合成研究', body: '' } });
  assert.match(html, /提炼并选择保留经验/); assert.match(html, /建议不是已验证的规律/); assert.match(html, /已保存的 V3/); assert.doesNotMatch(html, /<details[^>]* open|确认保存选中经验|checked=""/);
  const source = await readFile('src/pages/WorkControl.tsx', 'utf8'); assert.match(source, /open \? `\$\{base\}\/experience-candidates` : null/); assert.match(source, /selected: false/); assert.match(source, /selected\.length > 8/); assert.match(source, /共享经验保存后默认未启用/);
});
test('archived activity reconnects explicitly and message dispatch has no pre-send await', async () => {
  const source = await readFile('src/pages/WorkControl.tsx', 'utf8');
  assert.match(source, /读取归档并重新连接活动/); assert.match(source, /result\.archive\.chunks\.flat\(\)/); assert.match(source, /cursor\.current = Math\.max\(cursor\.current, result\.archive\.through\)/);
  const conversation = source.slice(source.indexOf('function TaskConversation'), source.indexOf('export function WorkNotificationCenter'));
  assert.match(conversation, /action\.execute\(\(\) => api/); assert.doesNotMatch(conversation, /async \(\) => \{ await saved\.save\(\); return api/);
});
test('public research refinement uses its latest fixed connection rather than empty ownership or another run', () => {
  const task = { id: 'research-task', projectId: 'project', role: 'douyin-research', accountId: '', latestRunId: 'latest-run' };
  const run = { id: 'latest-run', taskId: task.id, projectId: task.projectId, node: { role: 'douyin-research', accountId: '', connectionAccountId: 'fixed-reader' } };
  assert.deepEqual(refinementAccountIds(task, run), ['fixed-reader']);
  for (const patch of [{ id: 'historical-run' }, { taskId: 'other-task' }, { projectId: 'other-project' }, { node: { role: 'douyin-script', connectionAccountId: 'wrong-reader' } }]) assert.deepEqual(refinementAccountIds(task, { ...run, ...patch }), []);
  assert.deepEqual(refinementAccountIds(task), []); assert.deepEqual(refinementAccountIds({ ...task, role: 'xiaohongshu-copy', accountId: 'fixed-creator' }, run), ['fixed-creator']);
});
test('desktop retry rechecks identity and notification ID and never calls a real notification', async () => {
  let owner = 'SYNTHETIC_SESSION', calls = [], failures = [];
  globalThis.sessionStorage = { getItem() { return owner; } };
  const args = { notificationId: 'notice', sessionToken: owner, sound: false }, record = { id: 'notice', readAt: '', deliveredAt: '' };
  const services = { read: async id => { calls.push(['read', id]); return { notification: record }; }, notify: async input => { calls.push(['notify', input]); return { delivered: false }; }, failed: async id => failures.push(id) };
  try {
    assert.deepEqual(await deliverWorkNotification(args, () => true, services), { delivered: false }); assert.deepEqual(failures, ['notice']); assert.equal(record.readAt, ''); assert.equal(record.deliveredAt, '');
    assert.deepEqual(calls[1], ['notify', args]); calls = [];
    await assert.rejects(() => deliverWorkNotification(args, () => true, { ...services, read: async () => { owner = 'OTHER_SESSION'; return { notification: record }; } }), /身份/); assert.equal(calls.length, 0);
    owner = 'SYNTHETIC_SESSION'; await assert.rejects(() => deliverWorkNotification(args, () => true, { ...services, read: async () => ({ notification: { ...record, id: 'other-notice' } }) }), /身份/); assert.equal(calls.length, 0);
    await assert.rejects(() => deliverWorkNotification(args, () => false, services), /身份/); assert.equal(calls.length, 0);
    assert.deepEqual(await deliverWorkNotification(args, () => true, { ...services, read: async () => ({ notification: { ...record, deliveredAt: 'already' } }) }), { delivered: true }); assert.equal(calls.length, 0);
    assert.deepEqual(await deliverWorkNotification(args, () => true, { ...services, read: async () => ({ notification: { ...record, readAt: 'read' } }) }), { delivered: false }); assert.equal(calls.length, 0);
    assert.deepEqual(await deliverWorkNotification(args, () => true, { ...services, notify: async () => ({ delivered: true }) }), { delivered: true }); assert.deepEqual(failures, ['notice']);
  } finally { globalThis.sessionStorage = { getItem() { return 'SYNTHETIC_SESSION'; } }; }
  const view = await readFile('src/pages/WorkControl.tsx', 'utf8'); assert.match(view, /重试桌面提醒/); assert.match(view, /!item\.deliveryAttemptedAt/); assert.match(view, /window\.studioDesktop\?\.notifyWork && !item\.readAt && !item\.deliveredAt/);
});

test('finished planning has a durable next step and unknown plans never get execution links', () => {
  const run = { id: 'planning-run', projectId: 'p', status: 'succeeded', planningPlanId: 'saved-plan', planningPlanVersion: 2 };
  assert.match(render(PlanningNextStep, { run }), /核对本轮计划/);
  assert.match(render(PlanningNextStep, { run: { ...run, planningPlanId: '', planningQuestion: '请选择目标账号' } }), /返回总控补充需求/);
  assert.equal(render(PlanningNextStep, { run: { ...run, planningPlanId: '', status: 'running' } }), '');
  const html = render(PlanReview, { plan, onChanged() {} });
  assert.match(html, /图片 Agent 需要单独批准/);
  assert.match(html, /每次派工都要选择 Skills/);
  assert.doesNotMatch(html, /确认计划并排队/);
  assert.match(render(PlanReview, { plan: { ...plan, status: 'approved' }, onChanged() {} }), /本轮协作/);
});

test('task deletion follows server eligibility and media continuation works for historical broken links', () => {
  assert.match(render(DeleteWorkTaskButton, { task: { id: 'task', removable: true }, onDeleted() {} }), /删除任务/);
  assert.equal(render(DeleteWorkTaskButton, { task: { id: 'task', removable: false }, onDeleted() {} }), '');
  const artifact = { id: 'task', taskId: 'task', runId: 'run', version: 2, title: '旧文案', body: '正文', kind: 'copy', legacy: {} };
  assert.match(render(ArtifactEditor, { artifact, projectId: 'p', headVersion: 2, onSaved() {} }), /图片 Agent/);
  assert.match(render(ArtifactEditor, { artifact: { ...artifact, kind: 'script' }, projectId: 'p', headVersion: 2, onSaved() {} }), /图片 Agent/);
  assert.doesNotMatch(render(ArtifactEditor, { artifact: { ...artifact, candidate: true }, projectId: 'p', headVersion: 2, onSaved() {} }), /图片 Agent/);
});

test('media handoff repairs the selected version then refreshes, without a paid request or stale-owner navigation', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const artifact = { id: 'task/一', version: 3, kind: 'copy', legacy: {} };
  let owner = 'SYNTHETIC_SESSION', afterRead, afterRefresh, response = { projectId: 'p', assetId: 'exact-asset' };
  globalThis.sessionStorage = { getItem() { return owner; } };
  globalThis.fetch = async (url, options) => { calls.push({ url, method: options.method }); afterRead?.(); return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const refresh = async () => { calls.push('refresh'); afterRefresh?.(); };
  try {
    assert.deepEqual(await prepareWorkMedia(artifact, 'p', refresh), response);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].url, /artifacts\/task%2F%E4%B8%80\/versions\/3\/media-draft$/);
    assert.equal(calls[1], 'refresh');
    calls.length = 0;
    await assert.rejects(prepareWorkMedia({ ...artifact, candidate: true }, 'p', refresh), /先采用/);
    assert.equal(calls.length, 0);
    response = { projectId: 'other-project', assetId: 'wrong-asset' };
    await assert.rejects(prepareWorkMedia(artifact, 'p', refresh), /归属/);
    assert.equal(calls.includes('refresh'), false);
    response = { projectId: 'p', assetId: 'exact-asset' }; calls.length = 0;
    afterRead = () => { owner = 'CHANGED_SESSION'; };
    await assert.rejects(prepareWorkMedia(artifact, 'p', refresh), /工作区已切换/);
    assert.equal(calls.includes('refresh'), false);
    owner = 'SYNTHETIC_SESSION'; afterRead = null; afterRefresh = () => { owner = 'CHANGED_SESSION'; };
    await assert.rejects(prepareWorkMedia(artifact, 'p', refresh), /工作区已切换/);
    owner = 'SYNTHETIC_SESSION'; afterRefresh = null;
    await assert.rejects(prepareWorkMedia(artifact, 'p', async () => { throw Error('刷新失败'); }), /刷新失败/);
  } finally { globalThis.fetch = originalFetch; globalThis.sessionStorage = { getItem() { return 'SYNTHETIC_SESSION'; } }; }
});
