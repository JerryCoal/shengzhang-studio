import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = 'Windows.Media.Ocr · 本机中文 OCR';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 24 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const SCRIPT = typeof __dirname !== 'undefined' ? join(__dirname, 'image-watermark-check.ps1') : fileURLToPath(new URL('./image-watermark-check.ps1', import.meta.url));
const unavailableMessages = {
  unsupported: '当前环境无法使用本机 Windows 中文 OCR，请人工检查图片边缘与角落的可见标识。',
  invalid_image: '本机 OCR 无法检查这份图片，图片格式或大小不受支持；请人工核对可见标识。',
  image_limits: '图片尺寸超出本机 OCR 检查范围，请人工核对边缘与角落的可见标识。',
  chinese_unavailable: '本机未安装可用的中文 OCR 识别器，暂时无法检查；请人工核对可见标识。',
  no_text: '本机 OCR 未识别到可供检查的文字，小字或低对比度标识可能漏检；请人工核对。',
  timeout: '本机 OCR 检查超时，未得出判断；请人工核对图片边缘与角落的可见标识。',
  failed: '本机 OCR 暂时无法完成检查，未得出判断；请人工核对图片边缘与角落的可见标识。',
};

function decodeImage(mediaData) {
  if (typeof mediaData !== 'string' || mediaData.length > Math.ceil(MAX_BYTES / 3) * 4 + 100) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(mediaData);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== match[2]) return null;
  let width, height;
  if (match[1] === 'png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') return null;
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (match[1] === 'jpeg') {
    if (bytes.length < 64 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
    if (!width || !height) return null;
  } else {
    if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3);
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    } else return null;
  }
  if (!validDimensions(width, height)) return null;
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

function validDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_PIXELS;
}

function isStandaloneLabel(text) {
  // Chinese OCR commonly reads a narrow capital I as 丨, l, or 1. Normalize
  // only the initial AI token; the complete standalone-label pattern still applies.
  const value = text.normalize('NFKC').toLowerCase().replace(/^a\s*[i1l丨|]/u, 'ai').replace(/[\s\p{P}\p{S}]/gu, '');
  if (!value || value.length > 40) return false;
  return /^(?:(?:本|该)?(?:图片|图像|内容|作品)(?:为|由|系)?|由)?(?:ai|人工智能)(?:生成|制作)(?:(?:的)?(?:图片|图像|内容|作品))?(?:仅供参考)?$/.test(value)
    || /^(?:aigc|aigenerated(?:image|content)?|generatedbyai|(?:this)?(?:image|content)(?:is)?(?:aigenerated|generatedbyai))$/.test(value);
}

function inspectLines(raw) {
  if (!Array.isArray(raw.lines) || raw.lines.length > 4000 || !validDimensions(raw.width, raw.height)) return null;
  if (raw.lines.some(line => typeof line?.text !== 'string' || ![line.x, line.y, line.width, line.height].every(Number.isFinite) || line.x < 0 || line.y < 0 || line.width <= 0 || line.height <= 0 || line.x + line.width > raw.width + 1 || line.y + line.height > raw.height + 1)) return null;
  if (!raw.lines.some(line => typeof line?.text === 'string' && line.text.trim())) return { reason: 'no_text' };
  const regions = [];
  for (const line of raw.lines) {
    if (typeof line?.text !== 'string' || line.text.length > 200 || !isStandaloneLabel(line.text)) continue;
    const x = line.x / raw.width, y = line.y / raw.height, width = Math.min(line.width / raw.width, 1 - x), height = Math.min(line.height / raw.height, 1 - y);
    // Only compact, standalone labels near the outer 8% are candidates. A sentence
    // discussing AI, a central title, or a large promotional headline is not a label.
    if (width > 0.42 || height > 0.065 || !(x <= 0.08 || y <= 0.08 || x + width >= 0.92 || y + height >= 0.92)) continue;
    regions.push({ text: line.text.trim(), x, y, width, height });
    if (regions.length === 20) break;
  }
  return { regions };
}

function runWindowsOcr({ imagePath, timeoutMs }) {
  return new Promise(resolveResult => {
    const executable = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-ImagePath', imagePath], { windowsHide: true, timeout: timeoutMs, maxBuffer: 512 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) return resolveResult({ status: 'unavailable', reason: error.killed ? 'timeout' : 'failed' });
      try { resolveResult(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); }
      catch { resolveResult({ status: 'unavailable', reason: 'failed' }); }
    });
  });
}

// Injectable runner is for isolated tests only; all production OCR stays in the
// local Windows process. Its output and errors are never included in messages.
async function runInjected(runner, request) {
  let timer;
  const controller = new AbortController();
  try {
    return await Promise.race([
      Promise.resolve().then(() => runner({ ...request, signal: controller.signal })),
      new Promise(resolveResult => { timer = setTimeout(() => { controller.abort(); resolveResult({ status: 'unavailable', reason: 'timeout' }); }, request.timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function inspectImageWatermark(mediaData, options = {}) {
  const result = { status: 'unavailable', engine: ENGINE, checkedAt: new Date().toISOString(), regions: [], message: unavailableMessages.failed };
  let temporaryDirectory, output;
  options = options && typeof options === 'object' ? options : {};
  const fail = reason => ({ ...result, message: unavailableMessages[reason] || unavailableMessages.failed });
  const image = decodeImage(mediaData);
  if (!image) return fail('invalid_image');
  if (process.platform !== 'win32' && typeof options.runner !== 'function') return fail('unsupported');
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(50, Math.min(30000, options.timeoutMs)) : 20000;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'shengzhang-image-ocr-'));
    const imagePath = join(temporaryDirectory, `image.${image.extension}`);
    await writeFile(imagePath, image.bytes, { flag: 'wx', mode: 0o600 });
    const request = { imagePath, timeoutMs };
    const raw = typeof options.runner === 'function' ? await runInjected(options.runner, request) : await runWindowsOcr(request);
    if (!raw || raw.status !== 'ok') output = fail(raw?.reason);
    else if (!/^zh(?:-|$)/i.test(raw.language || '')) output = fail('chinese_unavailable');
    else {
      const inspected = inspectLines(raw);
      if (!inspected) output = fail('failed');
      else if (inspected.reason) output = fail(inspected.reason);
      else output = { ...result, status: inspected.regions.length ? 'detected' : 'not_detected', width: raw.width, height: raw.height, regions: inspected.regions, message: inspected.regions.length ? '本机 OCR 发现疑似可见 AI 角标，请核对标出位置；检测不会修改图片，识别可能有误或漏检。' : '本机 OCR 未发现符合规则的可见 AI 角标；小字或低对比度标识可能漏检，不代表图片没有水印或 AI 标识，请人工核对。' };
    }
  } catch { output = fail('failed'); }
  finally {
    image.bytes.fill(0);
    if (temporaryDirectory) {
      // Delete only the newly allocated direct child of the OS temporary folder.
      if (dirname(resolve(temporaryDirectory)) === resolve(tmpdir()) && basename(temporaryDirectory).startsWith('shengzhang-image-ocr-')) {
        try { await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); }
        catch { output = { ...fail('failed'), message: '本机 OCR 临时文件清理未完成，请退出工作站后重试检查；本次未得出判断。' }; }
      }
    }
  }
  return output;
}
