import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMatrixBridge } from '../server/matrix-stdio-bridge.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--config') { console.error('用法：node scripts/start-matrix-mcp.mjs --config 本机配置.json'); process.exitCode = 1; }
else {
  try {
    const source = await readFile(resolve(args[1]),'utf8'); if (Buffer.byteLength(source) > 100000) throw new Error('配置文件过大');
    const bridge = await startMatrixBridge(JSON.parse(source));
    console.log(`本机 MCP 桥接已启动：${bridge.endpoint}。关闭本窗口将停止服务。`);
    let stopping = false; const stop = async () => { if (stopping) return; stopping = true; await bridge.close(); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
  } catch { console.error('无法启动 MCP 桥接。请检查配置 JSON、程序绝对路径、端口与依赖；未输出凭证或服务原文。'); process.exitCode = 1; }
}
