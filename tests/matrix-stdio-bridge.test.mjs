import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startMatrixBridge,validateMatrixBridgeConfig } from '../server/matrix-stdio-bridge.mjs';
import { createMCPClient,mcpValue } from '../server/mcp-client.mjs';

test('matrix bridge refuses shell commands, relative working directories and inherited secrets config',()=>{
  const base={command:process.execPath,args:['server.mjs'],cwd:process.cwd(),port:18120};
  assert.equal(validateMatrixBridgeConfig(base).port,18120);
  assert.throws(()=>validateMatrixBridgeConfig({...base,command:'node'}));
  assert.throws(()=>validateMatrixBridgeConfig({...base,cwd:'relative'}));
  assert.throws(()=>validateMatrixBridgeConfig({...base,env:{NODE_OPTIONS:'--require evil'}}));
  assert.throws(()=>validateMatrixBridgeConfig({...base,token:'short'}));
  assert.throws(()=>validateMatrixBridgeConfig({...base,shell:true}));
});
test('real local HTTP to stdio bridge supports repeated isolated sessions and rejects browser-origin calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-matrix-bridge-')), file=join(dir,'fixture.mjs');
  await writeFile(file,`import readline from 'node:readline';const rl=readline.createInterface({input:process.stdin});let count=0;rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'test_echo',inputSchema:{type:'object',required:[]}}]}:{content:[{type:'text',text:JSON.stringify({count:++count,echo:m.params.arguments.value})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const token='a'.repeat(48),bridge=await startMatrixBridge({command:process.execPath,args:[file],cwd:dir,port,token});
  try {
    for(let round=0;round<2;round++){const client=createMCPClient({endpoint:bridge.endpoint,token,fetcher:fetch});try{assert.equal((await client.connect())[0].name,'test_echo');const reply=mcpValue(await client.call('test_echo',{value:'中文你好'}));assert.equal(reply.echo,'中文你好');assert.equal(reply.count,1);}finally{await client.close();}}
    const denied=await fetch(bridge.endpoint,{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}'});assert.equal(denied.status,403);
    const noToken=await fetch(bridge.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noToken.status,401);
  }finally{await bridge.close();await rm(dir,{recursive:true,force:true});}
});
