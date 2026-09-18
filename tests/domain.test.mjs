import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../server/domain.mjs';
import { createStore } from '../server/store.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
function fixture() { const state = d.seedState(); const p = state.projects[0]; const s = p.strategies[0]; d.confirmStrategy(p, s.id); return { state, p, s }; }
function ready(p, asset = p.assets[0]) { return d.updateAsset(p, asset.id, { title: asset.title, body: asset.body, expectedRevision: asset.revision, mediaData: png, mime: 'image/png' }); }
function published() { const { state, p } = fixture(); const a = ready(p); const pub = d.schedulePublication(p, state.accounts, { assetId: a.id, accountId: state.accounts[0].id, scheduledAt: new Date().toISOString() }); d.confirmPublication(p, pub.id, { url: 'https://www.xiaohongshu.com/explore/test-only', confirmed: true }); return { state, p, a, pub }; }

test('confirming a strategy twice creates tasks exactly once', () => {
  const { p, s } = fixture(); assert.equal(p.assets.length, 2); d.confirmStrategy(p, s.id); assert.equal(p.assets.length, 2); assert.ok(s.confirmedAt);
});
test('editing confirmed strategy forks and keeps tasks and brief snapshot immutable', () => {
  const { p, s } = fixture(); const before = structuredClone(s); p.brief.facts = '新的规格';
  const newer = d.editStrategy(p, s.id, { title: '新的主题', core: '重点展示使用体验', direction: s.direction, prompt: s.prompt });
  assert.equal(newer.version, 2); assert.equal(newer.status, 'draft'); assert.deepEqual(s, before);
  assert.equal(p.assets.length, 2); assert.notEqual(s.briefSnapshot.facts, p.brief.facts); assert.match(newer.tasks[0].prompt, /重点展示使用体验/);
});
test('local natural-language adjustments propagate to both channels', () => {
  const { p } = fixture(); const s = d.makeDraft(p, {}, '展示尺寸和装包体验');
  assert.equal(s.tasks.length, 2); for (const t of s.tasks) { assert.match(t.prompt, /展示尺寸和装包体验/); assert.match(t.body, /展示尺寸和装包体验/); assert.equal(t.scenes[1], '展示尺寸和装包体验'); }
});
test('partial regeneration preserves other tasks and previous ready revision', () => {
  const { p } = fixture(); const other = structuredClone(p.assets[1]); const a = ready(p); ready(p, a);
  assert.equal(a.history.length, 1); assert.equal(a.history[0].mediaData, png); assert.deepEqual(p.assets[1], other);
});
test('concurrent asset writes reject stale revisions', () => {
  const { p } = fixture(); const a = ready(p); assert.throws(() => d.updateAsset(p, a.id, { title: a.title, body: 'stale', expectedRevision: 1 }), /已被修改/);
});
test('changing title invalidates the rendered media, and dirty versions are not archived as ready', () => {
  const { p } = fixture(); const a = ready(p); const originalTitle = a.title;
  d.updateAsset(p, a.id, { title: 'New', body: a.body, expectedRevision: a.revision }); assert.equal(a.status, 'queued');
  d.updateAsset(p, a.id, { title: 'Newer', body: a.body, expectedRevision: a.revision }); assert.equal(a.history.length, 1); assert.equal(a.history[0].title, originalTitle);
});
test('invalid media content or wrong asset type is rejected', () => {
  const { p } = fixture(); const a = p.assets[0]; assert.throws(() => d.updateAsset(p, a.id, { title: a.title, body: a.body, expectedRevision: a.revision, mime: 'image/png', mediaData: 'data:image/png;base64,AAAA' }), /格式/);
  assert.throws(() => ready(p, p.assets[1]), /任务类型/);
});
test('publication requires ready media and matching account platform', () => {
  const { state, p } = fixture(); const input = { assetId: p.assets[0].id, accountId: state.accounts[0].id, scheduledAt: new Date().toISOString() };
  assert.throws(() => d.schedulePublication(p, state.accounts, input), /完成内容/); ready(p);
  assert.throws(() => d.schedulePublication(p, state.accounts, { ...input, accountId: state.accounts[1].id }), /平台一致/);
});
test('publication snapshots are independent, and duplicate scheduling is rejected', () => {
  const { state, p, a, pub } = published(); const prior = structuredClone(pub);
  assert.throws(() => d.schedulePublication(p, state.accounts, { assetId: a.id, accountId: pub.accountId, scheduledAt: new Date().toISOString() }), /已加入/);
  d.updateAsset(p, a.id, { title: '新标题', body: '新正文', expectedRevision: a.revision }); assert.deepEqual(pub, prior);
});
test('published state requires explicit user confirmation and trusted platform URL', () => {
  const { p, pub } = published();
  for (const url of ['https://xiaohongshu.com.evil.example/xx', 'javascript:alert(1)', 'https://www.douyin.com/video/1', 'https://user:pass@xiaohongshu.com/xx']) assert.throws(() => d.confirmPublication(p, pub.id, { url, confirmed: true }));
  assert.throws(() => d.confirmPublication(p, pub.id, { url: pub.url, confirmed: false }), /确认/);
});
test('comments require published provenance, dedupe per work, preserve criticism', () => {
  const { p, pub } = published();
  const report = d.importComments(p, { publicationId: pub.id, text: '价格太贵，不喜欢\n价格太贵，不喜欢\n尺寸是多少？\n 尺寸 是多少？ ' });
  assert.deepEqual(report, { added: 2, duplicates: 2 }); assert.equal(p.comments[0].sentiment, 'negative'); assert.equal(p.comments[0].irrelevant, false); assert.equal(p.comments[0].strategyId, pub.strategyId); assert.equal(p.comments[0].commentAt, null); assert.equal(p.comments[0].likes, null);
  const other = { ...pub, id: d.id() }; p.publications.push(other); assert.equal(d.importComments(p, { publicationId: other.id, text: '尺寸是多少？' }).added, 1);
});
test('analysis traces exact evidence and ignores manually excluded comments', () => {
  const { p, pub } = published(); d.importComments(p, { publicationId: pub.id, text: '尺寸多大\n携带方便吗\n价格好贵' }); p.comments[2].irrelevant = true;
  const insights = d.analyzeComments(p); assert.equal(insights.length, 1); assert.equal(insights[0].count, 2); assert.equal(insights[0].sampleSize, 2); assert.equal(insights[0].provisional, true); assert.deepEqual(insights[0].evidenceIds, p.comments.slice(0, 2).map(c => c.id));
});
test('adoption enters next prompt and revocation affects future drafts only', () => {
  const { p, pub } = published(); d.importComments(p, { publicationId: pub.id, text: '尺寸是多少' }); const insight = d.analyzeComments(p)[0];
  d.decideInsight(p, insight.id, { status: 'adopted', text: '加入实物比例与装包演示' }); d.decideInsight(p, insight.id, { status: 'adopted' }); assert.equal(p.experiences.length, 1);
  const round = d.makeDraft(p); assert.match(round.prompt, /加入实物比例与装包演示/); assert.equal(round.feedbackIds.length, 1);
  d.decideInsight(p, insight.id, { status: 'pending' }); const later = d.makeDraft(p); assert.equal(later.feedbackIds.length, 0); assert.doesNotMatch(later.prompt, /加入实物比例与装包演示/); assert.match(round.prompt, /加入实物比例与装包演示/);
});
test('SQLite mutations are atomic and roll back partial bad imports', () => {
  const store = createStore(':memory:'); const before = store.get();
  assert.throws(() => store.mutate(state => { state.projects[0].brief.name = 'incorrect'; throw new Error('rollback'); })); assert.deepEqual(store.get(), before); store.close();
});
