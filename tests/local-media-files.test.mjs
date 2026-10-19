import test from 'node:test';
import assert from 'node:assert/strict';
import { localMediaOptions, validateLocalMediaFile } from '../src/local-media.mjs';
import { newProject, updateAsset } from '../server/domain.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const dataHeader = hex => Uint8Array.from(Buffer.from(hex, 'hex')).buffer;
const file = (name, type, size = 100) => ({ name, type, size });
const header = {
  png: dataHeader('89504e470d0a1a0a00000000'), jpg: dataHeader('ffd8ffe000104a4649460001'),
  webp: dataHeader('524946460c00000057454250'), mp4: dataHeader('00000018667479706d703432'),
  webm: dataHeader('1a45dfa301000000'), mp3: dataHeader('4944330400000000'),
  wav: dataHeader('524946461800000057415645'), ogg: dataHeader('4f67675300000000'),
};

test('reference images support Windows extension fallback and validate real image signatures', () => {
  assert.equal(validateLocalMediaFile(file('场景.PNG', ''), 'reference', header.png), 'image/png');
  assert.equal(validateLocalMediaFile(file('scene.jpeg', 'image/jpeg'), 'reference', header.jpg), 'image/jpeg');
  assert.equal(validateLocalMediaFile(file('scene.webp', 'application/octet-stream'), 'reference', header.webp), 'image/webp');
  assert.throws(() => validateLocalMediaFile(file('伪装.png', 'image/png'), 'reference', header.mp4), /文件内容与格式不符/);
  assert.throws(() => validateLocalMediaFile(file('shot.mp4', 'video/mp4'), 'reference', header.mp4), /采用本地成品/);
});

test('local finished media accepts only the current asset save contract', () => {
  assert.equal(validateLocalMediaFile(file('cover.jpg', 'image/jpg'), 'image-asset', header.jpg), 'image/jpeg');
  assert.equal(validateLocalMediaFile(file('cover.png', 'image/png'), 'image-asset', header.png), 'image/png');
  assert.equal(validateLocalMediaFile(file('clip.mp4', ''), 'video-asset', header.mp4), 'video/mp4');
  assert.equal(validateLocalMediaFile(file('clip.webm', 'video/webm'), 'video-asset', header.webm), 'video/webm');
  for (const [name, mime, kind, bytes] of [['cover.webp', 'image/webp', 'image-asset', header.webp], ['clip.mov', 'video/quicktime', 'video-asset', header.mp4], ['audio.webm', 'audio/webm', 'video-asset', header.webm], ['fake.mp4', 'video/mp4', 'video-asset', header.png]]) {
    assert.throws(() => validateLocalMediaFile(file(name, mime), kind, bytes));
  }
});

test('audio uploads accept supported codecs and normalize browser MIME aliases', () => {
  for (const [name, mime, expected, bytes] of [['voice.mp3', 'audio/mp3', 'audio/mpeg', header.mp3], ['voice.wav', 'audio/x-wav', 'audio/wav', header.wav], ['voice.m4a', 'audio/x-m4a', 'audio/mp4', header.mp4], ['voice.ogg', '', 'audio/ogg', header.ogg], ['voice.webm', '', 'audio/webm', header.webm]]) {
    assert.equal(validateLocalMediaFile(file(name, mime), 'audio', bytes), expected);
  }
  assert.throws(() => validateLocalMediaFile(file('wrong.wav', 'audio/wav'), 'audio', header.webp), /内容与格式/);
});

test('upload limits keep data URLs below server limits and reject empty files before reading', () => {
  for (const kind of ['reference', 'audio', 'image-asset', 'video-asset']) {
    const options = localMediaOptions(kind), type = options.mimes[0];
    assert.equal(validateLocalMediaFile(file('valid', type, options.maxBytes), kind), type);
    assert.throws(() => validateLocalMediaFile(file('large', type, options.maxBytes + 1), kind), /文件过大/);
    assert.throws(() => validateLocalMediaFile(file('empty', type, 0), kind), /文件为空/);
    const encodedLength = Math.ceil(options.maxBytes / 3) * 4 + `data:${type};base64,`.length;
    assert(encodedLength < (kind.endsWith('-asset') ? 24_000_000 : 12_000_000));
  }
});

function project() {
  return newProject({ name: '本地文件测试', type: 'nurture', brand: '', product: '', goal: '', audience: '', sellingPoints: '', facts: '', requirements: '', channels: ['xiaohongshu'], deadline: '2026-12-31', budgetUsd: 10, nurture: { topic: '秋天的公园', scene: '午后树影', copyPrompt: '简洁自然' } });
}

test('adopting a local image saves a publishable asset and preserves its previous finished version', () => {
  const p = project(), asset = p.assets[0];
  const input = { title: asset.title, body: asset.body, expectedRevision: asset.revision, mediaData: png, mime: 'image/png' };
  updateAsset(p, asset.id, input);
  assert.equal(asset.status, 'ready'); assert.equal(asset.mediaData, png); assert.equal(asset.revision, 2);
  updateAsset(p, asset.id, { ...input, expectedRevision: 2 });
  assert.equal(asset.history.length, 1); assert.equal(asset.history[0].revision, 2);
});

test('a local file selected for an older revision cannot overwrite newer copy or media', () => {
  const p = project(), asset = p.assets[0], revision = asset.revision;
  updateAsset(p, asset.id, { title: '新标题', body: '新文案', expectedRevision: revision });
  assert.throws(() => updateAsset(p, asset.id, { title: '旧标题', body: '旧文案', expectedRevision: revision, mediaData: png, mime: 'image/png' }), /内容已被修改/);
  assert.equal(asset.title, '新标题'); assert.equal(asset.mediaData, '');
});

test('local video adoption uses the existing format and kind checks without model generation', () => {
  const p = project(), asset = p.assets[0]; asset.kind = 'video';
  const mediaData = `data:video/mp4;base64,${Buffer.from(header.mp4).toString('base64')}`;
  updateAsset(p, asset.id, { title: asset.title, body: asset.body, expectedRevision: asset.revision, mediaData, mime: 'video/mp4' });
  assert.equal(asset.status, 'ready'); assert.equal(asset.mime, 'video/mp4'); assert.equal(p.usage.length, 0);
  assert.throws(() => updateAsset(p, asset.id, { title: asset.title, body: asset.body, expectedRevision: asset.revision, mediaData: png, mime: 'image/png' }), /素材与任务类型不一致/);
});
