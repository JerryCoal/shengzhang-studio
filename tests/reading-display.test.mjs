import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import textScale from '../scripts/text-scale-postcss.mjs';
import { projectKeywords, splitCopyKeywords } from '../src/copy-keywords.mjs';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite'))('postcss');

test('font preferences scale text hierarchy without scaling artwork or fixed layout dimensions', async () => {
  const css = '.body{font-size:14px;width:240px;line-height:1.8}.small{font-size:11px!important}.inherit{font:inherit;font-size:.91em}.hidden{font-size:0}.banner-flower{font-size:150px}@media(max-width:400px){.body{font-size:12px}}';
  const result = await postcss([textScale()]).process(css, { from: undefined });
  assert.match(result.css, /font-size:calc\(14px \* var\(--studio-font-scale, 1\)\)/);
  assert.match(result.css, /font-size:calc\(11px \* var\(--studio-font-scale, 1\)\)!important/);
  assert.match(result.css, /font-size:calc\(12px \* var\(--studio-font-scale, 1\)\)/);
  assert.match(result.css, /width:240px;line-height:1.8/);
  assert.match(result.css, /font-size:\.91em/); assert.match(result.css, /font-size:0/);
  assert.match(result.css, /banner-flower\{font-size:150px/);
  assert.equal((await postcss([textScale()]).process(result.css, { from: undefined })).css, result.css);
});

test('keyword emphasis preserves original copy and safely handles overlapping words, emoji and literal syntax', () => {
  const original = 'Wereus 学习搭子 ✨<script> x.y C++\nAI学习 daily #学习搭子';
  const parts = splitCopyKeywords(original, ['学习', '学习搭子', 'Wereus', 'x.y', 'C++', '<script>', 'AI']);
  assert.equal(parts.map(part => part.text).join(''), original);
  assert.deepEqual(parts.filter(part => part.keyword).map(part => part.text), ['Wereus', '学习搭子', '<script>', 'x.y', 'C++', 'AI', '学习', '学习搭子']);
  assert.equal(splitCopyKeywords('daily AIs', ['AI']).some(part => part.keyword), false);
  assert.equal(splitCopyKeywords('✨小红书[赞R]', ['小红书', '[赞R]']).map(part => part.text).join(''), '✨小红书[赞R]');
});

test('project emphasis selects supplied facts and confirmed current tags only, with bounded terms', () => {
  const project = { brief: { name: '校园项目', brand: 'Wereus', product: '学习空间', sellingPoints: '安静自习；自由组队，支持语音' },
    trends: { tags: [{label:'已确认热点',enabled:true,expiresAt:'2099-01-01'}, {label:'已过期标签',enabled:true,expiresAt:'2001-01-01'}, {label:'停用标签',enabled:false,expiresAt:'2099-01-01'}] },
    research: {selectedIds:['picked'], analyses:[{id:'picked',tags:['#已选参考']},{id:'unpicked',tags:['未确认参考']}]} };
  const original=JSON.stringify(project), words=projectKeywords(project, Date.parse('2026-10-14'));
  assert.deepEqual(words, ['校园项目','Wereus','学习空间','安静自习','自由组队','支持语音','已确认热点','已选参考']);
  assert.equal(JSON.stringify(project), original);
  assert.deepEqual(projectKeywords(), []);
  assert(projectKeywords({brief:{sellingPoints:Array.from({length:100},(_,i)=>`卖点${i}`).join('；')}}).length <= 48);
});
