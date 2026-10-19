// Shared, deterministic formatting only. Candidates are not verified platform topics.
export const XHS_MAX_TOPICS = 10;
export const XHS_MAX_TOPIC_LENGTH = 40; // Workstation input bound, not a claimed platform rule.
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const size = text => Array.from(text).length;
const separator = /^[\s,，、;；]*$/u;

export function splitXhsTopics(body) {
  if (typeof body !== 'string') return { content: '', tags: [] };
  const tokens = [];
  const pattern = /[#＃]([\p{L}\p{N}_-]+)(?:\[话题\]|［话题］)?[#＃]?/gu;
  for (const match of body.matchAll(pattern)) {
    const before = body.slice(0, match.index);
    const previous = tokens.at(-1);
    const boundary = !before || /[\s,，、;；：:]$/u.test(before) || previous?.end === match.index;
    // Do not turn URLs, C#, issue numbers, inline code or fenced examples into topics.
    if (!boundary || !/\p{L}/u.test(match[1]) || /(?:https?:\/\/|www\.)\S*$/iu.test(before)) continue;
    const fences = before.match(/^\s*(?:```|~~~)/gmu) || [];
    const line = before.slice(before.lastIndexOf('\n') + 1);
    if (fences.length % 2 || (line.match(/`/g) || []).length % 2) continue;
    tokens.push({ start: match.index, end: match.index + match[0].length, tag: match[1] });
  }
  const tail = tokens.at(-1);
  if (!tail || !separator.test(body.slice(tail.end))) return { content: body, tags: [] };
  let first = tokens.length - 1;
  while (first > 0 && separator.test(body.slice(tokens[first - 1].end, tokens[first].start))) first--;
  let content = body.slice(0, tokens[first].start).trimEnd();
  content = content.replace(/(?:^|\n)[ \t]*(?:话题标签|话题|标签)[：:][ \t]*$/u, '').trimEnd();
  return { content, tags: tokens.slice(first).map(token => token.tag) };
}

export function prepareXhsTopics(body, selectedTags) {
  if (typeof body !== 'string') fail('正文格式不正确');
  const split = splitXhsTopics(body);
  const input = selectedTags === undefined ? split.tags : selectedTags;
  if (!Array.isArray(input) || input.length > 100) fail('话题列表格式不正确');
  const tags = [], seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.length > 300) fail('话题名称格式不正确');
    const name = raw.normalize('NFKC').trim().replace(/^#+/u, '').replace(/#+$/u, '').replace(/\[话题\]$/u, '').trim();
    if (!name || /[#\[\]<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(name)) fail('话题请填写名称，每行一个，不要包含脚本、换行或多个井号话题');
    if (size(name) > XHS_MAX_TOPIC_LENGTH) fail(`工作站中每个话题最多 ${XHS_MAX_TOPIC_LENGTH} 个字符，请缩短后重试`);
    const key = name.toLocaleLowerCase('en-US');
    if (!seen.has(key)) { seen.add(key); tags.push(name); }
  }
  if (tags.length > XHS_MAX_TOPICS) fail(`一次最多提交 ${XHS_MAX_TOPICS} 个话题，请删减后重试`);
  const content = split.content;
  const bodyWithTopics = tags.length ? `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${tags.map(tag => '#' + tag).join(' ')}` : content;
  if (size(bodyWithTopics) > 1000) fail('正文加话题超过 1000 字，请缩短正文或减少话题后重试');
  return { content, tags, bodyWithTopics };
}
