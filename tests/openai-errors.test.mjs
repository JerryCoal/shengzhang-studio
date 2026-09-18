import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAITransport, openAIResponseError } from '../server/openai-errors.mjs';
import { generateKeyframe } from '../server/media-generation.mjs';

const secret = 'sk-only-test-never-expose-1234567890';
const rejected = (code, type = 'insufficient_quota', headers = {}) => Response.json({ error: { code, type, message: `private prompt and key ${secret}` } }, { status: 429, headers });
const request = { method: 'POST', body: JSON.stringify({ model: 'gpt-5.4', input: secret }) };
const endpoint = 'https://api.openai.com/v1/responses';

test('billing subcodes take precedence over generic insufficient_quota and never suggest timed retries', async () => {
  for (const [code, phrase] of [['insufficient_quota', '额度不足'], ['credit_balance_exhausted', '预付余额'], ['project_spend_limit_exceeded', '项目'], ['organization_spend_limit_exceeded', '组织'], ['organization_usage_limit_exceeded', '批准'], ['billing_hard_limit_reached', '计费上限']]) {
    const error = await openAIResponseError(rejected(code, 'insufficient_quota', { 'Retry-After': '3' }));
    assert.equal(error.diagnostic.code, code); assert.equal(error.diagnostic.kind, 'billing');
    assert.ok(error.message.includes(phrase)); assert.equal(error.noCharge, true); assert.equal(error.diagnostic.retryAt, undefined);
    assert.ok(!JSON.stringify(error).includes(secret)); assert.ok(!error.message.includes(secret));
  }
});

test('rate limits honor seconds and HTTP dates; same-model cooldown avoids extra provider calls', async () => {
  let now = Date.parse('2026-09-14T10:00:00Z'), calls = 0;
  const client = createOpenAITransport(async () => { calls++; return calls === 1 ? rejected('slow_down', 'rate_limit_error', { 'Retry-After': '2.2' }) : Response.json({ status: 'completed' }); }, () => now);
  await assert.rejects(client.fetch(endpoint, request), e => e.diagnostic.retryAfterSeconds === 3 && e.noCharge);
  now += 1000;
  await assert.rejects(client.fetch(endpoint, request), e => /2 秒/.test(e.message) && e.status === 429 && e.noCharge);
  assert.equal(calls, 1);
  now += 2100; assert.ok((await client.fetch(endpoint, request)).ok); assert.equal(calls, 2); assert.equal(client.diagnostic(), null);
  const dated = await openAIResponseError(rejected('rate_limit_exceeded', 'requests', { 'Retry-After': 'Mon, 14 Sep 2026 10:01:00 GMT' }), {}, Date.parse('2026-09-14T10:00:00Z'));
  assert.equal(dated.diagnostic.retryAfterSeconds, 60);
  const long = await openAIResponseError(rejected('slow_down', 'rate_limit_error', { 'Retry-After': '172800' }));
  assert.equal(long.diagnostic.retryAfterSeconds, 172800, 'never shorten a valid provider delay');
});

test('unknown or non-JSON 429 remains unknown, oversized responses and arbitrary codes are not exposed', async () => {
  for (const response of [new Response(`<html>${secret}</html>`, { status: 429 }), rejected(secret, secret), new Response('x'.repeat(70000) + secret, { status: 429 })]) {
    const error = await openAIResponseError(response); assert.equal(error.diagnostic.kind, 'unknown_limit');
    assert.equal(error.diagnostic.code, 'http_429'); assert.equal(error.diagnostic.retryAt, undefined);
    assert.ok(!JSON.stringify(error).includes(secret));
  }
});

test('connection checks do not clear a failed generation diagnostic; credentials reset clears it', async () => {
  const a = createOpenAITransport(async url => url.endsWith('/models') ? Response.json({ data: [] }) : rejected('credit_balance_exhausted'));
  const b = createOpenAITransport(async () => Response.json({}));
  await assert.rejects(a.fetch(endpoint, request)); await a.fetch('https://api.openai.com/v1/models', { method: 'GET' });
  assert.equal(a.diagnostic().kind, 'billing'); assert.equal(a.diagnostic().model, 'gpt-5.4'); assert.equal(b.diagnostic(), null);
  a.reset(); assert.equal(a.diagnostic(), null);
});

test('network and timeout outcomes remain uncertain and provider messages never leak', async () => {
  const transport = createOpenAITransport(async () => { throw new Error(secret); });
  await assert.rejects(transport.fetch(endpoint, request), e => e.diagnostic.kind === 'network' && !e.noCharge && !e.message.includes(secret));
  const timeout = await openAIResponseError(new Response('', { status: 408 })); assert.equal(timeout.noCharge, false);
  const busy = await openAIResponseError(Response.json({ error: { code: 'server_is_overloaded' } }, { status: 503 }));
  assert.equal(busy.noCharge, false); assert.equal(busy.diagnostic.kind, 'service');
});

test('keyframe failures use the same specific billing diagnostic without generating a replacement', async () => {
  let calls = 0;
  await assert.rejects(generateKeyframe({ apiKey: secret, prompt: 'test', references: [], quality: 'low' }, async () => { calls++; return rejected('credit_balance_exhausted'); }), e => e.diagnostic.code === 'credit_balance_exhausted' && e.noCharge);
  assert.equal(calls, 1);
});

test('OpenAI diagnostics do not inspect other providers or label their errors as OpenAI', async () => {
  const response = rejected('insufficient_quota');
  const client = createOpenAITransport(async () => response);
  assert.equal(await client.fetch('https://ark.cn-beijing.volces.com/api/v3/tasks', request), response);
  assert.equal(client.diagnostic(), null); assert.equal(response.bodyUsed, false);
});
