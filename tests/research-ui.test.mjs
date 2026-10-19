import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { seedState } from '../server/domain.mjs';
import { MODELS, DEFAULT_ROUTES } from '../server/models.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({
  stdin: { contents: "export { RedfoxXhsResearchLimit, ResearchRunSummary, ResearchReportStats, ResearchPanel } from './src/pages/Research.tsx'; export { Context } from './src/context.tsx';", resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env.MODE': '"development"', 'import.meta.env.VITE_API_BASE_URL': '""' }, logLevel: 'silent',
});
const module = { exports: {} }; new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { RedfoxXhsResearchLimit, ResearchRunSummary, ResearchReportStats, ResearchPanel, Context } = module.exports;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const stats = { rawCount: 12, normalizedCount: 10, invalidCount: 2, duplicateCount: 1, missingDateCount: 3, emptyContentCount: 2, searchRequests: 2, detailRequests: 3 };
const excluded = Object.fromEntries(['invalid', 'unsafeUrl', 'missingDate', 'uncertainDate', 'future', 'expired', 'noteType', 'emptyContent', 'dispute', 'blocked', 'duplicate', 'limit'].map(key => [key, 0]));
function researchFixture() {
  return { revision: 2, queries: ['桌面整理'], references: [], pendingReferences: [], analyses: [], selectedIds: [], reports: [{ sourceId: 'xiaohongshu', name: 'Redfox · 桌面整理', status: 'ok', count: 10, message: '读取完成，部分候选仍需核对', stats }],
    run: { id: 'this-run', phase: 'failed', status: 'failed', startedAt: '2026-10-18T10:00:00Z', error: '本轮 10 条候选均超出所选时间范围，请调整关键词后重试。', discovery: { platform: 'xiaohongshu', timeRange: 'week', sortBy: 'general', noteType: 'all' } },
    summary: { runId: 'this-run', mode: 'collected', candidateCount: 10, eligibleCount: 0, analysisCount: 0, pendingCount: 3, failedSources: 0, sourceReports: 1, excluded: { ...excluded, expired: 10 }, collection: { coverage: 'complete', reportCount: 1, ...stats } } };
}

test('Redfox XHS confirmation shows the whole-run request and RMB estimate ceilings', () => {
  const one = render(RedfoxXhsResearchLimit, { keywordCount: 1, expanded: true, timeRange: 'week' });
  assert.match(one, /每个关键词最多 2 页，全轮合计最多 3 次详情/);
  assert.match(one, /本轮最多 2 次搜索 \+ 3 次详情，共 5 次请求/); assert.match(one, /估算上限 ¥0\.20/);
  assert.match(one, /先按最新内容查找/); assert.match(one, /DeepSeek 分析另计项目美元预算/);
  const three = render(RedfoxXhsResearchLimit, { keywordCount: 3, expanded: true, timeRange: 'month' });
  assert.match(three, /全轮合计最多 3 次详情/); assert.match(three, /共 9 次请求/); assert.match(three, /估算上限 ¥0\.36/);
});

test('turning off expansion removes detail reads and unbounded-time search does not claim latest sorting', () => {
  const html = render(RedfoxXhsResearchLimit, { keywordCount: 3, expanded: false, timeRange: 'all' });
  assert.match(html, /每个关键词 1 次搜索，不读取详情/); assert.match(html, /共 3 次请求/); assert.match(html, /估算上限 ¥0\.12/);
  assert.doesNotMatch(html, /先按最新内容查找|全轮合计最多 3 次详情/);
  assert.match(render(RedfoxXhsResearchLimit, { keywordCount: 0, expanded: true, timeRange: 'week' }), /填写 1–3 个关键词后/);
});

test('failed-run summary separates collection statistics, cleaning and final usable count with details folded', () => {
  const research = researchFixture();
  const html = render(ResearchRunSummary, { research });
  assert.match(html, /读取候选 <b>12<\/b>/); assert.match(html, /最终可用 <b>0<\/b>/); assert.match(html, /进入分析 <b>0<\/b>/);
  assert.match(html, /格式不兼容<\/dt><dd>2<\/dd>/); assert.match(html, /日期未核实<\/dt><dd>3<\/dd>/); assert.match(html, /正文缺失<\/dt><dd>2<\/dd>/);
  assert.match(html, /清洗：超出时间范围<\/dt><dd>10<\/dd>/); assert.match(html, /清洗：内容类型不符/); assert.match(html, /清洗：屏蔽词/);
  assert.match(html, /<details class="research-summary-details">/); assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /不应把各项简单相加/);
});

test('unavailable or partial counts and old runs never masquerade as fresh zero-count results', () => {
  const research = researchFixture();
  research.summary.collection = { coverage: 'unavailable', reportCount: 0, ...Object.fromEntries(Object.keys(stats).map(key => [key, null])) };
  let html = render(ResearchRunSummary, { research });
  assert.match(html, /未记录不代表零/); assert.match(html, /读取候选<\/dt><dd>未记录/);
  research.summary.collection = { coverage: 'partial', reportCount: 1, ...stats };
  html = render(ResearchRunSummary, { research });
  assert.match(html, /已覆盖来源读取候选/); assert.match(html, /不能作为全部来源总计/);
  research.summary.runId = 'older-run'; research.references = [{ id: 'old-a' }, { id: 'old-b' }];
  html = render(ResearchRunSummary, { research });
  assert.match(html, /已保存参考总量：2 条/); assert.match(html, /不能当作本轮结果/); assert.doesNotMatch(html, /最终可用/);
});

test('reused runs explain that no new collection is performed and report details keep precise counts', () => {
  const research = researchFixture(); research.summary.mode = 'reused';
  const html = render(ResearchRunSummary, { research });
  assert.match(html, /本轮重新分析/); assert.match(html, /复用候选/); assert.match(html, /不新增采集请求/); assert.doesNotMatch(html, /读取候选/);
  const detail = render(ResearchReportStats, { stats });
  assert.match(detail, /搜索请求<\/dt><dd>2/); assert.match(detail, /详情请求<\/dt><dd>3/); assert.match(detail, /格式不兼容<\/dt><dd>2/);
});

test('research page surfaces the exact failed reason while retaining collapsed historical material', () => {
  const state = seedState(), project = state.projects[0]; project.research = researchFixture();
  project.research.reports[0].status = 'failed';
  project.research.references = [{ id: 'old', kind: 'xiaohongshu', title: '历史桌面参考', url: 'https://www.xiaohongshu.com/explore/old', text: '旧参考正文仍然保留', publishedAt: '2026-10-10T10:00:00Z', collectedAt: '2026-10-10T11:00:00Z', dateBasis: 'note_time', sourceName: '旧来源', metrics: {}, risk: 'unverified', riskReason: '' }];
  const context = { state, project, settings: { routes: DEFAULT_ROUTES, models: MODELS, providers: {}, openaiConfigured: false }, busy: false, run() {}, runBackground() {}, notify() {}, go() {}, refresh: async () => {}, mutate: async () => { throw new Error('SSR must not mutate'); } };
  const html = renderToStaticMarkup(createElement(Context.Provider, { value: context }, createElement(ResearchPanel)));
  assert.match(html, /role="alert">本轮 10 条候选均超出所选时间范围/);
  assert.match(html, /本次研究未完成，请查看上方具体原因/); assert.match(html, /历史桌面参考/);
  assert.match(html, /展开素材详情/); assert.match(html, /research-reference-details" hidden/);
  assert.match(html, /已保存的历史参考不会因失败清空/); assert.match(html, /最终可用 <b>0<\/b>/);
  assert.match(html, /部分完成 · 已取得 10 条/);
});
