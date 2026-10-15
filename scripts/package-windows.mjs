import { createReadStream, createWriteStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const root = resolve(`outputs/windows/Shengzhang-Studio-${version}`);
const filename = resolve(`outputs/Shengzhang-Studio-${version}-windows-x64.zip`);
const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => join(item.parentPath, item.name));
const zip = new JSZip();
for (const file of files) {
  const name = relative(root, file).replaceAll('\\', '/');
  if (/(^|\/)(cookies\.json|launcher\.json|data|browser|private|\.git|\.env|\.tools|test-results|docling-models|site-packages)(\/|$)|\.(sqlite|sqlite-wal|sqlite-shm|dpapi\.json)$/i.test(name)) throw new Error(`Private file found in publication: ${name}`);
  zip.file(`Shengzhang-Studio-${version}/${name}`, createReadStream(file));
}
await pipeline(zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }), createWriteStream(filename));
const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk);
const sha256 = hash.digest('hex');
writeFileSync(filename + '.sha256', `${sha256}  Shengzhang-Studio-${version}-windows-x64.zip\n`);
console.log(JSON.stringify({ filename, bytes: statSync(filename).size, files: files.length, sha256 }));
