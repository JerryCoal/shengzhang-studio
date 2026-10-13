import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { newProject } from '../server/domain.mjs';
import { FEISHU_FIELDS, parseFeishuTarget, canonicalFields, createFeishuClient } from '../server/feishu.mjs';

const tableUrl = 'https://team.feishu.cn/base/bascnTEST12345?table=tblTEST12345';
function fakeFeishu() {
  const fields = structuredClone(FEISHU_FIELDS), records = new Map(), calls = [], creates = new Map(); let index = 0;
  const service = { fields, records, calls, creates, failNext: null, beforeCreate: null, afterCreate: null, hold: null };
  service.fetch = async (value, options) => {
    const url = new URL(value), body = options.body && JSON.parse(options.body); calls.push({ url, method: options.method, body });
    assert.equal(url.origin, 'https://open.feishu.cn'); assert.equal(options.redirect, 'error');
    if (service.failNext) { const failure = service.failNext; service.failNext = null; return Response.json(failure); }
    if (url.pathname.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'private-token-do-not-return', expire: 7200 });
    assert.equal(options.headers.Authorization, 'Bearer private-token-do-not-return');
    if (service.hold) await service.hold;
    if (url.pathname.endsWith('/fields')) {
      if (options.method === 'GET') return Response.json({ code: 0, data: { items: fields, has_more: false } });
      assert.equal(options.method, 'POST'); assert.ok(!fields.some(f => f.field_name === body.field_name)); fields.push(body);
      return Response.json({ code: 0, data: { field: body } });
    }
    if (url.pathname.endsWith('/records/search')) {
      assert.equal(body.filter.conjunction, 'and'); assert.equal(body.filter.conditions[0].field_name, '计划编号');
      return Response.json({ code: 0, data: { items: [...records.values()].filter(r => r.fields['计划编号'] === body.filter.conditions[0].value[0]), has_more: false } });
    }
    if (url.pathname.endsWith('/records') && options.method === 'POST') {
      if (service.beforeCreate) { const f = service.beforeCreate; service.beforeCreate = null; await f(); }
      const key = url.searchParams.get('client_token'); assert.match(key, /^[0-9a-f-]{36}$/);
      if (creates.has(key)) { const old = creates.get(key); assert.deepEqual(body, old.body); return Response.json({ code: 0, data: { record: old.record } }); }
      const record = { record_id: `recTEST${++index}`, fields: structuredClone(body.fields) }; records.set(record.record_id, record); creates.set(key, { body, record });
      if (service.afterCreate) { const f = service.afterCreate; service.afterCreate = null; await f(); }
      return Response.json({ code: 0, data: { record } });
    }
    const id = url.pathname.split('/').at(-1), record = records.get(id);
    if (!record) return Response.json({ code: 1254006 });
    if (options.method === 'PUT') Object.assign(record.fields, body.fields);
    return Response.json({ code: 0, data: { record } });
  };
  return service;
}
async function fixture(t, extra = {}) {
  const store = createStore(':memory:'); let credential = '';
  const vault = { status: () => ({ supported: true, configured: !!credential }), save: async value => { credential = value; }, getKey: async () => credential, remove: () => { credential = ''; } };
  const mock = fakeFeishu();
  const app = createApp(store, { feishuVault: vault, feishuFetcher: mock.fetch, ...extra });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const req = async (path, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json() };
  };
  const p = store.mutate(state => { const p = newProject({ ...state.projects[0].brief, name: '真实项目' }); state.projects.push(p); return p; });
  const add = () => store.mutate(state => {
    const project = state.projects.find(x => x.id === p.id);
    const r = { id: randomUUID(), assetId: 'asset-test', strategyId: 'strategy-test', assetRevision: 1, title: '招募计划', platform: 'xiaohongshu', accountName: '团队账号', status: 'scheduled', url: '', body: '不应上传的正文', mediaData: 'data:image/png;base64,SECRET', scheduledAt: '2026-10-12T09:00:00+08:00', sample: false };
    project.publications.push(r); return r;
  });
  const record = add();
  const connect = async () => {
    assert.equal((await req('/team/feishu', 'PUT', { appId: 'cli_test12345', appSecret: 'private-app-secret', tableUrl, expectedRevision: 0 })).status, 200);
    assert.equal((await req('/team/feishu/check', 'POST', {})).status, 200);
  };
  const sync = (body = {}) => req(`/projects/${p.id}/feishu-sync`, 'POST', { confirmed: true, ...body });
  const saved = () => store.get().projects.find(x => x.id === p.id);
  return { req, mock, app, store, p, record, add, connect, sync, saved, vault };
}

test('Feishu links reject arbitrary hosts, embedded credentials, wiki links and missing table IDs', () => {
  assert.equal(parseFeishuTarget(tableUrl + '&secret=discarded').tableUrl, tableUrl);
  for (const url of ['http://team.feishu.cn/base/bascnTEST12345?table=tblTEST12345', 'https://feishu.cn.evil.test/base/bascnTEST12345?table=tblTEST12345', 'https://user:pw@team.feishu.cn/base/bascnTEST12345?table=tblTEST12345', 'https://team.feishu.cn/wiki/abcdefghi?table=tblTEST12345', 'https://team.feishu.cn/base/bascnTEST12345']) assert.throws(() => parseFeishuTarget(url));
});
test('Feishu credentials stay in the vault, never in state, backup, status or errors', async t => {
  const f = await fixture(t); await f.connect();
  for (const path of ['/state','/backup','/team/feishu','/integrations']) assert.doesNotMatch(JSON.stringify((await f.req(path)).data), /private-app-secret|private-token-do-not-return/);
  f.mock.failNext = { code: 99991672, msg: 'leaked private-app-secret' };
  const denied = await f.req('/team/feishu/check', 'POST', {}); assert.equal(denied.status, 502); assert.match(denied.data.error, /权限/); assert.doesNotMatch(denied.data.error, /private-app-secret/);
});
test('Feishu setup adds only missing standard fields and refuses incompatible columns before mutation', async t => {
  const f = await fixture(t); f.mock.fields.splice(1); f.mock.fields.push({ field_name: '自有列', type: 1 }); await f.connect();
  assert.equal((await f.sync()).status, 400);
  assert.equal((await f.req('/team/feishu/initialize', 'POST', { confirmed: true })).status, 200);
  assert.ok(f.mock.fields.some(x => x.field_name === '自有列')); assert.equal(f.mock.records.size, 0);
  const count = f.mock.calls.length; await f.req('/team/feishu/initialize', 'POST', { confirmed: true });
  assert.ok(!f.mock.calls.slice(count).some(x => x.method === 'POST'));
  f.mock.fields.find(x => x.field_name === '负责人').type = 11;
  assert.equal((await f.req('/team/feishu/initialize', 'POST', { confirmed: true })).status, 400);
});
test('Feishu sync creates one row, preserves team-managed columns, and updates confirmed publication status', async t => {
  const f = await fixture(t); await f.connect();
  await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: false, owner: '小陈' });
  assert.equal((await f.sync()).status, 200); const remote = [...f.mock.records.values()][0];
  assert.equal(remote.fields['负责人'], '小陈'); assert.equal(remote.fields['计划发布时间'], Date.parse(f.record.scheduledAt));
  assert.doesNotMatch(JSON.stringify(remote), /不应上传|SECRET/);
  remote.fields['负责人'] = '队友'; remote.fields['团队备注'] = '已核对'; remote.fields['额外列'] = '保留';
  assert.equal((await f.sync({ recordId: f.record.id })).status, 200); assert.equal(f.mock.records.size, 1);
  const confirmed = await f.req(`/projects/${f.p.id}/publications/${f.record.id}/confirm`, 'POST', { url: 'https://www.xiaohongshu.com/explore/123456', confirmed: true }); assert.equal(confirmed.status, 200);
  assert.equal((await f.sync()).status, 200); assert.equal(remote.fields['发布状态'], '已发布'); assert.equal(remote.fields['作品链接'].link, 'https://www.xiaohongshu.com/explore/123456');
  assert.equal(remote.fields['负责人'], '队友'); assert.equal(remote.fields['团队备注'], '已核对'); assert.equal(remote.fields['额外列'], '保留');
  assert.ok(!f.mock.calls.some(x => !x.url.hostname.endsWith('feishu.cn')));
});
test('rescheduling uses optimistic time comparison and syncs cancellation without deleting rows', async t => {
  const f = await fixture(t); await f.connect(); await f.sync();
  const path = `/projects/${f.p.id}/publications/${f.record.id}`;
  assert.equal((await f.req(path, 'PATCH', { scheduledAt: '2026-10-13T09:00:00+08:00', expectedScheduledAt: 'wrong' })).status, 409);
  assert.equal((await f.req(path, 'PATCH', { scheduledAt: '2026-10-13T09:00:00+08:00', expectedScheduledAt: f.record.scheduledAt })).status, 200);
  await f.sync(); assert.equal([...f.mock.records.values()][0].fields['计划发布时间'], Date.parse('2026-10-13T09:00:00+08:00'));
  await f.req(path, 'PATCH', { status: 'cancelled' }); await f.sync();
  assert.equal([...f.mock.records.values()][0].fields['发布状态'], '已取消'); assert.equal(f.mock.records.size, 1);
});
test('remote owned-field changes pause writes and overwrite consent is tied to the inspected remote snapshot', async t => {
  const f = await fixture(t); await f.connect(); await f.sync(); const remote = [...f.mock.records.values()][0];
  remote.fields['标题'] = '团队改过的标题';
  assert.equal((await f.sync({ recordId: f.record.id })).status, 409);
  let s = f.saved().publications[0].feishuSync; assert.equal(s.status, 'conflict'); assert.ok(s.conflicts.includes('标题'));
  remote.fields['标题'] = '团队又改了一次';
  assert.equal((await f.sync({ recordId: f.record.id, overwriteConflict: true, expectedRemoteHash: s.remoteHash })).status, 409);
  assert.equal(remote.fields['标题'], '团队又改了一次');
  s = f.saved().publications[0].feishuSync;
  assert.equal((await f.sync({ recordId: f.record.id, overwriteConflict: true, expectedRemoteHash: s.remoteHash })).status, 200);
  assert.equal(remote.fields['标题'], f.record.title); assert.equal(f.mock.records.size, 1);
});
test('uncertain creation recovers by stable plan ID and local edits wait for the old request to resolve', async t => {
  const f = await fixture(t); await f.connect(); f.mock.afterCreate = async () => { throw new Error('socket closed'); };
  assert.equal((await f.sync()).status, 502); assert.equal(f.mock.records.size, 1);
  const key = f.saved().publications[0].feishuSync.pending.clientToken;
  f.store.mutate(state => { state.projects.find(p => p.id === f.p.id).publications[0].title = '本地新标题'; });
  assert.equal((await f.sync()).status, 200); assert.equal(f.mock.records.size, 1);
  assert.equal([...f.mock.creates.keys()][0], key); assert.equal([...f.mock.records.values()][0].fields['标题'], f.record.title);
  await f.sync(); assert.equal([...f.mock.records.values()][0].fields['标题'], '本地新标题');
});
test('retrying a lost create request keeps the same key and body even when the default owner changes', async t => {
  const f = await fixture(t); await f.connect(); await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { owner: '甲', autoSync: false });
  f.mock.beforeCreate = async () => { throw new Error('offline'); }; await f.sync();
  const first = f.mock.calls.filter(x => x.url.pathname.endsWith('/records') && x.method === 'POST')[0];
  await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { owner: '乙', autoSync: false });
  await f.sync(); const last = f.mock.calls.filter(x => x.url.pathname.endsWith('/records') && x.method === 'POST').at(-1);
  assert.equal(first.url.href, last.url.href); assert.deepEqual(first.body, last.body); assert.equal([...f.mock.records.values()][0].fields['负责人'], '甲');
});
test('deleted or duplicate remote rows are not silently recreated or merged', async t => {
  const f = await fixture(t); await f.connect(); await f.sync(); f.mock.records.clear();
  assert.equal((await f.sync({ recordId: f.record.id })).status, 409); assert.equal(f.mock.records.size, 0);
  const other = f.add(); const identity = `${f.p.id}:${other.id}`;
  for (const id of ['recA', 'recB']) f.mock.records.set(id, { record_id: id, fields: { '计划编号': identity } });
  assert.equal((await f.sync({ recordId: other.id })).status, 400); assert.equal(f.mock.records.size, 2);
});
test('automatic sync needs project opt-in, ignores samples, and pauses after destination changes', async t => {
  const f = await fixture(t); await f.connect(); await f.app.locals.integrations.tick(); assert.equal(f.mock.records.size, 0);
  assert.equal((await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: true, owner: '' })).status, 400);
  await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: true, owner: '', confirmed: true });
  await f.app.locals.integrations.tick(); assert.equal(f.mock.records.size, 1);
  const sampleId = f.store.get().projects[0].id;
  assert.equal((await f.req(`/projects/${sampleId}/feishu-plan`, 'PUT', { autoSync: true, owner: '', confirmed: true })).status, 400);
  await f.req('/team/feishu', 'PUT', { appId: 'cli_test12345', tableUrl: tableUrl.replace('tblTEST12345', 'tblOTHER1234'), expectedRevision: 1 });
  assert.equal(f.saved().feishuPlan.autoSync, false); assert.equal(f.store.get().feishu.check, undefined);
});
test('automatic connection failures pause the project instead of repeatedly contacting Feishu', async t => {
  const f = await fixture(t); await f.connect(); await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: true, owner: '', confirmed: true });
  f.mock.failNext = { code: 99991672 }; await f.app.locals.integrations.tick();
  assert.equal(f.saved().feishuPlan.autoSync, false); assert.match(f.saved().feishuPlan.error, /暂停/);
  const calls = f.mock.calls.length; await f.app.locals.integrations.tick(); assert.equal(f.mock.calls.length, calls);
});
test('disconnect clears the vault, stops auto sync and retains local and remote records', async t => {
  const f = await fixture(t); await f.connect(); await f.sync();
  await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: true, owner: '', confirmed: true });
  assert.equal((await f.req('/team/feishu', 'DELETE')).status, 200); assert.equal(f.vault.status().configured, false); assert.equal(f.saved().feishuPlan.autoSync, false);
  assert.equal(f.mock.records.size, 1); assert.equal(f.saved().publications.length, 1); assert.equal((await f.sync()).status, 400);
});
test('field normalization handles rich text and empty links without assuming unknown values are blank', () => {
  const values = canonicalFields({ '标题': [{ type: 'text', text: '测试' }], '作品链接': null, '计划发布时间': 123 });
  assert.equal(values['标题'], '测试'); assert.equal(values['作品链接'], ''); assert.equal(values['计划发布时间'], 123);
  assert.throws(() => canonicalFields({ '标题': { unknown: 'data' } }));
});
test('token refresh happens in memory and official nonzero error codes count as failures even with HTTP 200', async () => {
  let auth = 0, reads = 0;
  const client = createFeishuClient({ credentials: async () => ({ appId: 'cli_test12345', appSecret: 'private-app-secret' }), fetcher: async (url) => {
    if (url.includes('/auth/')) { auth++; return Response.json({ code: 0, tenant_access_token: `t-${auth}`, expire: 7200 }); }
    reads++; if (reads === 1) return Response.json({ code: 99991668 });
    return Response.json({ code: 0, data: { items: [], has_more: false } });
  } });
  await client.fields(parseFeishuTarget(tableUrl)); await client.fields(parseFeishuTarget(tableUrl)); assert.equal(auth, 2);
});

test('automatic batches skip blocked rows before limiting the batch so later plans still sync', async t => {
  const f = await fixture(t); await f.connect();
  for (let i = 0; i < 5; i++) f.add();
  await f.sync();
  f.store.mutate(state => {
    const p = state.projects.find(p => p.id === f.p.id);
    for (let i = 0; i < 5; i++) p.publications[i].feishuSync = { ...p.publications[i].feishuSync, status: i === 0 ? 'error' : 'conflict', retryable: false };
    p.publications[5].title = '应当继续同步的新标题';
  });
  await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: true, owner: '', confirmed: true });
  await f.app.locals.integrations.tick();
  const last = f.saved().publications[5];
  assert.equal(f.mock.records.get(last.feishuSync.recordId).fields['标题'], '应当继续同步的新标题');
  assert.equal(f.saved().publications[0].feishuSync.status, 'error');
  assert.equal(f.saved().publications[1].feishuSync.status, 'conflict');
});

test('automatic retries are bounded and do not contact Feishu again after three failed attempts', async t => {
  const f = await fixture(t); await f.connect();
  await f.req(`/projects/${f.p.id}/feishu-plan`, 'PUT', { autoSync: true, owner: '', confirmed: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    f.mock.beforeCreate = async () => { throw new Error('offline'); };
    await f.app.locals.integrations.tick();
    assert.equal(f.saved().publications[0].feishuSync.attempts, attempt);
    f.store.mutate(state => { state.projects.find(p => p.id === f.p.id).publications[0].feishuSync.nextAttemptAt = 0; });
  }
  const calls = f.mock.calls.length;
  await f.app.locals.integrations.tick();
  assert.equal(f.mock.calls.length, calls); assert.equal(f.mock.records.size, 0);
  assert.ok(f.saved().publications[0].feishuSync.pending.clientToken);
});
