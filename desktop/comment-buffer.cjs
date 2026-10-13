const normalized = text => text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
function captureOptions(value = {}) {
  return { limit: [50, 200, 1000].includes(value?.limit) ? value.limit : 200, includeReplies: value?.includeReplies === true };
}
function createCommentBuffer(options) {
  const { limit, includeReplies } = captureOptions(options);
  const rows = [], ids = new Map(), texts = new Map();
  let characters = 0, duplicates = 0, skipped = 0, full = false;
  function merge(inputs, pageSkipped = 0) {
    if (!Array.isArray(inputs)) throw Error('评论结构无法识别，请改用选中文字读取');
    skipped = Math.max(skipped, Number.isSafeInteger(pageSkipped) ? pageSkipped : 0);
    let added = 0;
    for (const input of inputs.slice(0, 1000)) {
      if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) continue;
      if (input.isReply === true && !includeReplies) continue;
      const row = { text: input.text.trim(), likes: Number.isSafeInteger(input.likes) && input.likes >= 0 && input.likes <= 1000000000 ? input.likes : null, timeLabel: typeof input.timeLabel === 'string' ? input.timeLabel.slice(0, 100) : '', isReply: input.isReply === true };
      if (typeof input.platformCommentId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(input.platformCommentId)) row.platformCommentId = input.platformCommentId;
      if (typeof input.parentCommentId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(input.parentCommentId)) row.parentCommentId = input.parentCommentId;
      if (typeof input.commentAt === 'string' && Number.isFinite(Date.parse(input.commentAt))) row.commentAt = new Date(input.commentAt).toISOString();
      const key = normalized(row.text), match = texts.get(key);
      const old = row.platformCommentId ? ids.get(row.platformCommentId) || (!match?.platformCommentId ? match : null) : match;
      if (old) {
        duplicates++;
        if (row.likes !== null) old.likes = row.likes;
        if (row.parentCommentId) old.parentCommentId = row.parentCommentId;
        if (row.commentAt) old.commentAt = row.commentAt;
        if (row.platformCommentId && !old.platformCommentId) { old.platformCommentId = row.platformCommentId; ids.set(row.platformCommentId, old); }
        continue;
      }
      if (rows.length >= limit || characters + row.text.length > 120000) { full = true; break; }
      rows.push(row); texts.set(key, row); if (row.platformCommentId) ids.set(row.platformCommentId, row);
      characters += row.text.length; added++;
      if (rows.length >= limit) { full = true; break; }
    }
    return added;
  }
  const stats = () => ({ count: rows.length, replies: rows.filter(r => r.isReply).length, limit, includeReplies, duplicates, skipped, full });
  return { merge, stats, rows: () => rows.map(r => ({ ...r })), clear: () => { rows.length = 0; ids.clear(); texts.clear(); } };
}
module.exports = { createCommentBuffer, captureOptions };
