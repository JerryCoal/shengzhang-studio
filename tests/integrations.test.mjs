import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { generateKeyframe, imageCost } from '../server/media-generation.mjs';
import { isPublicAddress, downloadVideo } from '../server/integration-http.mjs';
import * as domain from '../server/domain.mjs';
import { defaultSeedream } from '../server/seedream-config.mjs';

const openAIKey = 'sk-fake-integration-key-never-real-123456';
const seedKey = 'seedance-fake-key-never-real';
const clientSecret = 'fake-client-secret-never-real';
const accessToken = 'fake-access-token-never-real';
const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
const mp4 = `data:video/mp4;base64,${Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex').toString('base64')}`;
const imageResponse = () => Response.json({ data: [{ b64_json: png }], usage: { input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 } });
const success = data => Response.json({ data: { error_code: 0, ...data } });
function memoryVault() { let value = ''; return { status: () => ({ configured: !!value, supported: true, suffix: value.slice(-4), problem: '' }), getKey: async () => value, save: async key => { value = key; }, remove: () => { value = ''; } }; }
async function fixture(t, options = {}) {
  const store = createStore(':memory:'), seedanceVault = memoryVault(), seedreamVault = memoryVault(), douyinVault = memoryVault(), preferences = createIntegrationPreferences();
  await seedanceVault.save(seedKey); preferences.save({ region: 'byteplus', model: 'test-seedance-endpoint', reservationUsd: 2, outputPriceUsd: 2.5 });
  const app = createApp(store, { apiKey: openAIKey, seedanceVault, seedreamVault, douyinVault, integrationPreferences: preferences, downloadVideo: async () => mp4, ...options });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const req = async (path, method = 'GET', body, headers = {}) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'X-Studio-Client': 'studio-v1', 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  store.mutate(state => { const p = state.projects[0]; domain.confirmStrategy(p, p.strategies[0].id); p.imageData = `data:image/png;base64,${png}`; });
  const pid = store.get().projects[0].id, aid = store.get().projects[0].assets.find(a => a.kind === 'video').id;
  const p = () => store.get().projects[0], a = () => p().assets.find(a => a.id === aid), base = `/projects/${pid}/assets/${aid}`;
  return { store, app, req, p, a, pid, aid, base, douyinVault, preferences };
}
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Background operation did not finish'); }

test('Seedream-only account generates referenced first/last frames and completes Seedance without OpenAI', async t => {
  const calls = [], key = 'seedream-fake-key-never-real';
  const f = await fixture(t, { apiKey: '', fetcher: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/images/generations')) { assert.equal(init.headers.Authorization, `Bearer ${key}`); return Response.json({ data: [{ b64_json: png }], usage: { generated_images: 1 } }); }
    if (init.method === 'POST') return Response.json({ id: 'seedream-video' });
    return Response.json({ id: 'seedream-video', status: 'succeeded', content: { video_url: 'https://output.tos.bytepluses.com/test.mp4' } });
  } });
  const settings = { ...defaultSeedream, imagePriceUsd: .04 };
  assert.equal((await f.req('/integrations/seedream', 'PUT', { settings, apiKey: key })).status, 200);
  assert.equal((await f.req('/integrations/image-provider', 'PUT', { provider: 'seedream' })).status, 200);
  for (const role of ['first_frame', 'last_frame']) {
    // Omitted provider uses the saved default; old clients remain compatible.
    assert.equal((await f.req(f.base + '/keyframes', 'POST', { role, prompt: role, expectedRevision: 1 })).status, 202);
    await until(() => f.a().aiProduction?.phase === 'frames');
  }
  assert.equal(JSON.parse(calls[0].init.body).image.length, 1); assert.equal(JSON.parse(calls[1].init.body).image.length, 2);
  assert.equal(JSON.parse(calls[1].init.body).image[1], f.a().aiProduction.frames[0].mediaData);
  assert.equal(f.a().aiProduction.frames[1].provider, 'seedream'); assert.equal(f.a().aiProduction.frames[1].model, settings.model);
  assert.equal(f.p().usage.filter(v => v.stage === 'keyframe').reduce((s, v) => s + v.amountUsd, 0), .08);
  const body = { productionId: f.a().aiProduction.id, expectedRevision: 1, prompt: 'camera', duration: 5, generateAudio: false, confirmed: true };
  await f.req(f.base + '/seedance', 'POST', body); await until(() => f.a().aiProduction.phase === 'generating-video');
  const video = JSON.parse(calls[2].init.body);
  assert.deepEqual(video.content.slice(1).map(v => v.image_url.url), f.a().aiProduction.frames.map(v => v.mediaData));
  await f.req(f.base + '/video-status', 'POST'); assert.equal(f.a().mediaData, mp4);
  assert(!calls.some(v => v.url.includes('openai.com')));
  for (const path of ['/integrations', '/state', '/backup']) assert(!JSON.stringify((await f.req(path)).body).includes(key));
  await f.req('/integrations/seedream', 'DELETE'); const status = (await f.req('/integrations')).body;
  assert.equal(status.seedream.configured, false); assert.equal(status.seedance.configured, true);
});

test('Seedream budget is checked before dispatch, keys cannot change mid-task, ambiguous failures stay locked', async t => {
  let complete, calls = 0;
  const blocked = new Promise(resolve => { complete = resolve; });
  const f = await fixture(t, { fetcher: async () => { calls++; await blocked; throw Error('private-seedream-key'); } });
  const settings = { ...defaultSeedream, imagePriceUsd: .2, reservationUsd: .1 };
  await f.req('/integrations/seedream', 'PUT', { settings, apiKey: 'private-seedream-key' });
  const input = { provider: 'seedream', role: 'first_frame', prompt: 'reference', expectedRevision: 1 };
  f.store.mutate(state => { state.projects[0].brief.budgetUsd = .15; });
  assert.equal((await f.req(f.base + '/keyframes', 'POST', input)).status, 400); assert.equal(calls, 0);
  f.store.mutate(state => { state.projects[0].brief.budgetUsd = 10; });
  try {
    assert.equal((await f.req(f.base + '/keyframes', 'POST', input)).status, 202);
    assert.equal(f.p().usage.at(-1).amountUsd, .2);
    assert.equal((await f.req('/integrations/seedream', 'PUT', { settings })).status, 409);
    assert.equal((await f.req('/integrations/seedream', 'DELETE')).status, 409);
  } finally { complete(); }
  await until(() => f.a().aiProduction.phase === 'uncertain');
  assert.equal((await f.req(f.base + '/keyframes', 'POST', input)).status, 409); assert.equal(calls, 1);
  assert(!JSON.stringify(f.a()).includes('private-seedream-key'));
});

test('keyframe provider switch keeps OpenAI available and preserves the old first frame on rejection', async t => {
  const calls = [];
  const f = await fixture(t, { fetcher: async (url, init) => { calls.push({ url, init }); return url.includes('openai.com') ? imageResponse() : Response.json({ error: { message: 'secret-upstream-value' } }, { status: 403 }); } });
  const input = { provider: 'openai', role: 'first_frame', prompt: 'first', expectedRevision: 1 };
  await f.req(f.base + '/keyframes', 'POST', input); await until(() => f.a().aiProduction?.phase === 'frames');
  const frameId = f.a().aiProduction.frames[0].id;
  await f.req('/integrations/seedream', 'PUT', { settings: defaultSeedream, apiKey: 'seedream-test-secret' });
  await f.req(f.base + '/keyframes', 'POST', { ...input, provider: 'seedream', role: 'last_frame' });
  await until(() => f.a().aiProduction.phase === 'failed');
  assert.equal(JSON.parse(calls[1].init.body).image.length, 2);
  assert.equal(f.a().aiProduction.frames[0].id, frameId); assert.equal(f.p().usage.at(-1).amountUsd, 0);
  assert.match(f.a().aiProduction.error, /开通/); assert(!f.a().aiProduction.error.includes('secret-upstream-value'));
  await f.req(f.base + '/keyframes', 'POST', { ...input, role: 'last_frame' }); await until(() => f.a().aiProduction.phase === 'frames');
  assert.equal(calls[2].url, 'https://api.openai.com/v1/images/edits'); assert.equal(f.a().aiProduction.frames.length, 2);
});

test('image-2 uses image edits with product and first-frame references; fees use image token rates', async () => {
  let sent;
  await generateKeyframe({ apiKey: openAIKey, prompt: 'same product', references: [`data:image/png;base64,${png}`, `data:image/png;base64,${png}`] }, async (url, init) => { sent = { url, init }; return imageResponse(); });
  assert.equal(sent.url, 'https://api.openai.com/v1/images/edits'); assert.equal(sent.init.body.get('model'), 'gpt-image-2');
  assert.equal(sent.init.body.get('size'), '864x1536'); assert.equal(sent.init.body.get('input_fidelity'), null); assert.equal(sent.init.body.getAll('image[]').length, 2);
  assert.equal(sent.init.redirect, 'error'); assert.equal(imageCost({ input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 }), .0321); assert.equal(imageCost({}), null);
});
test('keyframes to Seedance downloads MP4, resumes polling without another paid submission, snapshots budget', async t => {
  const calls = [];
  const f = await fixture(t, { fetcher: async (url, init) => {
    calls.push({ url, init });
    if (url.includes('openai.com')) return imageResponse();
    if (init.method === 'POST') return Response.json({ id: 'video-task-1' });
    return Response.json({ id: 'video-task-1', status: 'succeeded', content: { video_url: 'https://output.tos.bytepluses.com/result.mp4' }, usage: { completion_tokens: 100000 } });
  } });
  for (const role of ['first_frame', 'last_frame']) { assert.equal((await f.req(f.base + '/keyframes', 'POST', { role, prompt: role, expectedRevision: 1 })).status, 202); await until(() => f.a().aiProduction?.phase === 'frames'); }
  assert.equal(calls[1].init.body.getAll('image[]').length, 2);
  const input = { productionId: f.a().aiProduction.id, expectedRevision: 1, prompt: 'smooth camera', duration: 8, generateAudio: true, confirmed: true };
  assert.equal((await f.req(f.base + '/seedance', 'POST', input)).status, 202); await until(() => f.a().aiProduction.phase === 'generating-video');
  assert.equal((await f.req(f.base + '/seedance', 'POST', input)).status, 409);
  const sent = JSON.parse(calls.find(c => c.url.includes('bytepluses.com') && c.init.method === 'POST').init.body);
  assert.deepEqual(sent.content.slice(1).map(c => c.role), ['first_frame', 'last_frame']); assert.equal(sent.resolution, '720p'); assert.equal(sent.generate_audio, true);
  f.app.locals.integrations.start();
  assert.equal((await f.req(f.base + '/video-status', 'POST')).status, 200);
  assert.equal(f.a().status, 'ready'); assert.equal(f.a().mediaData, mp4); assert.equal(f.a().aiProduction.phase, 'complete');
  const completedRevision = f.a().revision;
  await f.req(f.base + '/video-status', 'POST'); assert.equal(f.a().revision, completedRevision); assert.equal(f.a().aiProduction.phase, 'complete');
  assert.equal(f.p().usage.at(-1).amountUsd, .25); assert.equal(calls.filter(c => c.url.includes('bytepluses.com') && c.init.method === 'POST').length, 1);
  assert.ok(!JSON.stringify((await f.req('/backup')).body).includes(seedKey));
});
test('keyframe budget and revision validation happens before charge; stale generated media cannot replace edited asset', async t => {
  let finish, calls = 0; const blocked = new Promise(r => { finish = r; });
  const f = await fixture(t, { fetcher: async () => { calls++; await blocked; return imageResponse(); } });
  f.store.mutate(state => { state.projects[0].brief.budgetUsd = .1; });
  assert.equal((await f.req(f.base + '/keyframes', 'POST', { role: 'first_frame', prompt: 'frame', expectedRevision: 1 })).status, 400); assert.equal(calls, 0);
  f.store.mutate(state => { state.projects[0].brief.budgetUsd = 10; });
  assert.equal((await f.req(f.base + '/keyframes', 'POST', { role: 'first_frame', prompt: 'frame', expectedRevision: 1 })).status, 202);
  assert.equal((await f.req(f.base + '/keyframes', 'POST', { role: 'first_frame', prompt: 'duplicate', expectedRevision: 1 })).status, 409);
  await f.req(f.base, 'PUT', { title: 'new title', body: 'new body', expectedRevision: 1 }); finish();
  await until(() => f.a().aiProduction.phase === 'stale'); assert.equal(f.a().title, 'new title'); assert.equal(f.p().usage[0].status, 'completed');
});
test('ambiguous Seedance create fails closed and restart never resubmits; provider error cannot disclose keys', async t => {
  let calls = 0; const f = await fixture(t, { fetcher: async () => { calls++; throw new Error(seedKey); } });
  f.store.mutate(state => { state.projects[0].assets.find(a => a.id === f.aid).aiProduction = { id: 'prepared', phase: 'frames', assetRevision: 1, frames: ['first_frame', 'last_frame'].map(role => ({ id: role, role, mediaData: `data:image/png;base64,${png}` })) }; });
  const input = { productionId: 'prepared', expectedRevision: 1, prompt: 'video', duration: 5, generateAudio: false, confirmed: true };
  await f.req(f.base + '/seedance', 'POST', input); await until(() => f.a().aiProduction.phase === 'uncertain');
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick(); assert.equal(calls, 1);
  assert.equal((await f.req(f.base + '/seedance', 'POST', input)).status, 409); assert.equal(f.p().usage.at(-1).amountUsd, 2);
  assert.ok(!JSON.stringify((await f.req('/state')).body).includes(seedKey));
});
test('integration credentials are never echoed and reject remote/proxy configurations', async t => {
  const f = await fixture(t);
  const body = { clientKey: 'test-client', clientSecret, redirectUri: 'https://callback.example.com/authorized' };
  assert.equal((await f.req('/integrations/douyin', 'PUT', body, { 'X-Forwarded-For': '192.0.2.1' })).status, 403);
  assert.equal((await f.req('/integrations/douyin', 'PUT', body)).status, 200);
  for (const path of ['/integrations', '/backup', '/state']) { const json = JSON.stringify((await f.req(path)).body); assert.ok(!json.includes(clientSecret)); assert.ok(!json.includes(seedKey)); }
  assert.equal((await f.req('/integrations/seedance', 'PUT', { region: 'byteplus', model: 'ep-test', reservationUsd: 2, outputPriceUsd: 0, baseUrl: 'https://evil.test' })).status, 400);
});
test('video download rejects private addresses, arbitrary hosts, redirects and oversized content', async () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '172.31.1.1', '192.168.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  let calls = 0; const fetcher = async () => { calls++; return new Response('x'); };
  await assert.rejects(downloadVideo('https://evil.test/a.mp4', fetcher));
  await assert.rejects(downloadVideo('https://out.tos.bytepluses.com/a.mp4', fetcher, async () => [{ address: '127.0.0.1' }])); assert.equal(calls, 0);
  await assert.rejects(downloadVideo('https://out.tos.bytepluses.com/a.mp4', async (_url, init) => { assert.equal(init.headers, undefined); assert.equal(init.redirect, 'error'); return new Response('x', { headers: { 'content-length': '99999999' } }); }, async () => [{ address: '8.8.8.8' }]));
});

async function authorize(f) {
  assert.equal((await f.req('/integrations/douyin', 'PUT', { clientKey: 'test-client', clientSecret, redirectUri: 'https://callback.example.com/authorized' })).status, 200);
  const link = await f.req('/integrations/douyin/authorize', 'POST', { accountId: 'account-dy' }); const state = new URL(link.body.url).searchParams.get('state');
  assert.equal((await f.req('/integrations/douyin/complete', 'POST', { callbackUrl: `https://callback.example.com/authorized?code=fake-code&state=wrong` })).status, 400);
  const url = `https://callback.example.com/authorized?code=fake-code&state=${state}`;
  assert.equal((await f.req('/integrations/douyin/complete', 'POST', { callbackUrl: url })).status, 200);
  assert.equal((await f.req('/integrations/douyin/complete', 'POST', { callbackUrl: url })).status, 400);
}
function token(scopes = 'video.create,video.data,item.comment') { return success({ access_token: accessToken, refresh_token: 'fake-refresh-token', open_id: 'fake-open-id', expires_in: 7200, refresh_expires_in: 86400, scope: scopes }); }
async function publication(f) {
  f.store.mutate(state => { const a = state.projects[0].assets.find(a => a.id === f.aid); a.status = 'ready'; a.mediaData = mp4; a.mime = 'video/mp4'; });
  return (await f.req(`/projects/${f.pid}/publications`, 'POST', { assetId: f.aid, accountId: 'account-dy', scheduledAt: new Date(Date.now() - 1000).toISOString() })).body.result;
}
test('Douyin OAuth uses one-time state; scheduled publication sends exactly reviewed caption once and waits for real public status', async t => {
  const calls = []; let reviewed = false;
  const f = await fixture(t, { fetcher: async (url, init) => {
    calls.push({ url, init }); const path = new URL(url).pathname;
    if (path === '/oauth/access_token/') { assert.equal(init.method, 'POST'); assert.equal(init.body.get('grant_type'), 'authorization_code'); return token(); }
    assert.equal(init.headers['access-token'], accessToken);
    if (path === '/video/upload/') { assert.ok(init.body.get('video') instanceof Blob); return success({ video: { video_id: 'upload-id' } }); }
    if (path === '/video/create/') { assert.deepEqual(JSON.parse(init.body), { video_id: 'upload-id', text: '用户检查后的文案' }); return success({ item_id: 'encrypted-item/+' }); }
    if (path === '/video/data/') return success({ list: [{ item_id: 'encrypted-item/+', is_reviewed: reviewed, video_status: reviewed ? 5 : 1, share_url: 'https://www.douyin.com/video/123' }] });
    throw new Error('unexpected request');
  } });
  await authorize(f); const pub = await publication(f), base = `/projects/${f.pid}/publications/${pub.id}`;
  assert.equal((await f.req(base + '/automatic', 'POST', { confirmed: false, text: '用户检查后的文案' })).status, 400);
  assert.equal((await f.req(base + '/automatic', 'POST', { confirmed: true, text: '用户检查后的文案' })).status, 200);
  assert.equal((await f.req(base + '/automatic', 'POST', { confirmed: true, text: 'duplicate' })).status, 409);
  assert.equal((await f.req(base, 'PATCH', { status: 'cancelled' })).status, 409);
  await f.app.locals.integrations.tick(); let record = f.p().publications.find(p => p.id === pub.id);
  assert.equal(record.automation.status, 'submitted'); assert.equal(record.status, 'scheduled');
  await f.req(base + '/platform-status', 'POST'); assert.equal(f.p().publications.find(p => p.id === pub.id).status, 'scheduled');
  reviewed = true; await f.req(base + '/platform-status', 'POST'); record = f.p().publications.find(p => p.id === pub.id);
  assert.equal(record.status, 'published'); assert.equal(record.confirmationSource, 'douyin-api'); assert.equal(record.platformItemId, 'encrypted-item/+');
  assert.equal(calls.filter(c => new URL(c.url).pathname === '/video/create/').length, 1);
  for (const path of ['/integrations', '/backup', '/state']) assert.ok(!JSON.stringify((await f.req(path)).body).includes(accessToken));
});
test('ambiguous create response is never automatically retried after restart', async t => {
  let creates = 0; const f = await fixture(t, { fetcher: async (url) => {
    if (url.includes('/oauth/access_token/')) return token();
    if (url.includes('/video/upload/')) return success({ video: { video_id: 'uploaded' } });
    if (url.includes('/video/create/')) { creates++; throw new Error(accessToken); }
    throw new Error('unexpected');
  } });
  await authorize(f); const pub = await publication(f), base = `/projects/${f.pid}/publications/${pub.id}`;
  await f.req(base + '/automatic', 'POST', { confirmed: true, text: 'authorized' }); await f.app.locals.integrations.tick();
  assert.equal(f.p().publications.find(p => p.id === pub.id).automation.status, 'uncertain');
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick(); assert.equal(creates, 1);
  assert.equal((await f.req(base + '/automatic', 'POST', { confirmed: true, text: 'again' })).status, 409);
});
test('comment pagination encodes item ids, deduplicates by id, preserves manual corrections and resumes partial data', async t => {
  let secondPass = false, commentCalls = 0;
  const f = await fixture(t, { fetcher: async (url) => {
    const path = new URL(url).pathname;
    if (path === '/oauth/access_token/') return token();
    if (path === '/item/comment/list/') {
      commentCalls++; const parsed = new URL(url); assert.equal(parsed.searchParams.get('item_id'), 'encrypted-item/+');
      const first = parsed.searchParams.get('cursor') === '0';
      return success({ cursor: first ? 50 : 100, has_more: first, list: [{ comment_id: first ? 'c1' : 'c2', content: '相同的评论内容', create_time: 1760000000, digg_count: secondPass ? 9 : 1, reply_comment_total: 2 }] });
    }
    throw new Error('unexpected');
  } });
  await authorize(f); const pub = await publication(f), base = `/projects/${f.pid}/publications/${pub.id}`;
  const connection = (await f.req('/integrations')).body.douyin.accounts[0].connectionId;
  f.store.mutate(state => { Object.assign(state.projects[0].publications[0], { status: 'published', platformItemId: 'encrypted-item/+', platformConnectionId: connection }); });
  const first = await f.req(base + '/comments-sync', 'POST'); assert.equal(first.status, 200); assert.equal(first.body.result.added, 2); assert.equal(commentCalls, 2);
  const comment = f.p().comments[0]; await f.req(`/projects/${f.pid}/comments/${comment.id}`, 'PATCH', { tags: ['价格顾虑'], irrelevant: true });
  secondPass = true; const second = await f.req(base + '/comments-sync', 'POST'); assert.equal(second.body.result.added, 0); assert.equal(f.p().comments.length, 2);
  assert.deepEqual(f.p().comments[0].tags, ['价格顾虑']); assert.equal(f.p().comments[0].irrelevant, true); assert.equal(f.p().comments[0].likes, 9); assert.equal(f.p().comments[0].source, 'douyin-api');
  assert.equal((await f.req(base + '/comments-sync', 'PUT', { enabled: true })).status, 200); await f.app.locals.integrations.tick(); assert.equal(commentCalls, 6);
  await f.req(base + '/comments-sync', 'PUT', { enabled: false }); await f.app.locals.integrations.tick(); assert.equal(commentCalls, 6);
});
test('missing granted scopes blocks automatic publishing before upload', async t => {
  let calls = 0; const f = await fixture(t, { fetcher: async () => { calls++; return token('video.data'); } });
  await authorize(f); const pub = await publication(f);
  assert.equal((await f.req(`/projects/${f.pid}/publications/${pub.id}/automatic`, 'POST', { confirmed: true, text: 'caption' })).status, 403); assert.equal(calls, 1);
});

test('token expiry triggers official refresh before upload and stores refreshed credentials privately', async t => {
  let refreshed = false;
  const f = await fixture(t, { fetcher: async (url, init) => {
    if (url.includes('/oauth/access_token/')) return success({ access_token: accessToken, refresh_token: 'fake-refresh-token', open_id: 'fake-open-id', expires_in: 1, refresh_expires_in: 86400, scope: 'video.create,video.data,item.comment' });
    if (url.includes('/oauth/refresh_token/')) { assert.equal(init.method, 'POST'); assert.ok(init.body instanceof FormData); assert.equal(init.body.get('grant_type'), 'refresh_token'); assert.equal(init.body.get('refresh_token'), 'fake-refresh-token'); refreshed = true; return success({ access_token: 'refreshed-test-token', expires_in: 7200 }); }
    assert.equal(init.headers['access-token'], 'refreshed-test-token');
    if (url.includes('/video/upload/')) return success({ video: { video_id: 'uploaded' } });
    return success({ item_id: 'published-item' });
  } });
  await authorize(f); const pub = await publication(f);
  assert.equal((await f.req(`/projects/${f.pid}/publications/${pub.id}/automatic`, 'POST', { confirmed: true, text: 'caption' })).status, 200);
  await f.app.locals.integrations.tick(); assert.equal(refreshed, true);
  assert.ok(!JSON.stringify((await f.req('/integrations')).body).includes('refreshed-test-token'));
});
test('background progress cannot invalidate a text generation whose actual inputs are unchanged', async t => {
  let finish, started; const gate = new Promise(r => { finish = r; }); const begin = new Promise(r => { started = r; });
  const f = await fixture(t, { fetcher: async () => { started(); await gate; return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: 'new strategy', core: 'facts', direction: 'direction', prompt: 'prompt' }) }] }], usage: { input_tokens: 100, output_tokens: 100 } }); } });
  const request = f.req(`/projects/${f.pid}/strategies`, 'POST', { mode: 'openai', stage: 'strategy' });
  await begin; f.store.mutate(state => { const p = state.projects[0]; p.assets[0].aiProduction = { phase: 'generating-video', nextPollAt: Date.now() }; domain.touch(p); }); finish();
  assert.equal((await request).status, 200); assert.equal(f.p().strategies.at(-1).title, 'new strategy');
});
