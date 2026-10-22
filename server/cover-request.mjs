import { createHash } from 'node:crypto';
import { mediaPrompt } from './prompts.mjs';
import { rulesOf } from './workflow.mjs';
import { resolveAccountCreation, assertAssetCreationAccount } from './account-creation.mjs';
import { resolveCreativeSkill } from './creative-skills.mjs';
import { resolveBuiltinSkills } from './builtin-skills.mjs';
import { workflowSkillTrace } from './creative-skill-catalog.mjs';
import { contentProjectForAsset, contentKnowledge } from './content-workflow.mjs';
import { seedreamSettingsSchema } from './seedream-config.mjs';

const fail = (message, status = 409) => { throw Object.assign(Error(message), { status, noCharge: true }); };
export function coverModelOptions(config, preferences) {
  const settings = preferences.get().seedream, options = [];
  const seedream = config.seedreamVault?.status();
  if (seedream?.configured && !seedream.problem) options.push({ provider: 'seedream', model: settings.model, label: `Seedream ${settings.family} · 火山方舟`, reservation: Math.max(settings.reservationUsd, settings.imagePriceUsd), currency: 'USD' });
  if (config.redfox?.enabled('media') && config.redfox.status().configured && !config.redfox.status().problem) options.push({ provider: 'redfox', model: 'Seedream 5.0 Pro', label: 'Seedream 5.0 Pro · Redfox', reservation: 1, currency: 'CNY' });
  return options;
}

// A per-request choice overrides only this request, never shared or account defaults.
export function coverRecipe(state, project, asset, input) {
  let scoped = state;
  if (input.skillId !== undefined) {
    scoped = { ...state, skillSelections: { ...state.skillSelections, cover: input.skillId }, accounts: state.accounts.map(account => ({ ...account, ...(account.creationProfile ? { creationProfile: { ...account.creationProfile, presets: (account.creationProfile.presets || []).map(preset => ({ ...preset, skillSelections: { ...preset.skillSelections, cover: input.skillId } })) } } : {}) })) };
  }
  let { creativeSkill, accountContext } = resolveAccountCreation(scoped, contentProjectForAsset(project, asset), asset.channel, 'cover');
  if (input.skillId !== undefined) {
    creativeSkill = input.skillId ? { ...resolveCreativeSkill(state, { skillId: input.skillId, stage: 'cover', platform: asset.channel }), workflowId: 'cover' } : null;
  }
  assertAssetCreationAccount(asset, accountContext);
  const knowledgeContext = contentKnowledge(project, asset, accountContext, input.query || input.prompt);
  const builtinSkills = resolveBuiltinSkills(state, 'cover');
  const recipe = mediaPrompt(project, asset, { ...input, purpose: 'cover', hasProductReference: !!project.imageData, creativeSkill, builtinSkills, accountContext, knowledgeContext }, rulesOf(state));
  recipe.skillTrace = workflowSkillTrace('cover', { creativeSkill, builtinSkills, accountContext }, new Date().toISOString());
  return recipe;
}

export function coverRequest(state, project, asset, input, config, preferences) {
  if (asset.revision !== input.expectedRevision) fail('内容已更新，请重新核对图片费用与规则');
  const provider = input.provider || (config.redfox?.enabled('media') ? 'redfox' : 'seedream');
  const settings = seedreamSettingsSchema.parse({ ...preferences.get().seedream, ...(input.watermark === undefined ? {} : { watermark: input.watermark }) });
  const model = provider === 'redfox' ? 'Seedream 5.0 Pro' : settings.model;
  if (input.model !== undefined && input.model !== model) fail('图片模型配置已变化，请重新选择并核对费用');
  const option = coverModelOptions(config, preferences).find(option => option.provider === provider && option.model === model);
  if (input.approvalFingerprint !== undefined && !option) fail('所选图片模型连接已变化，请重新核对');
  const recipe = coverRecipe(state, project, asset, input);
  const fingerprint = createHash('sha256').update(JSON.stringify({ projectId: project.id, assetId: asset.id, revision: asset.revision, title: asset.title, body: asset.body, provider, model, settings, option, prompt: recipe.prompt, reference: project.imageData || '', accountContext: recipe.accountContext, skillTrace: { ...recipe.skillTrace, at: '' } })).digest('hex');
  if (input.approvalFingerprint !== undefined && input.approvalFingerprint !== fingerprint) fail('图片资料、账号、Skills 或费用已变化，请重新核对并同意本次请求');
  return { provider, model, settings, recipe, fingerprint, option };
}

const coverInputDigest = input => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]])))).digest('hex');
function coverReceipts(asset) {
  const rows = asset.coverRequestLedger || [];
  if (!Array.isArray(rows) || rows.length > 200 || rows.some(row => !row || typeof row.requestId !== 'string' || typeof row.digest !== 'string' || typeof row.generationId !== 'string') || new Set(rows.map(row => row.requestId)).size !== rows.length) fail('图片请求留存记录有误，请核对备份后继续');
  return rows;
}
export function replayCoverRequest(asset, input) {
  if (!input.requestId) return null;
  const receipt = coverReceipts(asset).find(row => row.requestId === input.requestId);
  if (receipt) { if (receipt.digest !== coverInputDigest(input)) fail('同一图片请求的内容已改变，请重新核对费用'); return receipt; }
  const previous = asset.aiCover;
  if (previous?.input?.requestId === input.requestId) {
    if (coverInputDigest(previous.input) !== coverInputDigest(input)) fail('同一图片请求的内容已改变，请重新核对费用');
    return { requestId: input.requestId, digest: coverInputDigest(input), generationId: previous.id, createdAt: previous.createdAt || '' };
  }
  return null;
}
export function rememberCoverRequest(asset, input, generationId) {
  const rows = [...coverReceipts(asset)], previous = asset.aiCover;
  const add = receipt => {
    const known = rows.find(row => row.requestId === receipt.requestId);
    if (known) { if (known.digest !== receipt.digest) fail('图片请求留存记录冲突'); return; }
    if (rows.length >= 200) fail('本素材已保留 200 次图片请求，请建立新的素材继续；旧请求记录已保留');
    rows.push(receipt);
  };
  if (previous?.input?.requestId) add({ requestId: previous.input.requestId, digest: coverInputDigest(previous.input), generationId: previous.id, createdAt: previous.createdAt || '' });
  if (input.requestId) {
    if (rows.some(row => row.requestId === input.requestId)) fail('该图片请求已经提交，请查询原请求');
    add({ requestId: input.requestId, digest: coverInputDigest(input), generationId, createdAt: new Date().toISOString() });
  }
  if (rows.length) asset.coverRequestLedger = rows;
}
