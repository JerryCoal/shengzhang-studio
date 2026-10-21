import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReviewedPublication, runPublicationBatch } from '../server/publish-batch.mjs';

const row = (id, platform, mode = 'external') => ({ id, platform, projectId: 'p', publicationId: id, mode });
test('multi-platform batch overlaps different channels but serializes the same platform and never retries a failed row', { timeout: 5000 }, async () => {
  const gate = Promise.withResolvers(), calls = [], updates = [], active = new Set(); let peak = 0;
  const result = await runPublicationBatch([row('x1', 'xiaohongshu'), row('x2', 'xiaohongshu'), row('y1', 'youtube')], {
    submit: async item => {
      assert(!active.has(item.platform)); active.add(item.platform); peak = Math.max(peak, active.size); calls.push(item.id);
      if (item.id === 'x1') await gate.promise;
      if (item.id === 'y1') gate.resolve();
      active.delete(item.platform);
      if (item.id === 'x1') throw new Error('结果不明，请核对');
      return { note: '需要登记真实回执' };
    }, update: (item, value) => updates.push([item.id, value.status]),
  });
  assert.equal(peak, 2); assert.deepEqual(calls, ['x1', 'y1', 'x2']);
  assert.deepEqual(result.map(item => item.status), ['review', 'returned', 'returned']);
  assert.equal(updates.filter(item => item[0] === 'x1' && item[1] === 'running').length, 1);
});
test('desktop assistants are sequential across channels and a checkpoint failure prevents every external call', async () => {
  let active = false, calls = 0;
  await runPublicationBatch([row('a', 'xiaohongshu', 'builtin'), row('b', 'douyin', 'builtin')], { submit: async () => { assert(!active); active = true; await Promise.resolve(); calls++; active = false; return {}; } });
  assert.equal(calls, 2);
  await assert.rejects(runPublicationBatch([row('c', 'xiaohongshu')], { checkpoint: async () => { throw Error('无法保存'); }, submit: async () => { assert.fail('must not dispatch'); } }), /无法保存/);
});
test('batch rejects duplicate or unbounded rows before dispatch', async () => {
  const actions = { submit: async () => { assert.fail('must not dispatch'); } };
  await assert.rejects(runPublicationBatch([], actions));
  await assert.rejects(runPublicationBatch([row('a','youtube'), row('a','xiaohongshu')], actions));
  await assert.rejects(runPublicationBatch(Array.from({length:21},(_,i)=>row(String(i),'youtube')), actions));
});
function fixture() {
  const asset = { id: 'a', revision: 2, channel: 'xiaohongshu', title: '标题', body: '正文', mime: 'image/png', status: 'ready', mediaData: 'image', creationTrace: { accounts: [{ platform: 'xiaohongshu', accountId: 'account-a' }] } };
  const state = { accounts: [{id:'account-a',platform:'xiaohongshu'},{id:'account-b',platform:'youtube'}], projects: [{id:'p',assets:[asset],publications:[]},{id:'other',assets:[{...asset}],publications:[]}] };
  const review = {projectId:'p',assetId:'a',accountId:'account-a',platform:'xiaohongshu',expectedRevision:2,originalTitle:'标题',originalBody:'正文',originalMime:'image/png'};
  return { state, review, asset };
}
test('reviews remain bound to the original project/account/version and reject content or identity changes', () => {
  const {state,review,asset}=fixture(); assert.equal(assertReviewedPublication(state,review).project.id,'p');
  assert.throws(()=>assertReviewedPublication(state,{...review,accountId:'account-b'}),/归属/);
  assert.throws(()=>assertReviewedPublication(state,{...review,projectId:'missing'}),/项目/);
  asset.revision++; assert.throws(()=>assertReviewedPublication(state,review),/修改/); asset.revision--;
  asset.body='新正文'; assert.throws(()=>assertReviewedPublication(state,review),/修改/);
});
test('a duplicate scheduled record is reused; submitted, cancelled, stale and sample records never replay', () => {
  const {state,review}=fixture(), p=state.projects[0];
  const pub={id:'pub',assetId:'a',assetRevision:2,platform:'xiaohongshu',accountId:'account-a',title:'标题',body:'正文',mime:'image/png',status:'scheduled'};
  p.publications.push(pub); assert.equal(assertReviewedPublication(state,review).existing.id,'pub');
  pub.delivery={phase:'submitting'}; assert.throws(()=>assertReviewedPublication(state,review),/核对/);
  delete pub.delivery; pub.status='published'; assert.throws(()=>assertReviewedPublication(state,review));
  pub.status='cancelled'; assert.throws(()=>assertReviewedPublication(state,{...review,publicationId:'pub'}));
  pub.status='scheduled'; pub.sample=true; assert.throws(()=>assertReviewedPublication(state,{...review,publicationId:'pub'}));
});
