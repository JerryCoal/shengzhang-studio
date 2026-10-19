import test from 'node:test';
import assert from 'node:assert/strict';
import { XHS_TITLE_DIMENSIONS, XHS_NOTE_DIMENSIONS, xhsAssistantDefinition, xhsSampleDateRange, xhsSampleItems, safeXhsCoverUrl, xhsAssistantInputSchema } from '../server/xhs-assistant.mjs';

const source = { id: '687df3a1000000000d0184a4', title: '校园自习准备清单', body: '选择安静位置，提前核对开放时间。', url: 'https://www.xiaohongshu.com/explore/687df3a1000000000d0184a4' };
const common = { summary: '依据有限样本的创作参考。', limitations: ['仅一个样本，不能代表平台表现。'], evidence: [{ sampleId: source.id, quote: source.title }] };
const payload = { input: { title: source.title, vision: false }, samples: [source] };
const title = () => ({ ...structuredClone(common), dimensions: XHS_TITLE_DIMENSIONS.map((item, index) => ({ id: item.id, score: index + 1, reason: '具体内容需要改进。' })), improvements: ['明确读者得到的价值。'], alternatives: [{ title: '自习前先核对这份清单', reason: '用清晰的行动表达内容。' }, { title: '校园自习准备的三个步骤', reason: '说明具体主题与内容范围。' }] });

test('title scores are weighted locally with complete unique dimensions and no overlap boost', () => {
  const result = xhsAssistantDefinition('title-score').validate(title(), payload);
  assert.equal(result.totalScore, 3.2); assert.equal(result.grade, 'C'); assert.equal(result.maxScore, 10);
  assert.equal(result.title, source.title); assert.match(result.scoreLabel, /非小红书平台分/);
  assert.equal(result.references[0].url, source.url);
  const duplicate = title(); duplicate.dimensions[1].id = duplicate.dimensions[0].id;
  assert.throws(() => xhsAssistantDefinition('title-score').validate(duplicate, payload), /重复或缺失/);
  const outOfRange = title(); outOfRange.dimensions[0].score = 10.01;
  assert.throws(() => xhsAssistantDefinition('title-score').validate(outOfRange, payload), /超出范围/);
  assert.throws(() => xhsAssistantDefinition('title-score').validate({ ...title(), totalScore: 10 }, payload), /结构/);
});

test('note scores average four 100-point dimensions and distinguish station grade from platform approval', () => {
  const result = xhsAssistantDefinition('note-score').validate({ ...common, dimensions: XHS_NOTE_DIMENSIONS.map((item, i) => ({ id: item.id, score: [91, 81, 71, 61][i], reason: '按给定文本评估。' })), strengths: ['主题具体。'], improvements: ['补充步骤。'], keywords: ['自习'] }, payload);
  assert.equal(result.totalScore, 76); assert.equal(result.maxScore, 100); assert.equal(result.grade, '一般');
  assert.match(result.scoreLabel, /非小红书平台分/);
});

test('scoring evidence requires the current exact sample and a continuous original quote', () => {
  for (const evidence of [[{ sampleId: 'unknown', quote: source.title }], [{ sampleId: source.id, quote: '校园自习攻略清单' }], [{ sampleId: source.id, quote: '选择安静位置，核对开放时间。' }], []]) {
    assert.throws(() => xhsAssistantDefinition('title-score').validate({ ...title(), evidence }, payload), error => error.researchOutputKind === 'evidence');
  }
  assert.throws(() => xhsAssistantDefinition('title-score').validate(title(), { ...payload, samples: [] }), /样本/);
});

test('cover text plans cannot pretend to have seen images and visual reports cover exactly the supplied images', () => {
  const value = { ...common, observations: [], plans: Array.from({ length: 3 }, (_, i) => ({ name: `方案${i + 1}`, headline: '校园自习', prompt: '3:4 静态封面，清晰留白。', layout: '顶部标题', colors: '米白色', reason: '作为文字方案建议。', sampleIds: [source.id] })) };
  const definition = xhsAssistantDefinition('cover-plan'); assert.equal(definition.validate(value, payload).vision, false);
  const observed = { ...value, observations: [{ sampleId: source.id, observation: '标题位于顶部。' }] };
  assert.throws(() => definition.validate(observed, payload), /不能声称/);
  const visualPayload = { ...payload, input: { ...payload.input, vision: true }, visionReferenceIds: [source.id] };
  assert.equal(definition.validate(observed, visualPayload).vision, true);
  assert.throws(() => definition.validate(value, visualPayload), /图片观察/);
  assert.throws(() => definition.validate({ ...observed, observations: [...observed.observations, ...observed.observations] }, visualPayload), /图片观察/);
});

test('provider sample normalization ignores fallback recommendations, author details, ranking scores and unsafe covers', () => {
  const result = xhsSampleItems({ articles: [{ id: source.id, title: source.title, desc: source.body, createTime: '2026-01-01 10:20:30', likedCount: '1.2万', collectedCount: 0, cover: 'https://sns-webpic-qc.xhscdn.com/original.png', authorId: 'private-author', authorNickname: 'private-nickname', totalScore: 14 }], latestHotArticles: [{ id: '000000000000000000000000', title: '不匹配推荐' }] });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].metrics.likes, null); assert.equal(result.items[0].metrics.favorites, 0);
  assert.equal(result.items[0].publishedAt, '2026-01-01T02:20:30.000Z'); assert.match(result.items[0].dateNote, /Asia\/Shanghai/);
  assert.doesNotMatch(JSON.stringify(result), /private-author|private-nickname|totalScore|不匹配推荐/);
  assert(result.warnings.some(value => value.includes('不足 5'))); assert(result.warnings.some(value => value.includes('排除')));
  for (const value of ['http://sns.xhscdn.com/a', 'https://sns.xhscdn.com.evil.test/a', 'https://evil.test/a', 'https://token@sns.xhscdn.com/a', 'https://sns.xhscdn.com:444/a', 'https://sns.xhscdn.com:443/a', 'https://sns.xhscdn.com/a#', 'https://127.0.0.1/a', 'file:///secret']) assert.equal(safeXhsCoverUrl(value), '');
  assert.equal(safeXhsCoverUrl('https://sns.xhscdn.net/a'), 'https://sns.xhscdn.net/a');
  assert.throws(() => xhsSampleItems({ latestHotArticles: [] }), /匹配样本/);
  const ranged = xhsSampleItems({ articles: [{ id: source.id, title: source.title, desc: source.body, createTime: '2026-01-01 10:20:30' }] }, Date.now(), { startDate: '2026-10-01', endDate: '2026-10-17' });
  assert.equal(ranged.items.length, 0); assert.match(ranged.warnings.join(' '), /日期范围/);
});

test('sample time range uses inclusive T+1 Chinese dates and user input has finite length bounds', () => {
  assert.deepEqual(xhsSampleDateRange(1, Date.parse('2026-10-18T02:00:00Z')), { startDate: '2026-10-17', endDate: '2026-10-17' });
  assert.deepEqual(xhsSampleDateRange(7, Date.parse('2026-10-18T02:00:00Z')), { startDate: '2026-10-11', endDate: '2026-10-17' });
  assert.deepEqual(xhsSampleDateRange(3, Date.parse('2026-10-17T16:00:00Z')), { startDate: '2026-10-15', endDate: '2026-10-17' });
  assert.throws(() => xhsSampleDateRange(14));
  for (const [field, max] of Object.entries({ keyword: 150, title: 200, body: 8000, instruction: 4000 })) assert.throws(() => xhsAssistantInputSchema.parse({ mode: 'create', [field]: '字'.repeat(max + 1) }));
});
