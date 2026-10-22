// Isolated acceptance workspace: encrypted memory only, synthetic providers only.
// No personal workspace, model credentials or external requests are read or used.
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createApp } from '../../server/app.mjs';
import { createStore } from '../../server/store.mjs';
import { createModelStore } from '../../server/models.mjs';
import { createIntegrationPreferences } from '../../server/integrations.mjs';
import { defaultSeedream } from '../../server/seedream-config.mjs';
import { installCreativeSkill } from '../../server/creative-skills.mjs';
import { createWorkExecutors } from '../../server/work-executors.mjs';

const store = createStore(':memory:', { key: randomBytes(32), scope: 'controller-workspace-browser-only' });
const ownerId = 'synthetic-controller-owner', accountId = 'synthetic-campus-account';
const modelStore = createModelStore(), preferences = createIntegrationPreferences();
preferences.saveSeedream({ ...defaultSeedream, imagePriceUsd: 0.04 });
const syntheticImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=';
const rejectExternal = async () => { throw Object.assign(Error('验收工作区已禁用真实外部请求'), { noCharge: true }); };
store.mutate(state => {
  state.accounts = [{ id: accountId, name: '校园账号 A（合成验收）', platform: 'xiaohongshu' }];
  const project = state.projects[0]; state.projects = [project];
  project.brief.name = '总控单页流程验收'; project.brief.brand = '合成校园品牌'; project.brief.product = '学习资料整理工具'; project.brief.budgetUsd = 100; project.brief.channels = ['xiaohongshu'];
  project.assets = []; project.tasks = []; project.usage = []; project.publications = []; state.contentRules = [];
  for (const [workflowId, name] of [['copy-xiaohongshu', '校园真实场景写作'], ['cover', '校园图文视觉规范']]) installCreativeSkill(state, { fileName: `${name}.md`, text: `---\nname: ${name}\ndescription: 合成验收 Skills，检查逐次选择和版本保存\nversion: 1.0.0\n---\n# 规则\n使用清晰的校园场景，保留事实边界。`, workflowId, confirmed: true, expectedRevision: state.skillsRevision || 0 });
});
const projectId = store.get().projects[0].id;
const actualPreparation = createWorkExecutors({ store, config: { apiKey: 'synthetic-never-sent', modelStore, fetcher: rejectExternal } });
const node = { id: 'campus-copy', title: '校园学习工具图文', role: 'xiaohongshu-copy', accountId, connectionAccountId: '', requirement: '给校园账号写一篇学习资料整理工具图文，先写自然文案，再制作两张配图。', dependsOn: [], model: 'gpt-5.4-mini', budgetUSD: 0 };
const app = createApp(store, {
  profileMode: true, workOwnerId: ownerId, authorizeWorkActor: actor => actor.userId === ownerId,
  apiKey: 'synthetic-never-sent', modelStore, staticDirectory: resolve('dist'),
  integrationPreferences: preferences, seedreamVault: { status: () => ({ configured: true, supported: true }), getKey: async () => 'synthetic-image-key-never-sent' },
  imageWatermarkInspector: async () => ({ status: 'unavailable', engine: 'synthetic-test', checkedAt: new Date().toISOString(), regions: [], message: '合成验收，不运行 OCR。' }),
  workExecutors: {
    prepare: actualPreparation.prepare,
    async execute({ run }) { await delay(750); return { kind: 'copy', title: run.node.title, body: `课件和笔记总是散落各处？\n\n先按课程整理材料，再让 AI 帮你列一份复习提纲，最后回到原文核对。\n\n本次使用的指令：${run.input.requirement}`, structured: { prompt: '大学校园，整洁的学习桌，课件与笔记，自然光，清爽布局。', scenes: ['整理课程资料', '核对复习提纲'] } }; },
  },
  fetcher: async (url, init) => {
    if (String(url) === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(init.body), payload = JSON.parse(body.input);
      if (!Array.isArray(payload.allowedAccounts)) return rejectExternal();
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ kind: 'proposal', goal: payload.goal || '校园账号图文制作', question: '', nodes: [node] }) }] }], usage: { input_tokens: 100, output_tokens: 100 } });
    }
    if (String(url) === 'https://ark.cn-beijing.volces.com/api/v3/images/generations') { await delay(500); return Response.json({ data: [{ b64_json: syntheticImage }], usage: { generated_images: 1 } }); }
    return rejectExternal();
  },
  mcpFetcher: rejectExternal, ragFetcher: rejectExternal, localQwenFetcher: rejectExternal,
});
const runtime = app.locals.workControl;
const created = runtime.createPlan(projectId, { goal: '给校园账号做一篇学习工具图文，配两张图片。', nodes: [node], idempotencyKey: randomUUID() });
const server = app.listen(4459, '127.0.0.1'); await once(server, 'listening');
console.log(JSON.stringify({ url: `http://127.0.0.1:4459/#controller?project=${encodeURIComponent(projectId)}&planId=${encodeURIComponent(created.plan.id)}`, projectId, planId: created.plan.id }, null, 2));
async function close() { await runtime.close(); await app.locals.integrations.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); process.exit(0); }
process.once('SIGINT', close); process.once('SIGTERM', close);
