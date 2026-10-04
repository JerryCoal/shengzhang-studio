import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { contentArchive, exportDetails, safeFilename } from '../server/content-export.mjs';
import { disableAutomaticPublishing } from '../server/manual-publishing.mjs';
import { allowedWebOperation } from '../server/web-relay.mjs';
import { douyinRequest } from '../server/douyin.mjs';
import { createStore } from '../server/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const asset = { id: 'selected', channel: 'xiaohongshu', status: 'ready', revision: 3, title: '../中文标题: 你好🌱', body: '正文第一行\n第二行 #学习搭子', mime: 'image/png', mediaData: 'data:image/png;base64,' + png, prompt: 'PRIVATE-PROMPT', corpusReferences: [{ text: 'PRIVATE-CORPUS' }], apiKey: 'PRIVATE-KEY' };
test('export preserves original bytes and all Chinese copy, produces structured files and never bundles project internals', async () => {
  const result = await contentArchive(asset), info = exportDetails(asset), zip = await JSZip.loadAsync(result.data);
  assert.match(result.filename, /小红书-R3-发布素材包\.zip$/); assert(!result.filename.includes('/'));
  const media = await zip.file('01-素材/' + info.mediaName).async('nodebuffer'); assert.equal(media.toString('base64'), png);
  const title = await zip.file('02-文案/标题.txt').async('nodebuffer'); assert.equal(title.subarray(0, 3).toString('hex'), 'efbbbf'); assert.equal(title.toString('utf8').slice(1), asset.title);
  assert.equal((await zip.file('02-文案/正文.txt').async('string')).replace(/^\ufeff/, ''), '正文第一行\r\n第二行 #学习搭子');
  const instructions = await zip.file('03-发布指引.txt').async('string'); assert.match(instructions, /不会登录平台/); assert.match(instructions, /到点不会自动上传/);
  const files = Object.values(zip.files).filter(f => !f.dir); assert.equal(files.length, 5);
  for (const f of files.filter(f => f.name.endsWith('.txt'))) assert.doesNotMatch(await f.async('string'), /PRIVATE-(PROMPT|CORPUS|KEY)/);
  assert.equal(safeFilename('CON'), '宣传内容'); assert.equal(safeFilename('  ..\\\/<>|:*?"\x00 '), '宣传内容');
});
test('file extensions match MIME; WebM stays WebM and carries a conversion warning; stale and mismatched media fail', async () => {
  for (const [mime, ext] of [['image/jpeg','jpg'],['image/webp','webp'],['video/mp4','mp4'],['video/webm','webm']]) {
    const content = { ...asset, channel: 'douyin', mime, mediaData: 'data:' + mime + ';base64,YWJjZA==' };
    const info = exportDetails(content); assert.equal(info.extension, ext);
    const zip = await JSZip.loadAsync((await contentArchive(content)).data); assert(zip.file('01-素材/' + info.mediaName));
    if (ext === 'webm') { assert.equal(zip.file(/\.mp4$/).length, 0); assert.match(await zip.file('03-发布指引.txt').async('string'), /不要只修改文件后缀/); }
  }
  assert.throws(() => exportDetails({...asset, status:'queued'}), /重新制作/);
  assert.throws(() => exportDetails({...asset, mime:'video/mp4'}), /格式不一致/);
  assert.throws(() => exportDetails({...asset, mediaData:'data:image/png;base64,'}), /不完整/);
  const pub={...asset,channel:undefined,platform:'douyin',assetRevision:2,status:'exported'};delete pub.channel;
  assert.equal(exportDetails(pub).revision,2);
});
test('desktop encrypted storage permanently disables old jobs after a normal save/restart without losing media or published links', t => {
  const directory=mkdtempSync(join(tmpdir(),'studio-manual120-')), path=join(directory,'studio.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let store=createStore(path,{key:Buffer.alloc(32,7)});
  store.mutate(s=>{s.accounts[0].autoPublish=true;s.projects[0].publications=[{id:'queued',status:'scheduled',mediaData:asset.mediaData,automation:{id:'job',status:'queued'}},{id:'published',status:'published',url:'https://www.douyin.com/video/123',automation:{id:'done',status:'published',itemId:'receipt'}}];});
  store.mutate(disableAutomaticPublishing);store.close();store=createStore(path,{key:Buffer.alloc(32,7)});
  try { const s=store.get(), records=s.projects[0].publications;assert(s.accounts.every(a=>a.autoPublish===false));assert.equal(records[0].automation.status,'disabled');assert.equal(records[0].mediaData,asset.mediaData);assert.equal(records[1].url,'https://www.douyin.com/video/123');assert.equal(records[1].automation.itemId,'receipt');assert.deepEqual(disableAutomaticPublishing(structuredClone(s)),s); } finally {store.close();}
});
test('both web relay and lowest-level Douyin transport reject posting even if a legacy caller attempts it', async () => {
  assert.equal(allowedWebOperation('/projects/p/publications/r/automatic','POST'),false);
  assert.equal(allowedWebOperation('/projects/p/publications/r/stop-automatic','POST'),false);
  assert.equal(allowedWebOperation('/projects/p/publications/r/comments-sync','POST'),true);
  for(const path of ['/video/upload/','/video/create/']) await assert.rejects(douyinRequest(path,{method:'POST'},()=>assert.fail('Must never contact Douyin')), e=>e.status===410);
});
