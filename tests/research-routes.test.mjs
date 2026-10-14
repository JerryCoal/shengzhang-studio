import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createModelStore } from '../server/models.mjs';
import { researchOf, selectedResearchContext } from '../server/research-data.mjs';
import { WEB_SEARCH_ENDPOINT } from '../server/research-sources.mjs';

const modelKey = 'fixture-research-model-key', searchKey = 'fixture-search-only-key';
const day = 86400000;
const recent = () => new Date(Date.now() - day).toISOString();
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } });
const vector = () => Array.from({ length: 512 }, (_, i) => i === 0 ? 1 : 0);
const vault = (initial = '') => { let value = initial; return { status: () => ({ configured: !!value, supported: true, suffix: value ? value.slice(-4) : '' }), getKey: async () => value, save: async next => { value = next; }, remove: async () => { value = ''; } }; };
function rows() {
  const row = (n, values = {}) => ({ Title: `校园自习活动${n}`, Url: `https://www.ithome.com/research-fixture/${n}?utm_source=test&access_token=private-access`, Content: `<nav>网站导航</nav><p>校园自习活动${n}提供预约时段，读者可了解共同学习的参与方式。</p><script>PRIVATE_SCRIPT</script>`, PublishTime: recent(), SiteName: '测试新闻', ...values });
  return [row(1), row(2, { Title: 'DeepSeek 学习工具的校园使用场景', Content: 'DeepSeek 学习工具文章展示问答步骤，样本包含校园学习场景。' }),
    row(3, { PublishTime: new Date(Date.now() - 8 * day).toISOString() }), row(4, { PublishTime: '' }),
    row(5, { PublishTime: new Date(Date.now() + day).toISOString() }), row(6, { Title: '校园自习活动1' }),
    row(7, { Content: '近期校园宣传出现著作权纠纷，不能用于借势。' }), row(8, { Content: '虚假竞品词出现在校园宣传中。' })];
}
function analysis(payload) {
  return { analyses: payload.references.slice(0, 2).map((reference, i) => ({ id: `angle-${i + 1}`, title: `共同学习的参与方式${i + 1}`,
    observation: `样本介绍了${reference.title}相关场景。`, hypothesis: '清楚展示参与步骤可能帮助理解，需通过小样本测试验证。',
    application: '参考步骤展示方式，编写项目已有的预约说明，不将外部事件当作项目事实。', tags: ['自习预约流程', '结伴学习场景', '热点'],
    evidence: [{ referenceId: reference.id, quote: reference.text.slice(0, 30) }], limitations: '当前仅有少量来源，无法据此判断成交或曝光效果。' })) };
}
async function fixture(t, options = {}) {
  const store = createStore(':memory:'), calls = [], behavior = {}, modelStore = createModelStore(), qwenVault = vault(modelKey), researchVault = vault(searchKey);
  modelStore.save({ strategy: 'qwen-plus', planning: 'qwen-plus', copy: 'qwen-plus', classification: 'qwen-flash', analysis: 'qwen-plus' });
  const id = store.get().projects[0].id, base = `/projects/${id}/research`;
  store.mutate(state => {
    const p = state.projects[0]; p.usage = []; p.brief = { ...p.brief, product: '校园自习空间', audience: '寻找共同学习场所的同学', goal: '介绍预约与参与方式', facts: '提供可预约的自习时段', budgetUsd: 5 };
    p.trends = { revision: 0, settings: { keywords: ['校园自习'], sourceIds: ['ithome'], blockTerms: ['虚假竞品词'], genericTerms: [] }, articles: [], candidates: [], tags: [], reports: [] };
  });
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).hostname, 'dashscope.aliyuncs.com', 'fixture must never call arbitrary model services');
    const request = JSON.parse(init.body);
    if (url.endsWith('/embeddings')) {
      calls.push({ kind: 'embedding', request });
      if (behavior.embedding) return behavior.embedding(request);
      return Response.json({ data: request.input.map((_, index) => ({ index, embedding: vector() })), usage: { total_tokens: request.input.length * 8 } });
    }
    assert(url.endsWith('/chat/completions')); const payload = JSON.parse(request.messages[1].content), kind = payload.references ? 'analysis' : payload.keywords ? 'query' : 'writing';
    calls.push({ kind, payload, request });
    if (behavior[kind]) return behavior[kind](payload, request);
    return completion(kind === 'query' ? { queries: ['校园自习活动'] } : kind === 'analysis' ? analysis(payload) : { title: '校园预约说明', core: '说明已有预约方式', direction: '呈现自习参与过程', prompt: '依据项目事实介绍校园自习活动。' });
  };
  const searchFetcher = async (url, init) => {
    assert.equal(url, WEB_SEARCH_ENDPOINT); assert.equal(init.headers.Authorization, `Bearer ${searchKey}`);
    const request = JSON.parse(init.body); calls.push({ kind: 'search', request });
    if (behavior.search) return behavior.search(request);
    return Response.json({ Result: { WebResults: rows() } });
  };
  const newsFetcher = async url => {
    calls.push({ kind: 'rss', url });
    assert.equal(new URL(url).hostname, 'www.ithome.com');
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    if (url.endsWith('/rss/')) return new Response(`<rss><channel><item><title>校园自习预约方法</title><link>https://www.ithome.com/research-fixture/rss</link><pubDate>${new Date(Date.now() - day).toUTCString()}</pubDate><description>校园自习活动提供预约时段，读者可以了解共同学习的参与方式。</description></item></channel></rss>`);
    return new Response('<article><p>校园自习活动提供预约时段，读者可以了解共同学习的参与方式。这是一段测试公开文章。</p></article>');
  };
  const qwenSearchFetcher = async (url, init) => {
    assert.equal(url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation');
    assert.equal(init.headers.Authorization, `Bearer ${modelKey}`);
    calls.push({kind:'qwen-search',request:JSON.parse(init.body)});
    if (behavior.qwenSearch) return behavior.qwenSearch(JSON.parse(init.body));
    return Response.json({output:{search_info:{search_results:[{title:'校园自习新计划',url:'https://www.ithome.com/research-fixture/qwen',site_name:'测试新闻'},{title:'待核实的校园线索',url:'https://www.ithome.com/research-fixture/undated'}]},choices:[{message:{content:'PRIVATE_AI_INVENTED_ARTICLE'},finish_reason:'stop'}]},usage:{input_tokens:20,output_tokens:30,plugins:{search:{count:1}}}});
  };
  const researchPageFetcher = async (url, init) => {
    calls.push({kind:'page',url}); assert.equal(new URL(url).hostname,'www.ithome.com');
    assert.equal(init.credentials,'omit'); assert.equal(init.headers.Authorization,undefined);
    if (behavior.page) return behavior.page(url,init);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    return new Response(`<html><head>${url.endsWith('/undated')?'':`<meta property="article:published_time" content="${recent()}">`}</head><body><article><p>校园自习新计划展示了具体预约流程，同学可依照时间安排参与活动，并在完成学习后记录体验。</p></article></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  };
  const app = createApp(store, { profileMode: true, modelStore, qwenVault, researchVault, fetcher, searchFetcher, qwenSearchFetcher, researchPageFetcher, researchPageResolver: async () => [{address:'1.1.1.1',family:4}], newsFetcher, newsResolver: async () => [{ address: '1.1.1.1', family: 4 }], ...options });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const req = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
  const current = () => store.get().projects[0];
  const run = (input = {}) => req(base + '/run', 'POST', { keywords: ['校园自习'], sources: ['web'], expectedRevision: researchOf(current()).revision, confirmed: true, useSemantic: false, reuseCollected: false, ...input });
  const cool = () => store.mutate(state => { if (state.projects[0].research?.run) state.projects[0].research.run.finishedAt = new Date(Date.now() - 20000).toISOString(); });
  return { app, store, calls, behavior, req, id, base, current, run, cool, qwenVault, researchVault, modelStore };
}
function good(result) { assert.equal(result.status, 200, JSON.stringify(result)); return result.data.result; }
async function selectAll(f) {
  const r = researchOf(f.current());
  return f.req(f.base + '/select', 'POST', { expectedRevision: r.revision, analysisIds: r.analyses.map(a => a.id), acknowledgedIds: r.analyses.filter(a => a.risk === 'review').map(a => a.id), confirmed: true });
}

test('research runs real query → web → clean → retrieval → analysis → explicit selection with separate ledgers', async t => {
  const f = await fixture(t), result = good(await f.run());
  assert.equal(result.run.status, 'completed'); assert.deepEqual(f.calls.map(c => c.kind), ['query', 'search', 'analysis']);
  assert.equal(result.references.length, 2); assert.equal(result.analyses.length, 2); assert.equal(result.retrieval.method, 'keyword');
  assert.deepEqual(result.selectedIds, []); assert.deepEqual(selectedResearchContext(f.current()), []);
  for (const category of ['expired', 'missingDate', 'future', 'duplicate', 'dispute', 'blocked']) assert.equal(result.excluded[category], 1, category);
  assert(result.references.every(r => !r.text.includes('PRIVATE_SCRIPT') && !r.url.includes('token') && r.dateBasis === 'search-metadata'));
  const modelPayload = f.calls.find(c => c.kind === 'analysis').payload;
  assert.equal(modelPayload.references.length, 2); assert(modelPayload.references.every(r => result.references.some(saved => saved.id === r.id)));
  assert(result.analyses.every(a => !a.tags.includes('热点') && a.evidence.every(e => result.references.find(r => r.id === e.referenceId).text.includes(e.quote))));
  const usage = f.current().usage; assert.deepEqual(usage.map(u => u.stage), ['research_query', 'research_analysis']);
  assert(usage.every(u => u.status === 'completed' && !u.estimated && u.amountUsd > 0 && !('amountCny' in u)));
  assert.deepEqual(usage.map(u => u.skillVersions[0].id), ['research-query', 'research-analysis']);
  assert.equal(f.current().researchUsage.length, 1); assert.equal(f.current().researchUsage[0].amountCny, .02); assert(!('amountUsd' in f.current().researchUsage[0]));
  good(await selectAll(f)); assert.equal(selectedResearchContext(f.current()).length, 2);
  const status = await f.req(f.base + '/status'); assert.equal(status.data.usageCny, .02); assert.equal(status.data.budgetCny, 1);
  for (const path of ['/state', '/backup', '/research/settings']) { const data = (await f.req(path)).data; assert(!JSON.stringify(data).includes(modelKey)); assert(!JSON.stringify(data).includes(searchKey)); }
});

test('reusing collected references performs analysis only and does not need a saved search key', async t => {
  const f = await fixture(t); good(await f.run()); f.cool(); const before = f.calls.length, spend = f.current().researchUsage.reduce((n, u) => n + u.amountCny, 0);
  await f.researchVault.remove(); const result = good(await f.run({ reuseCollected: true, keywords: ['学习伙伴互动'] }));
  assert.equal(result.run.status, 'completed'); assert.deepEqual(f.calls.slice(before).map(c => c.kind), ['analysis']);
  assert.deepEqual(f.calls.at(-1).payload.keywords, ['学习伙伴互动']); assert.deepEqual(result.queries, ['学习伙伴互动']);
  assert.equal(f.current().researchUsage.reduce((n, u) => n + u.amountCny, 0), spend); assert.equal(f.current().usage.length, 3);
});

test('semantic research builds only its evidence index, then reuses it without repeating source search or index upload', async t => {
  const f = await fixture(t), result = good(await f.run({ useSemantic: true }));
  assert.equal(result.retrieval.method, 'hybrid'); assert.equal(result.ragIndex.model, 'text-embedding-v4'); assert.equal(result.ragIndex.dimensions, 512);
  assert.equal(f.calls.filter(c => c.kind === 'embedding').length, 2); assert.equal(f.current().ragIndex, undefined, 'project-owned documents use a separate index');
  assert(!JSON.stringify(result.ragIndex).includes('预约时段'));
  assert.deepEqual(f.current().researchUsage.map(u => u.operation), ['web', 'index', 'query']);
  assert(f.current().researchUsage.filter(u => u.operation !== 'web').every(u => u.amountCny > 0 && !u.estimated && u.status === 'completed'));
  f.cool(); const before = f.calls.length; good(await f.run({ useSemantic: true, reuseCollected: true }));
  assert.deepEqual(f.calls.slice(before).map(c => c.kind), ['embedding', 'analysis']);
});

test('RSS-only research uses its bounded source adapter without web key or search fees', async t => {
  const f = await fixture(t); await f.researchVault.remove(); const result = good(await f.run({ sources: ['rss'] }));
  assert.equal(result.references.length, 1); assert.equal(result.references[0].kind, 'rss'); assert.equal(result.references[0].dateBasis, 'publisher-feed');
  assert.equal(f.calls.filter(c => c.kind === 'search').length, 0); assert(f.calls.some(c => c.kind === 'rss')); assert.equal((f.current().researchUsage || []).length, 0);
});

test('new workspaces default to public news; switching providers neither calls nor deletes credentials', async t => {
  const f = await fixture(t); await f.researchVault.remove();
  let result = await f.req('/research/settings');
  assert.equal(result.data.search.provider,'none'); assert.equal(result.data.search.reservationCny,0);
  assert.deepEqual(result.data.search.providers.map(p=>p.id),['none','qwen','volcengine']);
  assert(result.data.search.providers.find(p=>p.id==='qwen').supported);
  assert.equal((await f.req('/research/settings','PUT',{provider:'qwen'})).status,200);
  assert.equal(await f.qwenVault.getKey(),modelKey);
  assert.equal((await f.req('/research/settings','PUT',{provider:'qwen',apiKey:searchKey})).status,400);
  await f.req('/research/settings','PUT',{provider:'volcengine',apiKey:searchKey});
  await f.req('/research/settings','PUT',{provider:'none'});
  assert.equal(await f.researchVault.getKey(),searchKey);
  await f.req('/research/settings','PUT',{provider:'qwen'});
  result=await f.req('/research/settings','PUT',{clearKey:true});
  assert.equal(result.data.search.provider,'qwen'); assert.equal(result.data.search.configured,true);
  assert.equal(await f.researchVault.getKey(),''); assert.equal(await f.qwenVault.getKey(),modelKey);
  assert.equal(f.calls.length,0);
});

test('Qwen reuses its model key once, reads real article text, separates undated clues and skips query planning', async t => {
  const f = await fixture(t); await f.researchVault.remove();
  f.modelStore.save({...f.modelStore.get(),classification:'gpt-5.4-nano'}); // No OpenAI key; skipped planning must not demand it.
  good(await f.req('/research/settings','PUT',{provider:'qwen'}));
  const keywords=['校园自习','预约流程','晚间学习','大学生','效率工具','复盘记录','学习搭子','数字生活'];
  const result = good(await f.run({keywords}));
  assert.equal(result.run.webProvider,'qwen'); assert.equal(result.references.length,1);
  assert.equal(result.references[0].dateBasis,'page-published-metadata');
  assert.equal(result.pendingReferences.length,1); assert.match(result.pendingReferences[0].url,/undated/);
  assert.equal(f.calls.filter(c=>c.kind==='query').length,0); assert.equal(f.calls.filter(c=>c.kind==='search').length,0);
  assert.equal(f.calls.filter(c=>c.kind==='qwen-search').length,1); assert.equal(f.calls.filter(c=>c.kind==='analysis').length,1);
  for(const word of keywords) assert(f.calls.find(c=>c.kind==='qwen-search').request.input.messages[1].content.includes(word));
  assert(!JSON.stringify(result).includes('PRIVATE_AI'));
  assert.deepEqual(f.current().usage.map(u=>u.stage),['research_analysis']);
  assert.equal(f.current().researchUsage[0].operation,'qwen-web'); assert.equal(f.current().researchUsage[0].amountCny,.003076);
  assert.equal(f.current().researchUsage[0].status,'completed'); assert.equal(f.current().researchUsage[0].estimated,false);
  assert.equal(f.calls.find(c=>c.kind==='analysis').payload.references.length,1);
  good(await selectAll(f)); assert.equal(selectedResearchContext(f.current()).length,1);
  for (const path of ['/state','/backup','/research/settings']) assert(!JSON.stringify((await f.req(path)).data).includes(modelKey));
});

test('Qwen unsupported regions and insufficient research budgets reject before any model or search request', async t => {
  const f=await fixture(t); good(await f.req('/research/settings','PUT',{provider:'qwen'}));
  f.store.mutate(s=>{s.qwenConnection={region:'ap-southeast-1',workspaceId:''};});
  const settings=(await f.req('/research/settings')).data;
  assert.equal(settings.search.configured,false); assert.equal(settings.search.providers.find(p=>p.id==='qwen').supported,false);
  assert.equal((await f.run()).status,400); assert.equal(f.calls.length,0);
  f.store.mutate(s=>{s.qwenConnection={region:'cn-beijing',workspaceId:''};s.projects[0].researchPreviousCny=.9;});
  assert.equal((await f.run()).status,400); assert.equal(f.calls.length,0);
});

test('failed Qwen search preserves uncertainty and can continue chosen RSS without calling another paid search', async t => {
  const f=await fixture(t); good(await f.req('/research/settings','PUT',{provider:'qwen'}));
  f.behavior.qwenSearch=()=>new Response(`PRIVATE_${modelKey}`,{status:403});
  const result=good(await f.run({sources:['web','rss']}));
  assert(result.references.every(r=>r.kind==='rss')); assert.equal(f.calls.filter(c=>c.kind==='qwen-search').length,1);
  assert.equal(f.calls.filter(c=>['search','query','page'].includes(c.kind)).length,0);
  assert.equal(f.current().researchUsage[0].amountCny,.2); assert.equal(f.current().researchUsage[0].status,'uncertain');
  assert(!JSON.stringify(result).includes(modelKey));
});

test('Qwen undated sources remain visible clues after a failed run without inventing recent analysis', async t => {
  const f=await fixture(t); good(await f.req('/research/settings','PUT',{provider:'qwen'}));
  f.behavior.page=url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):new Response('<article><p>校园学习新安排只是测试文字，页面没有明确标注发布时间，不能伪装成近期新闻。</p></article>',{headers:{'Content-Type':'text/html'}});
  const failed=await f.run(); assert.equal(failed.status,400);
  assert.equal(f.current().research.pendingReferences.length,2); assert.equal(f.current().research.references.length,0);
  assert.equal(f.calls.filter(c=>c.kind==='analysis').length,0); assert.equal(f.current().researchUsage.length,1);
});

test('Qwen run settles usage but stops page fetching after project changes during the search request', async t => {
  const f=await fixture(t); good(await f.req('/research/settings','PUT',{provider:'qwen'}));
  f.behavior.qwenSearch=()=>{f.store.mutate(s=>{s.projects[0].brief.goal='新目标';});return Response.json({output:{search_info:{search_results:[]}},usage:{input_tokens:20,output_tokens:30,plugins:{search:{count:1}}}});};
  assert.equal((await f.run()).status,409); assert.equal(f.calls.filter(c=>c.kind==='page').length,0);
  assert.equal(f.current().researchUsage[0].status,'completed'); assert.equal(f.current().research.run.status,'failed');
});

test('a rejected web source still allows independent RSS collection and evidence-based analysis', async t => {
  const f = await fixture(t); f.behavior.search = () => new Response(searchKey, { status: 403 });
  const result = good(await f.run({ sources: ['web', 'rss'] }));
  assert.equal(result.run.status, 'completed'); assert(result.references.every(reference => reference.kind === 'rss'));
  assert(result.reports.some(report => report.sourceId === 'web' && report.status === 'failed')); assert(result.reports.some(report => report.sourceId === 'rss' && report.status === 'ok'));
  assert.equal(f.calls.filter(c => c.kind === 'search').length, 1); assert.equal(f.calls.filter(c => c.kind === 'analysis').length, 1);
  assert(!JSON.stringify(result).includes(searchKey)); assert.equal(f.current().researchUsage[0].amountCny, .02, 'search requests use explicit conservative reservation, not a claimed actual bill');
});

test('failed query embedding falls back locally without replay and records uncertainty separately from model USD', async t => {
  const f = await fixture(t); let embeddings = 0;
  f.behavior.embedding = request => ++embeddings === 1
    ? Response.json({ data: request.input.map((_, index) => ({ index, embedding: vector() })), usage: { total_tokens: 16 } })
    : new Response(modelKey, { status: 503 });
  const result = good(await f.run({ useSemantic: true }));
  assert.equal(result.run.status, 'completed'); assert.equal(result.retrieval.method, 'keyword'); assert.equal(embeddings, 2);
  const usage = f.current().researchUsage.find(u => u.operation === 'query'); assert.equal(usage.status, 'uncertain'); assert.equal(usage.estimated, true); assert(usage.amountCny > 0);
  assert(f.current().usage.every(u => u.status === 'completed' && u.amountUsd > 0 && !('amountCny' in u))); assert(!JSON.stringify(result).includes(modelKey));
});

test('failed refresh preserves old references, selected evidence and analyses, and never fabricates success', async t => {
  const f = await fixture(t); good(await f.run()); good(await selectAll(f)); const before = structuredClone(f.current().research); f.cool();
  f.behavior.search = () => new Response('PRIVATE_UPSTREAM_ERROR', { status: 503 });
  const failed = await f.run(); assert.equal(failed.status, 400); assert(!JSON.stringify(failed).includes('PRIVATE_'));
  const result = f.current().research; assert.equal(result.run.status, 'failed'); assert.deepEqual(result.analyses, before.analyses); assert.deepEqual(result.selectedIds, before.selectedIds);
  assert.deepEqual(result.references, before.references); assert.equal(selectedResearchContext(f.current()).length, 2); assert.equal(result.reports[0].status, 'failed');
  assert.equal(f.calls.filter(c => c.kind === 'analysis').length, 1); assert.equal(f.current().researchUsage.length, 2, 'attempted search still has a conservative fee record');
});

test('same-URL changed content followed by failed analysis retains the prior selected evidence snapshot', async t => {
  const f = await fixture(t); good(await f.run()); good(await selectAll(f)); const before = structuredClone(selectedResearchContext(f.current())); f.cool();
  f.behavior.search = () => Response.json({ Result: { WebResults: rows().slice(0, 2).map(row => ({ ...row, Content: '校园学习空间这次更换了完全不同的报道正文，需要等待重新核对。' })) } });
  f.behavior.analysis = () => completion({ analyses: [{ id: 'invalid' }] });
  const failed = await f.run(); assert.equal(failed.status, 502); assert.equal(f.current().research.run.status, 'failed');
  assert.deepEqual(selectedResearchContext(f.current()), before, 'failed replacement cannot destroy the previously selected quote/source pair');
  assert.equal(f.current().usage.at(-1).status, 'uncertain'); assert.equal(f.current().usage.at(-1).estimated, false, 'known failed-result tokens are accounted once');
});

test('selection rejects missing confirmation, unknown/stale IDs, unacknowledged entities and expired evidence without paid calls', async t => {
  const f = await fixture(t); good(await f.run()); const before = f.calls.length, r = researchOf(f.current()), risky = r.analyses.find(a => a.risk === 'review'); assert(risky);
  const selection = { expectedRevision: r.revision, analysisIds: [risky.id], acknowledgedIds: [], confirmed: true };
  assert.equal((await f.req(f.base + '/select', 'POST', { ...selection, confirmed: false })).status, 400);
  assert.equal((await f.req(f.base + '/select', 'POST', selection)).status, 400);
  assert.equal((await f.req(f.base + '/select', 'POST', { ...selection, analysisIds: ['not-present'] })).status, 409);
  assert.equal((await f.req(f.base + '/select', 'POST', { ...selection, expectedRevision: r.revision - 1 })).status, 409);
  assert.equal((await f.req(f.base + '/select', 'POST', { ...selection, acknowledgedIds: ['not-selected'] })).status, 400);
  good(await f.req(f.base + '/select', 'POST', { ...selection, acknowledgedIds: [risky.id] }));
  f.store.mutate(state => { state.projects[0].research.references.forEach(ref => { ref.publishedAt = new Date(Date.now() - 8 * day).toISOString(); }); });
  assert.equal((await selectAll(f)).status, 409); assert.deepEqual(selectedResearchContext(f.current()), []); assert.equal(f.calls.length, before);
});

test('local encrypted workspace, active-job and revision guards reject before source/model calls', async t => {
  const f = await fixture(t);
  assert.equal((await f.run({ confirmed: false })).status, 400); assert.equal((await f.run({ expectedRevision: 99 })).status, 409); assert.equal(f.calls.length, 0);
  assert.equal((await f.req(f.base + '/run', 'POST', { keywords: ['校园'], sources: ['web'], expectedRevision: 0, confirmed: true }, { 'X-Forwarded-For': '203.0.113.1' })).status, 403);
  for (const options of [{ profileMode: false }, { authorizeCredentials: () => true }]) {
    const other = await fixture(t, options); assert.equal((await other.req('/research/settings')).data.available, false); assert.equal((await other.run()).status, 403); assert.equal(other.calls.length, 0);
  }
});

test('CNY source cap and USD model cap cannot be bypassed and stay in their own ledgers', async t => {
  const cny = await fixture(t); cny.store.mutate(state => { state.projects[0].researchPreviousCny = 1; });
  assert.equal((await cny.run()).status, 400); assert.equal(cny.calls.length, 0); assert.equal(cny.current().usage.length, 0); assert.equal((cny.current().researchUsage || []).length, 0);
  const usd = await fixture(t); usd.store.mutate(state => { state.projects[0].brief.budgetUsd = 0; });
  assert.equal((await usd.run()).status, 400); assert.equal(usd.calls.length, 0); assert.equal((usd.current().researchUsage || []).length, 0);
});

test('concurrent run, settings changes and selection are blocked until the active query completes', async t => {
  const f = await fixture(t); let enter, release; const entered = new Promise(r => { enter = r; }), waiting = new Promise(r => { release = r; });
  f.behavior.query = async () => { enter(); await waiting; return completion({ queries: ['校园自习活动'] }); };
  const pending = f.run(); await entered;
  assert.equal((await f.run()).status, 409); assert.equal((await f.req('/research/settings', 'PUT', { reservationCny: .03 })).status, 409);
  assert.equal((await f.req(f.base + '/select', 'POST', { expectedRevision: researchOf(f.current()).revision, analysisIds: [], confirmed: true })).status, 409);
  release(); good(await pending); assert.equal(f.calls.filter(c => c.kind === 'query').length, 1);
});

test('brief changes during a paid query stop source collection, preserve completed usage and return 409', async t => {
  const f = await fixture(t);
  f.behavior.query = () => { f.store.mutate(state => { state.projects[0].brief.goal = '并发修改的新目标'; }); return completion({ queries: ['校园自习活动'] }); };
  const result = await f.run(); assert.equal(result.status, 409); assert.deepEqual(f.calls.map(c => c.kind), ['query']);
  assert.equal(f.current().research.run.status, 'failed'); assert.equal(f.current().usage.length, 1); assert.equal(f.current().usage[0].status, 'completed'); assert.equal(f.current().usage[0].estimated, false);
  assert.equal((f.current().researchUsage || []).length, 0);
});

test('research connection settings keep the dedicated key in its vault, preserve default pricing and clear it explicitly', async t => {
  const f = await fixture(t); const initial = await f.req('/research/settings'); assert.equal(initial.status, 200); assert.equal(initial.data.search.reservationCny, .02); assert.equal(initial.data.search.configured, true);
  const next = 'fixture-replacement-search-key'; const saved = await f.req('/research/settings', 'PUT', { apiKey: next, reservationCny: .03 });
  assert.equal(saved.status, 200); assert.equal(await f.researchVault.getKey(), next); assert.equal(saved.data.search.reservationCny, .03);
  assert(!JSON.stringify(saved).includes(next)); assert(!JSON.stringify((await f.req('/state')).data).includes(next));
  assert.equal((await f.req('/research/settings', 'PUT', { apiKey: next, clearKey: true })).status, 400);
  const cleared = await f.req('/research/settings', 'PUT', { clearKey: true }); assert.equal(cleared.data.search.configured, false);
  assert.equal((await f.run()).status, 400); assert.equal(f.calls.length, 0);
});

test('downstream AI strategy receives only explicitly selected, still-valid research references', async t => {
  const f = await fixture(t); good(await f.run()); const sourceCalls = f.calls.filter(c => ['query', 'search', 'analysis'].includes(c.kind)).length;
  const generate = () => f.req(`/projects/${f.id}/strategies`, 'POST', { mode: 'openai', stage: 'strategy', query: '校园宣传' });
  good(await generate()); assert.deepEqual(f.calls.at(-1).payload.researchReferences || [], []);
  const state = researchOf(f.current()), chosen = state.analyses.find(a => a.risk !== 'review'); assert(chosen);
  good(await f.req(f.base + '/select', 'POST', { expectedRevision: state.revision, analysisIds: [chosen.id], confirmed: true }));
  good(await generate()); const payload = f.calls.at(-1).payload;
  assert.deepEqual(payload.researchReferences.map(item => item.analysisId), [chosen.id]); assert(payload.researchReferences[0].evidence.every(e => chosen.evidence.some(original => original.referenceId === e.referenceId)));
  f.store.mutate(value => { value.projects[0].research.references.forEach(ref => { ref.publishedAt = new Date(Date.now() - 8 * day).toISOString(); }); });
  good(await generate()); assert.deepEqual(f.calls.at(-1).payload.researchReferences || [], []);
  assert.equal(f.calls.filter(c => ['query', 'search', 'analysis'].includes(c.kind)).length, sourceCalls, 'generation never repeats source collection');
});
