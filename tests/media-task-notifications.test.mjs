import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMediaTasks, projectMediaTasks } from '../src/media-tasks.ts';
import { registerWorkspaceSaver, flushWorkspaceSavers } from '../src/workspace-save.ts';

const projects = phase => [{ id: 'project-a', brief: { name: '品牌A' }, updatedAt: '2026-10-19T01:00:00.000Z', assets: [{ id: 'asset-a', title: '内容A', channel: 'xiaohongshu', contentBrief: { accountId: 'account-a' }, aiCover: { id: 'cover-a', phase } }] }];
test('opening old ready media is silent; an observed active task notifies exactly once', () => {
  const old = mergeMediaTasks([], projectMediaTasks(projects('ready')));
  assert.equal(old.tasks.length, 0); assert.equal(old.completed.length, 0);
  const running = mergeMediaTasks([], projectMediaTasks(projects('generating')));
  assert.equal(running.tasks[0].accountId, 'account-a'); assert.equal(running.tasks[0].page, 'xiaohongshu-agent'); assert.equal(running.tasks[0].externallyManaged, true);
  const completed = mergeMediaTasks(running.tasks, projectMediaTasks(projects('ready')));
  assert.equal(completed.completed.length, 1); assert.equal(completed.tasks[0].status, 'completed');
  assert.equal(mergeMediaTasks(completed.tasks, projectMediaTasks(projects('ready'))).completed.length, 0);
});
test('uncertain media restores without dispatch or a success notification, and viewed state stays viewed', () => {
  const recovery = mergeMediaTasks([], projectMediaTasks(projects('uncertain')));
  assert.equal(recovery.tasks[0].status, 'interrupted'); assert.equal(recovery.completed.length, 0);
  recovery.tasks[0].retained = false;
  assert.equal(mergeMediaTasks(recovery.tasks, projectMediaTasks(projects('uncertain'))).tasks[0].retained, false);
});
test('desktop exit flush waits for all editors and rejects when any draft cannot save', async () => {
  let release, secondSaved = false;
  const first = registerWorkspaceSaver(() => new Promise(resolve => { release = resolve; }));
  const second = registerWorkspaceSaver(async () => { secondSaved = true; });
  const flush = flushWorkspaceSavers(); assert(secondSaved); let done = false; void flush.then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); release(); await flush; first(); second();
  const failed = registerWorkspaceSaver(async () => { throw new Error('Encrypted store unavailable'); });
  await assert.rejects(flushWorkspaceSavers(), /Encrypted store/); failed();
  await flushWorkspaceSavers();
});
