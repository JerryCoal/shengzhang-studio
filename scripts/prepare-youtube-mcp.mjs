// Adds our own entry point to the reviewed upstream checkout. Does not modify
// upstream files, install packages, run an OAuth flow, or contact any API.
import { readFile,writeFile,stat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const YOUTUBE_STUDIO_ENTRY = `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { createAuthFromEnv } from './auth/oauth.js';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';

async function main() {
  if (!process.env.TOKEN_STORAGE_PATH || !isAbsolute(process.env.TOKEN_STORAGE_PATH)) throw new Error('请设置独立账号的 TOKEN_STORAGE_PATH 绝对路径');
  process.env.GOOGLE_REDIRECT_URI ||= 'http://127.0.0.1:18111/callback';
  const auth = createAuthFromEnv();
  const args = process.argv.slice(2);
  if (args.length === 0) { await createServer(auth).connect(new StdioServerTransport()); return; }
  if (args.length !== 1 || args[0] !== '--login') throw new Error('仅支持 --login，或不带参数启动 stdio MCP');
  const redirect = new URL(process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:18111/callback');
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || redirect.username || redirect.password || redirect.search || redirect.hash) throw new Error('GOOGLE_REDIRECT_URI 需为带端口的本机 127.0.0.1 回调');
  const state = randomBytes(32).toString('hex');
  const authorization = new URL(auth.getAuthUrl(['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.force-ssl']));
  if (authorization.protocol !== 'https:' || authorization.hostname !== 'accounts.google.com' || authorization.username || authorization.password) throw new Error('授权地址不是 Google 官方页面');
  authorization.searchParams.set('state',state);
  let used = false;
  const server = createHttpServer(async(req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'");
    if (req.headers.host !== redirect.host || req.method !== 'GET') { res.writeHead(400); res.end('请求无效'); return; }
    const url = new URL(req.url || '/',redirect.origin);
    if (url.pathname !== redirect.pathname) { res.writeHead(404); res.end('没有此页面'); return; }
    const returned = Buffer.from(url.searchParams.get('state') || ''), expected = Buffer.from(state);
    if (used || returned.length !== expected.length || !timingSafeEqual(returned,expected)) { res.writeHead(400); res.end('授权校验失败，请重新开始。'); return; }
    used = true;
    try { const code = url.searchParams.get('code'); if (!code || code.length > 4096 || url.searchParams.has('error')) throw new Error('未完成授权'); await auth.exchangeCode(code); res.end('<h2>YouTube 授权已保存到本机</h2><p>可以关闭本页并启动工作站 MCP 连接。不要复制或发送令牌文件。</p>'); console.error('YouTube 授权已保存。'); }
    catch { res.writeHead(400); res.end('授权未完成，请检查 Google 应用配置、测试用户或权限后重新操作。'); process.exitCode = 1; }
    finally { clearTimeout(timer); server.close(); }
  });
  await new Promise<void>((ok,no)=>{server.once('error',no);server.listen(Number(redirect.port),'127.0.0.1',ok);});
  const timer = setTimeout(()=>{console.error('授权等待已结束，请重试。');server.close();process.exitCode=1;},10*60*1000);
  console.error('在系统浏览器打开以下 Google 官方授权链接（仅本次授权有效）：');
  console.error(authorization.href);
}
main().catch(()=>{console.error('YouTube 本机服务启动失败，请检查依赖、应用配置与授权目录。未输出令牌或原始错误。');process.exitCode=1;});
`;
export async function prepareYouTubeEntry(directory) {
  const root=resolve(directory); const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  if (!pkg.dependencies?.googleapis || !pkg.dependencies?.['@modelcontextprotocol/sdk']) throw Error('不是兼容的 YouTube MCP 源码目录');
  const auth=await readFile(join(root,'src/auth/oauth.ts'),'utf8'), server=await readFile(join(root,'src/server.ts'),'utf8');
  if (!auth.includes('export function createAuthFromEnv') || !server.includes('export function createServer(auth?')) throw Error('上游接口已改变，请先核对新版本');
  if (!(await stat(join(root,'src'))).isDirectory()) throw Error('源码目录不存在');
  const target=join(root,'src/studio-entry.ts');
  try { await writeFile(target,YOUTUBE_STUDIO_ENTRY,{flag:'wx'}); }
  catch(error) { if (error.code!=='EEXIST' || await readFile(target,'utf8') !== YOUTUBE_STUDIO_ENTRY) throw error; }
  return target;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--repo'){console.error('用法：node scripts/prepare-youtube-mcp.mjs --repo YouTube-MCP源码目录');process.exitCode=1;}
  else try { await prepareYouTubeEntry(args[1]); console.log('已添加工作站专用入口 src/studio-entry.ts；原有上游文件未改动。下一步按安装指引构建并授权。'); }
  catch { console.error('未能准备 YouTube MCP 入口，请检查所选源码版本、依赖声明或同名文件。原有源码没有被覆盖。');process.exitCode=1; }
}
