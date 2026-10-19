import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../server/domain.mjs';
import { normalizeWorkflow, saveEditorDraft } from '../server/workflow.mjs';
import { mediaPrompt } from '../server/prompts.mjs';
import { createStore } from '../server/store.mjs';
import { validateSceneReference } from '../server/nurture.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const channels = ['xiaohongshu', 'douyin', 'tiktok', 'instagram'];
const brief = (extra = {}) => ({
  name: '慢生活账号养号', type: 'nurture', brand: '', product: '', goal: '', audience: '', sellingPoints: '', facts: '', requirements: '',
  channels, deadline: '2026-12-31', budgetUsd: 10,
  nurture: { topic: '周末公园阅读', scene: '午后公园的长椅旁，树影和一本打开的书。', copyPrompt: '使用三段短句，以一个温和的问题收尾，避免广告语。' }, ...extra,
});

test('nurture needs no product brief and creates one confirmed image task per supported channel', () => {
  const input = brief({ imageData: png });
  for (const key of ['brand', 'product', 'goal', 'audience', 'sellingPoints']) delete input[key];
  const p = domain.newProject(input);
  assert.equal(p.brief.type, 'nurture'); assert.deepEqual(p.brief.nurture, input.nurture);
  assert.equal(p.imageData, png); assert.equal(p.brief.imageData, undefined);
  assert.equal(p.strategies.length, 1); assert.equal(p.strategies[0].status, 'confirmed');
  assert.equal(p.assets.length, 4); assert.deepEqual(p.assets.map(a => a.channel), channels);
  assert(p.assets.every(a => a.kind === 'image' && a.status === 'queued' && a.strategyId === p.strategies[0].id));
  assert.equal(p.publications.length, 0); assert.equal(p.usage.length, 0);
  domain.confirmStrategy(p, p.strategies[0].id);
  assert.equal(p.assets.length, 4, 're-confirming cannot duplicate content');
});

test('nurture rejects missing, blank and oversized required input and unsupported channels', () => {
  for (const [key, max] of [['topic', 100], ['scene', 2000], ['copyPrompt', 4000]]) {
    for (const value of [undefined, '', '  ', '字'.repeat(max + 1)]) {
      assert.throws(() => domain.newProject(brief({ nurture: { ...brief().nurture, [key]: value } })), `${key} must reject ${String(value).slice(0, 20)}`);
    }
  }
  for (const nurture of [undefined, null, '养号']) assert.throws(() => domain.newProject(brief({ nurture })));
  for (const list of [[], ['youtube'], ['xiaohongshu', 'youtube'], ['douyin', 'douyin']]) assert.throws(() => domain.newProject(brief({ channels: list })));
  const maximum = { topic: '题'.repeat(100), scene: '景'.repeat(2000), copyPrompt: '令'.repeat(4000) };
  assert.deepEqual(domain.briefSchema.parse(brief({ nurture: maximum })).nurture, maximum);
});

test('scene references reject spoofed MIME, malformed bytes, non-images and oversized inputs', () => {
  const badImages = [
    'https://example.test/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:video/mp4;base64,AAAA', 'data:image/png;base64,AAAA',
    png.replace('image/png', 'image/jpeg'), png.replace('base64,', 'base64,!'),
    `data:image/png;base64,${'A'.repeat(12000000)}`, {}, 42,
  ];
  for (const imageData of badImages) assert.throws(() => domain.newProject(brief({ imageData })));
  assert.equal(domain.newProject(brief({ imageData: '' })).imageData, '');
  assert.equal(domain.newProject(brief()).imageData, '');
});

test('scene reference validation handles supported formats and large references without a regex stack overflow', () => {
  const jpeg = `data:image/jpeg;base64,${Buffer.from('ffd8ffe000044a46ffd9', 'hex').toString('base64')}`;
  const webp = `data:image/webp;base64,${Buffer.from('524946460c000000574542505650384c00000000', 'hex').toString('base64')}`;
  for (const image of [png, jpeg, webp]) assert.equal(validateSceneReference(image), image);
  // Exercise base64 processing at a realistic multi-megabyte upload size. The
  // validator checks MIME/signatures; decoding complete image pixels is separate.
  const large = `data:image/png;base64,${Buffer.concat([Buffer.from(png.split(',')[1], 'base64'), Buffer.alloc(6_000_000)]).toString('base64')}`;
  assert(large.length < 12_000_000); assert.equal(validateSceneReference(large), large);
  assert.throws(() => validateSceneReference(`${large.slice(0, -1)}!`), error => error.status === 400);
});

test('local publish copy does not expose the user writing instructions or fabricate product claims', () => {
  const p = domain.newProject(brief());
  const { topic, scene, copyPrompt } = p.brief.nurture;
  assert(!p.brief.facts.includes(copyPrompt));
  for (const a of p.assets) {
    assert(a.title.includes(topic)); assert(a.body.includes(scene));
    assert(!a.body.includes(copyPrompt)); assert(!a.title.includes(copyPrompt));
    assert(a.prompt.includes(copyPrompt));
    assert.doesNotMatch(a.body, /产品详细信息待补充|价格|销量|全网|每盒|产地/);
  }
});

test('nurture strategy snapshots keep topic, scene and instructions isolated from later edits and other projects', () => {
  const source = brief(), before = structuredClone(source.nurture), p = domain.newProject(source), a = p.assets[0], s = p.strategies[0];
  const savedAsset = structuredClone(a);
  source.nurture.scene = '调用者之后改掉了对象';
  p.brief.nurture = { topic: '后来改成海边漫步', scene: '新的海边场景', copyPrompt: '后来改成诗歌形式。' };
  const other = domain.newProject(brief({ name: '另一个账号主题', nurture: { topic: '隔离项目的主题', scene: '隔离项目的场景', copyPrompt: '隔离项目专属写作指令' } }));
  assert.deepEqual(s.briefSnapshot.nurture, before); assert.deepEqual(a, savedAsset);
  const recipe = mediaPrompt(p, a, { purpose: 'cover', textMode: 'none', style: 'natural', layout: 'top' });
  for (const value of Object.values(before)) assert(recipe.prompt.includes(value));
  for (const value of [...Object.values(p.brief.nurture), ...Object.values(other.brief.nurture)]) assert(!recipe.prompt.includes(value));
  assert(!recipe.prompt.includes(png));
  const next = domain.makeDraft(p);
  assert.deepEqual(next.briefSnapshot.nurture, p.brief.nurture);
  assert.deepEqual(s.briefSnapshot.nurture, before);
});

test('incomplete nurture drafts survive storage and valid edits do not rewrite confirmed assets', () => {
  const store = createStore(':memory:');
  try {
    const p = domain.newProject(brief()); store.mutate(state => state.projects.unshift(p));
    const incomplete = { ...p.brief, nurture: { topic: '还在输入的主题', scene: '', copyPrompt: '' } };
    const saved = store.mutate(state => saveEditorDraft(state, p.id, { brief: incomplete, expectedVersion: 0, baseBrief: p.brief }, domain.briefSchema));
    assert.equal(saved.draft.applied, false);
    assert.deepEqual(store.get().projectDrafts[p.id].brief.nurture, incomplete.nurture);
    assert.deepEqual(store.get().projects[0].brief, p.brief);
    const updated = { ...p.brief, nurture: { ...p.brief.nurture, topic: '完成后的新主题' } };
    const applied = store.mutate(state => saveEditorDraft(state, p.id, { brief: updated, expectedVersion: 1, baseBrief: p.brief }, domain.briefSchema));
    assert.equal(applied.draft.applied, true);
    const after = store.get().projects[0]; assert.deepEqual(after.brief.nurture, updated.nurture);
    assert.deepEqual(after.strategies, p.strategies); assert.deepEqual(after.assets, p.assets);
    assert.throws(() => store.mutate(state => saveEditorDraft(state, p.id, { brief: updated, expectedVersion: 1, baseBrief: p.brief }, domain.briefSchema)), /另一窗口/);
  } finally { store.close(); }
});

test('legacy launch and daily briefs retain their saved values and existing image/video behavior', () => {
  const legacy = domain.seedState().projects[0].brief;
  for (const type of ['launch', 'daily']) {
    const input = { ...legacy, type }, p = domain.newProject(input);
    assert.deepEqual(p.brief, input); assert.equal(p.assets.length, 0); assert.equal(p.strategies.length, 0);
    const s = domain.makeDraft(p); domain.confirmStrategy(p, s.id);
    assert.deepEqual(p.assets.map(a => [a.channel, a.kind]), [['xiaohongshu', 'image'], ['douyin', 'video']]);
    const restored = normalizeWorkflow({ ...domain.seedState(), projects: [structuredClone(p)] }).projects[0];
    assert.deepEqual(restored.brief, input); assert.deepEqual(restored.assets, p.assets);
    assert.equal(restored.brief.nurture, undefined);
  }
});
