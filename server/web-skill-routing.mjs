import { skillWorkflowId } from './skill-workflows.mjs';

const identifier = '[a-zA-Z0-9_-]{1,100}';
const projectPath = new RegExp(`^/projects/(${identifier})/(strategies|analysis|comments/classify)$`);
const assetPath = new RegExp(`^/projects/(${identifier})/assets/(${identifier})/(copy|cover|keyframes|seedance)$`);

// Identify an existing web AI operation only. This helper does not select or
// serialize rules, and does not expand the relay's operation allowlist.
export function webSkillWorkflowId(state, path, body = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  let match = projectPath.exec(path);
  if (match) {
    if (!state.projects?.some(project => project.id === match[1])) return null;
    if (match[2] === 'strategies') return input.mode === 'openai' && ['strategy', 'planning'].includes(input.stage || 'strategy') ? input.stage || 'strategy' : null;
    if (match[2] === 'analysis') return input.mode === 'openai' ? 'analysis' : null;
    return 'classification';
  }
  match = assetPath.exec(path);
  if (!match) return null;
  const asset = state.projects?.find(project => project.id === match[1])?.assets?.find(item => item.id === match[2]);
  if (!asset) return null;
  if (match[3] === 'copy') {
    if (input.reviewOnly === true) return input.reviewMode === 'semantic' ? 'price-semantic' : !input.reviewMode || input.reviewMode === 'words' ? 'word-review' : null;
    return skillWorkflowId('copy', { task: { channel: asset.channel } });
  }
  if (match[3] === 'keyframes') return ['first_frame', 'last_frame'].includes(input.role) ? input.role : null;
  return match[3] === 'seedance' ? 'video' : 'cover';
}
