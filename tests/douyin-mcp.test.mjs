import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { douyinMCPLogin, douyinMCPPlan } from '../server/douyin-mcp-adapter.mjs';

// Contract fixtures from panwenda/douyin-publish-mcp 0.3.6, commit
// 63c15b9d4ea73ce91111adab8b1c2befc6d09de6/src/douyin_publish_mcp/server.py.
// Descriptions are omitted; required fields, property names and types are preserved.
const str = { type: 'string' }, bool = { type: 'boolean' }, num = { type: 'number' };
const strings = { type: 'array', items: str };
const schema = (name, required, properties) => ({ name, inputSchema: { type: 'object', required, properties, additionalProperties: false } });
const tools = [
  schema('douyin_account_status', ['account'], { account: str }),
  schema('douyin_account_login', ['account'], { account: str, headed: bool, wait_seconds: num, force: bool }),
  schema('douyin_account_logout', ['account'], { account: str, confirm: bool }),
  schema('douyin_publish_video', ['account', 'file', 'title'], { account: str, file: str, title: str, description: str, tags: strings, schedule: str, thumbnail_portrait: str, thumbnail_landscape: str, product_link: str, product_title: str, declaration: str, collection: str, plan_id: str, confirm: bool }),
  schema('douyin_publish_note', ['account', 'images', 'title'], { account: str, images: strings, title: str, note: str, note_file: str, bgm: str, tags: strings, schedule: str, plan_id: str, confirm: bool }),
  schema('douyin_search_videos', ['keyword'], { keyword: str, count: num, sort: { ...str, enum: ['general', 'like', 'latest'] }, publish_time: { ...str, enum: ['all', 'day', 'week', 'half_year'] }, account: str }),
  schema('douyin_video_detail', ['aweme_id'], { aweme_id: str, account: str }),
  schema('douyin_user_profile', ['sec_user_id'], { sec_user_id: str, include_videos: bool, limit: num, account: str }),
  schema('douyin_my_profile', [], { include_videos: bool, limit: num, account: str }),
  schema('douyin_parse_share_link', ['share_text'], { share_text: str, account: str }),
];
const text = value => ({ content: [{ type: 'text', text: value }], isError: false });
const planId = 'abcd1234abcd';
function preflight(args, fingerprint = planId) {
  const plan = { kind: args.images ? 'note' : 'video', ...args };
  delete plan.confirm;
  return text(`这是**待发布的${args.images ? '图文' : '视频'}计划**（本地预检通过，**还没有发给抖音**）：\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\n请把上面这份计划逐项念给用户确认（尤其是账号、素材、标题、正文、发布时间）。\n用户明确同意后，用 plan_id="${fingerprint}" 且 confirm=true 再调用一次；\n任何一项要改，就重新调用本工具生成新计划（不要自己改 plan_id）。`);
}
function mockMCP(onCall, items = tools, methods = []) {
  return async (_url, init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const request = JSON.parse(init.body); methods.push(request.method);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'douyin-publish-mcp', version: '0.3.6' } };
    else if (request.method === 'tools/list') result = { tools: items };
    else {
      assert.equal(request.method, 'tools/call');
      const tool = items.find(item => item.name === request.params.name);
      assert(tool, 'unexpected upstream tool');
      const args = request.params.arguments;
      for (const field of tool.inputSchema.required) assert(Object.hasOwn(args, field), `missing ${field}`);
      for (const [key, value] of Object.entries(args)) {
        const property = tool.inputSchema.properties[key];
        assert(property, `unsupported upstream argument ${key}`);
        assert.equal(Array.isArray(value) ? 'array' : typeof value, property.type, `invalid ${key}`);
        if (property.enum) assert(property.enum.includes(value));
        if (property.type === 'array') assert(value.every(item => typeof item === 'string'));
      }
      result = await onCall(request.params.name, args);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: request.method === 'initialize' ? { 'Mcp-Session-Id': 'douyin-synthetic-session' } : {} });
  };
}
const vault = () => { let value = ''; return { status: () => ({ supported: true, configured: !!value }), getKey: async () => value, save: async v => { value = v; } }; };
async function fixture(t, onCall, { items = tools } = {}) {
  const tempRoot = resolve(await mkdtemp(join(tmpdir(), 'studio-douyin-mcp-test-')));
  const store = createStore(':memory:'), methods = [];
  const app = createApp(store, { mcpVaults: { xiaohongshu: vault(), douyin: vault() }, mcpFetcher: mockMCP(onCall, items, methods), mcpTempRoot: tempRoot });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close();
    assert.equal(dirname(tempRoot), resolve(tmpdir())); assert(basename(tempRoot).startsWith('studio-douyin-mcp-test-'));
    await rm(tempRoot, { recursive: true, force: true });
  });
  const req = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const project = store.get().projects[0], publication = { id: 'douyin-mcp-pub', sample: false, status: 'scheduled', platform: 'douyin', assetId: 'fixture-asset', assetRevision: 1, strategyId: 'fixture-strategy', accountId: 'fixture-account', accountName: '测试账号', scheduledAt: new Date().toISOString(), title: '测试标题', body: '真实正文', mime: 'image/png', mediaData: 'data:image/png;base64,' + readFileSync('public/icon-192.png').toString('base64'), url: '' };
  store.mutate(state => state.projects[0].publications.push(publication));
  assert.equal((await req('/mcp/douyin', { mode: 'external', endpoint: 'http://127.0.0.1:18080/mcp' }, 'PUT')).status, 200);
  return { req, store, methods, tempRoot, publication, base: `/projects/${project.id}/publications/${publication.id}/mcp`, current: () => store.get().projects[0].publications.find(item => item.id === publication.id), input: { confirmed: true, expectedRevision: 1, title: '测试标题', body: '真实正文' } };
}

test('Douyin adapter reads the actual upstream plan sentence and refuses ambiguous or body-only fingerprints', () => {
  assert.equal(douyinMCPPlan(preflight({ account: 'main', title: '测试', description: 'plan_id="111111111111"' })), planId);
  assert.equal(douyinMCPPlan(text(`plan_id="${planId}"`)), planId);
  for (const value of [text('没有计划'), text('正文 plan_id="abcd1234abcd"'), preflight({}, 'not-a-valid-id'), text(`${preflight({}).content[0].text}\nplan_id="111111111111"`)]) assert.throws(() => douyinMCPPlan(value), /没有提交/);
  assert.equal(douyinMCPLogin(text('logged_in=None\n曾经已登录')), 'unknown');
  assert.equal(douyinMCPLogin(text('账号资料：logged_in=True')), 'unknown');
});

test('Douyin connection reports the supported upstream capabilities without invoking account tools', async t => {
  const f = await fixture(t, () => assert.fail('connection must not call any tools'));
  const response = await f.req('/mcp/douyin/check', {});
  assert.equal(response.status, 200); assert.equal(response.data.connected, true); assert.equal(response.data.toolCount, 10);
  assert.deepEqual(response.data.capabilities, { image: true, video: true, comments: false, search: false, login: true, loginStatus: true });
  assert.deepEqual(f.methods, ['initialize', 'notifications/initialized', 'tools/list']);
});

test('Douyin rejects an accidentally configured Xiaohongshu server', async t => {
  const f = await fixture(t, () => assert.fail('wrong service must not execute a tool'), { items: [schema('check_login_status', [], {}), schema('publish_content', ['title', 'content', 'images'], { title: str, content: str, images: strings })] });
  const response = await f.req('/mcp/douyin/check', {});
  assert.equal(response.status, 502); assert.match(response.data.error, /不能把小红书服务地址填到抖音/);
  const settings = await f.req('/mcp/settings'); assert.equal(settings.data.platforms.find(p => p.platform === 'douyin').connected, false);
});

test('Douyin true, false and unknown login results do not reveal upstream account details', async t => {
  let state = 'True';
  const privateText = 'private-account-name sessionid=synthetic-only-private-cookie C:/private/credentials.json';
  const f = await fixture(t, (name, args) => { assert.equal(name, 'douyin_account_status'); assert.deepEqual(args, { account: 'main' }); return text(`账号「main」状态\nlogged_in=${state}\n${privateText}`); });
  for (const [upstream, expected] of [['True', 'logged-in'], ['False', 'not-logged-in'], ['None', 'unknown']]) {
    state = upstream; const response = await f.req('/mcp/douyin/login-status', {});
    assert.equal(response.status, 200); assert.equal(response.data.loginState, expected); assert(!JSON.stringify(response).includes(privateText)); assert(!JSON.stringify(response).includes('synthetic-only-private-cookie'));
  }
});

test('Douyin login displays only the bounded QR image and reuses the documented headed session', async t => {
  const data = readFileSync('public/icon-192.png').toString('base64');
  let badImage = false;
  const f = await fixture(t, (name, args) => {
    assert.equal(name, 'douyin_account_login'); assert.deepEqual(args, { account: 'main', headed: true, wait_seconds: 2, force: false });
    return { content: [{ type: 'image', mimeType: badImage ? 'image/svg+xml' : 'image/png', data }, { type: 'text', text: '正在等扫码 private-account-log C:/private/credentials.json' }] };
  });
  const response = await f.req('/mcp/douyin/login', {});
  assert.equal(response.status, 200); assert.equal(response.data.image, `data:image/png;base64,${data}`); assert(!JSON.stringify(response).includes('private-account-log'));
  badImage = true; const invalid = await f.req('/mcp/douyin/login', {}); assert.equal(invalid.status, 200); assert.equal(invalid.data.image, undefined); assert.match(invalid.data.note, /官方浏览器窗口/);
});

test('Douyin external comments explicitly direct the user to the built-in page helper without silently calling it', async t => {
  const f = await fixture(t, () => assert.fail('unsupported comments must not call any tool'));
  f.store.mutate(state => Object.assign(state.projects[0].publications.find(p => p.id === f.publication.id), { status: 'published', url: 'https://www.douyin.com/video/7585164848590687525' }));
  const response = await f.req(f.base + '/comments', {});
  assert.equal(response.status, 400); assert.match(response.data.error, /未提供评论工具/); assert.match(response.data.error, /应用自带页面助手/);
  assert(!f.methods.includes('tools/call'));
});

test('Douyin publishing without explicit confirmation performs no MCP calls and stages no media', async t => {
  const f = await fixture(t, () => assert.fail('unconfirmed publish must not execute a tool'));
  const response = await f.req(f.base + '/publish', { ...f.input, confirmed: false });
  assert.equal(response.status, 400); assert.deepEqual(f.methods, []); assert.equal(f.current().delivery, undefined); assert.deepEqual(await readdir(f.tempRoot), []);
});

test('Douyin preflight errors or missing fingerprints never journal or submit and remove temporary media', async t => {
  for (const kind of ['upstream-error', 'missing-plan']) await t.test(kind, async t => {
    let calls = 0, staged;
    const f = await fixture(t, (name, args) => {
      calls++; assert.equal(name, 'douyin_publish_note'); assert.equal(args.confirm, false); staged = args.images[0]; assert(existsSync(staged)); assert.equal(f.current().delivery, undefined);
      return kind === 'upstream-error' ? { ...text('private-preflight-output C:/private/media.png'), isError: true } : text('未返回发布计划');
    });
    const response = await f.req(f.base + '/publish', f.input);
    assert.equal(response.status, 502); assert.equal(calls, 1); assert.equal(f.current().delivery, undefined); assert(!existsSync(staged)); assert.deepEqual(await readdir(f.tempRoot), []); assert(!JSON.stringify(response).includes('private-preflight-output'));
    assert.equal((await f.req('/mcp/douyin/check', {})).status, 200, 'platform task lock must be released');
  });
});

test('Douyin image and video submissions preserve exact preflight arguments, journal before dispatch, and clean media', async t => {
  for (const kind of ['image', 'video']) await t.test(kind, async t => {
    const calls = []; let staged;
    const f = await fixture(t, (name, args) => {
      calls.push({ name, args }); staged = args.images?.[0] || args.file; assert(existsSync(staged));
      assert.equal(name, kind === 'image' ? 'douyin_publish_note' : 'douyin_publish_video');
      assert.equal(args.account, 'main'); assert.deepEqual(args.tags, []); assert.equal(args.title, f.input.title);
      assert.equal(kind === 'image' ? args.note : args.description, f.input.body);
      if (args.confirm === false) { assert.equal(f.current().delivery, undefined); return preflight(args); }
      assert.equal(args.confirm, true); assert.equal(args.plan_id, planId); assert.equal(f.current().delivery.phase, 'submitting'); assert.equal(f.current().delivery.title, f.input.title); assert.equal(f.current().delivery.body, f.input.body);
      assert.deepEqual(args, { ...calls[0].args, confirm: true, plan_id: planId });
      return text('视频已提交发布：测试标题\n这不等于作品已公开可见');
    });
    if (kind === 'video') f.store.mutate(state => Object.assign(state.projects[0].publications.find(p => p.id === f.publication.id), { mime: 'video/mp4', mediaData: 'data:video/mp4;base64,' + Buffer.from('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0000\u0000', 'binary').toString('base64') }));
    const response = await f.req(f.base + '/publish', f.input);
    assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.result.attempted, true); assert.equal(calls.length, 2); assert(!existsSync(staged)); assert.deepEqual(await readdir(f.tempRoot), []);
    assert.equal(f.current().status, 'scheduled'); assert.equal(f.current().delivery.phase, 'submitting');
    assert.equal((await f.req(f.base + '/publish', f.input)).status, 409); assert.equal(calls.length, 2);
  });
});

test('Douyin uncertain submission keeps the retry lock, never replays, hides upstream errors and cleans media', async t => {
  for (const kind of ['transport-error', 'tool-error']) await t.test(kind, async t => {
    let calls = 0, staged;
    const f = await fixture(t, (_name, args) => {
      calls++; staged = args.images[0]; assert(existsSync(staged));
      if (!args.confirm) return preflight(args);
      assert.equal(f.current().delivery.phase, 'submitting');
      if (kind === 'transport-error') throw Error('synthetic-private-submit-token');
      return { ...text('synthetic-private-submit-token'), isError: true };
    });
    const response = await f.req(f.base + '/publish', f.input);
    assert.equal(response.status, 502); assert.equal(calls, 2); assert.equal(f.current().delivery.phase, 'submitting'); assert(!JSON.stringify(response).includes('synthetic-private-submit-token'));
    assert(!existsSync(staged)); assert.deepEqual(await readdir(f.tempRoot), []);
    assert.equal((await f.req(f.base + '/publish', f.input)).status, 409); assert.equal(calls, 2);
  });
});
