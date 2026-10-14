import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({ entryPoints: ['src/components/ImageWatermarkReview.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' } });
const module = { exports: {} }; new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const { ImageWatermarkReview, VisibleWatermarkOption } = module.exports;
const render = props => renderToStaticMarkup(createElement(ImageWatermarkReview, props));
const image = 'data:image/png;base64,iVBORw0KGgo=';
const check = status => ({ status, engine: 'local-test', checkedAt: '2026-10-14T09:00:00Z', regions: [], message: '请核对原图。' });

test('image review distinguishes requested setting, old records and uncertain OCR outcomes', () => {
  assert.match(render({ image, requested: false, check: check('not_detected') }), /已请求不添加可见水印/);
  assert.match(render({ image, requested: true, check: check('not_detected') }), /已请求添加可见水印/);
  assert.match(render({ image, requested: false, check: check('not_detected') }), /不代表保证无水印/);
  assert.match(render({ image, check: check('unavailable') }), /自动检查暂不可用/);
  const old = render({ image }); assert.match(old, /这张图尚未自动检查/); assert.match(old, /未记录可见水印选项/);
  assert.match(old, /放大查看原图/); assert.match(old, /框线仅用于定位/);
});

test('image review escapes OCR text and locates normalized regions without changing source image', () => {
  const output = render({ image, requested: true, check: { ...check('detected'), regions: [
    { text: 'AI <script>test</script>', x: .8, y: .9, width: .3, height: .2 },
    { text: 'invalid', x: NaN, y: .1, width: .1, height: .1 },
  ] } });
  assert.match(output, /右下方/); assert.match(output, /AI &lt;script&gt;test&lt;\/script&gt;/);
  assert.doesNotMatch(output, /<script>/); assert.doesNotMatch(output, /invalid/);
  const bounds=output.match(/left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%/);
  assert(bounds);assert.equal(Number(bounds[1]),80);assert.equal(Number(bounds[2]),90);
  assert(Math.abs(Number(bounds[3])-20)<1e-6);assert(Math.abs(Number(bounds[4])-10)<1e-6);
  assert.match(output, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.equal((output.match(/class="watermark-image-region"/g) || []).length, 1);
});

test('watermark controls distinguish saved default from this request and allow both explicit booleans', () => {
  const saved = renderToStaticMarkup(createElement(VisibleWatermarkOption, { checked: true, defaultSetting: true, onChange() {} }));
  assert.match(saved, /默认添加可见水印/); assert.match(saved, /checked=""/);
  const once = renderToStaticMarkup(createElement(VisibleWatermarkOption, { checked: false, onChange() {} }));
  assert.match(once, /本次添加可见水印/); assert.match(once, /不修改默认设置/); assert.doesNotMatch(once, /checked=""/);
});
