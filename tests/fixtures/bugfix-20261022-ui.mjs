// Disposable browser acceptance workspace. All data is encrypted in memory;
// no real profiles, files, provider credentials or external services are used.
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createApp } from '../../server/app.mjs';
import { createStore } from '../../server/store.mjs';
import { createModelStore } from '../../server/models.mjs';
import { installCreativeSkill } from '../../server/creative-skills.mjs';

const store = createStore(':memory:', { key: randomBytes(32), scope: 'bugfix-20261022-browser-only' });
const ownerId = 'synthetic-ui-owner';
const accountId = 'synthetic-xhs-campus';
const modelStore = createModelStore();
const syntheticImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=';
let skillId;
store.mutate(state => {
  state.accounts = [{ id: accountId, name: '验收校园账号（合成）', platform: 'xiaohongshu' }];
  const project = state.projects[0];
  state.projects = [project];
  project.brief.name = '三个问题修复验收（合成工作区）';
  project.brief.brand = '合成校园品牌'; project.brief.product = '校园学习工具';
  project.brief.budgetUsd = 100; project.brief.channels = ['xiaohongshu']; project.usage = [];
  project.assets = []; project.tasks = []; project.publications = []; state.contentRules = [];
  skillId = installCreativeSkill(state, { fileName: '校园自装规则.md', text: '---\nname: 验收用自装 Skills\ndescription: 可在本验收工作区修改和保存\nversion: 1.0.0\n---\n# 表达要求\n用真实校园场景开头，保留事实边界。', workflowId: 'copy-xiaohongshu', confirmed: true, expectedRevision: state.skillsRevision || 0 }).id;
});
const projectId = store.get().projects[0].id;
const proposalNode = (patch = {}) => ({ id: 'campus-copy', title: '校园 AI 学习工具图文', role: 'xiaohongshu-copy', accountId, connectionAccountId: '', requirement: '介绍校园 AI 学习工具的真实适用场景，产出小红书文案后继续制作图片。', dependsOn: [], ...patch });
const rejectExternal = async () => { throw Object.assign(Error('验收工作区已禁用所有真实外部请求'), { noCharge: true }); };
const workExecutors = {
  prepare({ state, project, node }) {
    return { ...structuredClone(node), modelRoute: { model: 'gpt-5.4-mini', provider: 'openai', label: '合成验收模型（无外部调用）' }, estimateUSD: 0, permissions: ['model:copy'], account: structuredClone(state.accounts.find(account => account.id === node.accountId)), briefSnapshot: structuredClone(project.brief) };
  },
  async execute({ run }) {
    if (run.node.id === 'failed-case') throw Object.assign(Error('合成失败：用于检查失败任务的删除入口'), { noCharge: true });
    return { kind: 'copy', title: run.node.title, body: '这是合成验收文案。\n\n先明确学习问题，再核对 AI 建议；具体使用效果以实际体验为准。', structured: { prompt: '校园教室与学习桌，明亮自然光，整洁文具，真实日常感。', scenes: ['提出学习问题', '核对工具建议', '整理课堂笔记'] } };
  },
};
const app = createApp(store, {
  profileMode: true, workOwnerId: ownerId, authorizeWorkActor: actor => actor.userId === ownerId,
  apiKey: 'synthetic-ui-key-never-sent', modelStore, staticDirectory: resolve('dist'), workExecutors,
  fetcher: async (url, init) => {
    if (String(url) === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(init.body);
      const payload = JSON.parse(body.input);
      if (!Array.isArray(payload.allowedAccounts)) return rejectExternal();
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ kind: 'proposal', goal: '制作校园 AI 学习工具的小红书图文', question: '', nodes: [proposalNode()] }) }] }], usage: { input_tokens: 100, output_tokens: 100 } });
    }
    if (String(url) === 'https://api.openai.com/v1/images/generations') return Response.json({ data: [{ b64_json: syntheticImage }] });
    return rejectExternal();
  },
  mcpFetcher: rejectExternal, ragFetcher: rejectExternal, localQwenFetcher: rejectExternal,
});
const runtime = app.locals.workControl;
async function finished(runId) {
  for (let tries = 0; tries < 400; tries++) {
    const run = store.work.get('run', runId);
    if (['succeeded', 'failed', 'needs_reconciliation'].includes(run?.status)) return run;
    await delay(10);
  }
  throw Error('合成验收任务没有及时完成');
}
const quote = runtime.estimatePlanning(projectId, { goal: '制作校园 AI 学习工具的小红书图文', accountIds: [accountId], model: 'gpt-5.4-mini' });
const started = await runtime.startPlanning(projectId, { quoteId: quote.quoteId, planningBudgetUSD: 1, idempotencyKey: randomUUID() });
const planning = await finished(started.run.id);
if (planning.status !== 'succeeded') throw Error(`合成规划未完成：${planning.error || planning.status}`);
const cases = runtime.createPlan(projectId, { goal: '成功与失败任务删除验收', idempotencyKey: randomUUID(), nodes: [proposalNode({ id: 'success-case', title: '已完成图文任务（删除验收）', budgetUSD: 0 }), proposalNode({ id: 'failed-case', title: '已失败任务（删除验收）', budgetUSD: 0 })] });
const approved = await runtime.approvePlan(cases.plan.id, { version: cases.plan.version, budgetUSD: 0, idempotencyKey: randomUUID() });
for (const run of approved.runs) {
  const quote = runtime.estimateDispatch(run.id, { expectedRevision: run.revision, requirement: run.node.requirement, model: run.node.model, skillMode: 'default', skillIds: [] });
  await runtime.approveDispatch(run.id, { expectedRevision: run.revision, quoteId: quote.quoteId, budgetUSD: quote.estimateUSD, idempotencyKey: randomUUID() });
}
await Promise.all(approved.runs.map(run => finished(run.id)));
const server = app.listen(4458, '127.0.0.1'); await once(server, 'listening');
console.log(JSON.stringify({ url: 'http://127.0.0.1:4458', projectId, skillId, planningTaskId: planning.taskId, planningRunId: planning.id, unapprovedPlanId: planning.planningPlanId, successfulTaskId: approved.tasks.find(task => task.nodeId === 'success-case').id, failedTaskId: approved.tasks.find(task => task.nodeId === 'failed-case').id }, null, 2));
async function close() {
  await runtime.close(); await app.locals.integrations.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); store.close(); process.exit(0);
}
process.once('SIGINT', close); process.once('SIGTERM', close);
