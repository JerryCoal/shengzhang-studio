import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newProject, addAccount } from '../server/domain.mjs';
import { createContentDraft, createKnowledge } from '../server/content-workflow.mjs';
import { MODELS, DEFAULT_ROUTES } from '../server/models.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({
  stdin: { contents: "export { StudioPage, contentNextStep } from './src/pages/ContentStudio.tsx'; export { XiaohongshuAssistant } from './src/pages/XiaohongshuAssistant.tsx'; export { ContentKnowledgePreview } from './src/components/ContentKnowledgePreview.tsx'; export { Context } from './src/context.tsx';", resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env.MODE': '"development"', 'import.meta.env.VITE_API_BASE_URL': '""' }, logLevel: 'silent',
});
const module = { exports: {} }; new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { StudioPage, XiaohongshuAssistant, ContentKnowledgePreview, Context, contentNextStep } = module.exports;
function fixture() {
  const p = newProject({ name: '隔离界面测试', brand: '测试品牌', product: '测试产品', type: 'daily', goal: '真实分享', audience: '读者', sellingPoints: '已知用途', facts: '', requirements: '不编造', channels: ['xiaohongshu', 'douyin'], deadline: '2027-01-01', budgetUsd: 10 });
  const state = { projects: [p], accounts: [], activities: [], installedSkills: [], builtinSkillOverrides: {}, contentRules: [], skillsRevision: 0 };
  const a = addAccount(state, { platform: 'xiaohongshu', name: '甲的生活账号' });
  const b = addAccount(state, { platform: 'douyin', name: '乙的视频账号' });
  const image = createContentDraft(state, p, { requestId: crypto.randomUUID(), accountId: a.id, kind: 'image', requirement: '分享下班后的桌面整理', title: '甲的图文草稿' });
  const video = createContentDraft(state, p, { requestId: crypto.randomUUID(), accountId: b.id, kind: 'video', requirement: '介绍真实的整理过程', title: '乙的视频草稿' });
  const context = { state, project: p, settings: { routes: DEFAULT_ROUTES, models: MODELS, openaiConfigured: false, providers: {} }, busy: false, target: {}, accountScope: '', setAccountScope() {}, go() {}, notify() {}, run: async work => work(), runBackground: async (_label, work) => work(), mutate: async () => { throw new Error('Read-only UI test must not mutate'); }, refresh: async () => {}, startProject() {} };
  return { p, state, a, b, image, video, context };
}
const render = (component, context, props = {}) => renderToStaticMarkup(createElement(Context.Provider, { value: context }, createElement(component, props)));
test('content landing is a list first and does not mount the full assistant or account setup', () => {
  const { context, image, video, a } = fixture();
  const html = render(StudioPage, context);
  assert.match(html, /甲的图文草稿/); assert.match(html, /乙的视频草稿/); assert.match(html, /新建内容/);
  assert.doesNotMatch(html, /小红书创作助手|本次使用的参考样本|生成与诊断记录|本次创作方案/);
  assert.doesNotMatch(html, /前往确认策略/);
  const scoped = render(StudioPage, { ...context, accountScope: a.id });
  assert.match(scoped, new RegExp(image.title)); assert.doesNotMatch(scoped, new RegExp(video.title));
});
test('asset deep link opens its own account even when browsing another account', () => {
  const { context, image, b } = fixture();
  const html = render(StudioPage, { ...context, accountScope: b.id, target: { assetId: image.id, tab: 'copy' } });
  assert.match(html, /单篇内容编辑器/); assert.match(html, /甲的生活账号/); assert.doesNotMatch(html, /乙的视频账号/);
  assert.match(html, /生成文案/); assert.match(html, /更多标题/); assert.match(html, /正文诊断/);
  assert.doesNotMatch(html, /结果用于哪份内容|选择小红书助手功能|生成与诊断记录|创作账号与身份记忆/);
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
});
test('video editing keeps upload and video tools in its media step, without XHS tools', () => {
  const { context, video } = fixture();
  const html = render(StudioPage, { ...context, target: { assetId: video.id, tab: 'media' } });
  assert.match(html, /采用本地成品/); assert.match(html, /生成视频/); assert.match(html, /本地模板制作/);
  assert.match(html, /添加参考图片与本地配音/);
  assert.doesNotMatch(html, /标题评分|先获取封面方案|小红书创作助手/);
  assert.equal(contentNextStep({ ...video, body: '' }), 'copy');
  assert.equal(contentNextStep({ ...video, body: '现有正文', mediaData: '' }), 'media');
});
test('embedded title tool binds this asset and folds older records instead of mixing project history', () => {
  const { context, p, image, video, a } = fixture();
  const record = (id, assetId, at, title) => ({ id, mode: 'titles', status: 'completed', createdAt: at, input: { assetId, expectedAssetRevision: 1, keyword: '整理', title: image.title, body: '', instruction: '', sampleId: '' }, result: { summary: title, limitations: [], references: [], titles: [{ title, reason: '具体场景', matchScore: 8, sampleIds: [] }] }, accountId: a.id, accountName: a.name, profileRevision: 0, model: 'test', reservationUsd: .01, warnings: [] });
  p.xhsAssistant = { samples: [], runs: [record('new', image.id, '2026-10-19T10:00:00Z', '当前内容候选'), record('old', image.id, '2026-10-18T10:00:00Z', '旧内容候选'), record('other', video.id, '2026-10-20T10:00:00Z', '另一篇不应出现')] };
  const html = render(XiaohongshuAssistant, context, { targetAssetId: image.id, initialMode: 'titles', onPrepareCover() {}, onClose() {} });
  assert.match(html, /本篇内容工具/); assert.match(html, /当前内容候选/); assert.match(html, /旧内容候选/);
  assert.doesNotMatch(html, /另一篇不应出现|结果用于哪份内容|选择小红书助手功能/);
  assert.equal((html.match(/class="xhs-record-fold" open=""/g) || []).length, 1);
  assert.match(html, /添加参考（可选）/);
});
test('knowledge preview uses only explicit, active knowledge belonging to this content account', () => {
  const { context, state, p, image, a, b } = fixture();
  const allowed = createKnowledge(state, p, { kind: 'reference', title: '甲可用参考', text: '下班整理的真实参考内容', accountId: a.id });
  createKnowledge(state, p, { kind: 'experience', title: '乙的私有经验', text: '下班整理的另一个账号经验', accountId: b.id });
  image.contentBrief.knowledgeIds = [allowed.id];
  const html = render(ContentKnowledgePreview, context, { asset: image });
  assert.match(html, /甲可用参考/); assert.doesNotMatch(html, /乙的私有经验/);
  assert.match(html, /不能替代已核实事实/);
});
test('content list publication status follows the bound account and exact content revision', () => {
  const { context, p, image, a } = fixture();
  p.assets = [image]; image.status = 'ready'; image.mime = 'image/png';
  image.mediaData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
  const record = { id: 'published', assetId: image.id, assetRevision: image.revision, accountId: a.id, status: 'published' };
  p.publications = [{ ...record, accountId: 'other-account' }, { ...record, id: 'older', assetRevision: image.revision - 1 }, { ...record, id: 'cancelled', status: 'cancelled' }];
  let html = render(StudioPage, context);
  assert.match(html, /可准备发布/); assert.doesNotMatch(html, /查看发布记录|已安排发布/);
  p.publications.push({ ...record, id: 'scheduled', status: 'scheduled' });
  html = render(StudioPage, context);
  assert.match(html, /已安排发布/); assert.match(html, /查看发布记录/); assert.doesNotMatch(html, /可准备发布/);
  p.publications.push(record);
  html = render(StudioPage, context);
  assert.match(html, />已发布</); assert.match(html, /查看发布记录/); assert.doesNotMatch(html, /已安排发布|可准备发布/);
  delete image.contentBrief; delete image.creationTrace;
  html = render(StudioPage, context);
  assert.match(html, /可准备发布/); assert.doesNotMatch(html, /查看发布记录/);
});
