import { readFileSync } from 'node:fs';
import { atomicJSON } from './vault.mjs';
import { canUseCredentials } from './ai-routes.mjs';
import { assert } from './domain.mjs';
import { mountMediaGeneration, seedanceSettingsSchema, defaultSeedance } from './media-generation.mjs';
import { mountDouyin } from './douyin.mjs';
import { mountFeishuSync } from './feishu-sync.mjs';
import { mountMCPPlatforms } from './mcp-platforms.mjs';
import { z } from 'zod';
import { defaultSeedream, seedreamSettingsSchema, seedreamConnectionSchema } from './seedream-config.mjs';
import { createRedfoxService } from './redfox-client.mjs';
import { redfoxSearchCatalog } from './redfox-search-catalog.mjs';
import { REDFOX_SOCIAL_OPERATIONS, redfoxSocialCapabilities } from './redfox-social-catalog.mjs';
import { redfoxMediaCatalog } from './redfox-media-catalog.mjs';
import { redfoxXhsCatalog } from './redfox-xhs-catalog.mjs';
import { mountRedfoxSocial } from './redfox-social.mjs';
import { canEditSharedSettings } from './workspace-access.mjs';
import { mountRedfoxTrends } from './redfox-trends.mjs';

const redfoxSettingsSchema = z.object({ enabled: z.boolean().default(false), mediaEnabled: z.boolean().default(false), searchEnabled: z.boolean().default(false) }).strict();

export function createIntegrationPreferences(file) {
  let data = { seedance: { ...defaultSeedance }, seedream: { ...defaultSeedream }, imageProvider: 'seedream', redfox: redfoxSettingsSchema.parse({}) };
  if (file) try { const saved = JSON.parse(readFileSync(file, 'utf8')); data = { seedance: seedanceSettingsSchema.extend({ model: seedanceSettingsSchema.shape.model.or(z.literal('')) }).parse(saved.seedance), seedream: saved.seedream ? seedreamSettingsSchema.parse(saved.seedream) : { ...defaultSeedream }, imageProvider: z.enum(['openai', 'seedream']).parse(saved.imageProvider || 'openai') }; } catch (error) { if (error.code !== 'ENOENT') throw new Error('生成服务配置损坏，请检查 integration-settings.json'); }
  if (file) try { data.redfox = redfoxSettingsSchema.parse(JSON.parse(readFileSync(file, 'utf8')).redfox || {}); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Redfox 服务配置损坏，请检查 integration-settings.json'); }
  const commit = next => { if (file) atomicJSON(file, next); data = next; };
  return {
    get: () => structuredClone(data),
    save(seedance) { commit({ ...data, seedance: seedanceSettingsSchema.parse(seedance) }); },
    saveSeedream(value) { commit({ ...data, seedream: seedreamSettingsSchema.parse(value) }); },
    saveImageProvider(value) { commit({ ...data, imageProvider: z.enum(['openai', 'seedream']).parse(value) }); },
    saveRedfox(value) { commit({ ...data, redfox: redfoxSettingsSchema.parse(value) }); },
  };
}
export function mountIntegrations(app, store, config, helpers) {
  const preferences = config.integrationPreferences || createIntegrationPreferences();
  config.redfox = createRedfoxService(store, config, preferences, { ...redfoxSearchCatalog, ...REDFOX_SOCIAL_OPERATIONS, ...redfoxMediaCatalog, ...redfoxXhsCatalog });
  const redfoxSocial = mountRedfoxSocial(app, store, config, helpers);
  mountRedfoxTrends(app, store, config, helpers);
  const media = mountMediaGeneration(app, store, config, helpers, preferences);
  const douyin = mountDouyin(app, store, config, helpers);
  const feishu = mountFeishuSync(app, store, config, helpers);
  const mcp = mountMCPPlatforms(app, store, config, helpers);
  const local = req => assert(canUseCredentials(req, config), '请从已解锁的工作区设置连接', 403);
  const publicStatus = async req => {
    const local = canUseCredentials(req, config), v = config.seedanceVault?.status();
    const image = config.seedreamVault?.status();
    return { local, redfox: local ? { ...config.redfox.status(), capabilities: redfoxSocialCapabilities() } : { supported: false, configured: false, enabled: false, mediaEnabled: false, searchEnabled: false, capabilities: [] }, imageProvider: preferences.get().imageProvider, seedream: { ...preferences.get().seedream, configured: !!image?.configured && !image.problem, supported: !!image?.supported, suffix: local ? image?.suffix || '' : '', problem: local ? image?.problem || '' : '' }, seedance: { ...preferences.get().seedance, configured: !!v?.configured && !v.problem, supported: !!v?.supported, suffix: local ? v?.suffix || '' : '', problem: local ? v?.problem || '' : '' }, douyin: local ? await douyin.status() : { configured: false, supported: false, redirectUri: '', accounts: [] } };
  };
  app.get('/api/integrations', async (req, res) => res.json(await publicStatus(req)));
  const redfoxBusy = () => config.redfoxUpdating || config.redfox.busy() || media.busy() || helpers.activeJobs.size > 0;
  const redfoxUnfinished = () => store.get().projects.some(p =>
    ['submitting','pending','uncertain'].includes(p.redfoxWebSearch?.status) ||
    (p.redfoxCommentJobs || []).some(job => ['submitting','pending','processing','uncertain'].includes(job.status)) ||
    p.assets.some(a => a.aiCover?.provider === 'redfox' && ['generating','uncertain'].includes(a.aiCover.phase) ||
      (a.aiProduction?.provider === 'redfox' || a.aiProduction?.frameProvider === 'redfox') && ['generating-frame','submitting-video','generating-video','uncertain'].includes(a.aiProduction?.phase)));
  app.put('/api/integrations/redfox', async (req, res) => {
    local(req); assert(canEditSharedSettings(req, config), '请联系管理员管理 Redfox 配置', 403);
    assert(!redfoxBusy(), '请等待正在进行的生成和研究任务完成后修改 Redfox', 409);
    const input = z.object({ apiKey: z.string().trim().min(8).max(2048).regex(/^[\x21-\x7e]+$/).optional(), enabled: z.boolean().optional(), mediaEnabled: z.boolean().optional(), searchEnabled: z.boolean().optional() }).strict().parse(req.body);
    assert(!input.apiKey || !redfoxUnfinished(), '仍有未完成或结果不明的 Redfox 任务，请查询原任务或核对后解除锁定，再更换密钥。', 409);
    config.redfoxUpdating = true;
    try {
    if (input.apiKey) {
      assert(config.redfoxVault?.status().supported, '此工作区暂不支持加密保存 Redfox 密钥');
      await config.redfoxVault.save(input.apiKey);
      store.mutate(state => { state.redfoxStatus = { verifiedAt: null, lastError: '' }; });
    }
    const { apiKey: _apiKey, ...routing } = input;
    preferences.saveRedfox({ ...preferences.get().redfox, ...routing });
    res.json(await publicStatus(req));
    } finally { config.redfoxUpdating = false; }
  });
  app.delete('/api/integrations/redfox', async (req, res) => {
    local(req); assert(canEditSharedSettings(req, config), '请联系管理员管理 Redfox 配置', 403);
    assert(!redfoxBusy(), '请等待正在进行的 Redfox 任务完成后移除密钥', 409);
    assert(!redfoxUnfinished(), '仍有未完成或结果不明的 Redfox 任务，请查询原任务或核对后解除锁定，再移除密钥。', 409);
    config.redfoxUpdating = true;
    try {
    await config.redfoxVault?.remove(); preferences.saveRedfox({ enabled: false, mediaEnabled: false, searchEnabled: false });
    store.mutate(state => { state.redfoxStatus = { verifiedAt: null, lastError: '' }; });
    res.json(await publicStatus(req));
    } finally { config.redfoxUpdating = false; }
  });
  app.put('/api/integrations/image-provider', async (req, res) => {
    local(req); assert(!media.busy(), '请在生成任务完成后修改默认图片服务', 409);
    preferences.saveImageProvider(z.object({ provider: z.enum(['openai', 'seedream']) }).strict().parse(req.body).provider); res.json(await publicStatus(req));
  });
  app.put('/api/integrations/seedream', async (req, res) => {
    local(req); assert(!media.busy(), '请在生成任务完成后修改 Seedream 配置', 409);
    const { settings, apiKey } = seedreamConnectionSchema.parse(req.body);
    if (apiKey) { assert(config.seedreamVault?.status().supported, '此系统尚未提供安全凭证保险箱'); await config.seedreamVault.save(apiKey); }
    preferences.saveSeedream(settings); res.json(await publicStatus(req));
  });
  app.delete('/api/integrations/seedream', async (req, res) => { local(req); assert(!media.busy(), '请在生成任务完成后删除密钥', 409); config.seedreamVault?.remove(); res.json(await publicStatus(req)); });
  app.put('/api/integrations/seedance', async (req, res) => {
    local(req); assert(!media.busy(), '请在生成任务完成后修改 Seedance 配置', 409);
    const { apiKey, ...settings } = seedanceSettingsSchema.extend({ apiKey: z.string().trim().min(8).max(512).regex(/^[A-Za-z0-9_.-]+$/).optional() }).strict().parse(req.body);
    if (apiKey) { assert(config.seedanceVault?.status().supported, '此系统尚未提供安全凭证保险箱'); await config.seedanceVault.save(apiKey); }
    preferences.save(settings); res.json(await publicStatus(req));
  });
  app.delete('/api/integrations/seedance', async (req, res) => { local(req); assert(!media.busy(), '请在生成任务完成后删除密钥', 409); config.seedanceVault?.remove(); res.json(await publicStatus(req)); });
  let timer, ticking = false, currentTick = Promise.resolve();
  const tick = () => {
    if (ticking) return currentTick;
    ticking = true;
    currentTick = Promise.allSettled([media.tick(), douyin.tick(), feishu.tick()]).finally(() => { ticking = false; });
    return currentTick;
  };
  return {
    tick,
    redfoxResearchSearch: redfoxSocial.researchSearch,
    redfoxResearchStatus: redfoxSocial.researchStatus,
    mcpResearchSearch: mcp.researchSearch,
    mcpResearchStatus: mcp.researchStatus,
    start() { media.recover(); douyin.recover(); feishu.recover(); timer = setInterval(tick, 10000); timer.unref(); },
    async close() { clearInterval(timer); douyin.close(); feishu.close(); mcp.close(); redfoxSocial.close?.(); await currentTick; await media.close(); },
  };
}
