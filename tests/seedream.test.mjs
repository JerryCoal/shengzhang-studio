import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { defaultSeedream, SEEDREAM_MODELS, seedreamSettingsSchema } from '../server/seedream-config.mjs';
import { generateSeedreamKeyframe, seedreamCost } from '../server/seedream.mjs';

const key = 'seedream-test-key-never-real';
const jpeg = Buffer.from('ffd8ffe000044a46ffd9', 'hex').toString('base64');
const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
const reference = `data:image/png;base64,${png}`;
test('Seedream uses official host, exact portrait size, local references and model-specific fields', async () => {
  for (const [family, preset] of Object.entries(SEEDREAM_MODELS)) {
    const result = await generateSeedreamKeyframe({ apiKey: key, prompt: 'same product', references: [reference, reference], settings: { ...defaultSeedream, family, model: preset.model } }, async (url, init) => {
      assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
      assert.equal(init.headers.Authorization, `Bearer ${key}`); assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      assert.equal(body.model, preset.model); assert.equal(body.size, '1440x2560'); assert.equal(body.response_format, 'b64_json');
      assert.deepEqual(body.image, [reference, reference]); assert.equal(body.watermark, true);
      assert.equal(body.quality, undefined); assert.equal(body.n, undefined);
      assert.equal(body.sequential_image_generation, family === '5.0-pro' ? undefined : 'disabled');
      return Response.json({ data: [{ b64_json: jpeg }], usage: { generated_images: 1 } });
    });
    assert.equal(result.mediaData, `data:image/jpeg;base64,${jpeg}`);
  }
  let sent;
  await generateSeedreamKeyframe({ apiKey: key, prompt: 'no references', settings: defaultSeedream }, async (_, init) => { sent = JSON.parse(init.body); return Response.json({ data: [{ b64_json: png }] }); });
  assert.equal(sent.image, undefined);
  assert.equal(seedreamCost({ generated_images: 1 }, { imagePriceUsd: .03 }), .03);
  assert.equal(seedreamCost({}, { imagePriceUsd: .03 }), null);
  assert.equal(seedreamCost({ generated_images: 1 }, { imagePriceUsd: 0 }), null);
  assert.equal(seedreamCost({ generated_images: 0 }, { imagePriceUsd: 0 }), 0);
});
test('Seedream rejects invalid output and remote references, redacts upstream secrets, never retries', async () => {
  let calls = 0;
  const input = { apiKey: key, prompt: 'test', settings: defaultSeedream };
  await assert.rejects(generateSeedreamKeyframe({ ...input, references: ['https://user-controlled.example/image.png'] }, async () => { calls++; }), /本地/);
  assert.equal(calls, 0);
  for (const status of [400, 401, 402, 403, 404, 429, 500]) {
    await assert.rejects(generateSeedreamKeyframe(input, async () => { calls++; return Response.json({ error: { message: key } }, { status }); }), error => !error.message.includes(key) && error.message.includes(`HTTP ${status}`) && !!error.noCharge === (status < 500));
  }
  assert.equal(calls, 7);
  for (const value of [{ data: [{ url: 'https://evil.example/a.png' }] }, { data: [{ b64_json: 'PHNjcmlwdD4=' }] }, { data: [{ error: { message: key } }], usage: { generated_images: 0 } }]) {
    await assert.rejects(generateSeedreamKeyframe(input, async () => Response.json(value)), e => !e.message.includes(key) && e.status === 502);
  }
  await assert.rejects(generateSeedreamKeyframe(input, async () => { throw Error(key); }), error => !error.message.includes(key) && !error.noCharge);
  assert.throws(() => seedreamSettingsSchema.parse({ ...defaultSeedream, model: SEEDREAM_MODELS['5.0-pro'].model }));
  assert.throws(() => seedreamSettingsSchema.parse({ ...defaultSeedream, model: 'https://evil.example' }));
});
test('Seedream-only settings survive restart and upgrade legacy Seedance settings without changing them', t => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-seedream-'));
  t.after(() => { if (!dir.startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected directory'); rmSync(dir, { recursive: true }); });
  const path = join(dir, 'preferences.json');
  let store = createIntegrationPreferences(path); store.saveSeedream(defaultSeedream); store.saveImageProvider('seedream');
  store = createIntegrationPreferences(path);
  assert.equal(store.get().seedance.model, ''); assert.equal(store.get().imageProvider, 'seedream');
  assert.deepEqual(store.get().seedream, defaultSeedream);
  const seedance = { region: 'byteplus', model: 'ep-test', reservationUsd: 2, outputPriceUsd: 1 };
  writeFileSync(path, JSON.stringify({ seedance })); store = createIntegrationPreferences(path);
  assert.equal(store.get().imageProvider, 'openai'); assert.deepEqual(store.get().seedance, seedance);
  store.saveSeedream(defaultSeedream); assert.deepEqual(createIntegrationPreferences(path).get().seedance, seedance);
});
