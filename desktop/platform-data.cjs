// Independently implemented parsers for responses requested by the official page.
// Never replay private APIs or retain request headers / account profiles.
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value) ? value : null;
function count(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  if (!['number','string'].includes(typeof value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 && n <= 1e12 ? n : null;
}
function metricRequest(value, work) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !work?.itemId) return null;
    if (work.platform === 'xiaohongshu' && ['www.xiaohongshu.com','edith.xiaohongshu.com'].includes(u.hostname) && u.pathname === '/api/sns/web/v1/feed') return {...work, kind:'metrics'};
    if (work.platform === 'douyin' && u.hostname === 'www.douyin.com' && ['/aweme/v1/web/aweme/detail/','/aweme/v1/web/aweme/post/'].includes(u.pathname)) return {...work, kind:'metrics'};
  } catch {}
  return null;
}
function parseMetricResponse(body, work, now = Date.now) {
  if (typeof body !== 'string' || body.length > 5_000_000 || !work) return null;
  let data; try { data = JSON.parse(body); } catch { return null; }
  let metrics;
  if (work.platform === 'xiaohongshu' && data?.success === true) {
    const item = data.data?.items?.find?.(x => x?.id === work.itemId && (!x.note_card?.note_id || x.note_card.note_id === work.itemId));
    const info = item?.note_card?.interact_info;
    if (info) metrics = {views:null,likes:count(info.liked_count),comments:count(info.comment_count),favorites:count(info.collected_count),shares:count(info.share_count)};
  } else if (work.platform === 'douyin' && data?.status_code === 0) {
    const items = Array.isArray(data.aweme_list) ? data.aweme_list : [data.aweme_detail];
    const info = items.find(x => x?.aweme_id === work.itemId)?.statistics;
    if (info && (!info.aweme_id || info.aweme_id === work.itemId)) metrics = {views:count(info.play_count),likes:count(info.digg_count),comments:count(info.comment_count),favorites:count(info.collect_count),shares:count(info.share_count)};
  }
  return metrics && Object.values(metrics).some(v => v !== null) ? {platform:work.platform,itemId:work.itemId,metrics,capturedAt:new Date(now()).toISOString()} : null;
}
function publishRequest(value, platform) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    return platform === 'xiaohongshu' ? ['edith.xiaohongshu.com','creator.xiaohongshu.com'].includes(u.hostname) && u.pathname === '/web_api/sns/v2/note' : platform === 'douyin' && u.hostname === 'creator.douyin.com' && u.pathname === '/web/api/media/aweme/create_v2/';
  } catch { return false; }
}
function parsePublishResponse(body, platform) {
  if (typeof body !== 'string' || body.length > 1_000_000) return null;
  let data; try {data = JSON.parse(body);} catch {return null;}
  // Submission is acknowledged only with an exact string ID, never a rounded JS number.
  const success = platform === 'xiaohongshu' ? data?.success === true && (data.code === undefined || data.code === 0) : data?.status_code === 0;
  const itemId = identifier(platform === 'xiaohongshu' ? data?.data?.id || data?.data?.note_id : data?.item_id || data?.data?.item_id);
  if (!success || !itemId || !(platform === 'xiaohongshu' ? /^[a-fA-F0-9]{24}$/ : /^\d{8,30}$/).test(itemId)) return null;
  return {platform,itemId,url:platform === 'xiaohongshu' ? `https://www.xiaohongshu.com/explore/${itemId}` : `https://www.douyin.com/video/${itemId}`,submittedAt:new Date().toISOString()};
}
function watchPublication(page, platform, onReceipt) {
  let armed = false, closed = false, requestId = null, generation = 0;
  const listener = async (_event, method, p) => {
    if (closed || !armed) return;
    if (method === 'Network.requestWillBeSent' && requestId === null && p.request?.method === 'POST' && publishRequest(p.request.url, platform)) requestId = p.requestId;
    if (method !== 'Network.loadingFinished' || p.requestId !== requestId || p.encodedDataLength > 1_000_000) return;
    const ticket = generation;
    try {
      const response = await page.debugger.sendCommand('Network.getResponseBody',{requestId});
      if (closed || !armed || ticket !== generation) return;
      const receipt = parsePublishResponse(response.base64Encoded ? Buffer.from(response.body,'base64').toString('utf8') : response.body,platform);
      if (receipt) {armed = false; onReceipt(receipt);}
    } catch {}
  };
  return {
    async start() {if (!page.debugger.isAttached()) page.debugger.attach('1.3');page.debugger.on('message',listener);await page.debugger.sendCommand('Network.enable');},
    arm() {generation++;requestId = null;armed = true;},
    disarm() {generation++;armed = false;},
    close() {closed = true;generation++;page.debugger.removeListener('message',listener);},
  };
}
module.exports = {count,metricRequest,parseMetricResponse,publishRequest,parsePublishResponse,watchPublication};
