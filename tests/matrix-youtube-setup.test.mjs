import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { prepareYouTubeEntry,YOUTUBE_STUDIO_ENTRY } from '../scripts/prepare-youtube-mcp.mjs';

test('YouTube setup preserves upstream files and refuses to overwrite another entry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-youtube-setup-'));
  try{
    await mkdir(join(dir,'src/auth'),{recursive:true});
    await writeFile(join(dir,'package.json'),JSON.stringify({dependencies:{googleapis:'1','@modelcontextprotocol/sdk':'1'}}));
    const auth='export function createAuthFromEnv() {}', server='export function createServer(auth?: unknown) {}';
    await writeFile(join(dir,'src/auth/oauth.ts'),auth); await writeFile(join(dir,'src/server.ts'),server);
    const target=await prepareYouTubeEntry(dir); assert.equal(await readFile(target,'utf8'),YOUTUBE_STUDIO_ENTRY);
    assert.equal(await prepareYouTubeEntry(dir),target); assert.equal(await readFile(join(dir,'src/auth/oauth.ts'),'utf8'),auth); assert.equal(await readFile(join(dir,'src/server.ts'),'utf8'),server);
    await writeFile(target,'user-authored entry'); await assert.rejects(()=>prepareYouTubeEntry(dir)); assert.equal(await readFile(target,'utf8'),'user-authored entry');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('YouTube local OAuth callback rejects a wrong state and stores only the confirmed code through its auth module',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-youtube-oauth-')); let child;
  try{
    await mkdir(join(dir,'auth'),{recursive:true}); await mkdir(join(dir,'node_modules/@modelcontextprotocol/sdk/server'),{recursive:true});
    await writeFile(join(dir,'package.json'),' {"type":"module"}');
    await writeFile(join(dir,'node_modules/@modelcontextprotocol/sdk/package.json'),'{"type":"module","exports":{"./server/stdio.js":"./server/stdio.js"}}');
    await writeFile(join(dir,'node_modules/@modelcontextprotocol/sdk/server/stdio.js'),'export class StdioServerTransport {}');
    await writeFile(join(dir,'server.js'),'export function createServer() { throw Error("stdio not used by this OAuth test"); }');
    await writeFile(join(dir,'auth/oauth.js'),`import {writeFile} from 'node:fs/promises';export function createAuthFromEnv(){const redirect=process.env.GOOGLE_REDIRECT_URI;return {getAuthUrl:()=> 'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri='+encodeURIComponent(redirect),exchangeCode:async(code)=>{await writeFile(process.env.TEST_PROOF_FILE,JSON.stringify({code,redirect}));}};}`);
    await writeFile(join(dir,'entry.mjs'),stripTypeScriptTypes(YOUTUBE_STUDIO_ENTRY));
    const socket=createServer();await new Promise(ok=>socket.listen(0,'127.0.0.1',ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
    const callback=`http://127.0.0.1:${port}/callback`, proof=join(dir,'proof.json');
    child=spawn(process.execPath,[join(dir,'entry.mjs'),'--login'],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TOKEN_STORAGE_PATH:join(dir,'tokens'),GOOGLE_REDIRECT_URI:callback,TEST_PROOF_FILE:proof}});
    const exited=new Promise((ok,no)=>{child.once('exit',(code)=>ok(code));child.once('error',no);});
    let stdout='';child.stdout.on('data',chunk=>{stdout+=String(chunk);});
    const authorization=await new Promise((ok,no)=>{let stderr='';const timer=setTimeout(()=>no(Error('OAuth test did not start')),5000);const close=()=>{clearTimeout(timer);no(Error('OAuth test exited early'));};child.once('exit',close);child.once('error',close);child.stderr.on('data',chunk=>{stderr+=String(chunk);const found=/https:\/\/accounts\.google\.com\/[^\s]+/.exec(stderr);if(found){clearTimeout(timer);child.off('exit',close);child.off('error',close);ok(new URL(found[0]));}});});
    assert.equal(authorization.searchParams.get('redirect_uri'),callback);const state=authorization.searchParams.get('state');assert.match(state,/^[a-f0-9]{64}$/);
    assert.equal((await fetch(`${callback}?state=wrong&code=untrusted`)).status,400);await assert.rejects(()=>readFile(proof));
    assert.equal((await fetch(`${callback}?state=${state}&code=synthetic-confirmed`)).status,200);assert.equal(await exited,0);
    assert.deepEqual(JSON.parse(await readFile(proof,'utf8')),{code:'synthetic-confirmed',redirect:callback});assert.equal(stdout,'');
  }finally{if(child?.exitCode===null){child.kill();await new Promise(ok=>child.once('exit',ok));}await rm(dir,{recursive:true,force:true});}
});
