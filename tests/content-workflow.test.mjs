import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createKnowledge, updateKnowledge, createContentDraft, updateContentBrief, selectKnowledge, previewKnowledge, contentProjectForAsset } from '../server/content-workflow.mjs';
import { resolveAccountCreation, saveAccountCreationProfile } from '../server/account-creation.mjs';
import { mediaPrompt, textInstructions } from '../server/prompts.mjs';
import { removeWebSkillHistory, hasWebSkillHistory } from '../server/web-skill-privacy.mjs';
import { mergeRelayState } from '../server/web-merge.mjs';

function fixture(t) {
  const store = createStore(':memory:'); t.after(() => store.close());
  const state = store.get(), p = state.projects[0];
  state.accounts.push({ id: 'account-xhs-b', platform: 'xiaohongshu', name: '账号乙' });
  saveAccountCreationProfile(state, 'account-xhs', { identityMarkdown: 'ACCOUNT_A_MEMORY', identityFileName: '', presets: [], defaultPresetId: '', expectedRevision: 0 });
  saveAccountCreationProfile(state, 'account-xhs-b', { identityMarkdown: 'ACCOUNT_B_MEMORY', identityFileName: '', presets: [], defaultPresetId: '', expectedRevision: 0 });
  const draft = extra => createContentDraft(state, p, { requestId: randomUUID(), accountId: 'account-xhs', kind: 'image', requirement: '围绕办公喝茶写一篇静态图文', ...extra });
  const save = extra => createKnowledge(state, p, { requestId: randomUUID(), kind: 'reference', title: '办公喝茶参考', text: '办公时可以记录茶具收纳场景。', ...extra });
  return { state, p, draft, save };
}

test('direct drafting creates one compatible confirmed internal task, one bound asset and no fees', t => {
  const { state, p, draft } = fixture(t), count = p.assets.length, strategies = p.strategies.length, spent = p.usage.length;
  const a = draft(); assert.equal(p.assets.length, count + 1); assert.equal(p.strategies.length, strategies + 1); assert.equal(p.usage.length, spent);
  assert.equal(a.body, ''); assert.equal(a.kind, 'image'); assert.equal(a.channel, 'xiaohongshu'); assert.equal(a.contentBrief.accountId, 'account-xhs');
  const s = p.strategies.find(s => s.id === a.strategyId); assert.equal(s.status, 'confirmed'); assert.equal(s.source, 'direct'); assert.equal(s.tasks.length, 1);
  assert.equal(a.creationTrace.accounts[0].accountId, 'account-xhs');
  p.creationSelections = { xiaohongshu: { accountId: 'account-xhs-b', presetId: '' } };
  const creation = resolveAccountCreation(state, contentProjectForAsset(p, a), a.channel, 'copy-xiaohongshu');
  assert.equal(creation.accountContext.accounts[0].accountId, 'account-xhs'); assert.match(JSON.stringify(creation), /ACCOUNT_A_MEMORY/); assert.doesNotMatch(JSON.stringify(creation), /ACCOUNT_B_MEMORY/);
});

test('draft and knowledge idempotency keys cannot duplicate or change the original operation', t => {
  const { p, draft, save } = fixture(t), requestId = randomUUID(), a = draft({ requestId }), revision = p.revision;
  assert.equal(draft({ requestId }).id, a.id); assert.equal(p.revision, revision);
  assert.throws(() => draft({ requestId, requirement: '不同要求' }), /不同输入/);
  assert.throws(() => save({ requestId }), /不同输入/);
  const kId = randomUUID(), k = save({ requestId: kId }); assert.equal(save({ requestId: kId }).id, k.id);
  assert.throws(() => save({ requestId: kId, text: '不同来源' }), /不同输入/);
});

test('knowledge edits and content requirements use independent optimistic revisions without rebinding accounts', t => {
  const { state, p, draft, save } = fixture(t), k = save(), a = draft({ knowledgeIds: [k.id] });
  updateKnowledge(state, p, k.id, { expectedRevision: 1, title: '新的参考标题', active: false });
  assert.equal(k.text, '办公时可以记录茶具收纳场景。'); assert.equal(k.sourceUrl, ''); assert.equal(k.revision, 2);
  assert.throws(() => updateKnowledge(state, p, k.id, { expectedRevision: 1, text: '冲突' }), /另一处/);
  assert.throws(() => updateContentBrief(state, p, a.id, { expectedRevision: 1, requirement: '新要求' }), /停用/);
  updateContentBrief(state, p, a.id, { expectedRevision: 1, requirement: '新的明确要求', knowledgeIds: [] });
  assert.equal(a.revision, 2); assert.equal(a.contentBrief.accountId, 'account-xhs'); assert.equal(a.contentBrief.requirement, '新的明确要求');
  assert.throws(() => updateContentBrief(state, p, a.id, { expectedRevision: 1, requirement: '覆盖' }), /另一处/);
  assert.throws(() => updateContentBrief(state, p, a.id, { expectedRevision: 2, requirement: '换账号', accountId: 'account-xhs-b' }), /Unrecognized key|unrecognized_keys/);
});

test('selection includes only relevant active project/account knowledge, filters expiration and preserves original source snapshot', t => {
  const { state, p, save } = fixture(t), shared = save({ sourceUrl: 'https://example.com/source', sourceId: 'source-1', sourceType: 'research' });
  const mine = save({ kind: 'experience', accountId: 'account-xhs', text: '办公喝茶内容采用短句。这是待验证偏好。' });
  save({ accountId: 'account-xhs-b', text: 'B_ONLY 办公喝茶' });
  const expired = save({ expiresAt: '2020-01-01T00:00:00Z', text: 'EXPIRED 办公喝茶' });
  const inactive = save({ text: 'INACTIVE 办公喝茶' }); updateKnowledge(state, p, inactive.id, { expectedRevision: 1, active: false });
  save({ title: '银河轨道', text: '恒星风与轨道参数' });
  const selection = selectKnowledge(p, { accountId: 'account-xhs', query: '办公喝茶', now: Date.parse('2026-10-18T00:00:00Z') });
  assert.deepEqual(new Set(selection.entries.map(e => e.id)), new Set([shared.id, mine.id]));
  assert.match(selection.summary, /经验/); assert.doesNotMatch(JSON.stringify(selection), /B_ONLY|EXPIRED|INACTIVE|恒星/);
  updateKnowledge(state, p, shared.id, { expectedRevision: 1, text: '修改后的资料' }); assert.equal(selection.entries.find(e => e.id === shared.id).text, '办公时可以记录茶具收纳场景。');
  assert.equal(selection.entries.find(e => e.id === shared.id).sourceUrl, 'https://example.com/source');
  assert.equal(selectKnowledge(p, { query: '办公喝茶' }).entries.some(e => e.id === mine.id), false);
  assert.throws(() => selectKnowledge(p, { knowledgeIds: [expired.id], strict: true }), /过期/);
});

test('manual references stay bounded and preview is read only, enforcing asset account ownership', t => {
  const { state, p, draft, save } = fixture(t), k = save({ text: '茶'.repeat(12000), accountId: 'account-xhs' }), a = draft({ knowledgeIds: [k.id] });
  const before = JSON.stringify(p), result = previewKnowledge(state, p, { assetId: a.id, query: 'unmatched' });
  assert.equal(result.entries[0].selection, 'explicit'); assert.equal(result.entries[0].text.length, 1000); assert.equal(result.entries[0].excerpt, true); assert.equal(JSON.stringify(p), before);
  assert.throws(() => previewKnowledge(state, p, { assetId: a.id, accountId: 'account-xhs-b' }), /其他账号/);
  assert.throws(() => draft({ knowledgeIds: [save({ accountId: 'account-xhs-b' }).id] }), /其他账号/);
  assert.throws(() => save({ sourceUrl: 'https://user:password@example.com' }), /来源链接/);
  assert.throws(() => draft({ accountId: 'missing' }), /账号不存在/);
});

test('media prompt uses current requirement, scoped saved references and existing corpus without promoting experience to facts', t => {
  const { state, p, draft, save } = fixture(t), k = save({ kind: 'experience', text: 'EXPERIENCE_A 办公喝茶使用短句', accountId: 'account-xhs' });
  save({ text: 'OTHER_ACCOUNT 办公喝茶', accountId: 'account-xhs-b' });
  p.corpus = [{ id: 'corpus-1', name: '办公喝茶产品资料', enabled: true, purpose: 'product_facts', text: '茶具容量 200 毫升', chunks: [{ index: 0, text: '办公喝茶的茶具容量 200 毫升' }] }];
  const a = draft({ knowledgeIds: [k.id] }); updateContentBrief(state, p, a.id, { expectedRevision: 1, requirement: 'UPDATED_REQUIREMENT 办公喝茶极简构图' });
  const context = resolveAccountCreation(state, contentProjectForAsset(p, a), a.channel, 'cover').accountContext;
  const recipe = mediaPrompt(p, a, { purpose: 'cover', accountContext: context });
  assert.match(recipe.prompt, /UPDATED_REQUIREMENT/); assert.match(recipe.prompt, /EXPERIENCE_A/); assert.match(recipe.prompt, /200 毫升/); assert.doesNotMatch(recipe.prompt, /OTHER_ACCOUNT/);
  assert.match(recipe.prompt, /不能当作已证实规律、评分样本/); assert.equal(recipe.knowledgeContext.entries[0].id, k.id);
  assert.match(textInstructions('copy', { requirement: a.contentBrief.requirement, knowledgeContext: recipe.knowledgeContext, task: { channel: a.channel } }), /本篇创作要求/);
});

test('historical projects and assets without new fields keep old account selection and empty knowledge compatibility', t => {
  const { state, p } = fixture(t); delete p.knowledge; delete p.contentRequests;
  const old = { id: 'old', channel: 'xiaohongshu' }; assert.equal(contentProjectForAsset(p, old), p);
  assert.deepEqual(selectKnowledge(p).entries, []); assert.deepEqual(previewKnowledge(state, p).entries, []);
  assert.throws(() => createContentDraft(state, p, { requestId: randomUUID(), accountId: 'account-xhs', kind: 'image', requirement: 'x', knowledgeIds: ['missing'] }), /已不存在/);
});

test('all four image channels and video content preserve explicit kind while YouTube images are rejected', t => {
  const { state, p, draft } = fixture(t);
  for (const platform of ['douyin', 'tiktok', 'instagram', 'youtube']) state.accounts.push({ id: `new-${platform}`, name: platform, platform });
  for (const platform of ['xiaohongshu', 'douyin', 'tiktok', 'instagram']) { const a = draft({ accountId: platform === 'xiaohongshu' ? 'account-xhs' : `new-${platform}` }); assert.equal(a.channel, platform); assert.equal(a.kind, 'image'); }
  assert.throws(() => draft({ accountId: 'new-youtube' }), /YouTube/);
  p.brief.type = 'nurture'; p.brief.nurture = { topic: '茶', scene: '桌面', copyPrompt: '短句' };
  const video = draft({ kind: 'video', accountId: 'new-youtube' }); assert.equal(video.kind, 'video'); assert.equal(p.strategies.find(s => s.id === video.strategyId).briefSnapshot.type, 'daily');
});

test('static-image copy instructions override each platform video default without changing video or review instructions', () => {
  for (const channel of ['xiaohongshu', 'douyin', 'tiktok', 'instagram']) {
    const image = textInstructions('copy', { task: { channel, kind: 'image' } }); assert.match(image, /【本篇形式：静态图文】/); assert.match(image, /不写视频时长、动作过程、镜头运动或音轨/);
    const video = textInstructions('copy', { task: { channel, kind: 'video' } }); assert.doesNotMatch(video, /【本篇形式：静态图文】/);
    assert.equal(video, textInstructions('copy', { task: { channel } }));
    assert.doesNotMatch(textInstructions('copy', { task: { channel, kind: 'image' }, copyReview: { title: '校验标题' } }), /【本篇形式：静态图文】/);
  }
});

test('relay scrubbing removes private knowledge and embedded requirements while merging cannot inject or overwrite them', t => {
  const { state, p, draft, save } = fixture(t), k = save({ text: 'PRIVATE_KNOWLEDGE' }), a = draft({ requirement: 'PRIVATE_REQUIREMENT', title: '公开标题', knowledgeIds: [k.id] });
  a.knowledgeContext = selectKnowledge(p, { knowledgeIds: [k.id], accountId: 'account-xhs' });
  const base = structuredClone(state); removeWebSkillHistory(base);
  assert.equal(hasWebSkillHistory(base), false); assert.doesNotMatch(JSON.stringify(base), /PRIVATE_KNOWLEDGE|PRIVATE_REQUIREMENT/);
  const remote = structuredClone(base), rp = remote.projects.find(row => row.id === p.id), ra = rp.assets.find(row => row.id === a.id);
  rp.knowledge = [{ id: 'injected', text: 'REMOTE_INJECTION' }]; ra.contentBrief = { accountId: 'account-xhs-b', requirement: 'REMOTE_INJECTION' }; ra.knowledgeContext = { entries: [] }; ra.title = '远端试图覆盖';
  const merged = mergeRelayState(base, remote, state), mp = merged.projects.find(row => row.id === p.id), ma = mp.assets.find(row => row.id === a.id);
  assert.deepEqual(mp.knowledge, p.knowledge); assert.deepEqual(ma, a); assert.equal(mp.contentRequests.length, p.contentRequests.length);
  assert.doesNotMatch(JSON.stringify(merged), /REMOTE_INJECTION/);
  const removed = structuredClone(base), removedProject = removed.projects.find(row => row.id === p.id);
  removedProject.assets = removedProject.assets.filter(row => row.id !== a.id); removedProject.strategies = removedProject.strategies.filter(row => row.id !== a.strategyId);
  const protectedState = mergeRelayState(base, removed, state).projects.find(row => row.id === p.id);
  assert(protectedState.assets.some(row => row.id === a.id)); assert(protectedState.strategies.some(row => row.id === a.strategyId));
});
