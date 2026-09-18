import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { MODELS, STAGES, DEFAULT_ROUTES } from '../server/models.mjs';
const output = process.argv[2] || 'static-site/dist';
if (!['static-site/dist', 'github-pages/docs'].includes(output)) throw new Error('Unsupported static build output');
// Only code-defined model metadata is included. Never read the running workspace or credential vault.
writeFileSync(new URL('../src/static-settings.json', import.meta.url), JSON.stringify({ model: DEFAULT_ROUTES.strategy, inputPrice: MODELS[DEFAULT_ROUTES.strategy].inputPrice, outputPrice: MODELS[DEFAULT_ROUTES.strategy].outputPrice, routes: DEFAULT_ROUTES, models: MODELS, stages: STAGES, priceDate: '2026-09-14' }, null, 2));
for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build', '--mode', 'static', '--outDir', output]]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const html = new URL(`../${output}/index.html`, import.meta.url);
const csp = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
writeFileSync(html, readFileSync(html, 'utf8').replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">\n    <meta name="referrer" content="no-referrer">`));
writeFileSync(new URL(`../${output}/.nojekyll`, import.meta.url), '');
