import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceRoute, writeWorkspaceRoute } from '../src/workspace-route.mjs';
import { assetAccountId, assetPublicationRecords, scopedPublications } from '../server/workspace-view.mjs';

const freeze = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child); return value; };
const asset = { id: 'content-a', channel: 'xiaohongshu', revision: 2, contentBrief: { accountId: 'account-a' }, creationTrace: { accounts: [{ platform: 'douyin', accountId: 'other-platform' }, { platform: 'xiaohongshu', accountId: 'old-account' }] } };
const record = (id, extra = {}) => ({ id, assetId: asset.id, assetRevision: 2, accountId: 'account-a', status: 'published', ...extra });

test('workspace route round-trips a specific project, content version context, publication and account without confusing delimiters', () => {
  const projectId = '项目 / p?x=1&y=2#片段';
  const target = { assetId: 'asset?&=#/一', publicationId: 'published+record', accountId: '账号 A & B', tab: 'comments' };
  const hash = writeWorkspaceRoute('comments', projectId, target);
  assert.deepEqual(readWorkspaceRoute(hash), { page: 'comments', projectId, target });
  assert.ok(hash.startsWith('#comments?project='));
});

test('route serialization keeps private creation requests and selected knowledge out of links', () => {
  const target = freeze({ assetId: 'asset-a', requirement: 'PRIVATE_REQUEST_不要进入地址', knowledgeIds: ['PRIVATE_KNOWLEDGE'], newContent: true, token: 'PRIVATE_CREDENTIAL', tab: 'brief' });
  const hash = writeWorkspaceRoute('studio', 'project-a', target);
  assert.doesNotMatch(hash, /PRIVATE|requirement|knowledgeIds|newContent|token/);
  assert.deepEqual(readWorkspaceRoute(hash).target, { assetId: 'asset-a', tab: 'brief' });
  assert.equal(target.requirement, 'PRIVATE_REQUEST_不要进入地址');
});

test('old bookmarks remain valid and unknown or unbounded route input cannot invent navigation fields', () => {
  for (const page of ['dashboard', 'projects', 'corpus', 'trends', 'strategy', 'studio', 'publish', 'comments', 'analytics', 'planning', 'settings', 'help']) {
    assert.equal(readWorkspaceRoute('#' + page).page, page);
  }
  assert.equal(readWorkspaceRoute('#not-a-page').page, 'dashboard');
  assert.equal(writeWorkspaceRoute('not-a-page'), '#dashboard');
  const route = readWorkspaceRoute('#studio?project=' + 'p'.repeat(500) + '&assetId=' + 'a'.repeat(500) + '&accountId=owner&requirement=INJECTED&newContent=true&__proto__=bad');
  assert.equal(route.projectId.length, 200);
  assert.equal(route.target.assetId.length, 200);
  assert.deepEqual(Object.keys(route.target).sort(), ['accountId', 'assetId']);
  assert.equal(Object.getPrototypeOf(route.target), Object.prototype);
});

test('account ownership prefers the frozen content brief and legacy traces match only the content platform', () => {
  assert.equal(assetAccountId(freeze(structuredClone(asset))), 'account-a');
  assert.equal(assetAccountId({ ...asset, contentBrief: undefined }), 'old-account');
  assert.equal(assetAccountId({ ...asset, contentBrief: undefined, creationTrace: { accounts: [{ platform: 'douyin', accountId: 'other-platform' }] } }), '');
  assert.equal(assetAccountId({ id: 'unassigned', channel: 'xiaohongshu' }), '');
});

test('publication completion is scoped by content, current revision and target account, excluding cancelled records', () => {
  const project = freeze({ publications: [record('current'), record('old-version', { assetRevision: 1 }), record('next-version', { assetRevision: 3 }), record('other-account', { accountId: 'account-b' }), record('other-content', { assetId: 'content-b' }), record('cancelled', { status: 'cancelled' }), record('scheduled', { status: 'scheduled' }), record('exported', { status: 'exported' })] });
  assert.deepEqual(assetPublicationRecords(project, asset).map(row => row.id), ['current', 'scheduled', 'exported']);
  assert.deepEqual(assetPublicationRecords(project, asset, 'account-b').map(row => row.id), ['other-account']);
  assert.deepEqual(assetPublicationRecords(project, asset, 'account-c'), []);
});

test('a legacy content item without account ownership never becomes globally published just because one account published it', () => {
  const legacy = freeze({ id: 'legacy-content', channel: 'xiaohongshu', revision: 1 });
  const project = freeze({ publications: [record('a', { assetId: legacy.id, assetRevision: 1 }), record('b', { assetId: legacy.id, assetRevision: 1, accountId: 'account-b' })] });
  assert.deepEqual(assetPublicationRecords(project, legacy), []);
  assert.deepEqual(assetPublicationRecords(project, legacy, 'account-a').map(row => row.id), ['a']);
  assert.deepEqual(assetPublicationRecords(project, legacy, 'account-b').map(row => row.id), ['b']);
  assert.deepEqual(assetPublicationRecords(project, legacy, 'account-c'), []);
  assert.equal(assetAccountId(legacy), '');
});

test('changing the account viewing scope does not reassign content, mutate publication history or drop statuses', () => {
  const original = freeze(structuredClone(asset));
  const project = freeze({ publications: [record('a'), record('b', { accountId: 'account-b', status: 'scheduled' }), record('cancelled', { accountId: 'account-b', status: 'cancelled' })] });
  const before = JSON.stringify({ original, project });
  assert.deepEqual(scopedPublications(project, 'account-b').map(row => row.id), ['b', 'cancelled']);
  assert.equal(scopedPublications(project).length, 3);
  assert.deepEqual(scopedPublications(project, 'missing'), []);
  assetPublicationRecords(project, original, 'account-b');
  assert.equal(JSON.stringify({ original, project }), before);
  assert.equal(assetAccountId(original), 'account-a');
});
