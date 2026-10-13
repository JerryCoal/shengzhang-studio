const {createServer}=require('node:http');
const {timingSafeEqual}=require('node:crypto');
const tools=[
  {name:'studio_publish',description:'在官方页面自动准备单条内容，用户确认后提交；返回回执或取消状态。',inputSchema:{type:'object',required:['platform','sessionToken','projectId','publicationId','title','body','mime','mediaData'],properties:{platform:{type:'string',enum:['xiaohongshu','douyin']},sessionToken:{type:'string'},projectId:{type:'string'},publicationId:{type:'string'},title:{type:'string'},body:{type:'string'},mime:{type:'string'},mediaData:{type:'string'}}}},
  {name:'studio_comments',description:'读取登录后官方页面可见的自有作品评论，自动滚动后返回预览。',inputSchema:{type:'object',required:['url','sessionToken'],properties:{url:{type:'string'},sessionToken:{type:'string'},limit:{type:'integer'},includeReplies:{type:'boolean'}}}},
];
async function startDesktopMCP({token,execute}) {
  let active=false;
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value===undefined?'':JSON.stringify(value));};
    const bearer=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
    if(req.headers.origin||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||bearer.length!==expected.length||!timingSafeEqual(bearer,expected))return send(403,{error:'Local authenticated MCP only'});
    if(req.url!=='/mcp'||req.method!=='POST')return send(405,{error:'POST /mcp required'});
    let body;
    try {let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>190_000_000)return send(413,{error:'Payload too large'});chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Invalid JSON'});}
    const id=body?.id,respond=result=>send(200,{jsonrpc:'2.0',id,result});
    if(body?.jsonrpc!=='2.0')return send(400,{error:'JSON-RPC required'});
    if(body.method==='notifications/initialized'&&id===undefined)return send(202);
    if(typeof id!=='string'&&typeof id!=='number')return send(400,{error:'Request ID required'});
    if(body.method==='initialize')return respond({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'shengzhang-desktop-platform-mcp',version:'1.7.0'}});
    if(body.method==='tools/list')return respond({tools});
    if(body.method!=='tools/call'||!tools.some(t=>t.name===body.params?.name))return send(200,{jsonrpc:'2.0',id,error:{code:-32601,message:'Unsupported tool'}});
    if(active)return respond({isError:true,content:[{type:'text',text:'平台窗口正在执行另一项任务'}]});
    active=true;
    try {const result=await execute(body.params.name,body.params.arguments);respond({structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]});}
    catch{return respond({isError:true,content:[{type:'text',text:'请检查工作区登录、平台页面或任务状态'}]});}
    finally{active=false;body=undefined;}
  });
  server.requestTimeout=60000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {endpoint:`http://127.0.0.1:${server.address().port}/mcp`,close:()=>{server.close();server.closeAllConnections();}};
}
module.exports={startDesktopMCP};
