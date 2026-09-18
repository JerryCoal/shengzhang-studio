import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { NEWS_SOURCES } from './news-sources.mjs';
import { readBounded, isPublicAddress } from './integration-http.mjs';
import { articleRelevance, withinWeek } from './trends.mjs';

const error = message => Object.assign(new Error(message), { status: 502 });
const hash = value => createHash('sha256').update(value).digest('hex').slice(0,24);
export function plainText(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(lt|gt|amp|quot|apos|nbsp);/gi,(_,n)=>({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'",nbsp:' '})[n.toLowerCase()]).replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff&&!(c>=0xd800&&c<=0xdfff)?String.fromCodePoint(c):'';}).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim();
}
function valueOf(xml, name) { return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'i').exec(xml)?.[1] || ''; }
export function sourceURL(raw, source) {
  try { const url=new URL(plainText(raw),source.feed); if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&url.port!=='443')||!source.hosts.includes(url.hostname))return null; url.protocol='https:';url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(spm|from|ref)$/i.test(key))url.searchParams.delete(key);return url.href; } catch { return null; }
}
export function parseFeed(xml, source, at=Date.now()) {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<(?:rss|feed)\b/i.test(xml))throw error('订阅源不是可读取的 RSS / Atom，可能返回了验证页');
  const rows=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0,200), articles=[], excluded={old:0,undated:0,future:0,unsafe:0};
  for(const row of rows) {
    const item=row[2], title=plainText(valueOf(item,'title')).slice(0,200);
    const rawLink=valueOf(item,'link')||/<link\b[^>]*href=["']([^"']+)["']/i.exec(item)?.[1]||'';
    const url=sourceURL(rawLink,source), rawDate=plainText(valueOf(item,'pubDate')||valueOf(item,'published')||valueOf(item,'dc:date'));
    const date=Date.parse(rawDate); if(!rawDate||!Number.isFinite(date)){excluded.undated++;continue;}if(date>at){excluded.future++;continue;}
    const publishedAt=new Date(date).toISOString(); if(!withinWeek({publishedAt},at)){excluded.old++;continue;}
    if(!url||!title){excluded.unsafe++;continue;}
    const excerpt=plainText(valueOf(item,'description')||valueOf(item,'summary')||valueOf(item,'content:encoded')||valueOf(item,'content')).slice(0,280);
    articles.push({id:hash(url),title,url,publishedAt,excerpt,source:source.name,sourceId:source.id,sourceGroup:source.group,category:source.category,fetchedAt:new Date(at).toISOString(),extraction:'feed'});
  }
  return {articles,excluded,entries:rows.length};
}
export function robotsAllowed(text, target, agent='shengzhangnews') {
  const groups=[];let current=null,hasRules=false;
  for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim(), i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();if(key==='user-agent'){if(!current||hasRules){current={agents:[],rules:[]};groups.push(current);hasRules=false;}current.agents.push(value.toLowerCase());}else if(current&&['allow','disallow'].includes(key)){current.rules.push({allow:key==='allow',path:value});hasRules=true;}}
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&agent.includes(a))), applicable=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  const path=new URL(target).pathname+new URL(target).search, matches=[];
  for(const g of applicable)for(const r of g.rules)if(r.path){const end=r.path.endsWith('$'),body=(end?r.path.slice(0,-1):r.path).split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');if(new RegExp('^'+body+(end?'$':'')).test(path))matches.push({...r,size:r.path.replace(/\*/g,'').length});}
  matches.sort((a,b)=>b.size-a.size||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;
}
export function articleExcerpt(html) {
  const article=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]||/<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:left_zw|article-content|post-content|article_content|post_content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i.exec(html)?.[1];
  if(article){const paragraphs=[...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>plainText(m[1])).filter(p=>p.length>=25&&!/版权|责任编辑|未经许可|广告|转载|返回首页/.test(p));if(paragraphs.length)return paragraphs.join(' ').slice(0,280);}
  const metas=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]);for(const meta of metas)if(/(?:name|property)=["'](?:description|og:description)["']/i.test(meta))return plainText(/content=["']([^"']*)["']/i.exec(meta)?.[1]).slice(0,280);return '';
}
export async function collectNews(settings, {fetcher=fetch,resolver=lookup,at=Date.now()}={}) {
  const selected=NEWS_SOURCES.filter(s=>settings.sourceIds.includes(s.id)), robotsCache=new Map(), addressCache=new Map();
  async function request(url,source,limit=1200000) {
    if(!sourceURL(url,source))throw error('新闻来源地址不在允许范围');
    const host=new URL(url).hostname;
    if(!addressCache.has(host))addressCache.set(host,resolver(host,{all:true}));
    const addresses=await addressCache.get(host);if(!addresses.length||!addresses.every(a=>isPublicAddress(a.address)))throw error('新闻来源地址不可用');
    const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'ShengzhangNews/0.4.6 (public news feed reader)','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml,text/html,text/plain'}});
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw error('来源发生跳转，本次跳过以避免访问未知地址');}
    if(!response.ok){await response.body?.cancel();throw error(`来源暂不可访问（HTTP ${response.status}）`);}
    const data=await readBounded(response,limit),type=response.headers.get('content-type')||'';const charset=/charset\s*=\s*["']?(gb2312|gbk|gb18030)/i.test(type)?'gb18030':'utf-8';
    return new TextDecoder(charset).decode(data);
  }
  async function policy(url,source) { const origin=new URL(url).origin;if(!robotsCache.has(origin))robotsCache.set(origin,(async()=>{const text=await request(origin+'/robots.txt',source,100000);if(/<(?:html|!doctype)/i.test(text))throw error('来源返回验证页面，未继续采集');return text;})());const text=await robotsCache.get(origin);if(!robotsAllowed(text,url))throw error('来源采集规则不允许访问，本次已跳过'); }
  const articles=[],reports=[];const groups=[...new Set(selected.map(s=>s.group))];
  await Promise.all(groups.map(async group=>{for(const source of selected.filter(s=>s.group===group)){try{await policy(source.feed,source);const parsed=parseFeed(await request(source.feed,source),source,at);articles.push(...parsed.articles);reports.push({sourceId:source.id,name:source.name,status:'ok',count:parsed.articles.length,excluded:parsed.excluded,message:parsed.articles.length?'已采集公开订阅条目':'未发现发布时间在近七天内的条目'});}catch{reports.push({sourceId:source.id,name:source.name,status:'failed',count:0,message:'来源暂不可用、采集规则限制或响应格式变化；未绕过验证，请稍后重试。'});}}}));
  const unique=[...new Map(articles.map(a=>[a.url,a])).values()];
  const enrich=unique.filter(a=>articleRelevance(a,settings.keywords).matches.length).sort((a,b)=>articleRelevance(b,settings.keywords).value-articleRelevance(a,settings.keywords).value).slice(0,6);
  // Only known publisher URLs, no account cookies/keys, and at most six page requests per click.
  await Promise.all([...new Set(enrich.map(a=>a.sourceGroup))].map(async group=>{for(const item of enrich.filter(a=>a.sourceGroup===group)){const source=selected.find(s=>s.id===item.sourceId);try{await policy(item.url,source);const excerpt=articleExcerpt(await request(item.url,source));if(excerpt){item.excerpt=excerpt;item.extraction='page';}}catch{/* The dated feed excerpt remains usable; no retries or bypass. */}}}));
  return {articles:unique,reports};
}
