import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const version = '2.11.7';
const name = `caddy_${version}_windows_amd64.zip`;
// Official release checksums, verified 2026-10-17. Never disable TLS verification.
const expected = 'c308154504e53755958ffc62d8a2657ab17eefd6dd25c45dbb2c3d93d29519971f77ca652f7d0f2bcb7f980b9ba3822478865e29969d0272d7613550a43152b1';
const directory = resolve('.tools/team-runtime');
mkdirSync(directory, { recursive: true });
const archivePath = resolve(directory, name);
let archive;
if (existsSync(archivePath)) archive = readFileSync(archivePath);
else {
  const response = await fetch(`https://github.com/caddyserver/caddy/releases/download/v${version}/${name}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Caddy download failed: ${response.status}`);
  archive = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha512').update(archive).digest('hex') !== expected) throw new Error('Official Caddy SHA-512 checksum mismatch');
writeFileSync(archivePath, archive);
const zip = await JSZip.loadAsync(archive);
for (const file of ['caddy.exe', 'LICENSE', 'README.md']) {
  const entry = zip.file(file);
  if (!entry) throw new Error(`Missing official release file: ${file}`);
  writeFileSync(resolve(directory, file === 'caddy.exe' ? file : `CADDY-${file}`), await entry.async('nodebuffer'));
}
const executableSha256 = createHash('sha256').update(readFileSync(resolve(directory, 'caddy.exe'))).digest('hex');
writeFileSync(resolve(directory, 'caddy-release.json'), JSON.stringify({ version, source: `https://github.com/caddyserver/caddy/releases/tag/v${version}`, archive: name, archiveSha512: expected, executableSha256 }, null, 2));
console.log(JSON.stringify({ version, directory, executableSha256 }));
