import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const { createDocumentParser } = createRequire(import.meta.url)('../desktop/document-parser.cjs');
const scope = 'a'.repeat(64), other = 'b'.repeat(64);
const payload = { scope, requestId: 'synthetic-1', name: 'sample.pdf', base64: Buffer.from('%PDF-1.7 synthetic').toString('base64') };
const success = { ok: true, text: 'Synthetic heading\n\nSynthetic paragraph', blocks: [{ id: 'block-1', kind: 'heading', text: 'Synthetic heading', page: 1 }, { id: 'block-2', kind: 'paragraph', text: 'Synthetic paragraph', page: 1, heading: 'Synthetic heading' }], warnings: [], metadata: { version: 'test', pageCount: 1 } };

async function harness(t, parseReply = success, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-parser-test-'));
  const dataRoot = path.join(root, 'data'), tempRoot = path.join(root, 'temp'), pythonPath = path.join(root, 'venv', 'Scripts', 'python.exe');
  await mkdir(path.dirname(pythonPath), { recursive: true }); await mkdir(tempRoot); await writeFile(pythonPath, 'synthetic executable placeholder');
  const calls = [];
  const spawnProcess = (command, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { setTimeout(() => child.emit('close', null), options.killDelayMs || 0); return true; };
    const call = { command, args, opts, child }; calls.push(call);
    queueMicrotask(async () => {
      const index = args.indexOf('--parse');
      if (index >= 0) call.input = await readFile(args[index + 1]);
      if (index >= 0 && parseReply === 'hang') return;
      const reply = index < 0 ? { ok: true, ready: true, pdfReady: true, formats: ['pdf', 'docx'], version: 'test' } : parseReply;
      child.stderr.write('Synthetic private log /local/not-for-renderer');
      child.stdout.write(JSON.stringify(reply)); child.emit('close', 0);
    });
    return child;
  };
  const controller = createDocumentParser({ dataRoot, tempRoot, spawnProcess, ...options });
  t.after(async () => { controller.close(); await rm(root, { recursive: true, force: true }); });
  return { root, dataRoot, tempRoot, pythonPath, calls, controller };
}

test('parser rejects untrusted scope, path tricks and malformed input before spawning', async t => {
  const h = await harness(t);
  assert.equal((await h.controller.configure({ scope: '../escape', pythonPath: h.pythonPath })).ready, false);
  assert.equal((await h.controller.configure({ scope, pythonPath: 'cmd.exe' })).ready, false);
  for (const edit of [{ scope: '../bad' }, { requestId: '../bad' }, { name: 'script.exe' }, { base64: 'https://example.invalid/' }, { base64: Buffer.from('not pdf').toString('base64') }]) assert.equal((await h.controller.parse({ ...payload, ...edit })).ok, false);
  assert.equal(h.calls.length, 0);
});

test('parser persists only per-profile executable settings; copies bytes into a private temporary file and removes it', async t => {
  const h = await harness(t);
  assert.equal((await h.controller.configure({ scope, pythonPath: h.pythonPath })).ready, true);
  assert.equal((await h.controller.status({ scope: other })).configured, false);
  assert.equal((await h.controller.parse({ ...payload, scope: other })).code, 'not_configured');
  const output = await h.controller.parse({ ...payload, name: '../safe.pdf' });
  assert.equal(output.ok, true); assert.equal(output.sourceName, 'safe.pdf'); assert.deepEqual(output.blocks, success.blocks);
  const call = h.calls.find(call => call.args.includes('--parse'));
  assert.deepEqual(call.input, Buffer.from('%PDF-1.7 synthetic')); assert.equal(call.opts.shell, false); assert.equal(call.opts.windowsHide, true);
  assert.equal(call.opts.env.HF_HUB_OFFLINE, '1'); assert.equal(call.opts.env.TRANSFORMERS_OFFLINE, '1'); assert.equal(call.args[0], '-I');
  assert.deepEqual(await readdir(h.tempRoot), []);
  const settings = JSON.parse(await readFile(path.join(h.dataRoot, 'document-parser', scope + '.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings), ['pythonPath']); assert.equal(JSON.stringify(output).includes('private log'), false);
});

test('cancellation is scoped and close cancels without permanently disabling the parser', async t => {
  const h = await harness(t, 'hang'); await h.controller.configure({ scope, pythonPath: h.pythonPath });
  const run = h.controller.parse(payload);
  while (!h.calls.some(call => call.args.includes('--parse'))) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.controller.cancel({ scope: other, requestId: payload.requestId }).cancelled, false);
  assert.equal((await h.controller.parse({ ...payload, requestId: 'synthetic-2' })).code, 'busy');
  h.controller.close(); assert.equal((await run).code, 'cancelled'); assert.deepEqual(await readdir(h.tempRoot), []);
  assert.equal((await h.controller.status({ scope })).ready, true);
});

test('deadline terminates a stuck local parser and removes document bytes', async t => {
  const h = await harness(t, 'hang', { timeoutMs: 20 }); await h.controller.configure({ scope, pythonPath: h.pythonPath });
  assert.equal((await h.controller.parse(payload)).code, 'timeout'); assert.deepEqual(await readdir(h.tempRoot), []);
});

test('worker failure remains a safe failure without pretending that extraction succeeded', async t => {
  const h = await harness(t, { ok: false, code: 'models_missing', error: 'PDF 模型未就绪' }); await h.controller.configure({ scope, pythonPath: h.pythonPath });
  assert.deepEqual(await h.controller.parse(payload), { ok: false, code: 'models_missing', error: 'PDF 模型未就绪' });
  assert.deepEqual(await readdir(h.tempRoot), []);
});

test('deadline waits for child close before deleting the temporary input', async t => {
  const h = await harness(t, 'hang', { timeoutMs: 20, killDelayMs: 100 }); await h.controller.configure({ scope, pythonPath: h.pythonPath });
  const run = h.controller.parse(payload);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal((await readdir(h.tempRoot)).length, 1, 'input remains until the process confirms it has stopped');
  assert.equal((await run).code, 'timeout'); assert.deepEqual(await readdir(h.tempRoot), []);
});

test('editing a saved config cannot run a relative path or a non-Python executable', async t => {
  const h = await harness(t); await h.controller.configure({ scope, pythonPath: h.pythonPath });
  const calls = h.calls.length;
  for (const pythonPath of ['../python.exe', path.join(h.root, 'cmd.exe')]) {
    await writeFile(path.join(h.dataRoot, 'document-parser', scope + '.json'), JSON.stringify({ pythonPath }));
    assert.equal((await h.controller.parse(payload)).code, 'not_configured');
  }
  assert.equal(h.calls.length, calls);
});

test('maximum 16 MB input validates without a regex stack overflow and malformed padding is rejected', async t => {
  const h = await harness(t); await h.controller.configure({ scope, pythonPath: h.pythonPath });
  for (const base64 of ['A===', 'AAAA=AAA', 'AA=A', 'AAA']) assert.equal((await h.controller.parse({ ...payload, base64 })).code, 'invalid_file');
  const bytes = Buffer.alloc(16 * 1024 * 1024); bytes.write('%PDF-1.7 synthetic');
  assert.equal((await h.controller.parse({ ...payload, base64: bytes.toString('base64') })).ok, true);
  assert.deepEqual(await readdir(h.tempRoot), []);
});
