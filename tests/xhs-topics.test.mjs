import test from 'node:test';
import assert from 'node:assert/strict';
import { splitXhsTopics, prepareXhsTopics } from '../server/xhs-topics.mjs';

test('XHS topic footer separates normal, paired-hash and platform-copy formats', () => {
  for (const tail of ['#大学生 #学习搭子', '#大学生# #学习搭子#', '#大学生[话题]# #学习搭子[话题]#', '＃大学生［话题］＃，＃学习搭子＃']) {
    assert.deepEqual(splitXhsTopics('真实服务说明。\n\n' + tail), { content: '真实服务说明。', tags: ['大学生', '学习搭子'] });
  }
  assert.deepEqual(splitXhsTopics('正文\n标签：#大学生 #学习搭子'), { content:'正文',tags:['大学生','学习搭子'] });
  assert.deepEqual(splitXhsTopics('第二行 #学习搭子'), { content:'第二行',tags:['学习搭子'] });
});

test('XHS extraction preserves ordinary prose, code, Markdown and URL fragments', () => {
  for (const body of ['我在学 C#', '# 真实标题', '问题 #123', 'https://example.com/#学习', '正文含#术语', '讲解 #学习 的真实步骤。', '```text\n#学习', '`示例 #学习', '[链接](https://example.com/#学习)']) {
    assert.deepEqual(splitXhsTopics(body), { content:body,tags:[] }, body);
  }
  assert.deepEqual(splitXhsTopics('https://example.com/#学习\n\n#校园生活'), {content:'https://example.com/#学习',tags:['校园生活']});
});

test('explicit topic selection is authoritative, including clearing every candidate', () => {
  const body = '真实说明✨\n\n#旧话题 #学习';
  assert.deepEqual(prepareXhsTopics(body, []), {content:'真实说明✨', tags:[],bodyWithTopics:'真实说明✨'});
  assert.deepEqual(prepareXhsTopics(body, ['#校园生活[话题]#', '校园生活', 'ＡＩ', 'ai']), {content:'真实说明✨',tags:['校园生活','AI'],bodyWithTopics:'真实说明✨\n\n#校园生活 #AI'});
  assert.deepEqual(prepareXhsTopics(body).tags, ['旧话题','学习']);
});

test('invalid or excessive candidates are blocked rather than silently truncated', () => {
  for (const tags of [[''], ['一\n二'], ['<script>'], ['一#二'], ['一'.repeat(41)], Array.from({length:11},(_,i)=>`话题${i}`)]) assert.throws(()=>prepareXhsTopics('正文',tags), error=>error.status===400);
  assert.equal(prepareXhsTopics('正文', Array(11).fill('同一话题')).tags.length, 1);
  assert.equal(prepareXhsTopics('正文', ['校内 AI 学习']).tags[0], '校内 AI 学习');
});

test('combined publication text counts Unicode characters and includes the appended topics', () => {
  assert.equal(prepareXhsTopics('😀'.repeat(990), ['学习']).bodyWithTopics.length, 1985);
  assert.throws(()=>prepareXhsTopics('字'.repeat(999),['学习']), /正文加话题超过/);
  assert.equal(prepareXhsTopics('字'.repeat(1000),[]).content.length,1000);
});
