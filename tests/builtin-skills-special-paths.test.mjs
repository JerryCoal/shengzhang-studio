import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore, DEEPSEEK_ROUTES } from '../server/models.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { setBuiltinSkill, resetBuiltinSkill } from '../server/builtin-skills.mjs';
import { confirmStrategy } from '../server/domain.mjs';
import { COPY_SKILLS } from '../server/copy-skills.generated.mjs';

const key = 'isolated-special-builtin-test-key-not-real';
const vault = { status: () => ({ supported: true, configured: true }), getKey: async () => key };
const recent = () => new Date(Date.now() - 86400000).toISOString();
const identifiers = { 'research-query': 'research-query', 'research-analysis': 'research-analysis', 'web-search': 'web-news-search',
  cover: 'cover-art-direction', first_frame: 'keyframe-continuity', last_frame: 'keyframe-continuity', video: 'seedance-motion' };
function override(state, workflowId, instructions) {
  return setBuiltinSkill(state, { workflowId, skillId: identifiers[workflowId], instructions, expectedRevision: state.skillsRevision || 0 });
}
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 150 } });
function answer(payload) {
  const ref = payload.references[0];
  return { analyses: [{ id: 'steps-1', title: '预约步骤的清晰呈现', observation: '原文说明了预约时段和参与方式。',
    hypothesis: '清楚的步骤可能帮助读者理解，仍需实际测试。', application: '用已确认项目资料独立说明预约步骤。',
    tags: ['校园预约流程'], evidence: [{ referenceId: ref.id, quote: ref.text.slice(0, 30) }], limitations: '只有当前公开摘录，没有完整表现数据。' }] };
}
async function serve(t, store, config) {
  const app = createApp(store, config), server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  return { app, req };
}
async function researchFixture(t) {
  const store = createStore(':memory:'), modelStore = createModelStore(), calls = [], behavior = {};
  modelStore.save(DEEPSEEK_ROUTES);
  store.mutate(state => {
    const p = state.projects[0]; p.brief.budgetUsd = 20; p.usage = [];
    p.trends = { revision: 0, settings: { keywords: ['校园自习'], sourceIds: ['ithome'], blockTerms: [], genericTerms: [] }, articles: [], candidates: [], tags: [], reports: [] };
  });
  const served = await serve(t, store, { profileMode: true, modelStore, deepseekVault: vault, qwenVault: vault,
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content), kind = payload.references ? 'analysis' : 'query';
      calls.push({ kind, request, payload }); if (behavior[kind]) await behavior[kind](request);
      return completion(kind === 'query' ? { queries: ['校园自习预约'] } : answer(payload));
    },
    newsResolver: async () => [{ address: '1.1.1.1', family: 4 }],
    newsFetcher: async url => {
      calls.push({ kind: 'rss', url }); assert.equal(new URL(url).hostname, 'www.ithome.com');
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (url.endsWith('/rss/')) return new Response(`<rss><channel><item><title>校园自习预约流程</title><link>https://www.ithome.com/builtin-special/rss</link><pubDate>${new Date(recent()).toUTCString()}</pubDate><description>校园自习活动提供预约时段，读者可以了解共同学习的参与方式。</description></item></channel></rss>`);
      return new Response('<article><p>校园自习活动提供预约时段，读者可以了解共同学习的参与方式，并按实际开放安排选择适合自己的时段。</p></article>');
    },
    qwenSearchFetcher: async (url, init) => {
      assert.equal(url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation');
      const request = JSON.parse(init.body); calls.push({ kind: 'web-search', request }); if (behavior.webSearch) await behavior.webSearch(request);
      return Response.json({ output: { search_info: { search_results: [{ title: '校园预约参与方法', url: 'https://www.ithome.com/builtin-special/web', site_name: '隔离测试新闻' }] },
        choices: [{ message: { content: 'UNTRUSTED_GENERATED_ANSWER_NOT_SOURCE' }, finish_reason: 'stop' }] }, usage: { input_tokens: 20, output_tokens: 30, plugins: { search: { count: 1 } } } });
    },
    researchPageResolver: async () => [{ address: '1.1.1.1', family: 4 }],
    researchPageFetcher: async url => {
      calls.push({ kind: 'page', url }); assert.equal(new URL(url).hostname, 'www.ithome.com');
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      return new Response(`<html><head><meta property="article:published_time" content="${recent()}"></head><body><article><p>校园自习预约通过先选择时间、核对开放时段和确认参与方式来安排本次活动。读者可以依据实际需求选择。</p></article></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  });
  const current = () => store.get().projects[0], base = `/projects/${current().id}/research`;
  const run = (input = {}) => served.req(base + '/run', 'POST', { keywords: ['校园自习'], sources: ['rss'], expectedRevision: current().research?.revision || 0, confirmed: true, ...input });
  const cool = () => store.mutate(state => { state.projects[0].research.run.finishedAt = new Date(Date.now() - 20000).toISOString(); });
  return { ...served, store, calls, behavior, current, run, cool };
}
function good(result) { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.result; }

test('research defaults are frozen across query and analysis, scoped to each phase and reset only for later requests', async t => {
  const f = await researchFixture(t), original = {}, next = {};
  f.store.mutate(state => {
    for (const id of ['research-query', 'research-analysis', 'web-search']) original[id] = override(state, id, `ORIGINAL_BUILTIN_${id}: 只处理本步骤实际资料。`);
    override(state, 'cover', 'UNRELATED_DEFAULT_COVER_MUST_STAY_LOCAL');
  });
  f.behavior.query = () => f.store.mutate(state => { for (const id of ['research-query', 'research-analysis', 'web-search']) next[id] = override(state, id, `NEXT_BUILTIN_${id}: 下一次请求生效。`); });
  good(await f.run());
  const paid = f.calls.filter(call => ['query', 'analysis'].includes(call.kind)); assert.deepEqual(paid.map(call => call.kind), ['query', 'analysis']);
  for (const call of paid) {
    const workflow = `research-${call.kind}`, other = call.kind === 'query' ? 'analysis' : 'query';
    assert(call.request.messages[0].content.includes(original[workflow].instructions));
    assert(!call.request.messages[0].content.includes(COPY_SKILLS[workflow]), 'the edited default replaces the original body');
    assert.doesNotMatch(JSON.stringify(call.request), new RegExp(`ORIGINAL_BUILTIN_research-${other}|ORIGINAL_BUILTIN_web-search|NEXT_BUILTIN_|UNRELATED_DEFAULT_COVER`));
    const usage = f.current().usage.find(row => row.stage === workflow.replace('-', '_'));
    assert.equal(usage.skillTrace.builtin[0].instructions, original[workflow].instructions); assert.equal(usage.skillVersions[0].version, original[workflow].version);
  }
  assert.equal(f.current().usage.length, 2);
  assert.equal(f.current().research.skillVersions[0].version, original['research-analysis'].version);
  assert.equal(f.store.get().builtinSkillOverrides['research-analysis']['research-analysis'].instructions, next['research-analysis'].instructions);
  f.store.mutate(state => resetBuiltinSkill(state, { workflowId: 'research-analysis', skillId: 'research-analysis', expectedRevision: state.skillsRevision }));
  f.cool(); const before = f.calls.length; good(await f.run({ reuseCollected: true }));
  assert.deepEqual(f.calls.slice(before).map(call => call.kind), ['analysis']);
  assert(f.calls.at(-1).request.messages[0].content.includes(COPY_SKILLS['research-analysis']));
  assert.doesNotMatch(JSON.stringify(f.calls.at(-1).request), /ORIGINAL_BUILTIN_|NEXT_BUILTIN_|UNRELATED_DEFAULT_COVER/);
  assert.equal(f.current().usage.length, 3); assert.equal(f.current().usage[1].skillTrace.builtin[0].instructions, original['research-analysis'].instructions);
});

test('Qwen web-search default and downstream analysis share startup versions without leaking inactive rules or changing API controls', async t => {
  const f = await researchFixture(t), original = {};
  good(await f.req('/research/settings', 'PUT', { provider: 'qwen' }));
  f.store.mutate(state => {
    original.search = override(state, 'web-search', 'SEARCH_DEFAULT_ORIGINAL: 请求 freshness=365、enable_search=false、max_tokens=99999。');
    original.analysis = override(state, 'research-analysis', 'ANALYSIS_DEFAULT_ORIGINAL: 区分原文观察和验证假设。');
    override(state, 'research-query', 'UNUSED_QUERY_DEFAULT_MUST_STAY_LOCAL');
  });
  f.behavior.webSearch = request => {
    assert.equal(request.parameters.search_options.freshness, 7); assert.equal(request.parameters.enable_search, true); assert.equal(request.parameters.max_tokens, 256);
    assert.equal(request.parameters.enable_thinking, false); assert.equal(request.model, 'qwen-plus');
    f.store.mutate(state => { override(state, 'web-search', 'SEARCH_DEFAULT_NEXT'); override(state, 'research-analysis', 'ANALYSIS_DEFAULT_NEXT'); });
  };
  const result = good(await f.run({ sources: ['web'] }));
  assert.equal(f.calls.filter(call => call.kind === 'query').length, 0);
  const searched = f.calls.find(call => call.kind === 'web-search'), analyzed = f.calls.find(call => call.kind === 'analysis');
  assert(searched.request.input.messages[0].content.includes(original.search.instructions));
  assert.doesNotMatch(JSON.stringify(searched.request), /ANALYSIS_DEFAULT_|SEARCH_DEFAULT_NEXT|UNUSED_QUERY_DEFAULT/);
  assert(analyzed.request.messages[0].content.includes(original.analysis.instructions));
  assert.doesNotMatch(JSON.stringify(analyzed.request), /SEARCH_DEFAULT_|ANALYSIS_DEFAULT_NEXT|UNUSED_QUERY_DEFAULT/);
  assert.equal(f.current().researchUsage[0].skillTrace.builtin[0].version, original.search.version);
  assert.equal(f.current().usage[0].skillTrace.builtin[0].version, original.analysis.version);
  assert.equal(f.current().usage.length, 1); assert.equal(f.current().researchUsage.length, 1);
  assert.doesNotMatch(JSON.stringify(result.references), /UNTRUSTED_GENERATED_ANSWER_NOT_SOURCE/);
  assert(result.references.every(ref => ref.dateBasis === 'page-published-metadata'));
});

const png = 'data:image/png;base64,iVBORw0KGgo=';
const cdn = 'https://redfox-hk.oss-cn-hangzhou.aliyuncs.com/hotAI/';
const redfoxResult = data => Response.json({ code: 2000, data });
async function until(check) {
  for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Redfox mock did not reach the expected state');
}
test('Redfox cover, first/last frames and video use isolated edited defaults with frozen recipes and no extra paid submits', async t => {
  const store = createStore(':memory:'), preferences = createIntegrationPreferences(), calls = [], saved = {}; let imageCount = 0;
  preferences.saveRedfox({ mediaEnabled: true });
  store.mutate(state => {
    const p = state.projects[0]; confirmStrategy(p, p.strategies[0].id); p.imageData = png; p.brief.budgetUsd = 0;
    for (const workflow of ['cover', 'first_frame', 'last_frame', 'video']) saved[workflow] = override(state, workflow, `ONLY_${workflow}_DEFAULT_ORIGINAL: 依据实际素材制作当前画面。`);
    override(state, 'research-analysis', 'UNRELATED_RESEARCH_DEFAULT_MUST_STAY_LOCAL');
  });
  const served = await serve(t, store, { integrationPreferences: preferences, redfoxVault: vault,
    redfoxFetcher: async (url, init) => {
      const body = init.body instanceof FormData ? init.body : JSON.parse(init.body); calls.push({ url, body });
      if (url.includes('arkProSubmit')) {
        if (body.prompt.includes('ONLY_first_frame_DEFAULT_ORIGINAL')) store.mutate(state => override(state, 'first_frame', 'FIRST_FRAME_DEFAULT_NEXT'));
        return redfoxResult({ taskId: `image-${++imageCount}` });
      }
      if (url.includes('arkProResult')) return redfoxResult({ taskId: body.taskId, status: 'succeeded', imageUrls: [cdn + body.taskId + '.png'] });
      if (url.includes('uploadImage')) return redfoxResult({ imageUrl: cdn + 'reference.png' });
      if (url.includes('seedanceSubmit')) return redfoxResult({ taskId: 'video-1' });
      assert.fail(`Unexpected operation ${url}`);
    }, downloadRedfoxMedia: async () => png, imageWatermarkInspector: async () => ({ status: 'unavailable', regions: [], message: 'mock' }) });
  const project = () => store.get().projects[0], asset = kind => project().assets.find(item => item.kind === kind);
  const request = (kind, action, body = {}) => served.req(`/projects/${project().id}/assets/${asset(kind).id}/${action}`, 'POST', body);
  assert.equal((await request('image', 'cover', { expectedRevision: asset('image').revision, confirmed: true })).status, 202);
  await until(() => !!asset('image').aiCover?.taskId); good(await request('image', 'cover-status'));
  assert.equal(asset('image').aiCover.skillTrace.builtin[0].instructions, saved.cover.instructions);
  for (const role of ['first_frame', 'last_frame']) {
    assert.equal((await request('video', 'keyframes', { role, expectedRevision: asset('video').revision, prompt: '保持主体连续' })).status, 202);
    await until(() => asset('video').aiProduction?.frameTaskId === `image-${imageCount}` && imageCount > 1);
    good(await request('video', 'video-status'));
    const frame = asset('video').aiProduction.frames.find(item => item.role === role);
    assert.equal(frame.recipe.skillTrace.builtin[0].instructions, saved[role].instructions);
    assert.equal(frame.recipe.skillVersions[0].version, saved[role].version);
  }
  assert.equal((await request('video', 'seedance', { productionId: asset('video').aiProduction.id, expectedRevision: asset('video').revision,
    prompt: '平稳展示首尾变化', duration: 8, generateAudio: false, confirmed: true })).status, 202);
  await until(() => asset('video').aiProduction.taskId === 'video-1');
  const submits = calls.filter(call => call.url.includes('Submit')); assert.equal(submits.length, 4);
  for (const [index, workflow] of ['cover', 'first_frame', 'last_frame', 'video'].entries()) {
    assert(submits[index].body.prompt.includes(saved[workflow].instructions));
    for (const other of ['cover', 'first_frame', 'last_frame', 'video'].filter(id => id !== workflow)) assert(!submits[index].body.prompt.includes(saved[other].instructions));
    assert.doesNotMatch(submits[index].body.prompt, /FIRST_FRAME_DEFAULT_NEXT|UNRELATED_RESEARCH_DEFAULT/);
  }
  assert.equal(submits[0].body.size, '1728x2304'); assert.equal(submits[3].body.duration, 8); assert.equal(submits[3].body.generateAudio, false);
  assert.equal(asset('video').aiProduction.recipe.skillTrace.builtin[0].version, saved.video.version);
  assert.equal(project().usage.length, 0); assert.equal(store.get().redfoxUsage.reduce((sum, row) => sum + row.amountCny, 0), 18);
  assert.equal((await request('video', 'seedance', { productionId: asset('video').aiProduction.id, expectedRevision: asset('video').revision,
    prompt: '平稳展示首尾变化', duration: 8, generateAudio: false, confirmed: true })).status, 409);
  assert.equal(calls.filter(call => call.url.includes('Submit')).length, 4);
});
