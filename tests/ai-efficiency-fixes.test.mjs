import test from 'node:test';
import assert from 'node:assert/strict';
import { deepseekInstructions } from '../server/deepseek.mjs';
import { generateStage } from '../server/ai.mjs';
import { makeDraft, newProject } from '../server/domain.mjs';
import { importCorpus, corpusPrompt } from '../server/workflow.mjs';

const exampleOf = instructions => JSON.parse(instructions.split('格式示例（只参考结构，不抄示例内容）：').at(-1));

test('JSON schema examples preserve scalar types and falsy enum values in nested records', () => {
  const schema = { type: 'object', properties: {
    comments: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, needsReview: { type: 'boolean' }, score: { type: 'number' }, count: { type: 'integer' },
      optional: { type: 'null' }, enabled: { type: 'boolean', enum: [false] }, zero: { type: 'integer', enum: [0] },
      blank: { type: 'string', enum: [''] }, unset: { type: 'null', enum: [null] }, sentiment: { type: 'string', enum: ['neutral', 'negative'] },
    } } },
  } };
  const original = structuredClone(schema), result = deepseekInstructions('KEEP_SYSTEM_RULE', { schema });
  assert.deepEqual(exampleOf(result), { comments: [{ id: '根据输入填写', needsReview: false, score: 0, count: 0, optional: null, enabled: false, zero: 0, blank: '', unset: null, sentiment: 'neutral' }] });
  assert(result.startsWith('KEEP_SYSTEM_RULE'));
  assert(result.includes(JSON.stringify(schema)), 'the complete validation schema must remain in the prompt');
  assert.deepEqual(schema, original);
});

for (const provider of ['deepseek', 'qwen']) test(`${provider} classification request uses a boolean example and still validates real result evidence`, async () => {
  const payload = { product: '校园自习服务', goal: '介绍参与条件', comments: [{ id: 'comment-1', text: '多少钱？', work: '自习活动介绍' }] };
  const value = { comments: [{ id: 'comment-1', tags: ['价格顾虑'], sentiment: 'neutral', reason: '询价，尚未表达不满', evidence: '多少钱', needsReview: true }] };
  let requests = 0;
  const result = await generateStage(payload, { id: 'classification', provider, model: provider === 'qwen' ? 'qwen-plus' : 'deepseek-v4-pro', apiKey: 'test-only-no-network', maxTokens: 500, effort: 'low' }, async (url, init) => {
    requests += 1;
    assert.equal(new URL(url).pathname.endsWith('/chat/completions'), true);
    const request = JSON.parse(init.body), example = exampleOf(request.messages[0].content);
    assert.equal(example.comments[0].needsReview, false);
    assert.deepEqual(JSON.parse(request.messages[1].content), payload);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } });
  });
  assert.equal(requests, 1);
  assert.deepEqual(result.value, value);
  assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 30 });
});

function projectWithCorpus() {
  const project = newProject({ name: '校园宣传测试', brand: '测试品牌', product: '自习空间', type: 'launch', goal: '说明预约方式', audience: '希望寻找学习场所的读者', sellingPoints: '安静的学习环境', facts: '设有自习座位', requirements: '描述已知信息', channels: ['xiaohongshu', 'douyin'], deadline: '2026-10-20', budgetUsd: 1 });
  importCorpus(project, { name: '自习预约资料', text: '自习空间提供预约时段，具体可用座位以预约页面为准。', format: 'txt' });
  return project;
}

for (const source of ['openai', 'deepseek', 'qwen']) test(`${source} strategy retains source references without appending the corpus again`, () => {
  const project = projectWithCorpus(), before = structuredClone(project.corpus);
  const prompt = 'MODEL_PROMPT：呈现安静的自习场景；介绍已知预约方式。';
  const draft = makeDraft(project, { title: '校园自习预约', core: '介绍预约条件', direction: '说明适用场景', prompt }, '', source, undefined, '自习预约');
  assert.equal(draft.source, source);
  assert.equal(draft.prompt, prompt);
  assert.equal(draft.corpusReferences.length, 1);
  assert.equal(draft.corpusReferences[0].text, project.corpus[0].text);
  assert.equal(draft.tasks.length, 2);
  for (const task of draft.tasks) {
    assert(task.prompt.includes(prompt));
    assert(!task.prompt.includes(corpusPrompt(draft.corpusReferences)));
  }
  assert.deepEqual(project.corpus, before);
});

for (const source of ['demo', 'manual']) test(`${source} strategy continues to include local corpus context`, () => {
  const project = projectWithCorpus(), prompt = 'LOCAL_PROMPT：介绍自习预约。';
  const draft = makeDraft(project, { prompt }, '', source, undefined, '自习预约');
  assert.equal(draft.corpusReferences.length, 1);
  assert.equal(draft.prompt, prompt + corpusPrompt(draft.corpusReferences));
  assert.equal(draft.source, source);
});
