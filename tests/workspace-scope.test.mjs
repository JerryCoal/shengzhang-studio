import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspaceScope, scopeWithPrimary, toggleScopeAccount, toggleScopeProject, scopeHasAccount } from '../src/workspace-scope.mjs';

test('scope retains a unique primary project and validates viewing ids independently', () => {
  const result = normalizeWorkspaceScope({ projectIds:['p2','missing','p2'], accountIds:['a2','missing','a2'] }, ['p1','p2'], ['a1','a2'], 'p1');
  assert.deepEqual(result, { projectIds:['p1','p2'], accountIds:['a2'] });
  assert.deepEqual(normalizeWorkspaceScope(undefined, ['p1'], ['a1'], 'p1'), { projectIds:['p1'], accountIds:[] });
});

test('changing the primary switches a single-project view but preserves an explicit multi-project selection', () => {
  assert.deepEqual(scopeWithPrimary({ projectIds:['p1'], accountIds:['a1'] }, 'p2'), { projectIds:['p2'], accountIds:['a1'] });
  assert.deepEqual(scopeWithPrimary({ projectIds:['p1','p2'], accountIds:['a1'] }, 'p3'), { projectIds:['p1','p2','p3'], accountIds:['a1'] });
});

test('project multi-selection never implicitly changes primary ownership or mutates the source scope', () => {
  const original = Object.freeze({ projectIds:Object.freeze(['p1']), accountIds:Object.freeze(['a1']) });
  const selected = toggleScopeProject(original, 'p2', 'p1');
  assert.deepEqual(selected.projectIds, ['p1','p2']);
  assert.deepEqual(toggleScopeProject(selected, 'p1', 'p1').projectIds, ['p1','p2']);
  assert.deepEqual(toggleScopeProject(selected, 'p2', 'p1').projectIds, ['p1']);
  assert.deepEqual(original, { projectIds:['p1'], accountIds:['a1'] });
});

test('accounts support additive multi-select and explicit all semantics without altering project ids', () => {
  const initial = { projectIds:['p1','p2'], accountIds:[] };
  const one = toggleScopeAccount(initial, 'a1'), two = toggleScopeAccount(one, 'a2');
  assert.deepEqual(two, { projectIds:['p1','p2'], accountIds:['a1','a2'] });
  assert.equal(scopeHasAccount(two, 'a1'), true); assert.equal(scopeHasAccount(two, 'a2'), true);
  assert.equal(scopeHasAccount(two, 'a3'), false); assert.equal(scopeHasAccount(two, undefined), false);
  const all = toggleScopeAccount(toggleScopeAccount(two, 'a1'), 'a2');
  assert.deepEqual(all.accountIds, []); assert.equal(scopeHasAccount(all, 'a3'), true);
  assert.equal(scopeHasAccount(undefined, 'legacy-account'), true);
});
