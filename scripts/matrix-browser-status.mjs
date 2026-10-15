// Only reads Browser MCP's documented status fields; no page or credential data.
import { createMCPClient, mcpValue } from '../server/mcp-client.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--endpoint'){console.error('用法：node scripts/matrix-browser-status.mjs --endpoint http://127.0.0.1:18150/mcp');process.exitCode=1;}
else{
  let client;
  try{client=createMCPClient({endpoint:args[1],token:process.env.STUDIO_MCP_BRIDGE_TOKEN || ''});const tools=await client.connect();if(!tools.some(tool=>tool.name==='browser_status'))throw Error('服务没有 browser_status');const result=mcpValue(await client.call('browser_status',{}));if(!result||typeof result!=='object')throw Error('无法读取状态');console.log(JSON.stringify({state:result.state,connected:result.connected===true,extension_dir:typeof result.extension_dir==='string'?result.extension_dir.slice(0,1024):undefined,bridge_port:Number.isInteger(result.bridge_port)?result.bridge_port:undefined},null,2));}
  catch{console.error('未取得浏览器连接状态。请先启动本机桥接、检查端口和访问令牌。');process.exitCode=1;}
  finally{await client?.close();}
}
