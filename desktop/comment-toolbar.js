const $ = id => document.getElementById(id);
const bridge = window.commentCapture;
let sending = false, current = {};
function render(state) {
  current = state;
  $('heading').textContent = `${state.platform === 'douyin' ? '抖音' : '小红书'} · ${state.running ? '正在加载和采集' : state.count ? '已采集内容可返回预览' : '先登录，再一键采集'}`;
  $('count').textContent = state.count || 0; $('target').textContent = `/ ${state.limit || 200} 条`;
  $('message').textContent = state.message || '请在下方页面完成登录，再开始采集'; $('message').title = $('message').textContent;
  $('rounds').textContent = state.rounds ? `${state.rounds} 轮 · ${state.replies || 0} 回复 · 结构化 ${state.networkCount || 0} 条` : '尚未开始';
  $('progress').style.width = `${Math.min(100, (state.count || 0) / (state.limit || 200) * 100)}%`;
  $('dot').className = 'dot ' + (state.running ? 'running' : state.count || state.reason ? 'paused' : '');
  $('start').textContent = state.rounds ? '继续自动采集' : '开始自动采集';
  $('start').disabled = state.running || state.busy || state.full || sending;
  $('pause').disabled = !state.running;
  for (const id of ['read','selected','reload']) $(id).disabled = state.running || state.busy || sending;
  $('finish').disabled = (!state.count && !state.hasMetrics) || state.busy || sending;
  $('limit').disabled = state.locked || state.running || state.busy; $('replies').disabled = $('limit').disabled;
  $('limit').value = String(state.limit || 200); $('replies').checked = !!state.includeReplies;
}
async function action(type) {
  if (!bridge || sending) return;
  sending = true;
  try { const result = await bridge.command(type, { limit: Number($('limit').value), includeReplies: $('replies').checked }); if (result) render(result); }
  catch { current = { ...current, message: '操作未完成，请关闭窗口后重试' }; }
  finally { sending = false; render(current); }
}
for (const [id, type] of [['start','start'],['pause','pause'],['read','read'],['finish','finish'],['selected','selection'],['reload','reload'],['metrics','metrics']]) $(id)?.addEventListener('click', () => void action(type));
if (bridge) { bridge.onProgress(render); void bridge.command('status').then(render); }
