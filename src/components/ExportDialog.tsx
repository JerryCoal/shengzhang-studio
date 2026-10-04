import { useState } from 'react';
import { Check, Copy, Download, ExternalLink } from 'lucide-react';
import { Field, Modal } from '../components';
import { useStudio } from '../context';
import { exportContent, type ExportOptions } from '../export';
import { exportDetails } from '../../server/content-export.mjs';
import type { Asset, Publication } from '../types';
import '../export.css';

export function ExportDialog({ content, projectId, onClose, onExported }: { content: Asset | Publication; projectId: string; onClose: () => void; onExported?: () => Promise<void> }) {
  const { notify } = useStudio();
  const [format, setFormat] = useState<NonNullable<ExportOptions['imageFormat']>>('original');
  const [working, setWorking] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  let info: ReturnType<typeof exportDetails> | undefined, validation = '';
  try { info = exportDetails(content); } catch (e) { validation = e instanceof Error ? e.message : '素材不可导出'; }
  const image = content.mime.startsWith('image/');
  async function deliver(mode: NonNullable<ExportOptions['mode']>) {
    if (working) return; setWorking(true); setError('');
    try {
      await exportContent(content, projectId, { mode, imageFormat: format });
      if (mode !== 'copy') {
        setSaved(true);
        try { await onExported?.(); } catch { setError('文件保存已发起，但工作台记录更新失败。请检查下载文件，稍后重新登记；尚未标记为已发布。'); }
      }
      notify('已发起文件保存，请检查下载位置；发布需在平台亲自完成');
    } catch (e) { setError(e instanceof Error ? e.message : '导出未完成，请重试'); }
    finally { setWorking(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notify('已复制，可粘贴到平台发布页'); }
    catch { setError('当前环境无法自动复制，请选中下方文本后复制。'); }
  }
  return <Modal title="导出与手动发布" description="检查成品 → 保存文件 → 在平台发布 → 回填作品链接" onClose={working ? () => {} : onClose} wide>
    <div className="export-layout"><div className="export-media">{image ? <img src={content.mediaData} alt="即将导出的封面"/> : <video controls playsInline src={content.mediaData}/>}<p>{info?.label} · R{info?.revision} · {format === 'original' || !image ? content.mime : `image/${format}`}</p></div>
      <div><h3>{content.title}</h3><p className="small-note">只导出这一份成品及文案。项目资料、语料和密钥不会打包。</p>
        {image && <Field label="图片格式" hint="转换保持原图尺寸；JPG 使用白色背景。原成品不会被覆盖。"><select value={format} disabled={working} onChange={e => setFormat(e.target.value as typeof format)}><option value="original">保留原格式（{info?.extension.toUpperCase()}）</option><option value="png">PNG · 无损图片</option><option value="jpeg">JPG · 高质量，方便上传</option></select></Field>}
        {!image && <p className="info-box">视频按实际格式导出：{info?.extension.toUpperCase()}。MP4 成品可直接选文件上传；WebM 如不被平台接受，需先在视频编辑器转为 MP4。</p>}
        {info?.warnings.map(w => <p className="export-warning" key={w}>{w}</p>)}
        <div className="export-file-list"><b>发布素材包包含</b><span>01-素材 / 当前封面或视频</span><span>02-文案 / 标题、正文、完整文案 TXT</span><span>03-发布指引.txt / 上传步骤与格式提示</span></div>
        <div className="export-buttons"><button className="button primary" disabled={working || !!validation} onClick={() => void deliver('package')}><Download size={16}/>{working ? '正在准备文件…' : '下载发布素材包 · ZIP'}</button><button className="button" disabled={working || !!validation} onClick={() => void deliver('media')}>只下载{image ? '图片' : '视频'}</button><button className="button" disabled={working || !!validation} onClick={() => void deliver('copy')}>只下载文案 · TXT</button></div>
      </div></div>
    {(error || validation) && <p className="info-box error-box" role="alert">{error || validation}</p>}
    {saved && <p className="info-box" role="status"><Check size={18}/>保存已发起。请确认文件完整下载；ZIP 请先解压，再选择里面的图片或视频上传。</p>}
    <div className="export-copy"><Field label={`标题 · ${Array.from(content.title).length} 字`}><input readOnly value={content.title} onFocus={e => e.target.select()}/></Field><button className="button small" onClick={() => void copy(content.title)}><Copy size={14}/>复制标题</button><Field label={`正文 · ${Array.from(content.body || '').length} 字（含话题原文）`}><textarea rows={5} readOnly value={content.body} onFocus={e => e.target.select()}/></Field><button className="button small" onClick={() => void copy(content.body)}><Copy size={14}/>复制正文</button></div>
    <div className="manual-publish-steps"><b>接下来怎么发布</b><ol><li>打开官方创作中心，确认登录的账号。</li><li>上传解压后的素材，分别粘贴标题与正文；话题请在平台检查并选中。</li><li>检查画面、声音、可见范围及 AI 内容标识，亲自点击发布。</li><li>确认成功后，回到发布中心登记作品链接。计划时间仅为待办，不会自动投送。</li></ol></div>
    <div className="modal-actions"><button className="button" disabled={working} onClick={onClose}>返回工作台</button>{info && <a className="button primary" href={info.creatorUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/>打开{info.label}创作中心</a>}</div>
  </Modal>;
}
