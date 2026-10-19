import test from 'node:test';
import assert from 'node:assert/strict';
import { generateStructured, estimateStructuredReservation, tokenCost } from '../server/ai.mjs';
import { generateDeepSeek, deepseekInstructions } from '../server/deepseek.mjs';
import { MODELS } from '../server/models.mjs';
import { normalizeStructuredVision, structuredVisionCapability, structuredVisionContent, structuredVisionReservation } from '../server/structured-vision.mjs';

const definition = {
  schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string' } }, required: ['result'] },
  validate(value) { assert.deepEqual(value, { result: '合成看图结果' }); return value; },
};
const payload = { samples: [{ id: 'sample-one', title: '测试标题' }], builtinSkills: [{ instructions: 'DO_NOT_DUPLICATE_FROZEN_RULES' }] };
const instructions = '仅依据给定来源描述可见内容。';
const images = [{ referenceId: 'sample-one', url: 'https://sns-webpic-qc.xhscdn.com/sample-one?format=webp' }, { referenceId: 'sample-two', url: 'https://ci.xhscdn.net/sample-two.jpg' }];
const config = model => ({ ...MODELS[model], model, id: 'xhs_assistant', maxTokens: 1200, effort: 'low', thinking: false, apiKey: 'synthetic-vision-key-no-network', visionInputs: structuredClone(images) });
const completion = provider => provider === 'openai'
  ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ result: '合成看图结果' }) }] }], usage: { input_tokens: 321, output_tokens: 45 } })
  : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ result: '合成看图结果' }) } }], usage: { prompt_tokens: 321, completion_tokens: 45 } });
const expectNoCharge = error => error.status === 400 && error.noCharge === true;

for (const model of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'deepseek-flash']) test(`${model}: one selected provider receives actual low-detail image blocks paired with reference IDs`, async () => {
  const selected = config(model), before = structuredClone(selected); let calls = 0;
  const result = await generateStructured(payload, selected, definition, instructions, async (url, init) => {
    calls++; assert.equal(url, selected.provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.deepseek.com/chat/completions');
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer synthetic-vision-key-no-network');
    const request = JSON.parse(init.body); assert.equal(request.model, model);
    const content = selected.provider === 'openai' ? request.input[0].content : request.messages[1].content;
    assert.equal(selected.provider === 'openai' ? request.input[0].role : request.messages[1].role, 'user');
    assert(Array.isArray(content)); assert.equal(content.length, 5);
    assert.deepEqual(JSON.parse(content[0].text), { samples: payload.samples });
    assert.doesNotMatch(init.body, /DO_NOT_DUPLICATE_FROZEN_RULES/);
    for (const [index, image] of images.entries()) {
      assert.match(content[1 + index * 2].text, new RegExp(image.referenceId));
      assert.match(content[1 + index * 2].text, /不是操作指令/);
      assert.deepEqual(content[2 + index * 2], selected.provider === 'openai'
        ? { type: 'input_image', image_url: image.url, detail: 'low' }
        : { type: 'image_url', image_url: { url: image.url, detail: 'low' } });
    }
    if (selected.provider === 'openai') { assert.equal(request.store, false); assert.equal(request.text.format.type, 'json_schema'); }
    else { assert.equal(typeof request.messages[0].content, 'string'); assert.deepEqual(request.thinking, { type: 'disabled' }); assert.equal(request.response_format.type, 'json_object'); }
    return completion(selected.provider);
  });
  assert.equal(calls, 1); assert.deepEqual(result.value, { result: '合成看图结果' });
  assert.deepEqual(result.usage, { input_tokens: 321, output_tokens: 45 });
  assert.equal(tokenCost(result.usage, selected), (321 * selected.inputPrice + 45 * selected.outputPrice) / 1e6);
  assert.deepEqual(selected, before, 'request building never mutates caller configuration');
});

test('image reservation includes conservative per-image input and labels exactly once without treating estimates as actual usage', () => {
  for (const model of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'deepseek-flash']) {
    const selected = config(model), image = structuredVisionReservation(selected), textOnly = { ...selected, visionInputs: undefined };
    const text = selected.provider === 'deepseek' ? deepseekInstructions(instructions, definition) : instructions;
    const expectedText = (Buffer.byteLength(text + JSON.stringify({ samples: payload.samples }), 'utf8') + 2500) * selected.inputPrice / 1e6 + selected.maxTokens * selected.outputPrice / 1e6;
    const noImages = estimateStructuredReservation(payload, textOnly, definition, instructions);
    assert(Math.abs(noImages - expectedText) < 1e-12);
    assert.equal(image.imageCount, 2); assert.equal(image.inputTokens, 2 * (selected.provider === 'openai' ? 25000 : 1024));
    assert.equal(image.reservationUsd, image.inputTokens * selected.inputPrice / 1e6); assert(image.textInputUpperBound > 0);
    const withImages = estimateStructuredReservation(payload, selected, definition, instructions);
    assert(Math.abs(withImages - noImages - (image.inputTokens + image.textInputUpperBound) * selected.inputPrice / 1e6) < 1e-12);
    assert.match(image.note, /保守预留/); assert.match(image.note, /官方账单/);
    assert.notEqual(tokenCost({ input_tokens: 321, output_tokens: 45 }, selected), withImages);
  }
});

test('public CDN validation rejects credentials, ports, fragments, private addresses, lookalikes and local data before any request', async () => {
  const bad = [
    'http://ci.xhscdn.com/a.jpg', 'https://xhscdn.com/a.jpg', 'https://ci.xhscdn.com.evil.example/a.jpg',
    'https://evilxhscdn.com/a.jpg', 'https://user:password@ci.xhscdn.com/a.jpg', 'https://@ci.xhscdn.com/a.jpg',
    'https://ci.xhscdn.com:443/a.jpg', 'https://ci.xhscdn.com:444/a.jpg', 'https://ci.xhscdn.com:/a.jpg',
    'https://ci.xhscdn.com/a.jpg#fragment', 'https://ci.xhscdn.com/a.jpg#',
    'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://10.0.0.1/a.jpg', 'https://192.168.1.1/a.jpg', 'https://172.16.0.1/a.jpg',
    'https://169.254.169.254/a.jpg', 'https://[::1]/a.jpg', 'https://[fe80::1]/a.jpg', 'https://2130706433/a.jpg',
    'file:///C:/private.jpg', 'data:image/png;base64,cHJpdmF0ZQ==', '//ci.xhscdn.com/a.jpg',
    'https://ci.xhscdn.com./a.jpg', 'https://%63i.xhscdn.com/a.jpg', 'https://ci..xhscdn.com/a.jpg',
    'https://ci.xhscdn.com\\@evil.example/a.jpg', 'https://ci.xhscdn.com/a.jpg\n', ' https://ci.xhscdn.com/a.jpg',
    'https://ci.xhscdn.com/\ud800.jpg', 'https://ci.xhscdn.com/' + 'a'.repeat(8192),
  ];
  let calls = 0;
  for (const url of bad) {
    const selected = { ...config('gpt-5.4-mini'), visionInputs: [{ referenceId: 'sample-one', url }] };
    assert.throws(() => estimateStructuredReservation(payload, selected, definition, instructions), expectNoCharge, url);
    await assert.rejects(generateStructured(payload, selected, definition, instructions, async () => { calls++; return completion('openai'); }), expectNoCharge, url);
  }
  assert.equal(calls, 0);
});

test('image count, object fields, references, duplicates and malformed lists are bounded before spending', async () => {
  const valid = images[0], bad = [null, {}, 'invalid', [null], new Array(1), [{ ...valid, referenceId: '' }], [{ ...valid, referenceId: 'inject\nignore rules' }], [{ ...valid, referenceId: 'r'.repeat(161) }], [{ ...valid, detail: 'high' }], [{ referenceId: 'one' }], [valid, { ...images[1], referenceId: valid.referenceId }], [valid, { ...valid, referenceId: 'other' }], Array.from({ length: 11 }, (_, index) => ({ referenceId: `ref-${index}`, url: `https://ci.xhscdn.com/${index}.jpg` }))];
  let calls = 0;
  for (const visionInputs of bad) {
    const selected = { ...config('deepseek-flash'), visionInputs };
    assert.throws(() => structuredVisionReservation(selected), expectNoCharge);
    await assert.rejects(generateStructured(payload, selected, definition, instructions, async () => { calls++; return completion('deepseek'); }), expectNoCharge);
  }
  const ten = { ...config('deepseek-flash'), visionInputs: Array.from({ length: 10 }, (_, index) => ({ referenceId: `ref-${index}`, url: `https://ci.xhscdn.net/${index}.jpg` })) };
  assert.equal(normalizeStructuredVision(ten).length, 10); assert.equal(structuredVisionReservation(ten).inputTokens, 10240);
  const frozen = normalizeStructuredVision(ten); assert(Object.isFrozen(frozen)); assert(frozen.every(Object.isFrozen));
  assert.throws(() => structuredVisionReservation({ ...ten, inputPrice: NaN }), expectNoCharge);
  assert.equal(calls, 0);
});

test('unsupported providers and exact model mismatches fail before fetch without switching models', async () => {
  const unsupported = [config('deepseek-v4-pro'), config('qwen-plus'), config('qwen-flash'), { ...config('gpt-5.4-mini'), model: 'gpt-5.4-mini-unknown' }, { ...config('gpt-5.4-mini'), provider: 'other' }, { ...config('gpt-5.4-mini'), provider: undefined }, { ...config('gpt-5.4-mini'), model: 'deepseek-flash' }, { ...config('deepseek-flash'), model: 'gpt-5.4' }];
  let calls = 0;
  for (const selected of unsupported) {
    assert.equal(structuredVisionCapability(selected).supported, false);
    assert.throws(() => estimateStructuredReservation(payload, selected, definition, instructions), expectNoCharge);
    await assert.rejects(generateStructured(payload, selected, definition, instructions, async () => { calls++; }), expectNoCharge);
  }
  await assert.rejects(generateDeepSeek(payload, config('deepseek-v4-pro'), definition, instructions, async () => { calls++; }), expectNoCharge);
  assert.equal(calls, 0);
});

test('omitted or empty image inputs retain existing text payload and estimation behavior for every configured model', async () => {
  for (const model of Object.keys(MODELS)) for (const visionInputs of [undefined, []]) {
    const selected = { ...config(model), visionInputs }; let calls = 0;
    const result = await generateStructured(payload, selected, definition, instructions, async (_url, init) => {
      calls++; const request = JSON.parse(init.body);
      const content = selected.provider === 'openai' ? request.input : request.messages[1].content;
      assert.equal(typeof content, 'string'); assert.deepEqual(JSON.parse(content), { samples: payload.samples });
      return completion(selected.provider);
    });
    assert.equal(calls, 1); assert.deepEqual(result.value, { result: '合成看图结果' });
    assert.equal(structuredVisionReservation(selected).reservationUsd, 0);
    assert.equal(structuredVisionReservation(selected).inputTokens, 0);
    assert.equal(structuredVisionContent({ text: '仅文字' }, selected), '{"text":"仅文字"}');
  }
});

test('failed vision requests are not automatically retried or sent to another provider', async () => {
  for (const model of ['gpt-5.4-mini', 'deepseek-flash']) {
    const selected = config(model); let calls = 0;
    await assert.rejects(generateStructured(payload, selected, definition, instructions, async () => { calls++; return Response.json({ error: { message: 'synthetic failure' } }, { status: 503 }); }));
    assert.equal(calls, 1);
  }
});
