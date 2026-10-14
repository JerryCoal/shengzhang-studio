import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mountMCPPlatforms, xhsMCPResearchItem } from '../server/mcp-platforms.mjs';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';

// Entire MCP transport is synthetic. No user workspace, platform login, or network.
const AT = '2026-10-14T08:00:00.000Z';
const secret = 'PRIVATE_MCP_CREDENTIAL', access = 'PRIVATE_NOTE_ACCESS';
const noteId = n => n.toString(16).padStart(24, '0');
const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const login = () => ({ content: [{ type: 'text', text: '✅ 已登录\n用户名: PRIVATE_ACCOUNT' }] });
const req = { socket: { remoteAddress: '127.0.0.1' }, get: name => name === 'Host' ? '127.0.0.1:4340' : undefined };
const settings = (extra = {}) => ({ timeRange: 'week', sortBy: 'favorites', noteType: 'all', ...extra });
const feeds = (start, length = 20) => ({ feeds: Array.from({ length }, (_, index) => ({ id: noteId(start + index), xsecToken: access, noteCard: { user: { nickname: 'PRIVATE_AUTHOR' } } })) });
const detail = (n, extra = {}) => ({ feed_id: noteId(n), data: { note: { noteId: noteId(n), title: `学习空间 ${n}`, desc: `校园学习活动 ${n}`, time: Date.parse('2026-10-10T02:00:00Z'), interactInfo: { likedCount: '1.2万', collectedCount: '20+', commentCount: '31', sharedCount: '' }, user: { nickname: 'PRIVATE_AUTHOR' }, ...extra }, comments: { list: [{ content: 'PRIVATE_COMMENT', userInfo: { nickname: 'PRIVATE_COMMENTER' } }] } } });
function fixture(onCall, { mode = 'external' } = {}) {
  const calls = [], requests = []; let closed = 0;
  const fetcher = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:18060/mcp');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    if (init.method === 'DELETE') { closed++; return new Response(null, { status: 204 }); }
    const rpc = JSON.parse(init.body); requests.push(rpc);
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18' };
    else if (rpc.method === 'tools/list') result = { tools: [
      { name: 'search_feeds', inputSchema: { type: 'object', required: ['keyword'] } },
      { name: 'get_feed_detail', inputSchema: { type: 'object', required: ['feed_id', 'xsec_token'] } },
      { name: 'check_login_status', inputSchema: { type: 'object' } },
    ] };
    else { calls.push(rpc.params); result = await onCall(rpc.params.name, rpc.params.arguments); }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
  };
  const config = { mcpFetcher: fetcher, mcpVaults: { xiaohongshu: { status: () => ({ configured: true }), getKey: async () => JSON.stringify({ mode, endpoint: 'http://127.0.0.1:18060/mcp', apiKey: secret }) } } };
  const app = { get() {}, put() {}, post() {}, delete() {} };
  const mcp = mountMCPPlatforms(app, {}, config, { project() {}, activeJobs: new Set() });
  return { mcp, config, calls, requests, get closed() { return closed; } };
}

test('real MCP status exposes saved configuration through research settings without making a platform request', async t => {
  for (const mode of ['external', 'builtin']) {
    const f = fixture(async () => { throw Error('status must not call a platform tool'); }, { mode });
    const direct = await f.mcp.researchStatus(req);
    assert.equal(direct.configured, mode === 'external');
    assert.equal(direct.supported, mode === 'external');
    assert.equal(direct.checked, false);
    const store = createStore(':memory:');
    const app = createApp(store, { profileMode: true, ...f.config });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/research/settings`, { headers: { 'X-Studio-Client': 'studio-v1' } });
    assert.equal(response.status, 200);
    const settings = await response.json();
    assert.equal(settings.mcpConfigured, mode === 'external');
    assert.equal(settings.mcpSearchSupported, mode === 'external');
    assert(!JSON.stringify(settings).includes(secret));
    assert.equal(f.requests.length, 0);
  }
});

test('XHS discovery maps only documented search filters including month overfetch for local verification', async () => {
  const times = { week: '一周内', month: '半年内', all: '不限' }, sorts = { general: '综合', likes: '最多点赞', favorites: '最多收藏', comments: '最多评论' }, types = { all: '不限', image: '图文', video: '视频' };
  for (const [timeRange, publish_time] of Object.entries(times)) for (const [sortBy, sort_by] of Object.entries(sorts)) for (const [noteType, note_type] of Object.entries(types)) {
    const f = fixture(async (name, args) => {
      if (name === 'check_login_status') return login();
      assert.equal(name, 'search_feeds');
      assert.deepEqual(args, { keyword: '校园学习', filters: { publish_time, sort_by, note_type } });
      return json({ feeds: [] });
    });
    const result = await f.mcp.researchSearch(req, { queries: ['校园学习'], at: AT, discovery: { timeRange, sortBy, noteType } });
    assert.equal(f.calls.length, 2); assert.equal(f.closed, 1);
    assert.match(result.reports[0].message, /本次关键词样本/);
    if (timeRange === 'month') assert.match(result.reports[0].message, /半年内搜索.*近 30 天/);
    if (timeRange === 'all') assert.match(result.reports[0].message, /历史笔记不代表近期热点/);
  }
});

test('XHS discovery bounds three searches and twelve details without comments, credentials or profiles', async () => {
  const queries = ['校园', '自习室', '学习搭子', '不应搜索'];
  const f = fixture(async (name, args) => {
    if (name === 'check_login_status') return login();
    if (name === 'search_feeds') return json(feeds(queries.indexOf(args.keyword) * 20 + 1));
    assert.equal(name, 'get_feed_detail');
    assert.deepEqual(Object.keys(args).sort(), ['feed_id', 'load_all_comments', 'xsec_token']);
    assert.equal(args.load_all_comments, false);
    const n = parseInt(args.feed_id, 16);
    return json(detail(n, { title: `校园学习 ${n} ${access}`, desc: `校园学习 ${n} ${secret} https://www.xiaohongshu.com/explore/${args.feed_id}?xsec_token=${access}` }));
  });
  const result = await f.mcp.researchSearch(req, { queries, at: AT, discovery: settings() });
  assert.equal(f.calls.filter(call => call.name === 'search_feeds').length, 3);
  assert.equal(f.calls.filter(call => call.name === 'get_feed_detail').length, 12);
  assert.equal(result.items.length, 12);
  assert.deepEqual(result.items[0].metrics, { likes: '1.2万', favorites: '20+', comments: 31, shares: null });
  assert.equal(result.items[0].publishedAt, '2026-10-10T02:00:00.000Z');
  assert.equal(result.items[0].collectedAt, AT);
  const serialized = JSON.stringify(result);
  for (const value of [secret, access, 'PRIVATE_AUTHOR', 'PRIVATE_ACCOUNT', 'PRIVATE_COMMENT', 'PRIVATE_COMMENTER', 'xsec_token']) assert(!serialized.includes(value), value);
  assert.equal(f.closed, 1);
});

test('XHS discovery rejects malformed or unexpected controls before connecting', async () => {
  for (const discovery of [null, [], {}, settings({ timeRange: 'yesterday' }), settings({ sortBy: '最新' }), settings({ noteType: '全部' }), { ...settings(), endpoint: 'https://other.invalid' }, { ...settings(), load_all_comments: true }]) {
    const f = fixture(async () => { throw Error('must not call'); });
    await assert.rejects(f.mcp.researchSearch(req, { queries: ['校园'], at: AT, discovery }));
    assert.equal(f.requests.length, 0);
  }
});

test('XHS discovery keeps verified partial results, deduplicates requests, and never retries failed details', async () => {
  const f = fixture(async (name, args) => {
    if (name === 'check_login_status') return login();
    if (name === 'search_feeds') {
      if (args.keyword === '失败查询') return { isError: true, content: [{ type: 'text', text: secret }] };
      return json({ feeds: [
        { id: noteId(1), xsecToken: access }, { id: noteId(2), xsecToken: access }, { id: noteId(3), xsecToken: access }, { id: noteId(1), xsecToken: access },
      ] });
    }
    if (args.feed_id === noteId(1)) return json(detail(1));
    if (args.feed_id === noteId(2)) return json(detail(99));
    return { isError: true, content: [{ type: 'text', text: 'PRIVATE_PLATFORM_ERROR' }] };
  });
  const result = await f.mcp.researchSearch(req, { queries: ['校园', '学习', '失败查询'], at: AT, discovery: settings({ timeRange: 'all' }) });
  assert.equal(result.items.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'get_feed_detail').length, 3);
  assert.equal(f.calls.filter(call => call.name === 'search_feeds').length, 3);
  assert.match(result.reports[0].message, /2 条详情未能核对/);
  assert.equal(result.reports.at(-1).status, 'failed');
  assert(!JSON.stringify(result).includes('PRIVATE_'));
});

test('XHS discovery stops at account and active-project checks before more requests', async () => {
  const loggedOut = fixture(async name => { assert.equal(name, 'check_login_status'); return { content: [{ type: 'text', text: '❌ 未登录\nPRIVATE_ACCOUNT' }] }; });
  const none = await loggedOut.mcp.researchSearch(req, { queries: ['校园'], at: AT, discovery: settings() });
  assert.equal(none.items.length, 0); assert.equal(loggedOut.calls.length, 1); assert.equal(none.reports[0].status, 'skipped');
  const conflict = Object.assign(new Error('workspace changed'), { status: 409 }); let active = true;
  const f = fixture(async (name) => { if (name === 'check_login_status') return login(); active = false; return json(feeds(1)); });
  await assert.rejects(f.mcp.researchSearch(req, { queries: ['校园'], at: AT, discovery: settings(), assertActive: () => { if (!active) throw conflict; } }), error => error === conflict);
  assert.equal(f.calls.filter(call => call.name === 'get_feed_detail').length, 0); assert.equal(f.closed, 1);
});

test('XHS compact metrics preserve display notation while rejecting nonnumeric payloads', () => {
  const result = xhsMCPResearchItem(detail(1, { interactInfo: { likedCount: '2.5w', collectedCount: '１.２万', commentCount: '1,240', sharedCount: 'PRIVATE_METRIC' } }), noteId(1), { at: AT, preserveCompactMetrics: true });
  assert.deepEqual(result.metrics, { likes: '2.5w', favorites: '１.２万', comments: '1,240', shares: null });
  const legacy = xhsMCPResearchItem(detail(1), noteId(1), { at: AT });
  assert.equal(legacy.metrics.likes, null);
  for (const invalid of ['-1', '1.2万 arbitrary', '<script>1</script>', { raw: '2万' }, Infinity]) {
    const item = xhsMCPResearchItem(detail(1, { interactInfo: { likedCount: invalid } }), noteId(1), { at: AT, preserveCompactMetrics: true });
    assert.equal(item.metrics.likes, null);
  }
});
