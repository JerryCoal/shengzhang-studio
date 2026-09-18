import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, confirmStrategy, updateAsset } from '../server/domain.mjs';
import { guideProgress, updateGuide, nextProjectAction } from '../server/guide.mjs';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';

test('first run works with older state; practice is isolated, free and resumable', () => {
  const state = seedState(), original = structuredClone(state.projects[0]);
  assert.equal(guideProgress(state).guide.welcomeDismissed, false);
  updateGuide(state, { action: 'start' });
  const { project, step } = guideProgress(state);
  assert.equal(step, 0); assert.equal(project.brief.budgetUsd, 0); assert.equal(project.sample, true);
  assert.deepEqual(project.brief.channels, ['xiaohongshu']); assert.equal(project.assets.length, 0); assert.equal(project.usage.length, 0);
  assert.deepEqual(state.projects[1], original);
  updateGuide(state, { action: 'pause' }); updateGuide(state, { action: 'start' });
  assert.equal(state.projects.length, 2); assert.equal(guideProgress(state).project.id, project.id);
  assert.equal(guideProgress(state).guide.active, true);
});

test('practice advances only on real work and invalidates export after the asset changes', () => {
  const state = seedState(); updateGuide(state, { action: 'start' });
  const p = guideProgress(state).project;
  const record = (asset, extra = {}) => updateGuide(state, { action: 'export', projectId: p.id, assetId: asset.id, revision: asset.revision, ...extra });
  assert.throws(() => record({ id: 'missing', revision: 1 }), /先完成/);
  confirmStrategy(p, p.strategies[0].id);
  const a = p.assets[0]; assert.equal(p.assets.length, 1); assert.equal(a.kind, 'image');
  assert.equal(guideProgress(state).step, 1); assert.throws(() => record(a), /先完成/);
  updateAsset(p, a.id, { expectedRevision: a.revision, title: a.title, body: a.body, mime: 'image/png', mediaData: png });
  assert.equal(guideProgress(state).step, 2);
  assert.throws(() => record(a, { projectId: state.projects[1].id }), /先完成/);
  assert.throws(() => record(a, { revision: a.revision - 1 }), /先完成/);
  record(a); assert.equal(guideProgress(state).complete, true);
  updateGuide(state, { action: 'pause' }); updateGuide(state, { action: 'start' });
  assert.equal(guideProgress(state).complete, true); assert.equal(p.assets.length, 1);
  updateAsset(p, a.id, { expectedRevision: a.revision, title: a.title, body: a.body + ' 更新正文' });
  assert.equal(guideProgress(state).complete, false); assert.equal(guideProgress(state).step, 2);
});

test('guide preferences validate input and do not alter project content', () => {
  const state = seedState(), before = structuredClone(state.projects);
  updateGuide(state, { action: 'dismiss' }); updateGuide(state, { action: 'tips', enabled: false });
  assert.equal(guideProgress(state).guide.showTips, false);
  assert.equal(guideProgress(state).guide.welcomeDismissed, true); assert.deepEqual(state.projects, before);
  assert.throws(() => updateGuide(state, { action: 'tips', enabled: 'false' }));
  assert.throws(() => updateGuide(state, { action: 'complete' }));
});

test('next action follows creation, publication, feedback and planning', () => {
  const p = seedState().projects[0];
  assert.equal(nextProjectAction().page, 'projects'); assert.equal(nextProjectAction(p).page, 'strategy');
  confirmStrategy(p, p.strategies[0].id); assert.equal(nextProjectAction(p).page, 'studio');
  p.assets[0].status = 'ready'; assert.equal(nextProjectAction(p).page, 'publish');
  p.publications.push({ status: 'scheduled' }); assert.equal(nextProjectAction(p).page, 'publish');
  p.publications[0].status = 'published'; assert.match(nextProjectAction(p).title, /反馈/);
  p.comments.push({ irrelevant: false }); assert.match(nextProjectAction(p).title, /方向/);
  p.insights.push({ status: 'pending' }); assert.match(nextProjectAction(p).title, /建议/);
  p.experiences.push({ active: true }); assert.equal(nextProjectAction(p).page, 'planning');
});
