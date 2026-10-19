import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { confirmStrategy, updateAsset } from '../server/domain.mjs';
import { downloadRedfoxMedia, redfoxMediaURL } from '../server/redfox-media.mjs';
import { installCreativeSkill } from '../server/creative-skills.mjs';
import { saveAccountCreationProfile, saveProjectCreationSelection } from '../server/account-creation.mjs';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const mp4 = 'data:video/mp4;base64,AAAAAGZ0eXBpc29t';
const cdn = 'https://redfox-hk.oss-cn-hangzhou.aliyuncs.com/hotAI/';
const key = 'redfox-test-key-not-real';
const vault = { status: () => ({ supported: true, configured: true }), getKey: async () => key };
const result = data => Response.json({ code: 2000, data });
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Redfox mock job did not reach expected state'); }
async function fixture(t, handler, options = {}) {
  const store = createStore(':memory:'), preferences = createIntegrationPreferences(), calls = [];
  preferences.saveRedfox({ mediaEnabled: true });
  store.mutate(state => { const p = state.projects[0]; confirmStrategy(p, p.strategies[0].id); p.imageData = png; p.brief.budgetUsd = 0; });
  const app = createApp(store, { integrationPreferences: preferences, redfoxVault: vault,
    redfoxFetcher: async (url, init) => { const body = init.body instanceof FormData ? init.body : JSON.parse(init.body); calls.push({ url, init, body }); return handler(url, body, calls); },
    downloadRedfoxMedia: async (_url, kind) => kind === 'video' ? mp4 : png,
    imageWatermarkInspector: async () => ({ status: 'unavailable', regions: [], message: 'mock' }), ...options });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const p = () => store.get().projects[0], asset = kind => p().assets.find(a => a.kind === kind);
  const request = async (kind, path, body = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p().id}/assets/${asset(kind).id}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const cover = () => request('image', 'cover', { expectedRevision: asset('image').revision, prompt: '自然光产品实拍', confirmed: true });
  const frame = role => request('video', 'keyframes', { role, provider: 'openai', expectedRevision: asset('video').revision, prompt: '保持人物及产品一致' });
  const video = () => request('video', 'seedance', { productionId: asset('video').aiProduction.id, expectedRevision: asset('video').revision, prompt: '平稳推进镜头', duration: 8, generateAudio: false, confirmed: true });
  return { store, preferences, app, calls, p, asset, request, cover, frame, video };
}

test('Redfox cover preserves candidate approval and Skills; tracks CNY separately, resumes existing task after restart', async t => {
  const f = await fixture(t, async url => url.includes('arkProSubmit') ? result({ taskId: 'image-1' }) : result({ taskId: 'image-1', status: 'succeeded', imageUrls: JSON.stringify([cdn + 'cover.jpg']) }));
  f.store.mutate(state => { const skill = installCreativeSkill(state, { workflowId: 'cover', fileName: 'cover.md', text: '---\nname: test-cover\ndescription: Test\nversion: 1.0.0\n---\nONLY_COVER_RULE', expectedRevision: state.skillsRevision || 0, confirmed: true }); state.skillSelections.cover = skill.id; });
  const old = f.asset('image');
  assert.equal((await f.cover()).status, 202); await until(() => f.asset('image').aiCover?.taskId);
  assert.equal(f.asset('image').aiCover.provider, 'redfox'); assert.equal(f.p().usage.length, 0);
  assert.equal(f.store.get().redfoxUsage[0].amountCny, 1);
  assert.match(f.calls[0].body.prompt, /ONLY_COVER_RULE/); assert.deepEqual(f.calls[0].body.image, [png]);
  assert.equal(f.calls[0].body.size, '1728x2304'); assert.equal(f.calls[0].body.watermark, true);
  assert.equal((await f.cover()).status, 409);
  f.preferences.saveRedfox({ mediaEnabled: false }); // Existing tasks still finish using their original provider.
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick();
  assert.equal(f.asset('image').aiCover.phase, 'ready');
  assert.equal(f.calls.filter(c => c.url.includes('Submit')).length, 1);
  assert.equal(f.asset('image').revision, old.revision);
  assert.equal((await f.request('image', 'cover-apply', { id: f.asset('image').aiCover.id, expectedRevision: old.revision, confirmed: true })).status, 200);
  assert.equal(f.asset('image').aiCover.phase, 'applied'); assert.equal(f.asset('image').mediaData, png);
  assert(!JSON.stringify(f.store.get()).includes(key));
});

test('Redfox first/last frames upload as multipart, video uses URL roles, actor survives result polling', async t => {
  let count = 0;
  const f = await fixture(t, async (url, body) => {
    if (url.includes('arkProSubmit')) return result({ taskId: `frame-${++count}` });
    if (url.includes('arkProResult')) return result({ taskId: body.taskId, status: 'succeeded', imageUrls: [cdn + body.taskId + '.jpg'] });
    if (url.includes('uploadImage')) { assert(body instanceof FormData); assert.equal(body.get('file').type, 'image/png'); assert.equal(body.get('format'), 'png'); assert.match(url, /\?format=png$/); return result({ imageUrl: cdn + 'input.png' }); }
    if (url.includes('seedanceSubmit')) return result({ taskId: 'video-1' });
    return result({ taskId: body.taskId, status: 'completed', videoUrl: cdn + 'output.mp4' });
  });
  for (const role of ['first_frame', 'last_frame']) {
    assert.equal((await f.frame(role)).status, 202); await until(() => f.asset('video').aiProduction.frameTaskId === `frame-${count}` && count > 0);
    assert.equal((await f.request('video', 'video-status')).status, 200);
    assert.equal(f.asset('video').aiProduction.phase, 'frames');
  }
  assert.equal(f.calls[2].body.image.length, 2, 'tail frame carries first frame reference');
  assert.equal(f.asset('video').aiProduction.frames.length, 2);
  assert.equal((await f.video()).status, 202); await until(() => f.asset('video').aiProduction.taskId === 'video-1');
  const submit = f.calls.find(c => c.url.includes('seedanceSubmit'));
  assert.deepEqual(submit.body.imageWithRoles.map(f => f.role), ['first_frame', 'last_frame']);
  assert(submit.body.imageWithRoles.every(f => f.url === cdn + 'input.png'));
  assert.equal(submit.body.duration, 8); assert.equal(submit.body.generateAudio, false);
  f.store.mutate(state => { const a = state.projects[0].assets.find(a => a.kind === 'video'); a.aiProduction.initiatedBy = { userId: 'original-user', username: '原操作者', role: 'editor' }; });
  assert.equal((await f.request('video', 'video-status')).status, 200);
  assert.equal(f.asset('video').aiProduction.phase, 'complete'); assert.equal(f.asset('video').mediaData, mp4);
  assert.equal(f.store.get().redfoxUsage.at(-1).actor.userId, 'original-user');
  assert.equal(f.p().usage.length, 0); assert.equal(f.store.get().redfoxUsage.reduce((n, row) => n + row.amountCny, 0), 17);
  assert.equal((await f.video()).status, 409);
});

test('uncertain Redfox submit stays locked across restart and never resubmits', async t => {
  const f = await fixture(t, async () => { throw Error(key); });
  assert.equal((await f.cover()).status, 202); await until(() => f.asset('image').aiCover.phase === 'uncertain');
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick();
  assert.equal((await f.cover()).status, 409); assert.equal(f.calls.length, 1);
  assert(!JSON.stringify(f.store.get()).includes(key));
  assert.equal((await f.request('image', 'cover-reset', { id: f.asset('image').aiCover.id, confirmed: true })).status, 200);
  assert.equal(f.calls.length, 1);
});

test('Redfox poll task mismatch and failed downloads keep original id and never dispatch another submit', async t => {
  let mismatch = true, downloadFails = true;
  const f = await fixture(t, async url => url.includes('Submit') ? result({ taskId: 'image-original' }) : result({ taskId: mismatch ? 'someone-else' : 'image-original', status: 'succeeded', imageUrls: [cdn + 'image.jpg'] }), { downloadRedfoxMedia: async () => { if (downloadFails) throw Error('broken download'); return png; } });
  await f.cover(); await until(() => f.asset('image').aiCover.taskId);
  await f.request('image', 'cover-status'); assert.equal(f.asset('image').aiCover.failures, 1); assert.equal(f.asset('image').aiCover.mediaData, undefined);
  mismatch = false; await f.request('image', 'cover-status'); assert.equal(f.asset('image').aiCover.failures, 2);
  downloadFails = false; await f.request('image', 'cover-status'); assert.equal(f.asset('image').aiCover.phase, 'ready');
  assert.equal(f.calls.filter(c => c.url.includes('Submit')).length, 1); assert.equal(f.asset('image').aiCover.taskId, 'image-original');
});

test('Redfox stale images do not overwrite edits and invalid revision rejects before API request', async t => {
  const f = await fixture(t, async url => url.includes('Submit') ? result({ taskId: 'cover-stale' }) : result({ taskId: 'cover-stale', status: 'succeeded', imageUrls: [cdn + 'image.jpg'] }));
  assert.equal((await f.request('image', 'cover', { expectedRevision: 999, confirmed: true })).status, 409); assert.equal(f.calls.length, 0);
  await f.cover(); await until(() => f.asset('image').aiCover.taskId);
  f.store.mutate(state => { const p = state.projects[0], a = p.assets.find(a => a.kind === 'image'); updateAsset(p, a.id, { title: a.title, body: 'changed body', expectedRevision: a.revision }); });
  await f.request('image', 'cover-status'); assert.equal(f.asset('image').aiCover.phase, 'stale'); assert.equal(f.asset('image').body, 'changed body');
  assert.equal((await f.request('image', 'cover-apply', { id: f.asset('image').aiCover.id, expectedRevision: f.asset('image').revision, confirmed: true })).status, 409);
});

test('Redfox downloads accept only official HTTPS OSS public addresses and carry no credential headers', async () => {
  for (const url of ['http://redfox-hk.oss-cn-hangzhou.aliyuncs.com/a', 'https://evil.com/a', 'https://redfox-hk.oss-cn-hangzhou.aliyuncs.com.evil.com/a', 'https://user:pass@redfox-hk.oss-cn-hangzhou.aliyuncs.com/a', 'https://127.0.0.1/a']) assert.throws(() => redfoxMediaURL(url));
  let calls = 0;
  const fetcher = async (_url, init) => { calls++; assert.equal(init.redirect, 'error'); assert.equal(init.headers, undefined); return new Response(Buffer.from(png.split(',')[1], 'base64')); };
  await assert.rejects(downloadRedfoxMedia(cdn + 'a.png', 'image', fetcher, async () => [{ address: '127.0.0.1' }])); assert.equal(calls, 0);
  assert.equal(await downloadRedfoxMedia(cdn + 'a.png', 'image', fetcher, async () => [{ address: '8.8.8.8' }]), png);
  await assert.rejects(downloadRedfoxMedia(cdn + 'a.png', 'image', async () => new Response('html'), async () => [{ address: '8.8.8.8' }]));
  await assert.rejects(downloadRedfoxMedia(cdn + 'a.png', 'image', async () => new Response('tiny', { headers: { 'content-length': '10000000' } }), async () => [{ address: '8.8.8.8' }]));
});

test('Redfox keeps original account identity after switching and refuses tail frames from a different profile', async t => {
  const f = await fixture(t, async (url, body) => url.includes('Submit') ? result({ taskId: 'account-frame' }) : result({ taskId: body.taskId, status: 'succeeded', imageUrls: [cdn + 'image.jpg'] }));
  const platform = f.asset('video').channel;
  f.store.mutate(state => {
    state.accounts = ['a', 'b'].map(id => ({ id, name: 'account-' + id, platform }));
    for (const id of ['a', 'b']) saveAccountCreationProfile(state, id, { expectedRevision: 0, identityMarkdown: `PRIVATE_IDENTITY_${id}`, identityFileName: 'identity.md', presets: [], defaultPresetId: '' });
    saveProjectCreationSelection(state, state.projects[0], { platform, accountId: 'a', expectedRevision: state.projects[0].revision });
  });
  assert.equal((await f.frame('first_frame')).status, 202); await until(() => f.asset('video').aiProduction.frameTaskId);
  f.store.mutate(state => saveProjectCreationSelection(state, state.projects[0], { platform, accountId: 'b', expectedRevision: state.projects[0].revision }));
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick();
  assert.equal(f.asset('video').aiProduction.phase, 'frames');
  assert.match(f.calls[0].body.prompt, /PRIVATE_IDENTITY_a/); assert.doesNotMatch(f.calls[0].body.prompt, /PRIVATE_IDENTITY_b/);
  assert.equal(f.asset('video').aiProduction.frames[0].recipe.accountContext.accounts[0].accountId, 'a');
  assert.equal(f.store.get().redfoxUsage.at(-1).accountId, 'a');
  assert.equal((await f.frame('last_frame')).status, 409); assert.equal(f.calls.filter(c => c.url.includes('Submit')).length, 1);
});

test('Redfox video continues read-only polling after restart; missing credentials do not lock an unsubmitted asset', async t => {
  const f = await fixture(t, async (_url, body) => result({ taskId: body.taskId, status: 'completed', videoUrl: cdn + 'video.mp4' }));
  f.store.mutate(state => { const a = state.projects[0].assets.find(a => a.kind === 'video'); a.aiProduction = { id: 'production-restored', assetRevision: a.revision, phase: 'generating-video', provider: 'redfox', taskId: 'restored-task', frames: [], nextPollAt: 0 }; });
  f.app.locals.integrations.start(); await f.app.locals.integrations.tick();
  assert.equal(f.asset('video').aiProduction.phase, 'complete'); assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /seedanceResult$/);
  const unavailable = await fixture(t, async () => assert.fail('must not dispatch'), { redfoxVault: { status: () => ({ configured: false, supported: true }) } });
  assert.equal((await unavailable.cover()).status, 400); assert.equal(unavailable.asset('image').aiCover, undefined);
});
