import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_SKILLS } from '../server/ai-skills-manifest.mjs';
import { aiSkillWorkflows } from '../server/ai-skill-registry.mjs';
import { COPY_SKILLS, COPY_SKILL_VERSIONS } from '../server/copy-skills.generated.mjs';
import { generateStage } from '../server/ai.mjs';
import { mediaPrompt, PROMPT_VERSION } from '../server/prompts.mjs';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { importCorpus } from '../server/workflow.mjs';

// Expectations intentionally describe product workflows independently of the registry.
const workflowSkills = {
  'document-context': ['document-context'],
  'research-query': ['research-query'],
  'research-analysis': ['research-analysis'],
  strategy: ['marketing-strategy'],
  planning: ['iteration-planning'],
  'copy-xiaohongshu': ['marketing-copywriting', 'xiaohongshu-copywriting', 'natural-copy-editing'],
  'copy-douyin': ['marketing-copywriting', 'douyin-copywriting', 'natural-copy-editing'],
  'word-review': ['sensitive-copy-review'],
  'price-semantic': ['price-context-replacement'],
  classification: ['comment-classification'],
  analysis: ['comment-insight-analysis'],
  cover: ['cover-art-direction'],
  first_frame: ['keyframe-continuity'],
  last_frame: ['keyframe-continuity'],
  video: ['seedance-motion'],
};

function assertOnlySkills(instructions, expected) {
  for (const [id, body] of Object.entries(COPY_SKILLS)) {
    if (expected.includes(id)) {
      assert(instructions.includes(body), `missing required ${id}`);
      assert.equal(instructions.split(body).length - 1, 1, `duplicate ${id}`);
    } else assert(!instructions.includes(body), `unrelated ${id} was included`);
  }
}

function assertRecipe(recipe, workflow) {
  const expected = workflowSkills[workflow];
  assertOnlySkills(recipe.prompt, expected);
  assert.equal(recipe.promptVersion, PROMPT_VERSION);
  assert.deepEqual(recipe.skillVersions, expected.map(id => ({
    id, name: AI_SKILLS.find(skill => skill.id === id).name, version: COPY_SKILL_VERSIONS[id],
  })));
}

test('all 15 visible workflows resolve to the 16 current source Skills and compiled versions', () => {
  const workflows = aiSkillWorkflows();
  assert.equal(workflows.length, 15);
  assert.deepEqual(workflows.map(item => item.id).sort(), Object.keys(workflowSkills).sort());
  const expectedIds = [...new Set(Object.values(workflowSkills).flat())].sort();
  assert.equal(expectedIds.length, 16);
  assert.deepEqual(AI_SKILLS.map(skill => skill.id).sort(), expectedIds);
  assert.deepEqual(Object.keys(COPY_SKILLS).sort(), expectedIds);
  assert.deepEqual(Object.keys(COPY_SKILL_VERSIONS).sort(), expectedIds);
  for (const id of expectedIds) {
    const source = readFileSync(new URL(`../skills/${id}/SKILL.md`, import.meta.url), 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    assert(frontmatter, `${id} has Markdown metadata`);
    assert.match(frontmatter[1], new RegExp(`^name: ${id}$`, 'm'));
    const version = frontmatter[1].match(/^\s+version:\s*["']?([^\s"']+)/m)?.[1];
    assert(version, `${id} has an explicit version`);
    assert.equal(COPY_SKILL_VERSIONS[id], version, `${id} version is stale`);
    assert.equal(COPY_SKILLS[id], source.slice(frontmatter[0].length).trim(), `${id} instructions are stale`);
  }
  for (const workflow of workflows) {
    assert.deepEqual(workflow.skills.map(skill => skill.id), workflowSkills[workflow.id]);
    for (const skill of workflow.skills) {
      assert.equal(skill.instructions, COPY_SKILLS[skill.id]);
      assert.equal(skill.version, COPY_SKILL_VERSIONS[skill.id]);
      assert.equal(skill.name, AI_SKILLS.find(entry => entry.id === skill.id).name);
    }
  }
});

const brief = { brand: '测试品牌', product: '校园学习工具', facts: '目前只支持学习时段预约。' };
const strategy = { title: '学习时段预约', core: '说明预约步骤', direction: '展示实际预约过程', prompt: '用提供的事实说明预约步骤。' };
const comment = { id: 'comment-test-1', text: '预约后可以修改时间吗？' };
const copy = { title: '一起安排学习时间', body: '从预约学习时段开始，按自己的安排选择时间。', prompt: '展示真实学习环境。', scenes: ['选择学习时段', '核对预约信息', '查看预约结果'] };
const cases = [
  { workflow: 'strategy', stage: 'strategy', payload: { brief }, result: strategy, fields: ['title', 'core', 'direction', 'prompt'] },
  { workflow: 'planning', stage: 'planning', payload: { brief, previousStrategy: strategy, adoptedExperiences: [{ summary: '有人询问预约后如何修改时间', evidenceIds: [comment.id] }], comments: [comment] }, result: strategy, fields: ['title', 'core', 'direction', 'prompt'] },
  ...['xiaohongshu', 'douyin'].map(channel => ({ workflow: `copy-${channel}`, stage: 'copy', payload: { brief, strategy, task: { channel }, creativeSkill: null }, result: copy, fields: ['title', 'body', 'prompt', 'scenes'] })),
  { workflow: 'word-review', stage: 'copy', payload: { copyReview: { mode: 'words', title: '神级学习工具', body: '按已确认的事实说明服务。', matches: [{ id: 'word-1', term: '神级', field: 'title', start: 0, end: 2 }] } }, result: { title: '学习工具', body: '按已确认的事实说明服务。' }, fields: ['title', 'body'] },
  { workflow: 'price-semantic', stage: 'copy', payload: { copyReview: { mode: 'semantic', title: '元气学习计划', body: '体验费用19.9元。', matches: [{ id: 'price-1', term: '元', field: 'body', start: 8, end: 9 }] } }, result: { decisions: [{ id: 'price-1', decision: 'replace', reason: '此处是金额单位' }] }, fields: ['decisions'] },
  { workflow: 'classification', stage: 'classification', payload: { product: brief.product, comments: [comment] }, result: { comments: [{ id: comment.id, tags: ['使用疑问'], sentiment: 'neutral', reason: '询问预约修改方式', evidence: '可以修改时间吗', needsReview: false }] }, fields: ['comments'] },
  { workflow: 'analysis', stage: 'analysis', payload: { brief, strategy, comments: [comment] }, result: { insights: [{ category: '使用疑问', title: '说明预约修改方式', observation: '本次样本中有人询问能否修改预约时间。', recommendation: '核对产品实际功能后补充说明，效果待验证。', evidenceIds: [comment.id] }] }, fields: ['insights'] },
];

const providers = {
  openai: { model: 'gpt-5.4-mini', url: 'https://api.openai.com/v1/responses' },
  deepseek: { model: 'deepseek-v4-pro', url: 'https://api.deepseek.com/chat/completions' },
  qwen: { model: 'qwen-plus', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
};

for (const [provider, settings] of Object.entries(providers)) for (const scenario of cases) {
  test(`${provider}: ${scenario.workflow} dispatches only its own Skills and retains its output contract`, async () => {
    const payload = structuredClone(scenario.payload), original = structuredClone(payload), calls = [];
    const config = { id: scenario.stage, provider, model: settings.model, apiKey: 'test-only-fake-key', effort: 'low', thinking: false, maxTokens: 2500 };
    const result = await generateStage(payload, config, async (url, init) => {
      const request = JSON.parse(init.body);
      calls.push({ url, init, request });
      const instructions = provider === 'openai' ? request.instructions : request.messages.find(message => message.role === 'system').content;
      const input = JSON.parse(provider === 'openai' ? request.input : request.messages.find(message => message.role === 'user').content);
      assert.equal(url, settings.url);
      assert.equal(init.headers.Authorization, 'Bearer test-only-fake-key');
      assert.equal(init.method, 'POST');
      assert.equal(request.model, settings.model);
      assert.equal(request.tools, undefined);
      assert.deepEqual(input, original);
      assertOnlySkills(instructions, workflowSkills[scenario.workflow]);
      if (provider === 'openai') {
        assert.equal(request.store, false);
        assert.deepEqual(Object.keys(request.text.format.schema.properties).sort(), [...scenario.fields].sort());
      } else assert.equal(request.response_format.type, 'json_object');
      const text = JSON.stringify(scenario.result);
      return provider === 'openai'
        ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text }] }], usage: { input_tokens: 17, output_tokens: 29 } })
        : Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 17, completion_tokens: 29 } });
    });
    assert.equal(calls.length, 1, 'one generation must not add a hidden planning call');
    assert.deepEqual(result.value, scenario.result);
    assert.deepEqual(result.usage, { input_tokens: 17, output_tokens: 29 });
    assert.deepEqual(payload, original, 'generation must not mutate the input');
  });
}

function mediaFixture() {
  const project = seedState().projects[0];
  project.brief.facts = '测试确认事实：预约需在开始前完成。';
  confirmStrategy(project, project.strategies[0].id);
  const strategy = project.strategies[0];
  strategy.briefSnapshot = { ...project.brief };
  project.brief.facts = '尚未确认的新事实，不应进入制作要求';
  importCorpus(project, { name: '参考外观', text: '产品外观是米白色和绿色，保留包装标识。' });
  const image = project.assets.find(asset => asset.kind === 'image');
  image.title = '学习时间 "一起安排"';
  image.prompt = '保留真实产品形状。';
  const video = project.assets.find(asset => asset.kind === 'video');
  video.prompt = '同一场景中拿起产品，然后平稳放下。';
  return { project, image, video };
}

function referenceLine(recipe) {
  return recipe.prompt.split('\n').find(line => line.startsWith('【参考图用途】'));
}

test('cover title and none modes use the cover Skill and confirmed facts without video controls', () => {
  const { project, image } = mediaFixture();
  const before = structuredClone(project);
  const options = { purpose: 'cover', style: 'clean', layout: 'left', query: '产品外观', prompt: '保留真实包装标识，突出产品。', hasProductReference: true };
  for (const textMode of ['title', 'none']) {
    const recipe = mediaPrompt(project, image, { ...options, textMode }, []);
    assertRecipe(recipe, 'cover');
    const task = recipe.prompt.split('\n').find(line => line.startsWith('【任务】'));
    assert.match(task, /purpose=cover/);
    assert.match(task, new RegExp(`textMode=${textMode}`));
    assert.match(task, /3:4/);
    assert.match(task, /1728×2304/);
    assert.match(task, /左侧/);
    if (textMode === 'title') assert(task.includes(JSON.stringify(image.title)), 'title is quoted without silent editing');
    else {
      assert(!task.includes(image.title), 'no-title task must not request rendering the title');
      assert(!task.includes(JSON.stringify(image.title)), 'no-title task must not request a quoted title');
      assert.match(task, /不添加/);
      assert.match(recipe.prompt, /参考图原有的产品包装与标识照实保留/);
    }
    assert.match(referenceLine(recipe), /图1为产品参考/);
    assert.match(recipe.prompt, /测试确认事实：预约需在开始前完成/);
    assert(!recipe.prompt.includes(project.brief.facts));
    assert.match(recipe.prompt, /参考外观/);
    assert(recipe.corpusReferences.some(reference => reference.name === '参考外观'));
    assert(!recipe.prompt.includes('【生成设置】'), 'a static cover must not inherit video duration/audio controls');
  }
  assert.deepEqual(project, before);
});

test('first and last static keyframes share their Skill but accurately label optional product references', () => {
  const { project, video } = mediaFixture();
  const scenarios = [
    { purpose: 'first_frame', hasProductReference: true, role: '图1为产品参考。' },
    { purpose: 'first_frame', hasProductReference: false, role: '本次没有参考图，不虚构真实界面或包装细节。' },
    { purpose: 'last_frame', hasProductReference: true, role: '图1为产品参考，图2为首帧。' },
    { purpose: 'last_frame', hasProductReference: false, role: '图1为首帧；本次未提供独立产品参考图。' },
  ];
  for (const input of scenarios) {
    // Explicit reference availability must win over a stale project thumbnail.
    project.imageData = input.hasProductReference ? '' : 'data:image/png;base64,iVBORw0KGgo=';
    const recipe = mediaPrompt(project, video, { ...input, prompt: '保持产品形状和包装颜色。' }, []);
    assertRecipe(recipe, input.purpose);
    assert.equal(referenceLine(recipe), `【参考图用途】${input.role}`);
    const task = recipe.prompt.split('\n').find(line => line.startsWith('【任务】'));
    assert(task.includes(`purpose=${input.purpose}`));
    assert.match(task, /9:16 单张静态画面/);
    assert.match(task, input.purpose === 'first_frame' ? /开场状态/ : /结束状态/);
    assert(!recipe.prompt.includes('【生成设置】'));
  }
});

test('video motion prompts carry the selected duration/audio and only the motion Skill for all supported settings', () => {
  const { project, video } = mediaFixture();
  const before = structuredClone(project);
  for (const duration of [5, 8, 12]) for (const generateAudio of [false, true]) {
    const recipe = mediaPrompt(project, video, { purpose: 'video', duration, generateAudio, prompt: '手持产品向右缓慢移动，结尾停稳。' }, []);
    assertRecipe(recipe, 'video');
    assert.equal(referenceLine(recipe), '【参考图用途】按 first_frame / last_frame 标注识别首尾帧。');
    const controls = recipe.prompt.split('\n').find(line => line.startsWith('【生成设置】'));
    assert(controls, 'actual duration and audio settings must be model-visible');
    assert.match(controls, new RegExp(`总时长 ${duration} 秒`));
    assert.match(controls, new RegExp(`generateAudio=${generateAudio}`));
    const task = recipe.prompt.split('\n').find(line => line.startsWith('【任务】'));
    assert.match(task, /purpose=video/);
    assert.match(task, /已检查首尾帧/);
    assert.match(recipe.prompt, /手持产品向右缓慢移动，结尾停稳/);
  }
  assert.deepEqual(project, before);
});

test('user dictionary edits content while leaving builtin Skills and actual generation controls unchanged', () => {
  const { project, image, video } = mediaFixture();
  const rules = [
    { id: 'test-title', term: '标题', replacement: '提要', action: 'replace', enabled: true, risk: 'A' },
    { id: 'test-number', term: '8', replacement: '八', action: 'replace', enabled: true, risk: 'A' },
    { id: 'test-boolean', term: 'false', replacement: '关闭', action: 'replace', enabled: true, risk: 'A' },
  ];
  image.title = '标题8 false';
  image.prompt = video.prompt = '资料里的标题8 false';
  const before = structuredClone(project), rulesBefore = structuredClone(rules);
  const coverInput = { purpose: 'cover', textMode: 'title', prompt: '标题写成8，附注false。' };
  const videoInput = { purpose: 'video', duration: 8, generateAudio: false, prompt: '标题写成8，附注false。' };
  const originalInputs = structuredClone([coverInput, videoInput]);
  for (const [asset, input] of [[image, coverInput], [video, videoInput]]) {
    const recipe = mediaPrompt(project, asset, input, rules);
    assertRecipe(recipe, input.purpose);
    assert.equal(recipe.prompt.split('\n').find(line => line.startsWith('【本步要求】')), '【本步要求】提要写成八，附注关闭。');
    const dataLine = recipe.prompt.split('\n').find(line => line.startsWith('【参考资料】'));
    assert.match(dataLine, /资料里的提要八 关闭/);
    assert.equal(recipe.copyReview.source.prompt, input.prompt, 'review retains the unscreened user request');
    for (const rule of rules) assert(recipe.copyReview.hits.some(hit => hit.ruleId === rule.id && hit.field === 'prompt'));
    if (input.purpose === 'cover') {
      const task = recipe.prompt.split('\n').find(line => line.startsWith('【任务】'));
      assert(task.includes(JSON.stringify('提要八 关闭')), 'the image title uses the screened content');
      assert.match(task, /1728×2304/, 'dictionary entries must not rewrite output dimensions');
      assert.equal(recipe.copyReview.source.title, image.title);
    } else {
      const controls = recipe.prompt.split('\n').find(line => line.startsWith('【生成设置】'));
      assert.match(controls, /总时长 8 秒；generateAudio=false/);
      assert(!controls.includes('八') && !controls.includes('关闭'), 'content replacements must not change model controls');
    }
  }
  assert.deepEqual(project, before, 'source project, assets and corpus remain unchanged');
  assert.deepEqual([coverInput, videoInput], originalInputs);
  assert.deepEqual(rules, rulesBefore);
});

test('media Skill routing does not bypass the confirmed-strategy requirement', () => {
  const { project, image, video } = mediaFixture();
  project.strategies[0].status = 'draft';
  for (const purpose of ['cover', 'first_frame', 'last_frame', 'video']) {
    assert.throws(() => mediaPrompt(project, purpose === 'cover' ? image : video, { purpose }, []), /先确认/);
  }
});
