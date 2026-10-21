// User-installed rules and old generation recipes remain local. This scrubber
// only removes data; it never enables forwarding rules to a relay or provider.
const privateKeys = new Set(['localQwenConnection', 'contentEditDrafts', 'agentWorkspace', 'agentContext', 'agentPacket', 'agentHandoffs', 'taskJournal', 'knowledge', 'knowledgeContext', 'contentBrief', 'contentRequests', 'xhsAssistant', 'xhsCoverPlan', 'skillTrace', 'researchReferences', 'creativeSkill', 'builtinSkills', 'builtinSkillOverrides', 'userSkillVersions', 'briefImports', 'recipe', 'installedSkills', 'skillsRevision', 'skillSelections', 'creationProfile', 'creationSelections', 'activeCreationAccounts', 'accountContext', 'creationTrace']);
export function removeWebSkillHistory(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) removeWebSkillHistory(item); return; }
  // Requirements are also embedded in the initial task prompt for local
  // drafting. Do not let an unrelated relay operation upload that copy.
  if (value.contentBrief) { value.prompt = ''; value.localContentOnly = true; }
  if (value.source === 'direct' && Array.isArray(value.tasks)) for (const task of value.tasks) task.prompt = '';
  // Cover candidates flatten the recipe; frame/video jobs use recipe objects.
  if (Object.hasOwn(value, 'prompt') && (Object.hasOwn(value, 'promptVersion') || Object.hasOwn(value, 'skillVersions'))) {
    delete value.prompt; delete value.promptVersion; delete value.skillVersions;
  }
  for (const key of privateKeys) delete value[key];
  for (const item of Object.values(value)) removeWebSkillHistory(item);
}

export function hasWebSkillHistory(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasWebSkillHistory);
  if ([...privateKeys].some(key => Object.hasOwn(value, key))) return true;
  if (Object.hasOwn(value, 'prompt') && (Object.hasOwn(value, 'promptVersion') || Object.hasOwn(value, 'skillVersions'))) return true;
  return Object.values(value).some(hasWebSkillHistory);
}
