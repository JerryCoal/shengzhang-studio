import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../server/news-crawler.mjs';
import { NEWS_SOURCES } from '../server/news-sources.mjs';
import { cleanReferences } from '../server/research-data.mjs';

const source = NEWS_SOURCES[0], at = Date.parse('2026-03-02T12:00:00Z');
const feed = dates => '<rss><channel>' + dates.map((date, index) => `<item><title>校园预约观察${index}</title><link>https://${source.hosts[0]}/article/${index}</link><pubDate>${date}</pubDate><description>预约前可了解开放时段。</description></item>`).join('') + '</channel></rss>';

test('RSS refuses ambiguous days, timezone-free timestamps and rollover dates before ISO normalization', () => {
  const invalid = ['2026-03-01', '2026-03-01T12:00:00', '2026-02-30T12:00:00Z', '30 Feb 2026 12:00:00 GMT', '2026-03-01T24:00:00Z', '1 Mar 2026 12:00:00', '昨天'];
  const accepted = ['2026-03-01T12:00:00Z', '2026-03-01T20:00:00+08:00', 'Sun, 01 Mar 2026 12:00:00 GMT', '01 Mar 2026 20:00:00 +0800'];
  const result = parseFeed(feed([...invalid, ...accepted]), source, at);
  assert.equal(result.excluded.undated, invalid.length);
  assert.equal(result.articles.length, accepted.length);
  assert(result.articles.every(article => article.publishedAt === '2026-03-01T12:00:00.000Z'));
  const research = cleanReferences(result.articles.map(article => ({ kind: 'rss', title: article.title, url: article.url, text: article.excerpt, publishedAt: article.publishedAt, dateBasis: 'publisher-feed', collectedAt: article.fetchedAt, sourceName: article.source })), { at });
  assert.equal(research.references.length, accepted.length, 'only precise publisher times enter the research library');
});

test('RSS keeps the exact rolling-week boundary and excludes dates one second outside it', () => {
  const week = 7 * 86400000;
  const result = parseFeed(feed([new Date(at - week).toUTCString(), new Date(at - week - 1000).toISOString(), new Date(at + 1000).toUTCString()]), source, at);
  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.excluded, { old: 1, undated: 0, future: 1, unsafe: 0 });
});
