import test from 'node:test';
import assert from 'node:assert/strict';
import { controllerHistory, planningConversation } from '../server/work-controller-history.mjs';
import { createStore } from '../server/store.mjs';

test('controller history excludes other members, projects, account scopes and all task-private messages', t => {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 71), scope: 'synthetic-controller-history' });
  t.after(() => store.close());
  const db = store.work;
  for (const [id, ownerId, projectId, accounts] of [['own', 'alpha', 'p', ['a']], ['other-member', 'beta', 'p', ['a']], ['other-project', 'alpha', 'q', ['a']], ['other-account', 'alpha', 'p', ['b']]]) {
    db.put('run', { id, ownerId, projectId, kind: 'planning', taskId: `${id}-task`, status: 'succeeded', createdAt: '2026-10-21T01:00:00.000Z', finishedAt: '2026-10-21T01:01:00.000Z', input: { accountIds: accounts, goal: `${id}-goal`, rawPrompt: 'NEVER_EXPOSE', credentialFingerprint: 'NEVER_EXPOSE' }, artifact: { id, version: 1 } });
    db.put('artifact', { id: `${id}:1`, ownerId, kind: 'plan', body: `${id}-reply` });
  }
  db.put('message', { id: 'private-chat', ownerId: 'alpha', projectId: 'p', taskId: 'own-task', text: 'PRIVATE_TASK_CHAT' });
  const context = planningConversation(db, 'alpha', 'p', ['a']);
  assert.deepEqual(context.map(row => row.role), ['user', 'assistant']);
  assert.equal(context[0].text, 'own-goal'); assert.match(context[1].text, /own-reply/);
  const json = JSON.stringify(context);
  for (const forbidden of ['other-member', 'other-project', 'other-account', 'NEVER_EXPOSE', 'PRIVATE_TASK_CHAT']) assert(!json.includes(forbidden));
  assert.equal(controllerHistory(db, 'alpha', 'p').length, 4);
});

test('follow-up context is bounded to six short public messages and unknown outcomes are factual', t => {
  const store = createStore(':memory:', { key: Buffer.alloc(32, 72), scope: 'synthetic-controller-history-limit' }); t.after(() => store.close());
  for (let n = 0; n < 25; n++) store.work.put('run', { id: `r${n}`, ownerId: 'alpha', projectId: 'p', kind: 'planning', taskId: `t${n}`, status: n === 24 ? 'needs_reconciliation' : 'running', createdAt: new Date(Date.UTC(2026, 9, 21, 0, n)).toISOString(), input: { goal: '很长的需求'.repeat(900), accountIds: ['a'] } });
  assert.equal(controllerHistory(store.work, 'alpha', 'p').length, 40);
  const context = planningConversation(store.work, 'alpha', 'p', ['a']); assert.equal(context.length, 6);
  assert(context.every(row => row.text.length <= 2000)); assert.match(context.at(-1).text, /未知.*核对/);
  assert(!context.at(-1).text.includes('已完成'));
});
