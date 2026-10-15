import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';

// All tool transports, identities, credentials, comments and write receipts are
// synthetic. Only the local test HTTP server is contacted; no platform is called.
const tool = (name, required = []) => ({ name, inputSchema: { type: 'object', required } });
const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const words = text => ({ content: [{ type: 'text', text }] });
const platforms = ['xiaohongshu', 'douyin', 'youtube', 'instagram', 'tiktok'];
const ytTools = [tool('youtube_channels_list'), tool('youtube_comment_threads_list'), tool('youtube_search', ['q']), tool('youtube_videos_list'), tool('youtube_videos_insert', ['title', 'filePath'])];
const igTools = [tool('instagram_get_account'), tool('instagram_list_media'), tool('instagram_list_comments', ['mediaId']), tool('instagram_post_image'), tool('instagram_post_reel')];
const ttTools = [tool('get_profile'), tool('get_creator_info'), tool('post_video', ['video_url', 'privacy_level']), tool('post_photos', ['photo_urls', 'privacy_level'])];
const dyWriteTools = [tool('douyin_account_status', ['account']), tool('douyin_publish_note', ['account', 'images', 'title']), tool('douyin_publish_video', ['account', 'file', 'title'])];
const dyReadTools = [tool('douyin_comments', ['url']), tool('douyin_search', ['keyword']), tool('douyin_video', ['url'])];
const videoId = 'abcdefghijk', dyId = '7585164848590687525', published = '2026-10-14T08:00:00Z';
const ytURL = `https://www.youtube.com/watch?v=${videoId}`, dyURL = `https://www.douyin.com/video/${dyId}`;
const imageData = 'data:image/png;base64,' + readFileSync('public/icon-192.png').toString('base64');
const videoData = 'data:video/mp4;base64,' + Buffer.from('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0000\u0000', 'binary').toString('base64');
const privateKey = platform => `synthetic-${platform}-private-access-key`;
const vault = () => { let value = ''; return { status: () => ({ configured: !!value, supported: true }), getKey: async () => value, save: async next => { value = next; } }; };
const localReq = { socket: { remoteAddress: '127.0.0.1' }, get: name => name === 'Host' ? '127.0.0.1:4340' : undefined };

async function fixture(t) {
  const root = resolve(await mkdtemp(join(tmpdir(), 'studio-matrix-integration-'))), store = createStore(':memory:'), calls = [], transport = [], services = new Map();
  const vaults = Object.fromEntries(platforms.map(platform => [platform, vault()]));
  const app = createApp(store, { mcpVaults: vaults, mcpTempRoot: root, mcpFetcher: async (url, init) => {
    const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(init.redirect, 'error');
    const service = services.get(target.port); assert(service, `unconfigured synthetic service ${target.port}`);
    assert.equal(init.headers.Authorization || '', service.key ? `Bearer ${service.key}` : '');
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const request = JSON.parse(init.body); transport.push({ port: target.port, method: request.method });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} } };
    else if (request.method === 'tools/list') result = { tools: service.tools };
    else { assert.equal(request.method, 'tools/call'); assert(service.tools.some(item => item.name === request.params.name), 'unadvertised upstream tool'); const call = { port: target.port, name: request.params.name, args: request.params.arguments }; calls.push(call); result = await service.onCall(call.name, call.args); }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close();
    assert.equal(dirname(root), resolve(tmpdir())); assert(basename(root).startsWith('studio-matrix-integration-'));
    await rm(root, { recursive: true, force: true });
  });
  async function req(path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  function service(port, tools, onCall = () => assert.fail('no tool calls expected'), key = '') { services.set(String(port), { tools, onCall, key }); return `http://127.0.0.1:${port}/mcp`; }
  async function connect(platform, port, options = {}) { const result = await req(`/mcp/${platform}`, { mode: 'external', endpoint: `http://127.0.0.1:${port}/mcp`, ...options }, 'PUT'); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; }
  function publication(platform, changes = {}) {
    const pub = { id: randomUUID(), sample: false, status: 'scheduled', platform, assetId: 'fixture-asset', assetRevision: 1, strategyId: 'fixture-strategy', accountId: `mcp-${platform}-default`, accountName: '隔离测试账号', scheduledAt: new Date().toISOString(), title: '学习方法测试', body: '真实步骤与适用条件。', mime: 'image/png', mediaData: imageData, url: '', ...changes };
    store.mutate(state => state.projects[0].publications.push(pub));
    return { pub, base: `/projects/${store.get().projects[0].id}/publications/${pub.id}/mcp`, current: () => store.get().projects[0].publications.find(item => item.id === pub.id), input: { confirmed: true, expectedRevision: 1, title: pub.title, body: pub.body, accountId: 'default' } };
  }
  return { app, req, service, connect, publication, calls, transport, store, vaults, root };
}

test('all five platform credentials stay in the local vault boundary and new platforms reject built-in/remote configuration', async t => {
  const f = await fixture(t);
  for (const [index, platform] of platforms.entries()) {
    const result = await f.connect(platform, 19200 + index, { apiKey: privateKey(platform), remoteAccount: 'campus' });
    assert.equal(result.tokenConfigured, true);
    const saved = JSON.parse(await f.vaults[platform].getKey()); assert.equal(saved.accounts[0].apiKey, privateKey(platform));
    assert(!JSON.stringify(f.store.get()).includes(privateKey(platform)));
  }
  for (const path of ['/mcp/settings', '/state', '/backup']) {
    const result = await f.req(path); assert.equal(result.status, 200);
    for (const platform of platforms) assert(!JSON.stringify(result).includes(privateKey(platform)));
  }
  for (const platform of ['youtube', 'instagram', 'tiktok']) {
    assert.equal((await f.req(`/mcp/${platform}`, { mode: 'builtin' }, 'PUT')).status, 400);
    const remote = await f.req(`/mcp/${platform}`, { mode: 'external', endpoint: 'https://external.example.com/mcp' }, 'PUT'); assert.equal(remote.status, 502); assert.match(remote.data.error, /本机 MCP 地址/);
    assert.equal((await f.req(`/mcp/${platform}/check`, {}, 'POST', { Origin: 'https://other.example.com' })).status, 403);
  }
  await f.connect('youtube', 19300);
  assert.equal(JSON.parse(await f.vaults.youtube.getKey()).accounts[0].apiKey, '', 'credential cannot silently follow a changed service URL');
  assert.equal(f.transport.length, 0); assert.equal(f.calls.length, 0);
});

test('stale account requests stop before any upstream tool or media staging', async t => {
  const f = await fixture(t); f.service(19210, ytTools); await f.connect('youtube', 19210);
  const work = f.publication('youtube', { mime: 'video/mp4', mediaData: videoData });
  const next = await f.req('/mcp/youtube/accounts', { name: '另一频道' }); assert.equal(next.status, 201);
  const second = next.data.accountId; f.service(19211, ytTools); await f.connect('youtube', 19211, { accountId: second });
  assert.equal((await f.req('/mcp/youtube/check', { accountId: 'default' })).status, 409);
  assert.equal((await f.req(work.base + '/publish', { ...work.input, privacy: 'private' })).status, 409);
  f.store.mutate(state => Object.assign(state.projects[0].publications.find(pub => pub.id === work.pub.id), { status: 'published', url: ytURL }));
  assert.equal((await f.req(work.base + '/comments', { accountId: 'default' })).status, 409);
  assert.equal(f.calls.length, 0); assert.equal(f.transport.length, 0); assert.deepEqual(await readdir(f.root), []);
});

test('YouTube comments use a server-bound preview, retain work/account ownership and deduplicate repeated imports', async t => {
  const f = await fixture(t);
  const top = (id, text) => ({ id: `thread-${id}`, snippet: { videoId, topLevelComment: { id, snippet: { textOriginal: text, publishedAt: published, likeCount: 0, authorDisplayName: 'PRIVATE_AUTHOR' } } }, replies: { comments: [{ id: `reply-${id}`, snippet: { parentId: id, textOriginal: '我也想了解 ✨', publishedAt: published, likeCount: 2, authorDisplayName: 'PRIVATE_REPLY_AUTHOR' } }] } });
  f.service(19220, ytTools, (name, args) => { assert.equal(name, 'youtube_comment_threads_list'); assert.equal(args.videoId, videoId); assert.equal(args.part, 'snippet,replies'); return json({ items: [top('c1', '如何预约学习搭子？'), top('c1', '重复返回不会重复导入')] }); });
  await f.connect('youtube', 19220); const work = f.publication('youtube', { status: 'published', url: ytURL });
  const input = { accountId: 'default', includeReplies: true, limit: 20 };
  const first = await f.req(work.base + '/comments', input); assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.data.rows.length, 2); assert(first.data.previewId);
  assert(!JSON.stringify(first).includes('PRIVATE_')); assert.equal(first.data.rows[0].likes, 0);
  assert.equal((await f.req(work.base + '/comments/import', { previewId: first.data.previewId, confirmed: false, indices: [0] })).status, 400);
  const added = await f.req(work.base + '/comments/import', { previewId: first.data.previewId, confirmed: true, indices: [0, 1, 1] }); assert.equal(added.status, 200, JSON.stringify(added)); assert.equal(added.data.result.added, 2);
  f.store.mutate(state => { const comment = state.projects[0].comments.find(item => item.publicationId === work.pub.id && item.platformCommentId === 'c1'); comment.correctedAt = 'manual'; comment.tags = ['预约意愿']; });
  const second = await f.req(work.base + '/comments', input), duplicate = await f.req(work.base + '/comments/import', { previewId: second.data.previewId, confirmed: true, indices: [0, 1] });
  assert.equal(duplicate.data.result.duplicates, 2); const rows = f.store.get().projects[0].comments.filter(item => item.publicationId === work.pub.id); assert.equal(rows.length, 2);
  assert(rows.every(row => row.platform === 'youtube' && row.source === 'mcp')); assert.equal(rows[0].correctedAt, 'manual'); assert.deepEqual(rows[0].tags, ['预约意愿']);
  assert(f.calls.every(call => call.name === 'youtube_comment_threads_list'));
});

test('Instagram refuses missing/non-public media before dispatch and without leaving an attempted publication', async t => {
  const f = await fixture(t); f.service(19230, igTools); await f.connect('instagram', 19230, { remoteAccount: 'campus' }); const work = f.publication('instagram');
  for (const extra of [{}, { publicMediaUrl: 'https://127.0.0.1/image.png' }, { publicMediaUrl: 'file:///C:/image.png' }]) {
    const result = await f.req(work.base + '/publish', { ...work.input, ...extra }); assert.equal(result.status, 400, JSON.stringify(result)); assert.equal(work.current().delivery, undefined);
  }
  assert.equal(f.calls.length, 0); assert.deepEqual(await readdir(f.root), []);
});

function ttAccount(identity = 'open-id-a') { return { identity, creator: { creator_nickname: 'Campus', creator_username: 'campus', privacy_level_options: ['SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: 60 } }; }
function ttInput(work, preflightId) { return { ...work.input, preflightId, publicMediaUrl: 'https://media.example.com/fixture.mp4', privacy: 'SELF_ONLY', brandOrganic: true, brandContent: false, aiGenerated: true, allowComments: false, allowDuet: false, allowStitch: false, musicConfirmed: true, durationSeconds: 20 }; }
async function ttFixture(t) {
  const f = await fixture(t), account = ttAccount();
  const handler = (name, args) => { assert.equal(args.account, 'campus'); if (name === 'get_profile') return json({ open_id: account.identity }); if (name === 'get_creator_info') return json(account.creator); assert.equal(name, 'post_video'); return json({ publish_id: 'synthetic-publish-job' }); };
  f.service(19240, ttTools, handler); await f.connect('tiktok', 19240, { remoteAccount: 'campus' });
  const work = f.publication('tiktok', { mime: 'video/mp4', mediaData: videoData });
  const preflight = await f.req('/mcp/tiktok/publish-options', { accountId: 'default' }); assert.equal(preflight.status, 200, JSON.stringify(preflight));
  return { ...f, work, account, handler, preflight: preflight.data };
}

test('TikTok server-side preflight prevents injected permissions, stale connection/account and duplicate writes', async t => {
  const f = await ttFixture(t), input = ttInput(f.work, f.preflight.preflightId);
  assert.equal(f.preflight.accountIdentity, 'open-id-a'); assert.deepEqual(f.preflight.privacyOptions, ['SELF_ONLY']);
  assert.equal((await f.req(f.work.base + '/publish', { ...input, privacyOptions: ['PUBLIC_TO_EVERYONE'] })).status, 400);
  assert.equal((await f.req(f.work.base + '/publish', { ...input, preflightId: randomUUID() })).status, 409);
  assert.equal((await f.req(f.work.base + '/publish', { ...input, privacy: 'PUBLIC_TO_EVERYONE' })).status, 400);
  assert.equal((await f.req(f.work.base + '/publish', { ...input, allowDuet: true })).status, 400);
  assert.equal(f.calls.filter(call => call.name === 'post_video').length, 0); assert.equal(f.work.current().delivery, undefined);
  f.service(19241, ttTools, f.handler); await f.connect('tiktok', 19241, { remoteAccount: 'campus' });
  assert.equal((await f.req(f.work.base + '/publish', input)).status, 409, 'changing service endpoint invalidates previous authorization snapshot');
  const refreshed = await f.req('/mcp/tiktok/publish-options', { accountId: 'default' }); assert.equal(refreshed.status, 200);
  const valid = ttInput(f.work, refreshed.data.preflightId), sent = await f.req(f.work.base + '/publish', valid); assert.equal(sent.status, 200, JSON.stringify(sent));
  const writes = f.calls.filter(call => call.name === 'post_video'); assert.equal(writes.length, 1); assert.equal(writes[0].port, '19241'); assert.equal(writes[0].args.privacy_level, 'SELF_ONLY'); assert.equal(writes[0].args.confirm, true); assert.equal(writes[0].args.brand_organic_toggle, true); assert.equal(writes[0].args.disable_duet, true);
  assert.equal(f.work.current().delivery.phase, 'submitting'); assert.equal(f.work.current().status, 'scheduled');
  assert.equal((await f.req(f.work.base + '/publish', valid)).status, 409); assert.equal(f.calls.filter(call => call.name === 'post_video').length, 1); assert.deepEqual(await readdir(f.root), []);
});

test('TikTok refuses a prior preflight after the service changes its OAuth identity or allowed permissions', async t => {
  for (const drift of ['identity', 'permissions']) await t.test(drift, async t => {
    const f = await ttFixture(t);
    if (drift === 'identity') f.account.identity = 'open-id-b'; else f.account.creator.privacy_level_options = ['PUBLIC_TO_EVERYONE'];
    const result = await f.req(f.work.base + '/publish', ttInput(f.work, f.preflight.preflightId));
    assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(f.calls.filter(call => call.name === 'post_video').length, 0); assert.equal(f.work.current().delivery, undefined); assert.deepEqual(await readdir(f.root), []);
  });
});

test('TikTok preflight expires and cannot transfer to another locally selected matrix account', async t => {
  const expired = await ttFixture(t), originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 11 * 60000;
    assert.equal((await expired.req(expired.work.base + '/publish', ttInput(expired.work, expired.preflight.preflightId))).status, 409);
  } finally { Date.now = originalNow; }
  assert.equal(expired.calls.filter(call => call.name === 'post_video').length, 0);
  const switched = await ttFixture(t), created = await switched.req('/mcp/tiktok/accounts', { name: '第二校园账号' }); assert.equal(created.status, 201);
  const accountId = created.data.accountId; switched.service(19241, ttTools, switched.handler); await switched.connect('tiktok', 19241, { accountId, remoteAccount: 'campus' });
  switched.store.mutate(state => { state.projects[0].publications.find(pub => pub.id === switched.work.pub.id).accountId = `mcp-tiktok-${accountId}`; });
  const result = await switched.req(switched.work.base + '/publish', { ...ttInput(switched.work, switched.preflight.preflightId), accountId });
  assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(switched.calls.filter(call => call.name === 'post_video').length, 0); assert.equal(switched.work.current().delivery, undefined);
});

test('Douyin keeps one matrix account while routing publish and collection to separate services', async t => {
  const f = await fixture(t), writeKey = 'synthetic-douyin-write-key', readKey = 'synthetic-douyin-read-key';
  f.service(19250, dyWriteTools, (name, args) => { assert.equal(name, 'douyin_publish_note'); return args.confirm ? words('synthetic submission accepted') : words('plan_id="abcd1234abcd"'); }, writeKey);
  f.service(19251, dyReadTools, (name, args) => {
    if (name === 'douyin_comments') { assert.equal(args.url, dyURL); return json({ aweme_id: dyId, items: [{ comment_id: 'dy-comment-1', text: '这个学习搭子如何报名？', likes: 3, published_at: published }] }); }
    if (name === 'douyin_search') return json({ items: [{ aweme_id: dyId, url: dyURL, likes: 120 }] });
    assert.equal(name, 'douyin_video'); return json({ aweme_id: dyId, url: dyURL, description: '学习搭子计划与步骤', published_at: published, likes: 120, comments: 8, collects: 6, shares: 3 });
  }, readKey);
  await f.connect('douyin', 19250, { apiKey: writeKey, readEndpoint: 'http://127.0.0.1:19251/mcp', readApiKey: readKey });
  const checked = await f.req('/mcp/douyin/check', { accountId: 'default' }); assert.equal(checked.status, 200, JSON.stringify(checked));
  for (const capability of ['image', 'video', 'comments', 'search']) assert.equal(checked.data.capabilities[capability], true, capability);
  const own = f.publication('douyin', { status: 'published', url: dyURL }); const preview = await f.req(own.base + '/comments', { accountId: 'default' }); assert.equal(preview.status, 200, JSON.stringify(preview)); assert.equal(preview.data.rows.length, 1);
  const research = await f.app.locals.integrations.mcpResearchSearch(localReq, { platform: 'douyin', accountId: 'default', queries: ['学习搭子'], at: '2026-10-15T12:00:00Z', discovery: { platform: 'douyin', timeRange: 'week', sortBy: 'likes', noteType: 'all' } });
  assert.equal(research.items.length, 1); assert.equal(research.items[0].sourceAccountId, 'default'); assert(f.calls.filter(call => ['douyin_comments', 'douyin_search', 'douyin_video'].includes(call.name)).every(call => call.port === '19251'));
  const draft = f.publication('douyin'), publishedResult = await f.req(draft.base + '/publish', draft.input); assert.equal(publishedResult.status, 200, JSON.stringify(publishedResult));
  const writes = f.calls.filter(call => call.name === 'douyin_publish_note'); assert.equal(writes.length, 2); assert.deepEqual(writes.map(call => call.args.confirm), [false, true]); assert(writes.every(call => call.port === '19250'));
  assert.equal(draft.current().delivery.phase, 'submitting'); assert.equal((await f.req(draft.base + '/publish', draft.input)).status, 409);
  const settings = await f.req('/mcp/settings'); assert(!JSON.stringify(settings).includes(writeKey)); assert(!JSON.stringify(settings).includes(readKey)); assert.deepEqual(await readdir(f.root), []);
});
