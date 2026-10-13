import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {createCommentBuffer,captureOptions}=createRequire(import.meta.url)('../desktop/comment-buffer.cjs');
test('buffer validates options, preserves virtualized batches and applies reply and character limits',()=>{
  assert.deepEqual(captureOptions({limit:999999,includeReplies:'yes'}),{limit:200,includeReplies:false});
  const b=createCommentBuffer({limit:50});assert.equal(b.merge([{text:'一级',platformCommentId:'a'},{text:'回复',isReply:true}]),1);assert.equal(b.merge([{text:'第二页',platformCommentId:'b'}]),1);assert.equal(b.merge([{text:'一级',platformCommentId:'a'}]),0);assert.equal(b.rows().length,2);assert.equal(b.stats().duplicates,1);
  const capped=createCommentBuffer({limit:50});capped.merge(Array.from({length:50},(_,i)=>({text:'长'.repeat(3998)+i,platformCommentId:'c'+i})));assert(capped.stats().full);assert(capped.rows().reduce((sum,r)=>sum+r.text.length,0)<=120000);
});
test('buffer attaches IDs to earlier selected text but keeps distinct IDs with the same text',()=>{
  const b=createCommentBuffer({includeReplies:true});b.merge([{text:'好用'}]);b.merge([{text:'好用',platformCommentId:'one',likes:2}]);assert.equal(b.rows().length,1);assert.equal(b.rows()[0].platformCommentId,'one');b.merge([{text:'好用',platformCommentId:'two',isReply:true}]);assert.equal(b.rows().length,2);assert.equal(b.stats().replies,1);
  b.merge([{text:'被改动的文字',platformCommentId:'one',likes:3,cookie:'secret'}]);assert.equal(b.rows()[0].text,'好用');assert.equal(b.rows()[0].likes,3);assert.doesNotMatch(JSON.stringify(b.rows()),/secret/);b.clear();assert.equal(b.rows().length,0);
});
