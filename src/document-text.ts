import JSZip from 'jszip';
import { desktopSessionToken } from './desktop';
import type { DocumentBlock, DocumentExtraction, DocumentFormat, DocumentParserStatus, DocumentReadMode } from './document-parser-types';
export type { DocumentExtraction, DocumentReadMode } from './document-parser-types';

const defaultLimits = { maxBytes: 16 * 1024 * 1024, maxPages: 100, timeoutMs: 180000, maxCharacters: 300000 };
export async function getDocumentParserStatus(): Promise<DocumentParserStatus> {
  if (!window.studioDesktop?.documentParserStatus) return { available: false, configured: false, ready: false, pdfReady: false, formats: [], limits: defaultLimits, message: '本机增强解析仅在 Windows 客户端可用；网页版可使用简单提取' };
  try { return await window.studioDesktop.documentParserStatus({ sessionToken: desktopSessionToken() }); }
  catch { return { available: true, configured: false, ready: false, pdfReady: false, formats: [], limits: defaultLimits, message: '暂时无法连接本机解析组件，可使用简单提取' }; }
}

export async function readDocument(file: File, { mode = 'auto' }: { mode?: DocumentReadMode } = {}): Promise<{ text: string; format: DocumentFormat; extraction: DocumentExtraction }> {
  if (file.size > defaultLimits.maxBytes) throw new Error('请选择 16 MB 以内的文档');
  const format = file.name.split('.').at(-1)?.toLowerCase();
  const enhancedFormat = ['pdf', 'docx', 'pptx', 'xlsx'].includes(format || '');
  const warnings: string[] = [];
  if (enhancedFormat && mode !== 'simple') {
    const status = await getDocumentParserStatus();
    if (status.ready && status.formats.includes(format!) && window.studioDesktop?.parseDocument) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      try {
        const result = await window.studioDesktop.parseDocument({ sessionToken: desktopSessionToken(), requestId: crypto.randomUUID(), name: file.name, base64: btoa(binary) });
        if (!result.ok) throw new Error(result.error);
        const { text, format: parsedFormat, parser, sourceName, blocks, warnings: parsedWarnings, metadata } = result;
        return { text, format: parsedFormat, extraction: { parser, sourceName, blocks, warnings: parsedWarnings, metadata } };
      } catch (error) {
        const message = error instanceof Error ? error.message : '本机增强解析失败';
        if (mode === 'enhanced' || format === 'pptx' || format === 'xlsx') throw new Error(message);
        warnings.push(`增强解析未完成：${message}。本次已改用简单提取，复杂版式和扫描文字可能缺失。`);
      }
    } else if (mode === 'enhanced' || format === 'pptx' || format === 'xlsx') throw new Error(status.message);
    else warnings.push('本次使用简单提取；本机增强组件尚未就绪，复杂表格或扫描文字可能缺失。');
  }
  const result = await readSimpleDocument(file);
  result.extraction.warnings.unshift(...warnings);
  return result;
}

let pdfResources: Promise<JSZip> | undefined;
class LocalPDFResources {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const folder = kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : '';
    if (!folder || !/^[A-Za-z0-9_.-]+$/.test(filename)) throw new Error('不支持的 PDF 字体资源');
    pdfResources ||= fetch(`${import.meta.env.BASE_URL}pdf-resources.zip`).then(response => { if (!response.ok) throw new Error('PDF 字体资源暂时无法读取，请刷新后重试'); return response.arrayBuffer(); }).then(data => JSZip.loadAsync(data)).catch(error => { pdfResources = undefined; throw error; });
    const resource = (await pdfResources).file(`${folder}/${filename}`);
    if (!resource) throw new Error('文档使用了暂不支持的字体映射');
    return resource.async('uint8array');
  }
}

async function readSimpleDocument(file: File): Promise<{ text: string; format: DocumentFormat; extraction: DocumentExtraction }> {
  if (file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的介绍文档');
  const format = file.name.split('.').at(-1)?.toLowerCase();
  let text = '';
  let pageCount: number | undefined;
  const blocks: DocumentBlock[] = [];
  if (format === 'txt' || format === 'md') {
    const data = await file.arrayBuffer();
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { text = new TextDecoder('gb18030').decode(data); }
  } else if (format === 'docx') {
    const archive = await JSZip.loadAsync(file);
    const document = archive.file('word/document.xml');
    if (!document) throw new Error('这不是有效的 Word DOCX 文件');
    const expanded = (document as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof expanded !== 'number' || expanded > 4 * 1024 * 1024) throw new Error('文档正文过大，请拆分后导入');
    const xml = await document.async('string');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('文档包含不支持的 XML 声明');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.querySelector('parsererror')) throw new Error('文档结构损坏，请另存为 DOCX 后重试');
    const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    text = [...dom.getElementsByTagNameNS(namespace, 'p')].map(p => [...p.getElementsByTagNameNS(namespace, 't')].map(t => t.textContent || '').join('')).filter(Boolean).join('\n\n');
  } else if (format === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useWasm: false, useWorkerFetch: false, cMapUrl: 'local/', standardFontDataUrl: 'local/', BinaryDataFactory: LocalPDFResources, stopAtErrors: true });
    let passwordProtected = false;
    task.onPassword = () => { passwordProtected = true; void task.destroy(); };
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error('请选择 100 页以内的 PDF，或拆分后导入');
      pageCount = pdf.numPages;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n), content = await page.getTextContent();
        const pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').replace(/\u0000/g, '').trim();
        text += pageText + '\n\n';
        if (pageText) blocks.push({ id: `page-${n}`, kind: 'paragraph', text: pageText, page: n });
        if (text.length > 300000) throw new Error('正文超过 30 万字，请拆分文档');
      }
    } catch (error) { if (passwordProtected) throw new Error('请先解除 PDF 阅读密码，再导入副本'); throw error; }
    finally { await task.destroy(); }
  } else if (format === 'pptx' || format === 'xlsx') throw new Error('PPTX、XLSX 需要 Windows 客户端安装本机增强解析组件，或先导出为文字文档');
  else throw new Error('支持 TXT、MD、DOCX、PDF，以及本机增强解析的 PPTX、XLSX；旧版 DOC 请先另存为 DOCX');
  text = text.replace(/\u0000/g, '').trim();
  if (!text) throw new Error('未提取到正文；扫描件或图片型 PDF 请先转为文字');
  if (text.length > 300000) throw new Error('正文超过 30 万字，请拆分文档');
  if (!blocks.length) text.split(/\n\s*\n/).filter(Boolean).forEach((value, index) => blocks.push({ id: `paragraph-${index + 1}`, kind: 'paragraph', text: value }));
  if (blocks.length > 4000) throw new Error('文档分段过多，请拆分后导入');
  return { text, format, extraction: { parser: 'simple', sourceName: file.name.slice(-180), blocks, warnings: format === 'pdf' || format === 'docx' ? ['简单提取可能丢失版式、表格关系和图片中的文字，请核对原文。'] : [], metadata: pageCount ? { pageCount } : {} } };
}
