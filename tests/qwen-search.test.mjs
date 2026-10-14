import test from 'node:test';
import assert from 'node:assert/strict';
import { qwenSearchSupport, searchQwen, QWEN_SEARCH_MODEL, QWEN_SEARCH_RESERVATION_CNY, QWEN_SEARCH_STANDARD_CNY, QWEN_SEARCH_MAX_TOKENS } from '../server/qwen-search.mjs';

const key = 'sk-test-qwen-search-synthetic-only';
const at = '2026-10-14T05:00:00.000Z';
const source = (extra = {}) => ({ index: 1, title: '校园科技创新活动', url: 'https://news.example.org/article/1', site_name: '示例新闻', ...extra });
const payload = (overrides = {}) => ({
  output: { choices: [{ finish_reason: 'stop', message: { content: '这是模型撰写的总结，绝不能视为网页原文。' } }], search_info: { search_results: [source()] } },
  usage: { input_tokens: 2_000, output_tokens: 100, plugins: { search: { count: 1 } } },
  ...overrides,
});
const respond = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('Qwen search uses one native Beijing request, selected workspace, bounded output and forced seven-day turbo search', async () => {
  const calls = [], lifecycle = [], settlements = [];
  const result = await searchQwen(['校园', '科技', '消费', 'extra'], {
    key, at, connection: { region: 'cn-beijing', workspaceId: 'workspace-example' },
    onRequest: async event => { lifecycle.push('reserve'); assert.equal(event.requestCount, 1); assert.equal(event.reservationCny, QWEN_SEARCH_RESERVATION_CNY); },
    onUsage: event => { lifecycle.push('settle'); settlements.push(event); },
    fetcher: async (url, init) => { lifecycle.push('fetch'); calls.push({ url, init }); return respond(payload()); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://workspace-example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);
  assert.equal(calls[0].init.redirect, 'error');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, QWEN_SEARCH_MODEL);
  assert.equal(body.parameters.enable_search, true);
  assert.equal(body.parameters.enable_thinking, false);
  assert.equal(body.parameters.max_tokens, QWEN_SEARCH_MAX_TOKENS);
  assert.deepEqual(body.parameters.search_options, { forced_search: true, enable_source: true, search_strategy: 'turbo', freshness: 7 });
  assert.match(body.input.messages[1].content, /1\. 校园\n2\. 科技\n3\. 消费/);
  assert.doesNotMatch(calls[0].init.body, /extra/);
  assert.deepEqual(lifecycle, ['reserve', 'fetch', 'settle']);
  assert.equal(settlements[0].costCny, 0.0048);
  assert.equal(settlements[0].searchCostCny, QWEN_SEARCH_STANDARD_CNY);
  assert.equal(settlements[0].estimated, false);
  assert.equal(settlements[0].status, 'completed');
  assert.equal(result.items[0].text, '');
  assert.equal(result.items[0].publishedAt, '');
  assert.equal(result.items[0].dateBasis, 'unverified');
  assert.equal(result.items[0].collectedAt, at);
  assert.doesNotMatch(JSON.stringify(result), /这是模型撰写的总结/);
});

test('Qwen search never sends keys to unsupported regions and skips missing settings/queries without billing callbacks', async () => {
  assert.equal(qwenSearchSupport().supported, true);
  let calls = 0;
  const options = { key, at, fetcher: () => { calls++; throw Error('unexpected'); }, onRequest: () => { calls++; }, onUsage: () => { calls++; } };
  for (const region of ['ap-southeast-1', 'us-east-1', 'cn-hongkong', 'ap-northeast-1', 'eu-central-1']) {
    const connection = { region, workspaceId: 'test-workspace' };
    assert.equal(qwenSearchSupport(connection).supported, false);
    const result = await searchQwen(['校园'], { ...options, connection });
    assert.equal(result.reports[0].status, 'skipped');
  }
  assert.equal(qwenSearchSupport({ region: 'cn-beijing', workspaceId: 'https://evil.example/' }).supported, false);
  assert.equal((await searchQwen([], options)).reports[0].status, 'skipped');
  assert.equal((await searchQwen(['校园'], { ...options, key: '' })).reports[0].status, 'skipped');
  assert.equal(calls, 0);
});

test('Qwen search accepts resolved connection snapshots but rebuilds an official host and ignores injected baseUrl', async () => {
  const connection = { region: 'cn-beijing', workspaceId: 'safe-space', label: '北京', ragSupported: true, baseUrl: 'https://attacker.example/compatible-mode/v1' };
  assert.equal(qwenSearchSupport(connection).supported, true);
  let endpoint;
  await searchQwen(['校园'], { key, at, connection, fetcher: async url => { endpoint = url; return respond(payload()); } });
  assert.equal(endpoint, 'https://safe-space.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation');
  assert.equal(qwenSearchSupport({ ...connection, region: 'ap-southeast-1', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }).supported, false);
});

test('Qwen search respects budget/session callback rejection before sending a request', async () => {
  const guard = Error('local session closed'); let calls = 0, settled = 0;
  await assert.rejects(searchQwen(['校园'], { key, at, onRequest: () => { throw guard; }, onUsage: () => { settled++; }, fetcher: () => { calls++; } }), error => error === guard);
  assert.equal(calls, 0); assert.equal(settled, 0);
});

test('Qwen search never swallows usage settlement failure or makes a duplicate charge attempt', async () => {
  const guard = Error('ledger unavailable'); let calls = 0, settled = 0;
  await assert.rejects(searchQwen(['校园'], { key, at, onUsage: () => { settled++; throw guard; }, fetcher: async () => { calls++; return respond(payload()); } }), error => error === guard);
  assert.equal(calls, 1); assert.equal(settled, 1);
});

test('Qwen search only accepts structured source links, strips tracking, deduplicates and does not trust model dates/body', async () => {
  const result = await searchQwen(['校园'], { key, at, fetcher: async () => respond(payload({ output: {
    choices: [{ message: { content: JSON.stringify({ url: 'https://invented.example/a', datePublished: at, body: 'invented article' }) } }],
    search_info: { search_results: [
      source({ url: 'https://news.example.org/article/1?utm_source=ai&token=private', text: 'forged source body', publishedAt: at }),
      source(),
      source({ url: 'https://127.0.0.1/private' }),
      source({ url: 'file:///C:/secret' }),
      source({ url: 'https://name:password@example.org/a' }),
      source({ url: `https://news.example.org/${key}` }),
      source({ url: 'https://news.example.org/article/2', title: `title ${key}`, site_name: `site ${key}` }),
    ] },
  } })) });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].url, 'https://news.example.org/article/1');
  assert.equal(result.items[0].text, '');
  assert.equal(result.items[0].publishedAt, '');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
  assert.doesNotMatch(JSON.stringify(result), /private|forged source body|invented article|invented\.example/);
});

test('Qwen search treats missing or empty search evidence as failure even if model returns fluent news', async () => {
  for (const overrides of [
    { output: { choices: [{ message: { content: 'Today: https://model-link.example/news' } }] } },
    { output: { search_info: { search_results: [] } } },
    { usage: { input_tokens: 20, output_tokens: 10, plugins: { search: { count: 0 } } } },
  ]) {
    let settles = 0;
    const result = await searchQwen(['校园'], { key, at, onUsage: () => { settles++; }, fetcher: async () => respond(payload(overrides)) });
    assert.equal(result.items.length, 0);
    assert.equal(result.reports[0].status, 'failed');
    assert.match(result.reports[0].message, /没有当作新闻导入/);
    assert.equal(settles, 1);
  }
});

test('Qwen search keeps actual source rows from truncated model output but explicitly reports the truncation', async () => {
  const result = await searchQwen(['校园'], { key, at, fetcher: async () => respond(payload({ output: { choices: [{ finish_reason: 'length' }], search_info: { search_results: [source()] } } })) });
  assert.equal(result.items.length, 1);
  assert.match(result.reports[0].message, /长度限制/);
  assert.equal(result.items[0].text, '');
});

test('Qwen search authenticates once and retains unknown reservation without leaking HTTP error details', async () => {
  let calls = 0; const settlements = [];
  const result = await searchQwen(['校园'], { key, at, onUsage: event => settlements.push(event), fetcher: async () => { calls++; return new Response(JSON.stringify({ code: 'InvalidApiKey', message: `secret ${key}` }), { status: 401 }); } });
  assert.equal(calls, 1); assert.equal(result.items.length, 0);
  assert.match(result.reports[0].message, /鉴权/);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].costCny, QWEN_SEARCH_RESERVATION_CNY);
  assert.equal(settlements[0].estimated, true);
  assert.equal(settlements[0].inputTokens, null);
  assert.equal(settlements[0].status, 'uncertain');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
});

test('Qwen search network, malformed and oversized responses retain unknown usage with no retry', async () => {
  for (const respondFailure of [
    () => { throw Error(`network leaked ${key}`); },
    () => new Response('{broken'),
    () => new Response('x'.repeat(2_000_001)),
  ]) {
    let calls = 0; const settlements = [];
    const result = await searchQwen(['校园'], { key, at, onUsage: value => settlements.push(value), fetcher: async () => { calls++; return respondFailure(); } });
    assert.equal(calls, 1); assert.equal(result.reports[0].status, 'failed');
    assert.equal(settlements[0].costCny, QWEN_SEARCH_RESERVATION_CNY);
    assert.equal(settlements[0].estimated, true);
    assert.equal(settlements[0].status, 'uncertain');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
  }
});

test('Qwen search reports HTTP failure separately when usable billing counters are returned', async () => {
  let usage;
  const result = await searchQwen(['校园'], { key, at, onUsage: value => { usage = value; }, fetcher: async () => new Response(JSON.stringify(payload({ code: 'ServiceUnavailable' })), { status: 503 }) });
  assert.equal(result.reports[0].status, 'failed');
  assert.equal(usage.status, 'failed');
  assert.equal(usage.estimated, false);
});

test('Qwen search settles tiered model cost and never misrepresents missing or invalid usage as free', async () => {
  for (const [usage, expected, estimated] of [
    [{ input_tokens: 128_001, output_tokens: 100, plugins: { search: { count: 1 } } }, 0.312202, false],
    [{ input_tokens: 300_000, output_tokens: 100, plugins: { search: { count: 2 } } }, 1.4508, false],
    [{ input_tokens: 500, output_tokens: 10 }, QWEN_SEARCH_RESERVATION_CNY, true],
    [{ input_tokens: '500', output_tokens: -1, plugins: { search: { count: 1 } } }, QWEN_SEARCH_RESERVATION_CNY, true],
    [{ input_tokens: 300_000, output_tokens: 100 }, 1.4448, true],
  ]) {
    let settlement;
    await searchQwen(['校园'], { key, at, onUsage: value => { settlement = value; }, fetcher: async () => respond(payload({ usage })) });
    assert.equal(settlement.costCny, expected);
    assert.equal(settlement.estimated, estimated);
  }
});
