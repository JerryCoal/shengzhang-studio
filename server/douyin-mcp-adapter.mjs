// Interface adapter, independently implemented from the published MCP contract.
// Upstream: panwenda/douyin-publish-mcp 0.3.6, commit 63c15b9d4ea73ce91111adab8b1c2befc6d09de6.
import { assert } from './domain.mjs';
export function douyinMCPText(value) {
  return (Array.isArray(value?.content) ? value.content : []).filter(c=>c?.type==='text'&&typeof c.text==='string').slice(0,5).map(c=>c.text.slice(0,16000)).join('\n');
}
export function douyinMCPLogin(value) {
  const text=douyinMCPText(value);
  if (/^logged_in=True\s*$/m.test(text)) return 'logged-in';
  if (/^logged_in=False\s*$/m.test(text)) return 'not-logged-in';
  return 'unknown';
}
export function douyinMCPDraft(draft, file) {
  const image=draft.mime.startsWith('image/');
  // Titles are validated earlier by the same platform draft validator.
  return {name:image?'douyin_publish_note':'douyin_publish_video',args:{account:'main',title:draft.title,tags:[],...(image?{images:[file],note:draft.body}:{file,description:draft.body})}};
}
export function douyinMCPPlan(value) {
  // 0.3.6 embeds the fingerprint in this instruction, after the JSON plan.
  // Match the whole documented line so a title/body mentioning plan_id cannot supply it.
  const text=douyinMCPText(value);
  const matches=[...text.matchAll(/^用户明确同意后，用 plan_id="([a-f0-9]{12})" 且 confirm=true 再调用一次；\s*$/gm)];
  const standalone=[...text.matchAll(/^\s*plan_id\s*=\s*["']?([a-f0-9]{12})["']?\s*$/gm)];
  const plans=new Set([...matches,...standalone].map(match=>match[1]));
  assert(plans.size===1,'抖音 MCP 未返回可核对的发布计划，本次没有提交。请核对 panwenda/douyin-publish-mcp 版本。',502);
  return [...plans][0];
}
