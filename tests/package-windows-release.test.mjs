import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(root, '.tools');
const version = '2.1.0', name = 'Shengzhang-Studio-' + version;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, 'package-release-test-'));
  t.after(() => {
    assert.ok(realpathSync(directory).startsWith(realpathSync(scratch) + sep));
    assert.ok(basename(directory).startsWith('package-release-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const put = (path, content) => { const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); };
  put('package.json', JSON.stringify({ version }));
  mkdirSync(join(directory, 'scripts'));
  copyFileSync(join(root, 'scripts/package-windows-release.mjs'), join(directory, 'scripts/package-windows-release.mjs'));
  const bundle = join(directory, 'outputs/windows', name);
  const files = ['ShengzhangStudio.exe', 'resources/app/backend.cjs', 'resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/dist/index.html', 'resources/runtime/node.exe', 'RELEASE-' + version + '.md', 'VALIDATION-' + version + '.md'];
  for (const path of files) put('outputs/windows/' + name + '/' + path, 'synthetic fixture ' + path);
  put('outputs/windows/' + name + '/resources/app/package.json', JSON.stringify({ name: 'shengzhang-studio', version, main: 'main.cjs' }));
  const archive = join(directory, 'outputs', name + '-windows-x64.zip');
  const run = (...args) => spawnSync(process.execPath, ['scripts/package-windows-release.mjs', ...args], { cwd: directory, encoding: 'utf8', timeout: 15000 });
  return { directory, bundle, archive, manifest: join(bundle, 'release-manifest.json'), put, run };
}

function successful(result) { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); }
function rejected(result, pattern) { assert.equal(result.status, 1, result.stdout); assert.match(result.stderr, pattern); }

test('Windows release finalizer packages a synthetic current-version tree, verifies hashes, and never replaces an old or same-version package', async t => {
  const f = fixture(t), oldPath = 'outputs/Shengzhang-Studio-2.0.2-windows-x64.zip';
  f.put(oldPath, 'preserve old release');
  const result = successful(f.run(f.bundle));
  assert.equal(result.packaged, true);
  assert.equal(result.version, version);
  assert.equal(readFileSync(join(f.directory, oldPath), 'utf8'), 'preserve old release');
  const original = readFileSync(f.archive), checksum = readFileSync(f.archive + '.sha256', 'utf8');
  assert.equal(checksum, digest(original) + '  ' + basename(f.archive) + '\n');
  const manifest = JSON.parse(readFileSync(f.manifest));
  assert.equal(manifest.files.length, 9);
  const zip = await JSZip.loadAsync(original);
  assert.equal(await zip.file(name + '/release-manifest.json').async('string'), readFileSync(f.manifest, 'utf8'));
  assert.equal(successful(f.run('--verify')).verified, true);
  rejected(f.run(), /refusing to overwrite/);
  assert.deepEqual(readFileSync(f.archive), original);
});

test('Windows release finalizer accepts no alternate directory or uncontrolled root', t => {
  const f = fixture(t);
  for (const argument of [f.directory, join(f.directory, 'outputs/windows/Shengzhang-Studio-2.0.2'), '../../', '--force']) {
    rejected(f.run(argument), /Only the current-version|Invalid arguments/);
  }
  assert.equal(existsSync(f.archive), false);
  assert.equal(existsSync(f.manifest), false);
});

test('Windows release finalizer rejects private runtime files without writing a manifest', t => {
  for (const path of ['data/workspace.sqlite', 'resources/app/cookies.json', '.env', 'resources/app/master.key', 'resources/app/session.dpapi.json']) {
    const f = fixture(t);
    f.put('outputs/windows/' + name + '/' + path, 'synthetic private fixture');
    rejected(f.run(), /Private or unsafe release path/);
    assert.equal(existsSync(f.archive), false);
    assert.equal(existsSync(f.manifest), false);
  }
});

test('Windows release finalizer rejects mismatched app version and missing build files', t => {
  const f = fixture(t);
  f.put('outputs/windows/' + name + '/resources/app/package.json', JSON.stringify({ name: 'shengzhang-studio', version: '2.0.2', main: 'main.cjs' }));
  rejected(f.run(), /version or entry point/);
  f.put('outputs/windows/' + name + '/resources/app/package.json', JSON.stringify({ name: 'shengzhang-studio', version, main: 'main.cjs' }));
  rmSync(join(f.bundle, 'resources/app/backend.cjs'));
  rejected(f.run(), /Missing build input/);
  assert.equal(existsSync(f.manifest), false);
});

test('Windows release verification rejects a changed source tree or changed archive', t => {
  const f = fixture(t);
  successful(f.run());
  f.put('outputs/windows/' + name + '/resources/app/main.cjs', 'altered fixture');
  rejected(f.run('--verify'), /hash or inventory mismatch/);
  f.put('outputs/windows/' + name + '/resources/app/main.cjs', 'synthetic fixture resources/app/main.cjs');
  writeFileSync(f.archive, Buffer.concat([readFileSync(f.archive), Buffer.from('tampered')]));
  rejected(f.run('--verify'), /checksum mismatch/);
});

test('Windows release verification checks archive entries even when its outer checksum is updated', async t => {
  const f = fixture(t);
  successful(f.run());
  const zip = await JSZip.loadAsync(readFileSync(f.archive));
  zip.file(name + '/resources/app/main.cjs', 'replaced archive file', { createFolders: false });
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(f.archive, bytes);
  writeFileSync(f.archive + '.sha256', digest(bytes) + '  ' + basename(f.archive) + '\n');
  rejected(f.run('--verify'), /Archive contents do not match/);
});

test('Windows release finalizer refuses linked subdirectories before reading their contents', t => {
  const f = fixture(t), outside = join(f.directory, 'synthetic-outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'note.txt'), 'synthetic fixture');
  symlinkSync(outside, join(f.bundle, 'redirected'), process.platform === 'win32' ? 'junction' : 'dir');
  rejected(f.run(), /Links/);
  assert.equal(existsSync(f.archive), false);
});

test('Windows release verification rejects extra archive directories despite an updated checksum', async t => {
  const f = fixture(t);
  successful(f.run());
  const zip = await JSZip.loadAsync(readFileSync(f.archive));
  zip.folder('unexpected-directory');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(f.archive, bytes);
  writeFileSync(f.archive + '.sha256', digest(bytes) + '  ' + basename(f.archive) + '\n');
  rejected(f.run('--verify'), /file inventory mismatch/);
});

test('Windows release finalizer rejects invalid semver and leaves pre-existing partial artifacts untouched', t => {
  const f = fixture(t);
  f.put('package.json', JSON.stringify({ version: '../2.1.0' }));
  rejected(f.run(), /Invalid release version/);
  f.put('package.json', JSON.stringify({ version }));
  writeFileSync(f.archive + '.sha256', 'do not overwrite partial artifact');
  rejected(f.run(), /refusing to overwrite/);
  assert.equal(readFileSync(f.archive + '.sha256', 'utf8'), 'do not overwrite partial artifact');
  assert.equal(existsSync(f.manifest), false);
});
