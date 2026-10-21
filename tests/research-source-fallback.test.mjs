import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { researchSourceDiagnostic } from '../server/research-source-diagnostics.mjs';
import { researchImageEvidence, textOnlyImageEvidence } from '../server/research-image-evidence.mjs';
import { cleanReferences } from '../server/research-data.mjs';
import { researchInstructions } from '../server/research-ai.mjs';
import { xhsMCPResearchItem } from '../server/mcp-platforms.mjs';
import { LOCAL_MCP_CATALOG, localMCPDeploymentGuide } from '../server/local-mcp-catalog.mjs';

test('safe diagnostics distinguish actionable categories without guessing an unknown original report', () => {
  for (const code of ['mcp_not_running','mcp_auth','mcp_arguments','mcp_browser_startup','mcp_login','mcp_verification','mcp_rate_limited','mcp_schema']) {
    const diagnostic = researchSourceDiagnostic({ code, message: 'PRIVATE_COOKIE file=C:/private' }, 'detail');
    assert.equal(diagnostic.code, code); assert.equal(diagnostic.stage, 'detail'); assert(diagnostic.nextStep); assert(!JSON.stringify(diagnostic).includes('PRIVATE'));
  }
  const unknown = researchSourceDiagnostic(new Error('SECRET_PROVIDER_BODY'));
  assert.equal(unknown.code, 'source_unknown'); assert.match(unknown.message, /未确认/); assert(!JSON.stringify(unknown).includes('SECRET'));
});
test('image failure never invalidates text, source or existing image analysis; secrets and private media links are omitted', () => {
  const id = 'a'.repeat(24), at = Date.now(), source = { feed_id: id, data: { note: { noteId: id, title: '学习记录', desc: '每天记录读书计划。', time: at - 86400000, type: 'normal', imageList: [{url:'https://cdn.example.com/missing.jpg',description:'来源描述：桌面'}, {url:'https://cdn.example.com/p.jpg?xsec_token=PRIVATE_TOKEN'}, {url:'https://127.0.0.1/internal'}, {url:'https://cdn.example.com/PRIVATE_KEY.jpg'}], imageAnalysis:'既有来源分析：主体居中，但需人工核图。' } } };
  const raw = xhsMCPResearchItem(source, id, { at, secrets: ['PRIVATE_KEY'] });
  assert.equal(raw.text, source.data.note.desc); assert.equal(raw.imageEvidence.images.length, 1);
  const result = cleanReferences([raw], {at}); assert.equal(result.references.length, 1); assert.equal(result.references[0].text, raw.text); assert.equal(result.references[0].url, raw.url);
  assert.match(result.references[0].imageEvidence.analysis, /既有来源分析/); assert.equal(result.references[0].imageEvidence.status, 'not-verified');
  assert(!JSON.stringify(result).includes('PRIVATE_')); assert(!JSON.stringify(textOnlyImageEvidence(raw)).includes('https://'));
  assert.equal(researchImageEvidence({images:[null,{},'not-a-url']}), undefined);
  assert.match(researchInstructions('analysis'), /没有查看图片/);
});
test('local MCP catalog gives bounded human deployment guidance, not executable web commands or false all-platform launch support', () => {
  assert.equal(LOCAL_MCP_CATALOG.xiaohongshu.managed, true); assert.equal(LOCAL_MCP_CATALOG.douyin.managed, true);
  for (const platform of ['instagram','youtube','tiktok']) assert.equal(LOCAL_MCP_CATALOG[platform].managed, false);
  for (const platform of Object.keys(LOCAL_MCP_CATALOG)) {
    const guide = localMCPDeploymentGuide(platform); assert.match(guide, /不要直接安装或执行命令/); assert.match(guide, /独立服务目录与端口/); assert.match(guide, /不.*粘贴/); assert.match(guide, /127\.0\.0\.1/); assert(!/powershell\s+-|cmd\s+\/c|curl\s|iex\s|npm\s+install/.test(guide));
  }
});
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const built = await build({ stdin: { contents: "export { ResearchReferenceImages, ResearchSourceReport } from './src/pages/Research.tsx'; export { LocalMCPManager } from './src/pages/LocalMCPManager.tsx'; export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: process.cwd(), loader: 'tsx' }, bundle:true,format:'cjs',platform:'node',packages:'external',write:false,logLevel:'silent',loader:{'.css':'empty'},define:{'import.meta.env.MODE':'"test"','import.meta.env.VITE_API_BASE_URL':'""'} });
const compiled = { exports: {} }; new Function('module', 'exports', 'require', built.outputFiles[0].text)(compiled, compiled.exports, require); const ui = compiled.exports;
test('reference UI keeps source analysis, does not fetch pictures automatically, and explains legacy unspecified failures', () => {
  const html = ui.renderToStaticMarkup(ui.createElement(ui.ResearchReferenceImages, {reference:{imageEvidence:{images:[{url:'https://cdn.example.com/failure.jpg',description:'已有来源描述'}],analysis:'已有图片分析',status:'not-verified'}}}));
  assert.match(html, /已有图片分析/); assert.match(html, /已有来源描述/); assert.match(html, /未重新核图/); assert.match(html, /连接图片来源/); assert(!html.includes('<img'));
  const legacy = ui.renderToStaticMarkup(ui.createElement(ui.ResearchSourceReport, {report:{name:'来源',sourceId:'xiaohongshu',status:'failed',count:0,message:'未完成'}}));
  assert.match(legacy, /未记录更具体/); assert.match(legacy, /不能仅凭/);
  const manager = ui.renderToStaticMarkup(ui.createElement(ui.LocalMCPManager, {value:{platform:'youtube',accountId:'a',accountName:'账号A'},team:false,reload:async()=>{}}));
  assert.match(manager, /本地 MCP 管理/); assert.match(manager, /不声称已内置/); assert.match(manager, /复制给模型的部署说明/);
});
