import { useEffect, useState } from 'react';
import { desktopSessionToken } from '../desktop';
import { getDocumentParserStatus } from '../document-text';
import type { DocumentParserStatus } from '../document-parser-types';

export function DocumentParserSettings({ onStatusChange }: { onStatusChange?: (status: DocumentParserStatus) => void }) {
  const [status, setStatus] = useState<DocumentParserStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function refresh() { const next = await getDocumentParserStatus(); setStatus(next); onStatusChange?.(next); }
  useEffect(() => { void refresh(); }, []);
  async function configure() {
    if (!window.studioDesktop?.configureDocumentParser) return;
    setBusy(true); setMessage('');
    try {
      const next = await window.studioDesktop.configureDocumentParser({ sessionToken: desktopSessionToken() });
      setStatus(next); onStatusChange?.(next);
    } catch { setMessage('组件配置未完成，可稍后重试或继续简单提取。'); }
    finally { setBusy(false); }
  }
  return <div className="muted" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginTop: 10 }}>
    <strong>本机增强解析（可选）</strong>
    <p>{status?.message || '正在检查本机解析能力…'}</p>
    {status?.available && <>
      <p>使用 Docling 保留标题、表格和页码，识别扫描 PDF。文档在本机处理；首次安装组件及模型需要联网下载，解析时不联网。</p>
      <div className="button-row"><button type="button" disabled={busy} onClick={() => void configure()}>{busy ? '正在检查…' : status.configured ? '重新选择解析组件' : '选择已安装的解析组件'}</button><button type="button" disabled={busy} onClick={() => void refresh()}>检查状态</button></div>
      <details><summary>首次使用与限制</summary><p>在安装包的“可选文档解析组件 / scripts”文件夹运行 Install-Docling.cmd，按提示完成安装；然后在这里选择安装窗口显示的 python.exe。组件独立安装，完整 PDF 与 OCR 模型需要数 GB 磁盘空间。</p><p>增强解析最多 16 MB、100 页和 3 分钟。识别结果仍需人工核对；Office 分页可能与打印版不同。模型未就绪时，PDF 可继续简单提取。</p></details>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
export default DocumentParserSettings;
