const {randomUUID,createHash} = require('node:crypto');
// Memory-only cookies. Sessions are never stored in an Electron persist: partition.
// A different application login receives completely new platform sessions.
function createPlatformSessions(session, authenticate) {
  let owner = '', epoch = 0;
  const sessions = new Map();
  async function clear() {
    epoch++;owner='';const old=[...sessions.values()];sessions.clear();
    await Promise.allSettled(old.map(s=>s.clearStorageData()));
  }
  async function acquire(platform, token) {
    if (!['xiaohongshu','douyin'].includes(platform) || typeof token !== 'string' || !token || token.length > 1024) throw Error('请重新登录工作台后连接平台');
    const ticket=epoch;
    await authenticate(token);
    if (ticket!==epoch) throw Error('工作台登录已变化，请重新操作');
    const key=createHash('sha256').update(token).digest('hex');
    if (owner && owner!==key) await clear();
    owner=key;
    if (!sessions.has(platform)) sessions.set(platform,session.fromPartition(`studio-platform-${randomUUID()}`,{cache:false}));
    return sessions.get(platform);
  }
  return {acquire,clear};
}
module.exports={createPlatformSessions};
