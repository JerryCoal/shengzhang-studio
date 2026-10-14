import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb, researchURL, WEB_SEARCH_ENDPOINT, WEB_SEARCH_STANDARD_CNY } from '../server/research-sources.mjs';
import { mountMCPPlatforms, xhsMCPResearchItem } from '../server/mcp-platforms.mjs';

const AT = '2026-10-14T08:00:00.000Z', KEY = 'fixture-search-key-no-network';
const tool = (name, required = []) => ({ name, inputSchema: { type: 'object', required } });
const tools = [tool('search_feeds', ['keyword']), tool('get_feed_detail', ['feed_id', 'xsec_token']), tool('check_login_status')];
const noteId = n => n.toString(16).padStart(24, '0');
const note = (n, extra = {}) => ({ feed_id: noteId(n), data: { note: { noteId: noteId(n), title: `学习空间${n}`, desc: `校园学习活动${n}`, time: Date.parse('2026-10-13T10:00:00+08:00'), interactInfo: { likedCount: '20', commentCount: '5', collectedCount: '12', sharedCount: '3' }, ...extra }, comments: { list: [{ content: 'PRIVATE_COMMENT_NOT_TO_RETAIN', userInfo: { nickname: 'PRIVATE_PROFILE' } }] } } });
const req = { socket: { remoteAddress: '127.0.0.1' }, get: name => name === 'Host' ? '127.0.0.1:4340' : undefined };
function fixture(onCall, { mode = 'external', listedTools = tools } = {}) {
  const requests = [], calls = []; let closed = 0;
  const fetcher = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:18060/mcp'); assert.equal(init.redirect, 'error');
    if (init.method === 'DELETE') { closed++; return new Response(null, { status: 204 }); }
    const rpc = JSON.parse(init.body); requests.push(rpc.method);
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18' };
    else if (rpc.method === 'tools/list') result = { tools: listedTools };
    else { calls.push(rpc.params); result = await onCall(rpc.params.name, rpc.params.arguments); }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
  };
  const config = { mcpFetcher: fetcher, mcpVaults: { xiaohongshu: { status: () => ({ configured: true }), getKey: async () => JSON.stringify({ mode, endpoint: 'http://127.0.0.1:18060/mcp', apiKey: 'fixture-mcp-secret' }) } } };
  const app = { get() {}, put() {}, post() {}, delete() {} };
  const mcp = mountMCPPlatforms(app, {}, config, { project() {}, activeJobs: new Set() });
  return { mcp, calls, requests, get closed() { return closed; } };
}
const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const login = () => ({ content: [{ type: 'text', text: '✅ 已登录\n用户名: PRIVATE_ACCOUNT' }] });
const webResponse = rows => Response.json({ ResponseMetadata: { RequestId: 'fixture-request' }, Result: { WebResults: rows } });
const webRow = (n, extra = {}) => ({ Title: `校园资讯${n}`, Url: `https://news.example.com/article/${n}?xsec_token=PRIVATE_ACCESS&cookie=PRIVATE_COOKIE&utm_source=search&id=${n}#PRIVATE_FRAGMENT`, Content: `正文${n}`, PublishTime: '2026-10-13T18:00:00+08:00', SiteName: '测试新闻', ...extra });

test('web uses the documented dedicated search endpoint and bounded one-week request; no arbitrary page fetch', async () => {
  const calls = [], reservations = [];
  const result = await searchWeb(['校园', '科技', '生活', '不应发送'], { key: KEY, at: AT, onRequest: value => reservations.push(value), fetcher: async (url, init) => {
    calls.push({ url, init }); assert.equal(url, WEB_SEARCH_ENDPOINT); assert.equal(init.redirect, 'error'); assert(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload, { Query: ['校园', '科技', '生活'][calls.length - 1], SearchType: 'web', Count: 8, Filter: { NeedContent: true, NeedUrl: true }, QueryControl: { QueryRewrite: false } });
    return webResponse(Array.from({ length: 10 }, (_, i) => webRow(calls.length * 10 + i)));
  } });
  assert.equal(WEB_SEARCH_STANDARD_CNY, 0.02); assert.equal(calls.length, 3); assert.equal(reservations.length, 3); assert.equal(result.items.length, 24);
  assert(result.items.every(item => item.kind === 'web' && item.metrics === null && item.dateBasis === 'search-metadata' && item.collectedAt === AT));
  assert.equal(result.items[0].publishedAt, '2026-10-13T18:00:00+08:00');
  assert.equal(result.items[0].url, 'https://news.example.com/article/10?id=10');
  assert(!JSON.stringify(result).includes('PRIVATE_')); assert(result.reports.every(r => r.sourceId === 'web' && r.name && r.status === 'ok'));
});

test('web dates never use crawl/update time and result text is bounded without AI summaries or account details', async () => {
  const result = await searchWeb(['学习'], { key: KEY, at: AT, fetcher: async () => webResponse([
    webRow(1, { PublishTime: undefined, UpdateTime: AT, CrawlTime: AT, Content: '字'.repeat(2000), AuthorInfo: { Name: 'PRIVATE_AUTHOR' } }),
    webRow(2, { PublishTime: '昨天', Content: '', Summary: '仅使用检索相关正文摘要', Snippet: '不采用短摘要' }),
    webRow(3, { PublishTime: '2026-10-13', Content: KEY }),
    webRow(4, { Url: 'javascript:alert(1)' }),
    webRow(5, { Url: 'http://127.0.0.1/private' }),
    null,
  ]) });
  assert.equal(result.items.length, 3); assert(result.items.every(item => item.publishedAt === '')); assert.equal(result.items[0].text.length, 1600);
  assert.equal(result.items[1].text, '仅使用检索相关正文摘要'); assert(!JSON.stringify(result).includes(KEY)); assert(!JSON.stringify(result).includes('PRIVATE_AUTHOR'));
});

test('web failures preserve other query results and sanitize provider errors without retries', async () => {
  let calls = 0;
  const result = await searchWeb(['校园', '生活', '科技'], { key: KEY, fetcher: async () => {
    calls++;
    if (calls === 1) return new Response(`PRIVATE_${KEY}`, { status: 403 });
    if (calls === 2) return webResponse([webRow(1)]);
    return Response.json({ ResponseMetadata: { Error: { Message: 'PRIVATE_PROVIDER_ERROR' } }, Result: null });
  } });
  assert.equal(calls, 3); assert.equal(result.items.length, 1); assert.deepEqual(result.reports.map(r => r.status), ['failed', 'ok', 'failed']); assert(!JSON.stringify(result).includes('PRIVATE_'));
  const missing = await searchWeb(['校园'], { fetcher: async () => { throw Error('must not call'); } }); assert.equal(missing.reports[0].status, 'skipped');
});

test('search callbacks abort unchanged without being swallowed or issuing a paid request', async () => {
  const conflict = Object.assign(new Error('workspace changed'), { status: 409 }); let requests = 0;
  await assert.rejects(searchWeb(['校园'], { key: KEY, onRequest: () => { throw conflict; }, fetcher: async () => { requests++; return webResponse([]); } }), error => error === conflict);
  assert.equal(requests, 0);
});

test('web bounds response body and validates inputs before requests; URLs strip access parameters', async () => {
  for (const response of [new Response('PRIVATE', { headers: { 'content-length': '4000001' } }), new Response('x'.repeat(4_000_001))]) {
    let calls = 0; const result = await searchWeb(['校园'], { key: KEY, fetcher: async () => { calls++; return response; } });
    assert.equal(calls, 1); assert.equal(result.reports[0].status, 'failed'); assert(!JSON.stringify(result).includes('PRIVATE'));
  }
  await assert.rejects(searchWeb([{}], { key: KEY }), /搜索词/); await assert.rejects(searchWeb(['校园'], { key: 'a\nb' }), /密钥/);
  assert.equal(researchURL('https://user:pass@example.com/a'), '');
  assert.equal(researchURL('https://example.com/a?AuthToken=secret&X-Amz-Signature=secret&SESSION_ID=secret&ticket=secret&code=secret&article=3'), 'https://example.com/a?article=3');
});

test('MCP research checks login, bounds search/detail calls, verifies IDs and retains only allowed metadata', async () => {
  const f = fixture(async (name, args) => {
    if (name === 'check_login_status') return login();
    if (name === 'search_feeds') {
      assert.deepEqual(args.filters, { publish_time: '一周内', sort_by: '最多收藏' });
      const base = args.keyword === '校园' ? 1 : 5;
      return json({ feeds: Array.from({ length: 20 }, (_, i) => ({ id: noteId(base + i), xsecToken: 'PRIVATE_XSEC', noteCard: { user: { nickname: 'PRIVATE_USER' } } })) });
    }
    assert.equal(name, 'get_feed_detail'); assert.equal(args.load_all_comments, false); assert.deepEqual(Object.keys(args).sort(), ['feed_id', 'load_all_comments', 'xsec_token']);
    return json(note(Number.parseInt(args.feed_id, 16)));
  });
  const before = await f.mcp.researchStatus(req); assert.equal(before.supported, true); assert.equal(before.checked, false); assert.equal(f.requests.length, 0);
  const result = await f.mcp.researchSearch(req, { queries: ['校园', '生活', '忽略'], at: AT });
  assert.equal(f.calls.filter(c => c.name === 'search_feeds').length, 2); assert.equal(f.calls.filter(c => c.name === 'get_feed_detail').length, 8); assert.equal(result.items.length, 8); assert.equal(f.closed, 1);
  const item = result.items[0]; assert.equal(item.publishedAt, '2026-10-13T02:00:00.000Z'); assert.equal(item.dateBasis, 'platform-timestamp'); assert.equal(item.url, `https://www.xiaohongshu.com/explore/${noteId(1)}`);
  assert.deepEqual(item.metrics, { likes: 20, comments: 5, favorites: 12, shares: 3 }); assert(!JSON.stringify(result).includes('PRIVATE_'));
  const after = await f.mcp.researchStatus(req); assert.equal(after.supported, true); assert.equal(after.checked, true);
});

test('MCP skips unconfigured/builtin, missing capability and logged-out services without search', async () => {
  for (const options of [{ mode: 'builtin' }, { listedTools: [tool('get_feed_detail', ['feed_id', 'xsec_token'])] }, {}]) {
    const f = fixture(async name => { assert.equal(name, 'check_login_status'); return { content: [{ type: 'text', text: '❌ 未登录\nPRIVATE_ERROR' }] }; }, options);
    const result = await f.mcp.researchSearch(req, { queries: ['校园'], at: AT });
    assert.deepEqual(result.items, []); assert.equal(result.reports[0].status, 'skipped'); assert.equal(f.calls.filter(c => c.name === 'search_feeds').length, 0); assert(!JSON.stringify(result).includes('PRIVATE_'));
  }
  const remote = { socket: { remoteAddress: '203.0.113.2' }, get: () => undefined };
  await assert.rejects(fixture(async () => ({})).mcp.researchSearch(remote, { queries: ['校园'] }), error => error.status === 403);
});

test('MCP partial failures keep verified sources; unknown time and approximate counts remain unknown', async () => {
  const f = fixture(async (name, args) => {
    if (name === 'check_login_status') return login();
    if (name === 'search_feeds') return json({ feeds: [{ id: noteId(1), xsecToken: 'PRIVATE_XSEC' }, { id: noteId(2), xsecToken: 'PRIVATE_XSEC' }, { id: noteId(3), xsecToken: 'PRIVATE_XSEC' }] });
    if (args.feed_id === noteId(1)) return json(note(1, { time: undefined, interactInfo: { likedCount: '1.2万', collectedCount: '20+', commentCount: '3', sharedCount: -1 } }));
    if (args.feed_id === noteId(2)) return json(note(3));
    return { isError: true, content: [{ type: 'text', text: 'PRIVATE_UPSTREAM_TOKEN' }] };
  });
  const result = await f.mcp.researchSearch(req, { queries: ['校园'], at: AT });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].publishedAt, ''); assert.deepEqual(result.items[0].metrics, { likes: null, comments: 3, favorites: null, shares: null });
  assert.equal(result.reports[0].status, 'ok'); assert.match(result.reports[0].message, /2 条详情/); assert(!JSON.stringify(result).includes('PRIVATE_'));
  assert.throws(() => xhsMCPResearchItem(note(1), noteId(2), { at: AT }), /编号/);
});

test('MCP honors existing platform lock and abort callbacks before further detail calls', async () => {
  let release, started; const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  const f = fixture(async name => { if (name === 'check_login_status') return login(); started(); await pending; return json({ feeds: [] }); });
  const first = f.mcp.researchSearch(req, { queries: ['校园'], at: AT }); await entered;
  const second = await f.mcp.researchSearch(req, { queries: ['生活'], at: AT }); assert.equal(second.reports[0].status, 'failed'); assert.match(second.reports[0].message, /其他任务/);
  release(); await first; assert.equal(f.calls.filter(c => c.name === 'search_feeds').length, 1);
  const conflict = Object.assign(new Error('changed'), { status: 409 }); let checks = 0;
  await assert.rejects(f.mcp.researchSearch(req, { queries: ['校园'], at: AT, assertActive: () => { if (++checks === 3) throw conflict; } }), error => error === conflict);
  assert.equal(f.calls.filter(c => c.name === 'search_feeds').length, 1);
});
