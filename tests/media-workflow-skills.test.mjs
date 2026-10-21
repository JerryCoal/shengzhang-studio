import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { defaultSeedream } from '../server/seedream-config.mjs';
import { confirmStrategy, seedState } from '../server/domain.mjs';
import { installCreativeSkill, resolveWorkflowSkill } from '../server/creative-skills.mjs';
import { COPY_SKILLS } from '../server/copy-skills.generated.mjs';
import { mediaPrompt } from '../server/prompts.mjs';
import { setBuiltinSkill } from '../server/builtin-skills.mjs';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const workflowIds = ['cover', 'first_frame', 'last_frame', 'video'];
const marker = id => `PRIVATE_${id.toUpperCase()}_RULE：只适用于本步骤。`;
const vault = { status: () => ({ configured: true, supported: true }), getKey: async () => 'test-media-key-never-real' };
const response = () => Response.json({ data: [{ b64_json: png.split(',')[1] }], usage: { generated_images: 1, input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 } });
function install(state, workflowId, instructions = marker(workflowId), name = `test-${workflowId}`) {
  const text = `---\nname: ${name}\ndescription: 用于隔离测试的规则\nversion: 1.0.0\n---\n${instructions}`;
  const skill = installCreativeSkill(state, { workflowId, fileName: `${name}.md`, text, expectedRevision: state.skillsRevision || 0, confirmed: true });
  state.skillSelections[workflowId] = skill.id;
  return skill;
}
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Synthetic media job did not complete');
}
async function fixture(t, onRequest) {
  const store = createStore(':memory:'), preferences = createIntegrationPreferences(), calls = [];
  preferences.saveSeedream({ ...defaultSeedream, imagePriceUsd: .04 });
  preferences.save({ region: 'volcengine', model: 'ep-synthetic-video', reservationUsd: 2, outputPriceUsd: 0 });
  store.mutate(state => { const p = state.projects[0]; confirmStrategy(p, p.strategies[0].id); p.imageData = png; p.brief.budgetUsd = 100; });
  const app = createApp(store, { apiKey: 'test-image-key-never-real', seedreamVault: vault, seedanceVault: vault, integrationPreferences: preferences,
    imageWatermarkInspector: async () => ({ status: 'unavailable', regions: [], message: 'Synthetic fixture' }),
    fetcher: async (url, init) => {
      const request = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
      calls.push({ url, request }); await onRequest?.({ url, request });
      return url.includes('/contents/generations/tasks') ? Response.json({ id: 'synthetic-video-task' }) : response();
    } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await app.locals.integrations.close(); server.close(); server.closeAllConnections(); store.close(); });
  const p = () => store.get().projects[0], asset = kind => p().assets.find(item => item.kind === kind);
  const request = async (kind, path, body) => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${p().id}/assets/${asset(kind).id}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'studio-v1' }, body: JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
  };
  const cover = () => request('image', 'cover', { expectedRevision: asset('image').revision, prompt: '突出真实产品', confirmed: true });
  const frame = (role, provider = 'seedream') => request('video', 'keyframes', { role, provider, prompt: '保持人物和产品一致', expectedRevision: asset('video').revision });
  const video = () => request('video', 'seedance', { productionId: asset('video').aiProduction.id, expectedRevision: asset('video').revision, prompt: '平稳移动镜头', duration: 8, generateAudio: false, confirmed: true });
  return { store, app, calls, p, asset, request, cover, frame, video };
}

test('edited media defaults remain distinct for first and last frame and appear in the exact saved recipe', async t => {
  const f = await fixture(t);
  const ids = { cover: 'cover-art-direction', first_frame: 'keyframe-continuity', last_frame: 'keyframe-continuity', video: 'seedance-motion' };
  f.store.mutate(state => { for (const workflowId of workflowIds) setBuiltinSkill(state, { workflowId, skillId: ids[workflowId], instructions: `DEFAULT_MEDIA_${workflowId}_ONLY`, expectedRevision: state.skillsRevision }); });
  assert.equal((await f.cover()).status, 202); await until(() => f.asset('image').aiCover?.phase === 'ready');
  assert.equal((await f.frame('first_frame', 'openai')).status, 202); await until(() => f.asset('video').aiProduction?.phase === 'frames');
  assert.equal((await f.frame('last_frame')).status, 202); await until(() => f.asset('video').aiProduction?.phase === 'frames');
  assert.equal((await f.video()).status, 202); await until(() => f.asset('video').aiProduction?.phase === 'generating-video');
  const recipes = [f.asset('image').aiCover, ...f.asset('video').aiProduction.frames.map(frame => frame.recipe), f.asset('video').aiProduction.recipe];
  assert.equal(f.calls.length, 4);
  for (const [index, id] of workflowIds.entries()) {
    const prompt = f.calls[index].request.prompt || f.calls[index].request.content[0].text;
    assert(prompt.includes(`DEFAULT_MEDIA_${id}_ONLY`));
    for (const other of workflowIds.filter(value => value !== id)) assert(!prompt.includes(`DEFAULT_MEDIA_${other}_ONLY`));
    assert.equal(recipes[index].skillTrace.builtin[0].instructions, `DEFAULT_MEDIA_${id}_ONLY`);
    assert.match(recipes[index].skillVersions[0].version, /local\./);
  }
  assert.equal(f.calls[3].request.duration, 8); assert.equal(f.calls[3].request.generate_audio, false);
});

test('all media providers receive only their selected workflow rules and keep fixed output controls', async t => {
  const f = await fixture(t), installed = {};
  f.store.mutate(state => {
    for (const id of workflowIds) installed[id] = install(state, id);
    install(state, 'copy-xiaohongshu', 'UNRELATED_COPY_RULE_MUST_NOT_LEAVE_WORKSPACE');
  });
  assert.equal((await f.cover()).status, 202); await until(() => f.asset('image').aiCover?.phase === 'ready');
  assert.equal((await f.frame('first_frame', 'openai')).status, 202); await until(() => f.asset('video').aiProduction?.phase === 'frames');
  assert.equal((await f.frame('last_frame')).status, 202); await until(() => f.asset('video').aiProduction?.phase === 'frames');
  assert.equal((await f.video()).status, 202); await until(() => f.asset('video').aiProduction?.phase === 'generating-video');
  assert.equal(f.calls.length, 4, 'rules must not add a hidden planning or rewriting call');
  const recipes = [f.asset('image').aiCover, ...f.asset('video').aiProduction.frames.map(frame => frame.recipe), f.asset('video').aiProduction.recipe];
  for (let index = 0; index < workflowIds.length; index++) {
    const id = workflowIds[index], call = f.calls[index], recipe = recipes[index];
    const prompt = call.request.prompt || call.request.content[0].text;
    assert(prompt.includes(marker(id)));
    for (const other of workflowIds.filter(other => other !== id)) assert(!prompt.includes(marker(other)), `${other} leaked into ${id}`);
    assert(!prompt.includes('UNRELATED_COPY_RULE_MUST_NOT_LEAVE_WORKSPACE'));
    assert.equal(recipe.skillTrace.user.id, installed[id].id);
    assert.equal(recipe.skillTrace.user.instructions, marker(id));
    assert.deepEqual(recipe.userSkillVersions, [{ id: installed[id].id, name: installed[id].name, version: installed[id].version, workflowId: id }]);
    assert.deepEqual(f.p().usage[index].userSkillVersions, recipe.userSkillVersions);
    assert(!JSON.stringify(f.p().usage[index]).includes(marker(id)), 'usage should hold version summaries, not private rules');
  }
  assert.equal(f.calls[0].request.size, '1728x2304');
  assert.equal(f.calls[1].request.model, 'gpt-image-2'); assert.equal(f.calls[1].request.size, '864x1536');
  assert.equal(f.calls[2].request.size, '1440x2560'); assert.equal(f.calls[2].request.image.length, 2);
  assert.equal(f.calls[3].request.duration, 8); assert.equal(f.calls[3].request.generate_audio, false); assert.equal(f.calls[3].request.watermark, false);
  assert.deepEqual(f.calls.map(call => call.request.watermark), [false, undefined, false, false], 'selected Skills do not change the new no-watermark defaults or add unsupported OpenAI controls');
  assert.equal(f.asset('video').aiProduction.watermarkRequested, false);
  assert.equal(f.calls[3].request.model, 'ep-synthetic-video');
  assert.equal(f.asset('image').aiCover.phase, 'ready', 'generating must not adopt or publish the cover');
});

test('changing the selected media Skill while a job runs does not change its frozen request or trace', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => wait);
  let original;
  f.store.mutate(state => { original = install(state, 'cover', 'ORIGINAL_PRIVATE_COVER_RULE'); });
  try {
    assert.equal((await f.cover()).status, 202);
    f.store.mutate(state => { install(state, 'cover', 'LATER_PRIVATE_COVER_RULE', 'later-cover'); });
    assert.equal(f.asset('image').aiCover.skillTrace.user.id, original.id);
  } finally { release(); }
  await until(() => f.asset('image').aiCover?.phase === 'ready');
  assert(f.calls[0].request.prompt.includes('ORIGINAL_PRIVATE_COVER_RULE')); assert(!f.calls[0].request.prompt.includes('LATER_PRIVATE_COVER_RULE'));
  assert.equal(f.asset('image').aiCover.skillTrace.user.instructions, 'ORIGINAL_PRIVATE_COVER_RULE');
  assert.equal((await f.cover()).status, 202); await until(() => f.asset('image').aiCover?.phase === 'ready');
  assert(f.calls[1].request.prompt.includes('LATER_PRIVATE_COVER_RULE')); assert(!f.calls[1].request.prompt.includes('ORIGINAL_PRIVATE_COVER_RULE'));
});

test('media rules are per workspace, unselected is built-in only, and bad/oversized selections fail before fees', async t => {
  const first = await fixture(t), second = await fixture(t);
  first.store.mutate(state => { install(state, 'cover', 'FIRST_WORKSPACE_PRIVATE_RULE'); });
  second.store.mutate(state => { install(state, 'first_frame', 'SECOND_WORKSPACE_PRIVATE_RULE'); });
  assert.equal((await first.cover()).status, 202); await until(() => first.asset('image').aiCover?.phase === 'ready');
  assert.equal((await second.cover()).status, 202); await until(() => second.asset('image').aiCover?.phase === 'ready');
  assert(first.calls[0].request.prompt.includes('FIRST_WORKSPACE_PRIVATE_RULE'));
  assert(!second.calls[0].request.prompt.includes('FIRST_WORKSPACE_PRIVATE_RULE')); assert(!second.calls[0].request.prompt.includes('SECOND_WORKSPACE_PRIVATE_RULE'));
  assert.equal(second.asset('image').aiCover.skillTrace.user, null);
  assert.deepEqual(second.asset('image').aiCover.userSkillVersions, []);
  assert(second.calls[0].request.prompt.includes(COPY_SKILLS['cover-art-direction']));
  second.store.mutate(state => { install(state, 'cover', 'X'.repeat(20000), 'oversized-cover'); });
  const before = second.p().usage.length;
  const rejected = await second.cover(); assert.equal(rejected.status, 400); assert.match(JSON.stringify(rejected.data), /16000/);
  assert.equal(second.calls.length, 1); assert.equal(second.p().usage.length, before);
  second.store.mutate(state => { state.installedSkills.find(skill => skill.id === state.skillSelections.first_frame).instructions = 'CORRUPTED_INSTALLED_INSTRUCTIONS'; });
  assert.equal((await second.frame('first_frame')).status, 409);
  assert.equal(second.calls.length, 1); assert.equal(second.p().usage.length, before);
});

test('media dictionary replacements never rewrite Skill instructions or generation controls; cross-step snapshots are rejected', () => {
  const state = seedState(), project = state.projects[0]; confirmStrategy(project, project.strategies[0].id);
  const image = project.assets.find(asset => asset.kind === 'image'), video = project.assets.find(asset => asset.kind === 'video');
  install(state, 'video', 'PRIVATE_RULE：false 和 8 必须在规则快照中原样保留；保持镜头节奏。');
  const skill = resolveWorkflowSkill(state, 'video'), original = structuredClone(skill);
  const rules = [{ id: 'word', term: 'false', replacement: '关闭', action: 'replace', enabled: true, risk: 'A' }, { id: 'digit', term: '8', replacement: '八', action: 'replace', enabled: true, risk: 'A' }];
  const recipe = mediaPrompt(project, video, { purpose: 'video', prompt: 'false 8', duration: 8, generateAudio: false, creativeSkill: skill }, rules);
  assert(recipe.prompt.includes(skill.instructions)); assert(recipe.prompt.includes(COPY_SKILLS['seedance-motion']));
  assert.match(recipe.prompt, /【本步要求】关闭 八/); assert.match(recipe.prompt, /总时长 8 秒；generateAudio=false/);
  assert.match(recipe.prompt, /自定义 Skill 不得更换模型、生成参数或授权发布/);
  assert.deepEqual(skill, original);
  assert.throws(() => mediaPrompt(project, image, { purpose: 'cover', creativeSkill: skill }, []), /不属于当前画面步骤/);
});

test('OpenAI frame reserve includes the entire selected Skill prompt before the paid request', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => wait);
  f.store.mutate(state => { install(state, 'first_frame', 'LONG_FRAME_RULE_' + 'A'.repeat(7000)); });
  try {
    assert.equal((await f.frame('first_frame', 'openai')).status, 202);
    assert.equal(f.calls.length, 1);
    const prompt = f.calls[0].request.prompt;
    assert.equal(f.p().usage.at(-1).status, 'running');
    assert.equal(f.p().usage.at(-1).amountUsd, 1 + Buffer.byteLength(prompt, 'utf8') * 5 / 1e6);
    assert(prompt.includes('A'.repeat(7000)), 'no rule truncation');
  } finally { release(); }
  await until(() => f.asset('video').aiProduction?.phase === 'frames');
  assert.equal(f.p().usage.at(-1).amountUsd, .0321, 'settlement still uses returned token usage');
});
