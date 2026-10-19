import { resolve } from 'node:path';
import { createTeamApp } from './team-app.mjs';

const dataDirectory = resolve(process.env.STUDIO_TEAM_DATA_DIR || 'data/team');
const app = await createTeamApp({ dataDirectory, publicOrigin: process.env.STUDIO_TEAM_ORIGIN || 'https://localhost', workspaceName: process.env.STUDIO_TEAM_WORKSPACE || '团队工作区', staticDirectory: process.env.STUDIO_STATIC_DIR || resolve('dist') });
const server = app.listen(Number(process.env.STUDIO_TEAM_PORT || 4320), '127.0.0.1', () => {
  console.log(`团队工作站已启动：${process.env.STUDIO_TEAM_ORIGIN || 'https://localhost'}`);
  console.log(`主机数据目录：${dataDirectory}`);
  console.log('首次使用请查看数据目录中的 setup.code，在页面创建管理员。');
  process.send?.({ event: 'ready', url: process.env.STUDIO_TEAM_ORIGIN || 'https://localhost' });
});
let stopping = false;
async function shutdown() { if (stopping) return; stopping = true; server.close(); server.closeIdleConnections(); await app.locals.close(); process.exit(0); }
server.on('error', error => { console.error(`团队服务启动失败：${error.code || '请检查端口和数据目录'}`); void shutdown(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown());
process.on('message', message => { if (message?.event === 'shutdown') void shutdown(); });
process.on('disconnect', () => void shutdown());
