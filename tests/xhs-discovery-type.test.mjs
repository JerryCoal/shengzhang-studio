import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { xhsMCPResearchItem } from '../server/mcp-platforms.mjs';
import { cleanReferences, validateResearchAnalysis, selectResearch, selectedResearchContext } from '../server/research-data.mjs';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';

const discovery = noteType => ({ timeRange: 'all', sortBy: 'favorites', noteType });
const at = Date.parse('2026-10-14T08:00:00Z');
const noteId = n => String(n).padStart(24, '0');
function raw(n, type, now = at) {
  const envelope = { feed_id: noteId(n), data: { note: { noteId: noteId(n), type, title: `预约自习案例${n}`, desc: `案例${n}先选择自习时间，再确认座位，最后记录使用体验。`, time: now - 86400000, interactInfo: { likedCount: '30', collectedCount: '20', commentCount: '8' } } } };
  return xhsMCPResearchItem(envelope, noteId(n), { at: new Date(now).toISOString(), preserveCompactMetrics: true });
}
function answer(reference) {
  return { analyses: [{ id: 'sample', title: '明确的预约流程', observation: '正文说明预约步骤。', hypothesis: '步骤清楚可能有助于读者理解，需要验证。', application: '结合本项目真实步骤制作说明。', tags: ['预约流程示范'], evidence: [{ referenceId: reference.id, quote: reference.text.slice(0, 18) }], limitations: '仅有当前样本，不推断曝光或增长。', growthAdvice: [{ focus: 'content', action: '测试两种步骤呈现方式。', reason: '样本正文说明了步骤。', validation: '固定其他条件比较收藏数，样本不足继续观察。', referenceIds: [reference.id] }] }] };
}

test('XHS media type is read only from the documented detail field and retained through cleaning', () => {
  const rows = [raw(1, 'normal'), raw(2, 'video'), raw(3, undefined), raw(4, 'image'), raw(5, { value: 'video' })];
  assert.deepEqual(rows.map(row => row.noteType), ['image', 'video', 'unknown', 'unknown', 'unknown']);
  const all = cleanReferences(rows, { at, discovery: discovery('all') });
  assert.equal(all.references.length, 5); assert.equal(all.excluded.noteType, 0);
  assert.deepEqual(all.references.map(row => row.noteType).sort(), ['image', 'unknown', 'unknown', 'unknown', 'video']);
  for (const noteType of ['image', 'video']) {
    const filtered = cleanReferences(all.references, { at, discovery: discovery(noteType) });
    assert.equal(filtered.references.length, 1); assert.equal(filtered.references[0].noteType, noteType); assert.equal(filtered.excluded.noteType, 4);
  }
  const legacy = { ...rows[0] }; delete legacy.noteType;
  assert.equal(cleanReferences([legacy], { at, discovery: discovery('all') }).references[0].noteType, 'unknown');
  assert.equal(cleanReferences([legacy], { at, discovery: discovery('image') }).excluded.noteType, 1);
  const web = cleanReferences([{ ...rows[0], kind: 'web', url: 'https://news.example.net/article', noteType: 'image' }], { at, discovery: discovery('video') });
  assert.equal(web.references.length, 1); assert.equal(web.references[0].noteType, undefined);
});

test('selected XHS references recheck the saved content form before entering new copy', () => {
  const references = cleanReferences([raw(1, 'normal')], { at, discovery: discovery('image') }).references;
  const analyses = validateResearchAnalysis(answer(references[0]), { references, discovery: discovery('image') }).analyses;
  const project = { id: 'fixture-only', research: { revision: 0, references, analyses, selectedIds: [] } };
  selectResearch(project, { expectedRevision: 0, analysisIds: [analyses[0].id], confirmed: true }, at);
  assert.equal(selectedResearchContext(project, at).length, 1);
  for (const noteType of ['video', 'unknown', undefined]) {
    const changed = structuredClone(project); changed.research.references[0].noteType = noteType;
    assert.deepEqual(selectedResearchContext(changed, at), []);
  }
});

test('reanalysis applies the newly selected media type to saved samples before any DeepSeek request', async t => {
  const store = createStore(':memory:'), calls = [], id = store.get().projects[0].id;
  store.mutate(state => { state.projects[0].brief.budgetUsd = 5; state.projects[0].usage = []; });
  const app = createApp(store, { profileMode: true, deepseekVault: { status: () => ({ configured: true, supported: true }), getKey: async () => 'fixture-only-deepseek' }, fetcher: async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.deepseek.com');
    const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content);
    calls.push({ kind: 'analysis', payload });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer(payload.references[0])) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } });
  } });
  app.locals.integrations.mcpResearchStatus = async () => ({ supported: true });
  app.locals.integrations.mcpResearchSearch = async () => { calls.push({ kind: 'mcp' }); return { items: [raw(1, 'normal', Date.now()), raw(2, 'video', Date.now()), raw(3, undefined, Date.now())], reports: [] }; };
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const current = () => store.get().projects[0];
  const cool = () => store.mutate(state => { state.projects[0].research.run.finishedAt = new Date(Date.now() - 20000).toISOString(); });
  async function run(noteType, reuseCollected = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${id}/research/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify({ keywords: ['预约自习'], sources: ['xiaohongshu'], expectedRevision: current().research?.revision || 0, confirmed: true, discovery: discovery(noteType), reuseCollected }) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await run('all')).status, 200);
  assert.equal(calls.at(-1).payload.references.length, 3); cool();
  const first = calls.length, narrowed = await run('image', true);
  assert.equal(narrowed.status, 200, JSON.stringify(narrowed));
  assert.deepEqual(calls.slice(first).map(call => call.kind), ['analysis']);
  assert.equal(calls.at(-1).payload.references.length, 1);
  assert.equal(calls.at(-1).payload.references[0].noteType, 'image');
  assert.equal(narrowed.data.result.excluded.noteType, 2); cool();
  const beforeEmpty = calls.length, empty = await run('video', true);
  assert.equal(empty.status, 400);
  assert.equal(calls.length, beforeEmpty, 'an empty media-type filter must not issue a paid request');
  assert.equal(current().research.references[0].noteType, 'image', 'previous verified sources remain available after a failed filter');
});
