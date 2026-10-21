import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

// Package an already-built directory; never build, launch, upload, replace a
// release, or read a user's runtime data directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const present = path => { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const portablePath = value => typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes(':') && !isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const privateName = /(?:^|\/)(?:data|private|profiles|logs|run|\.git|\.ssh|\.tools)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|cookies(?:[-.].*)?\.json|master\.key|setup\.code|(?:credentials?|secrets?)\.json)$|\.(?:sqlite(?:3)?(?:-.*)?|db|dpapi\.json|log|pem|pfx|p12|key|keystore|jks)$/i;

function safeExisting(path, directory = false) {
  const stat = lstatSync(path);
  requireThat(!stat.isSymbolicLink() && samePath(realpathSync(path), resolve(path)), 'Links and redirected paths are not allowed in a release');
  requireThat(directory ? stat.isDirectory() : stat.isFile(), 'Unexpected release file type');
  return stat;
}

function scan(directory) {
  safeExisting(directory, true);
  const files = [];
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name), name = relative(directory, full).split(sep).join('/');
      requireThat(portablePath(name) && !privateName.test(name), 'Private or unsafe release path: ' + name);
      requireThat(!entry.isSymbolicLink(), 'Links are not allowed in a release');
      if (entry.isDirectory()) { safeExisting(full, true); visit(full); }
      else { const stat = safeExisting(full); files.push({ path: name, bytes: stat.size, sha256: digest(readFileSync(full)) }); }
    }
  };
  visit(directory);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function checkFiles(actual, expected) {
  requireThat(Array.isArray(expected) && actual.length === expected.length, 'Release file inventory changed');
  for (let index = 0; index < actual.length; index++) {
    const a = actual[index], b = expected[index];
    requireThat(b && portablePath(b.path) && !privateName.test(b.path) && a.path === b.path && a.bytes === b.bytes && a.sha256 === b.sha256, 'Release file hash or inventory mismatch');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/package-windows-release.mjs [--verify] [outputs/windows/Shengzhang-Studio-VERSION]\nVERSION must equal package.json. Existing artifacts are never overwritten.');
    return;
  }
  const verify = args.includes('--verify'), paths = args.filter(arg => arg !== '--verify');
  requireThat(args.filter(arg => arg === '--verify').length <= 1 && paths.length <= 1 && paths.every(arg => !arg.startsWith('--')), 'Invalid arguments');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  requireThat(/^\d+\.\d+\.\d+$/.test(version), 'Invalid release version');
  const outputs = join(root, 'outputs'), windows = join(outputs, 'windows'), name = 'Shengzhang-Studio-' + version;
  const directory = join(windows, name);
  requireThat(!paths.length || samePath(resolve(paths[0]), directory), 'Only the current-version directory inside this workspace outputs/windows is accepted');
  for (const path of [root, outputs, windows, directory]) safeExisting(path, true);
  const manifestPath = join(directory, 'release-manifest.json');
  const zipPath = join(outputs, name + '-windows-x64.zip'), checksumPath = zipPath + '.sha256';
  const lockPath = join(outputs, '.package-windows-' + version + '.lock');
  if (!verify) requireThat(![manifestPath, zipPath, checksumPath].some(present), 'Release artifact already exists; refusing to overwrite. Use --verify to check a completed release.');
  else requireThat(!present(lockPath), 'Packaging is in progress; verify after it completes');
  const required = ['ShengzhangStudio.exe', 'resources/app/package.json', 'resources/app/backend.cjs', 'resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/dist/index.html', 'resources/runtime/node.exe', 'RELEASE-' + version + '.md', 'VALIDATION-' + version + '.md'];
  const initial = scan(directory).filter(file => file.path !== 'release-manifest.json');
  for (const file of required) requireThat(initial.some(item => item.path === file && item.bytes > 0), 'Missing build input: ' + file);
  const appPackage = JSON.parse(readFileSync(join(directory, 'resources/app/package.json'), 'utf8'));
  requireThat(appPackage.name === 'shengzhang-studio' && appPackage.version === version && appPackage.main === 'main.cjs', 'Packaged application version or entry point does not match package.json');

  if (verify) {
    for (const path of [manifestPath, zipPath, checksumPath]) safeExisting(path);
    const manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes);
    requireThat(manifest.format === 'shengzhang.windows-release' && manifest.schemaVersion === 1 && manifest.version === version && manifest.directory === name, 'Release manifest identity mismatch');
    checkFiles(initial, manifest.files);
    const zipBytes = readFileSync(zipPath), hash = digest(zipBytes);
    requireThat(readFileSync(checksumPath, 'utf8') === hash + '  ' + basename(zipPath) + '\n', 'Release archive checksum mismatch');
    const zip = await JSZip.loadAsync(zipBytes);
    const entries = Object.values(zip.files);
    requireThat(entries.length === initial.length + 1, 'Release archive file inventory mismatch');
    const expected = new Map([...initial, { path: 'release-manifest.json', bytes: manifestBytes.length, sha256: digest(manifestBytes) }].map(file => [name + '/' + file.path, file]));
    for (const entry of entries) {
      requireThat(!entry.dir && portablePath(entry.name) && (!entry.unsafeOriginalName || entry.unsafeOriginalName === entry.name), 'Unsafe archive entry');
      const file = expected.get(entry.name);
      requireThat(file && ((Number(entry.unixPermissions || 0) & 0o170000) !== 0o120000), 'Unexpected archive entry');
      const bytes = await entry.async('nodebuffer');
      requireThat(bytes.length === file.bytes && digest(bytes) === file.sha256, 'Archive contents do not match the release manifest');
      expected.delete(entry.name);
    }
    requireThat(expected.size === 0, 'Missing archive entry');
    console.log(JSON.stringify({ verified: true, version, directory, zip: zipPath, sha256: hash, files: initial.length + 1 }));
    return;
  }

  const lock = openSync(lockPath, 'wx', 0o600), written = [];
  try {
    const manifest = { format: 'shengzhang.windows-release', schemaVersion: 1, version, directory: name, packagedAt: new Date().toISOString(), packagerNode: process.version, files: initial };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), zip = new JSZip();
    for (const file of initial) {
      const path = join(directory, file.path); safeExisting(path);
      const bytes = readFileSync(path);
      requireThat(bytes.length === file.bytes && digest(bytes) === file.sha256, 'Build changed while packaging; stop writers and retry');
      zip.file(name + '/' + file.path, bytes, { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
    }
    zip.file(name + '/release-manifest.json', manifestBytes, { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    checkFiles(scan(directory), initial);
    const hash = digest(bytes);
    // Commit ZIP last. Exclusive writes prevent replacement even if another
    // process creates a same-named artifact after the initial existence check.
    for (const [path, content] of [[manifestPath, manifestBytes], [checksumPath, Buffer.from(hash + '  ' + basename(zipPath) + '\n')], [zipPath, bytes]]) {
      writeFileSync(path, content, { flag: 'wx' });
      written.push({ path, sha256: digest(content) });
    }
    console.log(JSON.stringify({ packaged: true, version, directory, zip: zipPath, sha256: hash, manifest: manifestPath, files: initial.length + 1 }));
  } catch (error) {
    // Roll back only files created by this invocation, never a pre-existing
    // release or anything outside the validated outputs paths.
    for (const file of written.reverse()) {
      try { safeExisting(file.path); if (digest(readFileSync(file.path)) === file.sha256) unlinkSync(file.path); } catch { /* Keep uncertain files for manual inspection. */ }
    }
    throw error;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
