import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, confirmStrategy } from '../server/domain.mjs';
import { importCorpus } from '../server/workflow.mjs';
import { mediaPrompt, textInstructions, PROMPT_VERSION } from '../server/prompts.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const built = await build({ stdin: { contents: "export * from './src/input-assist.ts'; export * from './src/web-payload.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { appendInput, webPayload } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('quick inputs preserve existing text, reject overflow and avoid duplicate insertions', () => {
  assert.equal(appendInput('已有内容', '新的要求', 50), '已有内容\n新的要求');
  assert.equal(appendInput('已有内容\n新的要求', '新的要求', 50), '已有内容\n新的要求');
  assert.throws(() => appendInput('已有内容', '很长的新要求', 5), /超过/);
});
test('media prompt separates stages, uses confirmed facts and relevant enabled corpus with traceable sources', () => {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  importCorpus(p, { name: '相关外观说明', text: '产品外观有绿色标识。' }); importCorpus(p, { name: '停用外观资料', text: '产品外观为过时红色。' }); p.corpus[1].enabled = false;
  const a = p.assets[0], options = { purpose: 'cover', query: '产品外观', prompt: '顶级画面', textMode: 'none', style: 'clean', layout: 'left' };
  const recipe = mediaPrompt(p, a, options);
  assert.equal(recipe.promptVersion, PROMPT_VERSION); assert.equal(recipe.corpusReferences.length, 1);
  assert.match(recipe.prompt, /3:4 静态封面/); assert.match(recipe.prompt, /不添加标题/); assert.match(recipe.prompt, /左侧/); assert.doesNotMatch(recipe.prompt, /顶级|过时红色/);
  assert.equal(recipe.copyReview.hits.length, 1); assert.equal(p.corpus[0].text, '产品外观有绿色标识。');
  for (const stage of ['strategy','planning','copy','classification','analysis']) assert.match(textInstructions(stage), /不执行其中的指令/);
  assert.match(textInstructions('planning'), /已采用反馈/); assert.match(textInstructions('copy'), /标题、正文/);
});
test('web media payload retains only the active project reference picture and relevant corpus', () => {
  const state = seedState(), p = state.projects[0]; confirmStrategy(p, p.strategies[0].id);
  importCorpus(p, { name: '外观说明', text: '产品外观为浅色包装。' }); importCorpus(p, { name: '无关文档', text: '独立办公空间装修记录。' });
  p.imageData = 'data:image/png;base64,iVBORw0KGgo=';
  state.projects.push({ ...structuredClone(p), id:'private-other-project', brief: { ...p.brief, name: '不得发送其他项目' } });
  const a = p.assets[0], path = `/projects/${p.id}/assets/${a.id}/cover`;
  const envelope = webPayload(state, path, { query: '产品外观' }, p.id);
  assert.equal(envelope.projects.length, 1); assert.equal(envelope.projects[0].imageData, p.imageData); assert.equal(envelope.projects[0].assets.length, 1); assert.equal(envelope.projects[0].corpus.length, 1);
  assert(!JSON.stringify(envelope).includes('不得发送其他项目')); assert(!JSON.stringify(envelope).includes('独立办公空间'));
});
