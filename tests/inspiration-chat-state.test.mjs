import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestInspirationTarget, changeInspirationTarget, scopedInspirationTurns, inspirationCanReview, inspirationHandoffRequirement, inspirationDraftFingerprint } from '../src/inspiration-chat-state.mjs';

const draft = () => ({ platform: 'xiaohongshu', accountId: 'xhs-a', requirement: 'A_PRIVATE', kind: 'image', knowledgeIds: ['private-a'], experienceIds: ['experience-a'], referenceIds: ['reference-a'], model: 'local-qwen', skillIds: [], publishingNotes: '', idea: { title: 'A', core: 'A', direction: 'A', prompt: 'A' } });
test('an unambiguous named platform proposes a new unbound target without carrying account-private inputs', () => {
  const original = draft(), result = suggestInspirationTarget(original, '帮我做抖音的开场选题');
  assert.equal(result.changed, true); assert.equal(result.draft.platform, 'douyin'); assert.equal(result.draft.accountId, '');
  assert.deepEqual(result.draft.knowledgeIds, []); assert.deepEqual(result.draft.experienceIds, []); assert.deepEqual(result.draft.referenceIds, []); assert.equal(result.draft.idea, undefined); assert.equal(result.draft.requirement, '');
  assert.equal(original.accountId, 'xhs-a'); assert.equal(original.idea.title, 'A');
});
test('ambiguous platforms do not silently reroute and ordinary edits retain the current target', () => {
  assert.equal(suggestInspirationTarget(draft(), '小红书与抖音有什么不同').changed, false);
  assert.equal(suggestInspirationTarget(draft(), '语气轻松一点').draft.accountId, 'xhs-a');
  assert.equal(suggestInspirationTarget(draft(), 'small business').changed, false);
});
test('switching accounts resets private context while history remains available only in its own scope', () => {
  const conversation = { turns: [{ id: 'a', platform: 'xiaohongshu', accountId: 'xhs-a' }, { id: 'b', platform: 'xiaohongshu', accountId: 'xhs-b' }, { id: 'none', platform: 'xiaohongshu', accountId: '' }] };
  assert.deepEqual(scopedInspirationTurns(conversation, 'xiaohongshu', 'xhs-b').map(row => row.id), ['b']);
  assert.deepEqual(scopedInspirationTurns(conversation, 'xiaohongshu', '').map(row => row.id), ['none']);
  assert.equal(changeInspirationTarget(draft(), 'xiaohongshu', 'xhs-b').idea, undefined);
});
test('review is blocked for pending results, capacity, unsupported local-data mode or busy work', () => {
  const input = { loaded: true, busy: false, input: '继续改一版' };
  assert.equal(inspirationCanReview(input), true);
  for (const patch of [{ loaded: false }, { busy: true }, { localData: true }, { input: '' }, { input: 'x'.repeat(4001) }, { conversation: { turns: [{ status: 'pending' }] } }, { conversation: { turns: Array.from({ length: 20 }, () => ({ status: 'completed' })) } }]) assert.equal(inspirationCanReview({ ...input, ...patch }), false);
  assert.equal(inspirationCanReview({ ...input, conversation: { turns: [{ status: 'interrupted' }] } }), true);
});
test('handoff uses the currently approved idea rather than an obsolete early user request', () => {
  const value = { ...draft(), requirement: '旧要求：红色为主', idea: { title: '蓝色夏日', core: '采用蓝色而不是红色', direction: '保留完整方向', prompt: '完整提示与已确认最新方案' } };
  const requirement = inspirationHandoffRequirement(value, '再具体一点');
  assert.match(requirement, /蓝色夏日/); assert.doesNotMatch(requirement, /旧要求：红色为主|再具体一点/);
  assert.match(requirement, /不沿用.*早期方案/); assert.equal(value.idea.prompt, '完整提示与已确认最新方案');
  assert(inspirationHandoffRequirement({ ...value, idea: { ...value.idea, title: '题'.repeat(200), core: '文'.repeat(2000) } }).length <= 4000);
  assert.equal(inspirationHandoffRequirement({ ...draft(), idea: undefined }, '新的直接制作要求'), '新的直接制作要求');
});
test('confirmation fingerprints ignore autosave timestamps and object ordering, not substantive changes', () => {
  const before = { ...draft(), updatedAt: '2026-10-20T00:00:00Z' };
  const after = { updatedAt: '2026-10-20T00:00:01Z', ...Object.fromEntries(Object.entries(draft()).reverse()) };
  assert.equal(inspirationDraftFingerprint(before), inspirationDraftFingerprint(after));
  assert.notEqual(inspirationDraftFingerprint(before), inspirationDraftFingerprint({ ...after, accountId: 'different' }));
  assert.notEqual(inspirationDraftFingerprint(before), inspirationDraftFingerprint({ ...after, requirement: 'changed input' }));
});
