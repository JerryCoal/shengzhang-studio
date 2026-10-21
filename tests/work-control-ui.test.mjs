import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readWorkspaceRoute, writeWorkspaceRoute } from '../src/workspace-route.mjs';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({ stdin: { contents: "export { PlanReview, PlanningAction, WorkStatusBadge, ArtifactEditor, ExperienceCapture, ControllerPage } from './src/pages/WorkControl'; export { Context } from './src/context'; export { statusLabel, activeWork, attentionWork, refinementAccountIds, deliverWorkNotification } from './src/work-control';", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' }, define: { 'import.meta.env.MODE': '"test"', 'import.meta.env.VITE_API_BASE_URL': '""' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { PlanReview, PlanningAction, WorkStatusBadge, ArtifactEditor, ExperienceCapture, ControllerPage, Context, statusLabel, activeWork, attentionWork, refinementAccountIds, deliverWorkNotification } = module.exports;
globalThis.sessionStorage = { getItem() { return 'SYNTHETIC_SESSION'; } };
const context = { state: { accounts: [{ id: 'a', name: '校园 A', platform: 'xiaohongshu' }, { id: 'b', name: '品牌 B', platform: 'douyin' }], projects: [] }, project: { id: 'p' }, settings: { routes: { strategy: 'test-model' }, models: { 'test-model': { label: '合成模型' } } }, target: {}, go() { throw new Error('SSR cannot navigate'); }, notify() {}, scope: { projectIds: ['p'], accountIds: [] } };
const render = (Component, props) => renderToStaticMarkup(createElement(Context.Provider, { value: context }, createElement(Component, props)));
const plan = { id: 'plan', projectId: 'p', version: 1, status: 'draft', goal: '研究后做脚本', estimateUSD: 0.03, nodes: [{ id: 'xhs', title: '校园图文', role: 'xiaohongshu-copy', accountId: 'a', requirement: '核对真实事实', dependsOn: [], model: 'test-model', budgetUSD: 0, estimateUSD: 0.01 }, { id: 'research', title: '同话题研究', role: 'douyin-research', accountId: '', connectionAccountId: 'b', requirement: '保留来源', dependsOn: [], model: 'test-model', budgetUSD: 0, estimateUSD: 0.01 }, { id: 'script', title: '品牌脚本', role: 'douyin-script', accountId: 'b', requirement: '依赖研究', dependsOn: ['research'], model: 'test-model', budgetUSD: 0, estimateUSD: 0.01 }] };

test('new deep links preserve exact task/run/artifact/event while dropping private text', () => {
  const target = { taskId: 'task/一', runId: 'run?x', artifactId: 'artifact&a', artifactVersion: '3', eventId: 'event#5', planId: 'plan-1', goal: 'PRIVATE_GOAL', token: 'PRIVATE_TOKEN' };
  const hash = writeWorkspaceRoute('tasks', '项目 p', target), route = readWorkspaceRoute(hash);
  assert.equal(route.page, 'tasks'); assert.equal(route.target.artifactVersion, '3'); assert.equal(route.target.taskId, 'task/一'); assert.doesNotMatch(hash, /PRIVATE|goal|token/);
  for (const page of ['controller', 'tasks', 'accounts', 'materials', 'studio', 'publish', 'inspiration']) assert.equal(readWorkspaceRoute(writeWorkspaceRoute(page)).page, page);
});
test('states distinguish waiting, unknown and saved results without inventing progress', () => {
  assert.equal(statusLabel('waiting_dependencies'), '等待前置成果'); assert.equal(statusLabel('needs_reconciliation'), '结果待核对'); assert.equal(activeWork('waiting_dependencies'), true); assert.equal(attentionWork('needs_reconciliation'), true); assert.equal(activeWork('succeeded'), false);
  assert.match(render(WorkStatusBadge, { status: 'needs_reconciliation' }), /结果待核对/);
  assert.doesNotMatch(render(WorkStatusBadge, { status: 'queued' }), /思考|\d+%|已完成/);
});
test('plan review exposes account boundaries, dependencies and explicit unchecked approval', () => {
  const html = render(PlanReview, { plan, onChanged() {} });
  assert.match(html, /校园 A/); assert.match(html, /品牌 B/); assert.match(html, /项目共享研究/); assert.match(html, /等待：同话题研究/); assert.match(html, /只生成草稿，不发布/); assert.match(html, /仅填写，不批准/);
  assert.match(html, /<button class="button primary" disabled=""/); assert.doesNotMatch(html, /checked=""/);
});
test('approved plan is immutable until an explicit new-version edit', () => {
  const html = render(PlanReview, { plan: { ...plan, status: 'approved' }, onChanged() {} });
  assert.match(html, /运行中的任务仍使用原输入/); assert.doesNotMatch(html, /确认计划并排队/);
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
  for (const label of ['总控', '任务', '账号', '资料']) assert.ok(app.includes(`label: '${label}'`));
  assert.match(app, /原有工作区与交付入口/); assert.match(app, /case 'publish'/); assert.match(app, /case 'analysis-agent'/); assert.match(view, /此版本不运行后台任务引擎/); assert.match(view, /if \(LOCAL_DATA\) return <LocalWorkNotice/);
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
