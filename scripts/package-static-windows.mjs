import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Windows fallback for the bundled Bash wrapper. Use the exact bundled validator/stager.
const helper = process.env.STUDIO_SITE_BUILD_HELPER;
const python = process.env.STUDIO_PYTHON || 'python';
if (!helper) throw new Error('This optional legacy Sites packager requires STUDIO_SITE_BUILD_HELPER. For the supported static output, run pnpm run build:static.');
const site = resolve('static-site');
const stage = resolve('outputs/sites-package-' + Date.now());
mkdirSync(stage, { recursive: true });
const prepared = spawnSync(process.execPath, [helper, site, resolve(stage, 'dist')], { stdio: 'inherit' });
if (prepared.status !== 0) process.exit(prepared.status || 1);
const source = JSON.parse(readFileSync(resolve(site, '.openai/hosting.json'), 'utf8'));
const staged = JSON.parse(readFileSync(resolve(stage, 'dist/.openai/hosting.json'), 'utf8'));
if (staged.project_id !== source.project_id || staged.static.directory !== 'dist') throw new Error('Invalid static staging metadata');
const archive = resolve('outputs/shengzhang-static-site.tar.gz');
const result = spawnSync(python, ['-c', 'import tarfile,sys; a=tarfile.open(sys.argv[2],"w:gz"); a.add(sys.argv[1]+"/dist",arcname="dist"); a.close(); a=tarfile.open(sys.argv[2]); names=a.getnames(); assert "dist/index.html" in names and "dist/.openai/hosting.json" in names; assert not any(".git" in n.split("/") or n.endswith(".sqlite") or "/data/" in n for n in names); print("Validated static archive:",len(names),"entries")', stage, archive], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(archive);
