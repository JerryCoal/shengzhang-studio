'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxPages: 100, timeoutMs: 180000, maxCharacters: 300000 });
const FORMATS = ['pdf', 'docx', 'pptx', 'xlsx'];
const safeScope = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeRequest = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
const failure = (code, error) => ({ ok: false, code, error });
function validBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(LIMITS.maxBytes / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) return false;
  const padding = value.indexOf('=');
  return padding < 0 || (padding >= value.length - 2 && /^={1,2}$/.test(value.slice(padding)));
}

function createDocumentParser({ dataRoot, tempRoot = os.tmpdir(), spawnProcess = spawn, timeoutMs = LIMITS.timeoutMs } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot) || !path.isAbsolute(tempRoot)) throw new Error('文档解析目录必须为绝对路径');
  const settingsRoot = path.join(dataRoot, 'document-parser');
  const temporaryRoot = path.resolve(tempRoot);
  const active = new Map();
  const configPath = scope => path.join(settingsRoot, scope + '.json');
  async function validatedPython(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || !/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(path.basename(value))) return null;
    try { const real = await fs.realpath(value); return /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(path.basename(real)) && (await fs.stat(real)).isFile() ? real : null; } catch { return null; }
  }
  async function config(scope) {
    if (!safeScope(scope)) return null;
    try { const value = JSON.parse(await fs.readFile(configPath(scope), 'utf8')); const pythonPath = await validatedPython(value.pythonPath); return pythonPath ? { pythonPath } : null; } catch { return null; }
  }
  const unavailable = (message, configured = false) => ({ available: true, configured, ready: false, pdfReady: false, formats: [], limits: LIMITS, message });
  async function cleanup(directory) {
    if (!directory) return true;
    if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith('shengzhang-docling-')) return false;
    try { await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); return true; } catch { return false; }
  }
  function execute(pythonPath, args, job, limit) {
    return new Promise(resolve => {
      let child, output = '', finished = false, terminationTimer;
      const decoder = new StringDecoder('utf8');
      const finish = result => { if (finished) return; finished = true; clearTimeout(timer); clearTimeout(terminationTimer); resolve(result); };
      const stop = reason => { job.reason = reason; child?.kill(); terminationTimer ||= setTimeout(() => finish(failure('termination_failed', '解析进程未能及时退出；临时文件将在退出后清理，请关闭客户端后重试')), 5000); };
      const timer = setTimeout(() => stop('timeout'), limit);
      const env = {};
      for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name];
      Object.assign(env, { PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2' });
      if (job.directory) { env.TEMP = job.directory; env.TMP = job.directory; }
      try { child = spawnProcess(pythonPath, ['-I', '-X', 'utf8', path.join(__dirname, 'document-parser.py'), ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, cwd: job.directory || path.dirname(pythonPath) }); }
      catch { finish(failure('runtime_unavailable', '无法启动已选的 Python，请重新配置本机解析组件')); return; }
      job.child = child;
      job.processClosed = false;
      job.cancel = () => stop('cancelled');
      child.stdout.on('data', data => { output += decoder.write(data); if (Buffer.byteLength(output) > 4 * 1024 * 1024) stop('output_limit'); });
      child.stderr.on('data', () => {}); // Do not return logs that may contain document content or local paths.
      child.on('error', () => { job.processClosed = true; finish(failure('runtime_unavailable', '无法启动已选的 Python，请重新配置本机解析组件')); });
      child.on('close', () => {
        job.processClosed = true;
        if (job.reason) return finish(failure(job.reason, job.reason === 'cancelled' ? '已取消增强解析' : job.reason === 'output_limit' ? '解析结果过大，请拆分文档' : '增强解析超时，请拆分文档'));
        output += decoder.end();
        try { finish(JSON.parse(output)); } catch { finish(failure('parse_failed', '本机解析未返回有效结果，请确认组件安装完整或使用简单提取')); }
      });
    });
  }
  function modelPath(pythonPath) { return path.resolve(path.dirname(pythonPath), '..', 'docling-models'); }
  async function probe(pythonPath) { return execute(pythonPath, ['--status', '--models', modelPath(pythonPath)], {}, 30000); }
  async function status({ scope } = {}) {
    if (!safeScope(scope)) return unavailable('请先登录本机资料账户');
    const setting = await config(scope);
    if (!setting) return unavailable('尚未配置本机增强解析；安装可选组件后选择其 Python');
    const result = await probe(setting.pythonPath);
    if (!result.ok) return unavailable(result.error || '本机解析组件不可用', true);
    return { available: true, configured: true, ready: result.ready === true, pdfReady: result.pdfReady === true, version: result.version, formats: Array.isArray(result.formats) ? result.formats.filter(value => FORMATS.includes(value)) : [], limits: LIMITS, message: result.message || '本机增强解析已就绪' };
  }
  async function configure({ scope, pythonPath } = {}) {
    if (!safeScope(scope)) return unavailable('请先登录本机资料账户');
    pythonPath = await validatedPython(pythonPath);
    if (!pythonPath) return unavailable('请选择可选组件环境中的 python.exe');
    const result = await probe(pythonPath);
    if (!result.ok || !result.ready) return unavailable(result.error || result.message || '所选环境尚未安装 Docling，请先完成安装');
    await fs.mkdir(settingsRoot, { recursive: true });
    await fs.writeFile(configPath(scope), JSON.stringify({ pythonPath }) + '\n', { mode: 0o600 });
    return status({ scope });
  }
  async function parse({ scope, requestId, name, base64 } = {}) {
    if (!safeScope(scope) || !safeRequest(requestId)) return failure('invalid_request', '解析请求无效，请重新登录后重试');
    if (active.size) return failure('busy', '已有文档正在增强解析，请稍后重试');
    const sourceName = typeof name === 'string' ? path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').slice(-180) : '';
    const format = sourceName.split('.').pop().toLowerCase();
    if (!FORMATS.includes(format)) return failure('unsupported_format', '增强解析支持 PDF、DOCX、PPTX、XLSX');
    if (!validBase64(base64)) return failure('invalid_file', '文件数据无效或超过 16 MB');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > LIMITS.maxBytes || (format === 'pdf' ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes[0] !== 0x50 || bytes[1] !== 0x4b)) return failure('invalid_file', '文件格式与扩展名不匹配或文件过大');
    const setting = await config(scope);
    if (!setting) return failure('not_configured', '尚未配置本机增强解析，请先安装并选择组件');
    if (active.size) return failure('busy', '已有文档正在增强解析，请稍后重试');
    const job = { scope, requestId };
    active.set(requestId, job);
    let directory;
    try {
      await fs.mkdir(temporaryRoot, { recursive: true });
      directory = await fs.mkdtemp(path.join(temporaryRoot, 'shengzhang-docling-'));
      job.directory = directory;
      const input = path.join(directory, 'source.' + format);
      await fs.writeFile(input, bytes, { mode: 0o600 });
      if (job.reason) return failure('cancelled', '已取消增强解析');
      const result = await execute(setting.pythonPath, ['--parse', input, '--models', modelPath(setting.pythonPath)], job, timeoutMs);
      if (!result.ok) return result;
      if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > LIMITS.maxCharacters || !Array.isArray(result.blocks)) return failure('invalid_result', '解析正文为空或过大，请检查文件或拆分导入');
      return { ok: true, text: result.text, format, parser: 'docling', sourceName, blocks: result.blocks, warnings: Array.isArray(result.warnings) ? result.warnings : [], metadata: result.metadata || {} };
    } catch { return failure('parse_failed', '增强解析失败，请检查本机组件或使用简单提取'); }
    finally {
      active.delete(requestId);
      if (job.processClosed === false) { job.child.once('close', () => { void cleanup(directory); }); }
      else if (!(await cleanup(directory))) return failure('cleanup_failed', '临时文档暂未清理完成，请关闭客户端后重试');
    }
  }
  function cancel({ scope, requestId } = {}) { const job = active.get(requestId); if (job && job.scope === scope) { job.reason = 'cancelled'; job.cancel?.(); return { cancelled: true }; } return { cancelled: false }; }
  function close() { for (const job of active.values()) { job.reason = 'cancelled'; job.cancel?.(); } }
  return { status, configure, parse, cancel, close };
}
module.exports = { createDocumentParser, LIMITS };
