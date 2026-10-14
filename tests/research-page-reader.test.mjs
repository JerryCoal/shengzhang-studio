import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { enrichResearchPages } from '../server/research-page-reader.mjs';
import { cleanReferences } from '../server/research-data.mjs';

const AT = '2026-10-14T08:00:00.000Z', DATE = '2026-10-13T18:00:00+08:00';
const ADDRESS = { address: '93.184.216.34', family: 4 };
const item = (path = '/article', extra = {}) => ({ kind: 'web', title: '搜索服务给出的原标题', url: `https://news.example.com${path}`, text: '不可冒充网页原文的搜索摘要', publishedAt: AT, dateBasis: 'unverified-search', ...extra });
const paragraph = '这是发布方网页中的实际正文，介绍公开的校园学习空间与学生预约方式，保留明确出处用于研究。';
const page = (metadata = `<meta property="article:published_time" content="${DATE}">`, body = `<article><p>${paragraph}</p></article>`) => `<html><head>${metadata}</head><body>${body}</body></html>`;
const html = text => new Response(text, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
const robots = text => new Response(text, { headers: { 'Content-Type': 'text/plain' } });
function fixture({ document = page(), policy = 'User-agent: *\nAllow: /', resolver = async () => [ADDRESS], respond } = {}) {
  const calls = [], dns = [];
  return { calls, dns, options: { at: AT, resolver: async (...args) => { dns.push(args); return resolver(...args); }, fetcher: async (url, init) => {
    calls.push({ url, init });
    if (respond) return respond(url, init);
    return new URL(url).pathname === '/robots.txt' ? robots(policy) : html(document);
  } } };
}

test('public pages retain source title and URL, replace search claims with page text, and use explicit publication metadata', async () => {
  const f = fixture(); const result = await enrichResearchPages([item()], f.options), actual = result.items[0];
  assert.equal(actual.title, item().title); assert.equal(actual.url, item().url); assert.equal(actual.text, paragraph);
  assert.equal(actual.publishedAt, '2026-10-13T10:00:00.000Z'); assert.equal(actual.dateBasis, 'page-published-metadata'); assert.equal(actual.collectedAt, AT);
  assert.equal(result.reports[0].count, 1); assert.equal(result.reports[0].status, 'ok'); assert.equal(cleanReferences(result.items, { at: AT }).references.length, 1);
  assert.equal(f.dns.length, 1); assert.deepEqual(f.calls.map(c => new URL(c.url).pathname), ['/robots.txt', '/article']);
  for (const { url, init } of f.calls) {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']);
    assert(!/authorization|cookie|proxy/i.test(JSON.stringify(init.headers)));
    await new Promise((resolve, reject) => init.lookup(new URL(url).hostname, {}, (error, address, family) => { try { assert.ifError(error); assert.equal(address, ADDRESS.address); assert.equal(family, 4); resolve(); } catch (e) { reject(e); } }));
  }
});

test('metadata supports bounded current-article JSON-LD and itemprop dates, never related article or modified dates', async t => {
  const cases = [
    ['jsonld', `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', url: item().url, datePublished: DATE, dateModified: AT })}</script>`, true],
    ['graph', `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebSite', datePublished: AT }, { '@type': 'Article', mainEntityOfPage: { '@id': item().url }, datePublished: DATE }] })}</script>`, true],
    ['itemprop', `<meta itemprop="datePublished" content="${DATE}">`, true],
    ['modified-only', `<meta property="article:modified_time" content="${DATE}"><script type="application/ld+json">{"@type":"Article","dateModified":"${DATE}"}</script>`, false],
    ['different-article', `<script type="application/ld+json">{"@type":"Article","url":"https://other.example.org/news","datePublished":"${DATE}"}</script>`, false],
    ['related-article', `<script type="application/ld+json">{"@type":"WebPage","relatedLink":{"@type":"Article","datePublished":"${DATE}"}}</script>`, false],
    ['comment-and-script-spoof', `<!-- <meta property="article:published_time" content="${DATE}"> --><script>const invented='<meta property="article:published_time" content="${DATE}">';</script>`, false],
    ['commented-jsonld', `<!-- <script type="application/ld+json">{"@type":"Article","datePublished":"${DATE}"}</script> -->`, false],
    ['ambiguous-dates', `<meta property="article:published_time" content="${DATE}"><script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-12T08:00:00Z"}</script>`, false],
    ['oversized-json', `<script type="application/ld+json">${JSON.stringify({ '@type': 'Article', padding: 'x'.repeat(64000), datePublished: DATE })}</script>`, false],
    ['malformed-json', '<script type="application/ld+json">{"@type":"Article",</script>', false],
  ];
  for (const [name, meta, accepted] of cases) await t.test(name, async () => {
    const result = await enrichResearchPages([item()], fixture({ document: page(meta) }).options);
    assert.equal(!!result.items[0].publishedAt, accepted); assert.equal(result.items[0].text, paragraph);
    assert.equal(result.items[0].dateBasis, accepted ? 'page-published-metadata' : '');
  });
});

test('ambiguous, missing, invalid, future and URL-only dates never receive guessed timestamps', async () => {
  for (const value of ['2026-10-13', '2026-10-13T12:00:00', '2026-02-30T12:00:00Z', '2026-10-13T24:00:00Z', '2026-10-13T12:00:00+99:00', '2027-01-01T00:00:00Z', '昨天', '']) {
    const result = await enrichResearchPages([item('/2026/10/13/article')], fixture({ document: page(`<meta property="article:published_time" content="${value}">`) }).options);
    assert.equal(result.items[0].publishedAt, '', value); assert.equal(result.items[0].dateBasis, ''); assert.equal(result.reports[0].count, 0);
    assert.equal(cleanReferences(result.items, { at: AT }).references.length, 0);
  }
});

test('unreadable and excluded pages remain clues without preserving invented text or dates', async () => {
  const f = fixture({ respond: async url => new URL(url).pathname === '/robots.txt' ? robots('User-agent: *\nAllow: /') : new Response('PRIVATE_DIAGNOSTIC', { status: 403 }) });
  const result = await enrichResearchPages([item()], f.options);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].url, item().url); assert.equal(result.items[0].title, item().title);
  assert.equal(result.items[0].publishedAt, ''); assert.equal(result.items[0].text, ''); assert.equal(result.reports[0].status, 'failed'); assert(!JSON.stringify(result).includes('PRIVATE_DIAGNOSTIC'));
});

test('unsafe schemes, credentials and custom ports never trigger network access', async () => {
  const urls = ['http://news.example.com/a', 'https://user:pass@news.example.com/a', 'https://news.example.com:8443/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'file:///C:/secret.txt', 'javascript:alert(1)', 'https://news.example.com./a'];
  const f = fixture(); const result = await enrichResearchPages(urls.map(url => item('/unused', { url })), f.options);
  assert.equal(f.calls.length, 0); assert.equal(f.dns.length, 0); assert(result.items.every(entry => entry.text === '' && entry.publishedAt === ''));
  const safe = fixture(); await enrichResearchPages([item('/story?api_key=PRIVATE&session=PRIVATE&article=1#PRIVATE')], safe.options);
  assert(!JSON.stringify(safe.calls.map(c => c.url)).includes('PRIVATE')); assert.match(safe.calls.at(-1).url, /article=1$/);
});

test('all resolved addresses must be public; mixed/private/mapped/transition and invalid DNS answers are rejected', async () => {
  for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [ADDRESS, { address: '10.2.3.4', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '100.100.100.200', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }], [{ address: '2002:7f00:1::', family: 6 }], [{ address: '2001:db8::1', family: 6 }], [{ address: '2001::1', family: 6 }], [{ address: '3fff::1', family: 6 }], [{ address: '93.184.216.34', family: 6 }], [{ address: '2001:not-an-address', family: 6 }]]) {
    const f = fixture({ resolver: async () => addresses }); const result = await enrichResearchPages([item()], f.options);
    assert.equal(f.calls.length, 0); assert.equal(result.reports[0].status, 'failed');
  }
});

test('production HTTPS uses pinned lookup and a fresh direct agent despite proxy/credential environment', async t => {
  const old = process.env.HTTPS_PROXY; process.env.HTTPS_PROXY = 'http://PRIVATE_USER:PRIVATE_PASSWORD@127.0.0.1:9';
  t.after(() => { if (old === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = old; });
  let dnsCalls = 0; const requests = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    requests.push({ url, options }); assert.equal(options.agent, false); assert.equal(options.autoSelectFamily, false); assert.equal(new URL(url).hostname, 'news.example.com');
    const request = new EventEmitter(); request.end = () => {
      options.lookup('news.example.com', { all: true }, (error, addresses) => {
        assert.ifError(error); assert.deepEqual(addresses, [ADDRESS]);
        queueMicrotask(() => {
          const isRobots = new URL(url).pathname === '/robots.txt', body = isRobots ? 'User-agent: *\nAllow: /' : page();
          const response = Readable.from([Buffer.from(body)]); response.statusCode = 200; response.headers = { 'content-type': isRobots ? 'text/plain' : 'text/html' }; callback(response);
        });
      });
    }; return request;
  });
  const result = await enrichResearchPages([item()], { at: AT, resolver: async () => ++dnsCalls === 1 ? [{ address: '2408:8719:2000:60::77a7:ed23', family: 6 }, ADDRESS] : [{ address: '127.0.0.1', family: 4 }] });
  assert.equal(dnsCalls, 1); assert.equal(requests.length, 2); assert.equal(result.reports[0].count, 1);
  assert(!JSON.stringify(requests).includes('PRIVATE_')); assert(requests.every(request => request.options.headers.Authorization === undefined && request.options.headers.Cookie === undefined));
});

test('robots policy is checked before pages, honors specific agent/allow, and fails closed on robots errors', async () => {
  const f = fixture({ policy: 'User-agent: *\nDisallow: /\n\nUser-agent: ShengzhangResearch\nDisallow: /blocked\nAllow: /blocked/public$' });
  const result = await enrichResearchPages([item('/blocked/private'), item('/blocked/public')], f.options);
  assert.equal(f.calls.filter(c => c.url.endsWith('/robots.txt')).length, 1); assert(!f.calls.some(c => c.url.endsWith('/blocked/private'))); assert.equal(result.reports[0].count, 1);
  for (const response of [new Response('no', { status: 503 }), new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }), robots('<html>verification needed</html>')]) {
    const fail = fixture({ respond: async () => response }); const r = await enrichResearchPages([item()], fail.options);
    assert.equal(fail.calls.length, 1); assert.equal(r.items[0].text, ''); assert.equal(r.reports[0].status, 'failed');
  }
  const absent = fixture({ respond: async url => url.endsWith('/robots.txt') ? new Response(null, { status: 404 }) : html(page()) });
  assert.equal((await enrichResearchPages([item()], absent.options)).reports[0].count, 1);
  const specific = fixture({ policy: 'User-agent: Shengzhang\nAllow: /\n\nUser-agent: ShengzhangResearch\nDisallow: /blocked' });
  const blocked = await enrichResearchPages([item('/%62locked')], specific.options);
  assert.equal(specific.calls.length, 1); assert.equal(blocked.items[0].text, '');
});

test('redirects, non-HTML, compressed or excessive response bodies are refused without retries', async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://other.example/' } }), new Response('file', { headers: { 'content-type': 'application/pdf' } }), new Response('encoded', { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }), new Response('small', { headers: { 'content-type': 'text/html', 'content-length': '1200001' } }), html('x'.repeat(1_200_001))]) {
    const f = fixture({ respond: async url => url.endsWith('/robots.txt') ? robots('') : response }); const result = await enrichResearchPages([item()], f.options);
    assert.equal(f.calls.length, 2); assert.equal(result.items[0].text, ''); assert.equal(result.items[0].publishedAt, '');
  }
});

test('work is limited to six unique pages and two concurrent requests; duplicates and extra URLs remain clues', async () => {
  let active = 0, maximum = 0;
  const f = fixture({ respond: async url => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; return url.endsWith('/robots.txt') ? robots('') : html(page()); } });
  const inputs = [item('/0'), item('/0'), ...Array.from({ length: 8 }, (_, n) => item('/' + (n + 1)))];
  const result = await enrichResearchPages(inputs, f.options);
  assert.equal(result.items.length, inputs.length); assert.equal(f.calls.filter(c => !c.url.endsWith('/robots.txt')).length, 6); assert.equal(f.dns.length, 1); assert(maximum <= 2);
  assert.equal(result.items.filter(entry => entry.publishedAt).length, 6); assert.equal(result.items[1].text, ''); assert.equal(result.items.at(-1).publishedAt, '');
});

test('page excerpts exclude executable/navigation boilerplate and remain bounded', async () => {
  const f = fixture({ document: page(undefined, `<nav><p>PRIVATE_NAVIGATION ${'nav'.repeat(20)}</p></nav><article><script>PRIVATE_SCRIPT</script><p>${paragraph.repeat(50)}</p></article>`) });
  const result = await enrichResearchPages([item()], f.options); assert.equal(result.items[0].text.length, 1600); assert(!JSON.stringify(result).includes('PRIVATE_'));
});

test('page descriptions and generic body copy are not promoted to original article text', async () => {
  const metadata = `<meta property="article:published_time" content="${DATE}"><meta name="description" content="仅有搜索展示摘要，不能充当文章正文">`;
  const f = fixture({ document: page(metadata, `<p>${paragraph}</p>`) });
  const result = await enrichResearchPages([item()], f.options);
  assert.equal(result.items[0].text, ''); assert.equal(result.reports[0].count, 0); assert.equal(cleanReferences(result.items, { at: AT }).references.length, 0);
  for (const document of [page(metadata, `<div itemprop="articleBody">${paragraph}</div>`), page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', url: item().url, datePublished: DATE, articleBody: paragraph })}</script>`, '')]) {
    const accepted = await enrichResearchPages([item()], fixture({ document }).options);
    assert.equal(accepted.items[0].text, paragraph); assert.equal(accepted.reports[0].count, 1);
  }
});

test('known article containers retain nested body paragraphs without adjacent recommendations; bare local time stays unknown', async () => {
  for (const name of ['post_content', 'article-content', 'article_content', 'post-content', 'left_zw']) {
    const document = page('', `<span id="pubtime_baidu">2026/10/14 17:06:46</span><div class="${name}"><div class="intro">引言</div><p>${paragraph}</p></div><div class="related_post"><p>PRIVATE_RECOMMENDATIONS ${paragraph}</p></div>`);
    const result = await enrichResearchPages([item()], fixture({ document }).options);
    assert.equal(result.items[0].text, paragraph, name); assert.equal(result.items[0].publishedAt, ''); assert.equal(result.items[0].dateBasis, ''); assert.equal(result.reports[0].count, 0);
  }
});

test('active-session failures escape unchanged before requests and after DNS without a source report', async () => {
  const conflict = Object.assign(Error('workspace changed'), { status: 409 });
  await assert.rejects(enrichResearchPages([item()], { at: AT, assertActive: () => { throw conflict; }, resolver: async () => assert.fail('must not resolve'), fetcher: async () => assert.fail('must not fetch') }), error => error === conflict);
  let active = true;
  await assert.rejects(enrichResearchPages([item()], { at: AT, assertActive: () => { if (!active) throw conflict; }, resolver: async () => { active = false; return [ADDRESS]; }, fetcher: async () => assert.fail('must not fetch') }), error => error === conflict);
});

test('two in-flight workers are settled before an active-session failure escapes and no new page is started', async () => {
  const conflict = Object.assign(Error('workspace changed'), { status: 409 });
  let active = true, entered, fetched = 0, settled = false;
  const ready = new Promise(resolve => { entered = resolve; }), releases = [];
  const pending = enrichResearchPages([item('/one'), item('/two'), item('/three')], { at: AT, resolver: async () => [ADDRESS], assertActive: () => { if (!active) throw conflict; }, fetcher: async url => {
    if (url.endsWith('/robots.txt')) return robots('');
    fetched++; return new Promise(resolve => { releases.push(() => resolve(html(page()))); if (releases.length === 2) entered(); });
  } });
  const result = pending.then(() => { settled = true; assert.fail('must reject'); }, error => { settled = true; assert.equal(error, conflict); });
  await ready; active = false; releases[0](); await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  releases[1](); await result; assert.equal(fetched, 2);
});

test('DNS and request timeouts settle even when injected implementations ignore abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolving; const resolvingStarted = new Promise(resolve => { resolving = resolve; });
  const pendingDNS = enrichResearchPages([item()], { at: AT, resolver: async () => { resolving(); return new Promise(() => {}); }, fetcher: async () => assert.fail('must not fetch') });
  await resolvingStarted; t.mock.timers.tick(4001); const dns = await pendingDNS; assert.equal(dns.reports[0].status, 'failed');
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const pendingFetch = enrichResearchPages([item()], { at: AT, resolver: async () => [ADDRESS], fetcher: async () => { entered(); return new Promise(() => {}); } });
  await started; t.mock.timers.tick(8001); const fetch = await pendingFetch; assert.equal(fetch.reports[0].status, 'failed');
});
