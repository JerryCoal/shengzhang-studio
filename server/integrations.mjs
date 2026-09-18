import { readFileSync } from 'node:fs';
import { atomicJSON } from './vault.mjs';
import { canUseCredentials } from './ai-routes.mjs';
import { assert } from './domain.mjs';
import { mountMediaGeneration, seedanceSettingsSchema, defaultSeedance } from './media-generation.mjs';
import { mountDouyin } from './douyin.mjs';
import { z } from 'zod';
import { defaultSeedream, seedreamSettingsSchema, seedreamConnectionSchema } from './seedream-config.mjs';

export function createIntegrationPreferences(file) {
  let data = { seedance: { ...defaultSeedance }, seedream: { ...defaultSeedream }, imageProvider: 'openai' };
  if (file) try { const saved = JSON.parse(readFileSync(file, 'utf8')); data = { seedance: seedanceSettingsSchema.extend({ model: seedanceSettingsSchema.shape.model.or(z.literal('')) }).parse(saved.seedance), seedream: saved.seedream ? seedreamSettingsSchema.parse(saved.seedream) : { ...defaultSeedream }, imageProvider: z.enum(['openai', 'seedream']).parse(saved.imageProvider || 'openai') }; } catch (error) { if (error.code !== 'ENOENT') throw new Error('生成服务配置损坏，请检查 integration-settings.json'); }
  const commit = next => { if (file) atomicJSON(file, next); data = next; };
  return {
    get: () => structuredClone(data),
    save(seedance) { commit({ ...data, seedance: seedanceSettingsSchema.parse(seedance) }); },
    saveSeedream(value) { commit({ ...data, seedream: seedreamSettingsSchema.parse(value) }); },
    saveImageProvider(value) { commit({ ...data, imageProvider: z.enum(['openai', 'seedream']).parse(value) }); },
  };
}
export function mountIntegrations(app, store, config, helpers) {
  const preferences = config.integrationPreferences || createIntegrationPreferences();
  const media = mountMediaGeneration(app, store, config, helpers, preferences);
  const douyin = mountDouyin(app, store, config, helpers);
  const local = req => assert(canUseCredentials(req, config), '请从已解锁的工作区设置连接', 403);
  const publicStatus = async req => {
    const local = canUseCredentials(req, config), v = config.seedanceVault?.status();
    const image = config.seedreamVault?.status();
    return { local, imageProvider: preferences.get().imageProvider, seedream: { ...preferences.get().seedream, configured: !!image?.configured && !image.problem, supported: !!image?.supported, suffix: local ? image?.suffix || '' : '', problem: local ? image?.problem || '' : '' }, seedance: { ...preferences.get().seedance, configured: !!v?.configured && !v.problem, supported: !!v?.supported, suffix: local ? v?.suffix || '' : '', problem: local ? v?.problem || '' : '' }, douyin: local ? await douyin.status() : { configured: false, supported: false, redirectUri: '', accounts: [] } };
  };
  app.get('/api/integrations', async (req, res) => res.json(await publicStatus(req)));
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
    currentTick = Promise.allSettled([media.tick(), douyin.tick()]).finally(() => { ticking = false; });
    return currentTick;
  };
  return {
    tick,
    start() { media.recover(); douyin.recover(); timer = setInterval(tick, 10000); timer.unref(); },
    async close() { clearInterval(timer); douyin.close(); await currentTick; await media.close(); },
  };
}
