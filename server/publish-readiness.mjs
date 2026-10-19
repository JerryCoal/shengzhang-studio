// Presentation-only readiness. Upload, export and publication endpoints retain
// their own validation; opening the publication page never publishes anything.
const mediaKinds = { 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image', 'video/mp4': 'video', 'video/webm': 'video' };
function hasCurrentMedia(asset) {
  if (mediaKinds[asset.mime] !== asset.kind || typeof asset.mediaData !== 'string') return false;
  const prefix = `data:${asset.mime};base64,`;
  if (!asset.mediaData.startsWith(prefix)) return false;
  const encoded = asset.mediaData.slice(prefix.length);
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  let header;
  try { header = atob(encoded.slice(0, 24)); } catch { return false; }
  const hex = count => Array.from(header.slice(0, count), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  if (asset.mime === 'image/png') return hex(8) === '89504e470d0a1a0a';
  if (asset.mime === 'image/jpeg') return hex(3) === 'ffd8ff';
  if (asset.mime === 'image/webp') return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  if (asset.mime === 'video/webm') return hex(4) === '1a45dfa3';
  return header.slice(4, 8) === 'ftyp';
}
const blocked = (code, message, nextAction = '返回内容制作') => ({ ready: false, code, message, nextAction });

export function assetPublishReadiness(asset) {
  if (asset.status === 'ready') {
    return hasCurrentMedia(asset)
      ? { ready: true, code: 'ready', message: '当前成品已就绪，可以核对内容、选择账号并准备发布。', nextAction: '前往发布' }
      : blocked('missing-media', '成品文件缺失或格式不完整。请重新制作，或重新选择本地成品。');
  }
  const cover = asset.aiCover, video = asset.aiProduction;
  if (cover?.phase === 'generating') return blocked('generating-image', 'AI 配图仍在生成。完成后请检查候选图，并点击“确认采用为封面”。', '查看 AI 配图');
  if (cover?.phase === 'ready') {
    return cover.assetRevision === asset.revision && cover.mediaData
      ? blocked('image-awaiting-approval', 'AI 候选图已生成，但还没有采用。请打开 AI 配图，检查后点击“确认采用为封面”。', '检查并采用配图')
      : blocked('stale-image', '候选图对应的文案版本已变化。请按当前文案重新生成并采用配图。', '更新配图');
  }
  if (['generating-frame', 'submitting-video', 'generating-video'].includes(video?.phase)) return blocked('generating-video', '视频制作任务仍在进行。请打开 AI 视频查看进度，成品保存后即可准备发布。', '查看视频进度');
  if (video?.resultMediaData) return blocked('video-awaiting-approval', '视频已生成，但生成期间文案有变化。请打开 AI 视频核对后，点击“将此视频用于当前文案”。', '检查并采用视频');
  if (cover?.phase === 'uncertain' || video?.phase === 'uncertain') return blocked('uncertain-generation', '上次生成的结果需要核对。请打开对应的 AI 制作窗口查看提示，再决定采用或重试。', '核对生成结果');
  if (cover?.phase === 'stale' || video?.phase === 'stale') return blocked('stale-generation', '生成结果对应旧版本文案。请按当前文案重新制作画面，检查后采用。', '更新画面');
  if (cover?.phase === 'failed' || video?.phase === 'failed') return blocked('failed-generation', '上次 AI 制作未完成。请打开制作窗口查看原因并重试，也可制作本地模板或采用本地成品。', '查看制作原因');
  if (video?.phase === 'frames') return blocked('video-needs-render', '当前只有视频关键帧。请打开 AI 视频，检查首尾帧后生成视频成品。', '继续制作视频');
  if (asset.mediaData) return blocked('outdated-media', '文案或标题已修改，预览仍是旧版画面。请重新制作，或检查并重新采用本地成品。', '更新当前画面');
  return blocked('not-produced', `当前只有文案，还没有可发布的${asset.kind === 'video' ? '视频' : '图片'}。请制作画面，或选择电脑里已有的成品。`, '制作或选择成品');
}

// Keep the generating account selected when it still exists. If it was removed,
// require an explicit choice instead of silently using the first account.
export function publicationAccountChoice(asset, accounts) {
  const eligible = accounts.filter(account => account.platform === asset.channel);
  const source = asset.creationTrace?.accounts?.find(account => account.platform === asset.channel);
  const sourceAvailable = !!source && eligible.some(account => account.id === source.accountId);
  return {
    defaultAccountId: source ? sourceAvailable ? source.accountId : '' : eligible[0]?.id || '',
    sourceAccountId: source?.accountId || '',
    sourceAccountName: source?.accountName || '',
    sourceAvailable,
  };
}
