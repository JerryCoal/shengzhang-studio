import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPublishReadiness, publicationAccountChoice } from '../server/publish-readiness.mjs';
import { seedState, confirmStrategy, updateAsset, schedulePublication } from '../server/domain.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
function fixture() {
  const state = seedState(), project = state.projects[0];
  confirmStrategy(project, project.strategies[0].id);
  const asset = project.assets.find(a => a.kind === 'image');
  return { state, project, asset };
}
function complete(project, asset) { updateAsset(project, asset.id, { title: asset.title, body: asset.body, expectedRevision: asset.revision, mediaData: png, mime: 'image/png' }); }

test('publication preparation explains title edits while retaining old preview and backend guard', () => {
  const { state, project, asset } = fixture(); complete(project, asset);
  assert.equal(assetPublishReadiness(asset).ready, true);
  updateAsset(project, asset.id, { title: '新的标题', body: asset.body, expectedRevision: asset.revision });
  assert.equal(asset.mediaData, png);
  assert.equal(assetPublishReadiness(asset).code, 'outdated-media');
  assert.match(assetPublishReadiness(asset).message, /旧版画面/);
  assert.throws(() => schedulePublication(project, state.accounts, { assetId: asset.id, accountId: state.accounts[0].id, scheduledAt: new Date().toISOString() }), /完成内容制作/);
  complete(project, asset);
  assert.equal(assetPublishReadiness(asset).ready, true);
});

test('unadopted and stale candidates provide distinct actionable reasons', () => {
  const { asset } = fixture();
  asset.aiCover = { phase: 'ready', assetRevision: asset.revision, mediaData: png };
  assert.equal(assetPublishReadiness(asset).code, 'image-awaiting-approval');
  assert.match(assetPublishReadiness(asset).message, /确认采用/);
  asset.revision += 1;
  assert.equal(assetPublishReadiness(asset).code, 'stale-image');
  assert.equal(assetPublishReadiness(asset).ready, false);
});

test('video frames, active generation and completed stale result describe the next step', () => {
  const { asset } = fixture(); asset.kind = 'video';
  asset.aiProduction = { phase: 'frames' };
  assert.equal(assetPublishReadiness(asset).code, 'video-needs-render');
  asset.aiProduction.phase = 'generating-video';
  assert.equal(assetPublishReadiness(asset).code, 'generating-video');
  asset.aiProduction = { phase: 'stale', resultMediaData: 'data:video/mp4;base64,AAAAAGZ0eXBtcDQy' };
  assert.equal(assetPublishReadiness(asset).code, 'video-awaiting-approval');
  assert.match(assetPublishReadiness(asset).message, /将此视频用于当前文案/);
});

test('a failed new attempt does not block an existing valid current version', () => {
  const { project, asset } = fixture(); complete(project, asset);
  asset.aiCover = { phase: 'failed', error: 'provider failed' };
  assert.equal(assetPublishReadiness(asset).ready, true);
});

test('ready label alone does not enable incomplete, wrong-kind or malformed media', () => {
  const { asset } = fixture(); asset.status = 'ready'; asset.mime = 'image/png';
  for (const mediaData of ['', 'old-media', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,iVBORw0KGgo=']) {
    asset.mediaData = mediaData;
    assert.equal(assetPublishReadiness(asset).code, 'missing-media');
  }
  asset.mediaData = png; asset.kind = 'video';
  assert.equal(assetPublishReadiness(asset).ready, false);
});

test('generation failures and missing media have useful instructions without changing state', () => {
  const { asset } = fixture();
  assert.equal(assetPublishReadiness(asset).code, 'not-produced');
  for (const [phase, code] of [['generating', 'generating-image'], ['failed', 'failed-generation'], ['uncertain', 'uncertain-generation'], ['stale', 'stale-generation']]) {
    asset.aiCover = { phase };
    const before = structuredClone(asset);
    const result = assetPublishReadiness(asset);
    assert.equal(result.code, code); assert.ok(result.message && result.nextAction); assert.equal(result.ready, false);
    assert.deepEqual(asset, before);
  }
});

test('publishing starts with the account whose identity generated the content', () => {
  const accounts = [{ id: 'first', platform: 'xiaohongshu' }, { id: 'selected', platform: 'xiaohongshu' }, { id: 'video', platform: 'douyin' }];
  const asset = { channel: 'xiaohongshu', creationTrace: { accounts: [{ accountId: 'video', accountName: '视频号', platform: 'douyin' }, { accountId: 'selected', accountName: '生活号', platform: 'xiaohongshu' }] } };
  assert.deepEqual(publicationAccountChoice(asset, accounts), { defaultAccountId: 'selected', sourceAccountId: 'selected', sourceAccountName: '生活号', sourceAvailable: true });
  assert.equal(publicationAccountChoice(asset, accounts.filter(a => a.id !== 'selected')).defaultAccountId, '');
  assert.equal(publicationAccountChoice(asset, accounts.filter(a => a.id !== 'selected')).sourceAvailable, false);
  assert.equal(publicationAccountChoice({ channel: 'xiaohongshu' }, accounts).defaultAccountId, 'first');
});
