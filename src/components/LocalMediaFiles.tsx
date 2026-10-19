import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, UploadCloud } from 'lucide-react';
import { useStudio } from '../context';
import { fileData } from '../api';
import { Modal } from '../components';
import { localMediaOptions, validateLocalMediaFile, type LocalMediaKind } from '../local-media.mjs';
import type { Asset } from '../types';
import './local-media-files.css';

type SelectedMedia = { name: string; data: string; mime: string; size: number };
export function LocalFileDrop({ kind, label, hint, scopeKey, disabled = false, onFile }: {
  kind: LocalMediaKind; label: string; hint?: string; scopeKey: string; disabled?: boolean;
  onFile: (file: SelectedMedia) => Promise<string | void>;
}) {
  const { run, notify } = useStudio();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false), [reading, setReading] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const pending = useRef(false), identity = useRef({ key: scopeKey, mounted: true });
  if (identity.current.key !== scopeKey) { identity.current.mounted = false; identity.current = { key: scopeKey, mounted: true }; }
  useEffect(() => { identity.current.mounted = true; return () => { identity.current.mounted = false; }; }, []);
  useEffect(() => { setError(''); setMessage(''); setDragging(false); }, [scopeKey]);
  const options = localMediaOptions(kind), locked = disabled || reading;
  const select = (files: FileList | null) => {
    if (locked || pending.current || !files?.length) return;
    if (files.length !== 1) { setError('每次请选择或拖入一个文件'); return; }
    const file = files[0], captured = identity.current;
    pending.current = true; setReading(true); setError(''); setMessage(''); setDragging(false);
    void run(async () => {
      try {
        validateLocalMediaFile(file, kind);
        const mime = validateLocalMediaFile(file, kind, await file.slice(0, 32).arrayBuffer());
        const data = await fileData(new Blob([file], { type: mime }));
        if (mime.startsWith('image/')) await new Promise<void>((resolve, reject) => { const preview = new Image(); preview.onload = () => resolve(); preview.onerror = () => reject(new Error('图片无法打开，请重新导出有效的 PNG、JPG 或 WebP 文件')); preview.src = data; });
        if (!captured.mounted || identity.current !== captured) return;
        const result = await onFile({ name: file.name, data, mime, size: file.size });
        if (!captured.mounted || identity.current !== captured) return;
        const saved = result || `已读取 ${file.name}`;
        setMessage(saved); if (result) notify(result);
      } catch (cause) {
        if (captured.mounted && identity.current === captured) { setError(cause instanceof Error ? cause.message : '文件读取失败，请重新选择'); throw cause; }
      }
    }).finally(() => { pending.current = false; if (identity.current.mounted) setReading(false); });
  };
  return <div className={`local-file-drop ${dragging ? 'dragging' : ''} ${locked ? 'disabled' : ''}`}
    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); if (!locked && event.dataTransfer.types.includes('Files')) setDragging(true); }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = locked ? 'none' : 'copy'; }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); select(event.dataTransfer.files); }}>
    <div className="local-file-description"><UploadCloud size={21}/><div><b>{label}</b><p>{hint || `选择电脑中的文件，或直接拖到这里。${options.label} · 最大 ${options.maxBytes / 1024 / 1024}MB`}</p></div></div>
    <button className="button small" type="button" disabled={locked} onClick={() => input.current?.click()}><FolderOpen size={15}/>{reading ? '正在读取并保存…' : '选择电脑文件'}</button>
    <input ref={input} type="file" hidden accept={options.accept} disabled={locked} aria-label={label} onChange={event => { select(event.target.files); event.target.value = ''; }}/>
    {error && <p className="local-file-message error-text" role="alert">{error}</p>}
    {message && <p className="local-file-message" role="status">{message}</p>}
  </div>;
}

export function ProjectReferenceFile({ disabled = false, audio = false }: { disabled?: boolean; audio?: boolean }) {
  const { project, mutate, busy } = useStudio();
  if (!project) return null;
  const scope = project.id, nurture = project.brief.type === 'nurture';
  return <LocalFileDrop kind={audio ? 'audio' : 'reference'} label={audio ? '本地配音' : nurture ? '场景参考图片' : '产品 / 场景参考图片'} scopeKey={scope} disabled={disabled || busy}
    hint={audio ? '选择或拖入 MP3、WAV、M4A、OGG、WebM，最大 8MB。用于免费本地短片的前 12 秒配音。' : '选择或拖入 PNG、JPG、WebP，最大 8MB。保存到当前项目，供接下来的图片 / 视频关键帧生成参考。'}
    onFile={async file => { await mutate(`/projects/${scope}/media`, 'PUT', { kind: audio ? 'audio' : 'image', data: file.data }); return audio ? '配音已保存，下一次本地短片合成将使用这段音频' : '参考图已保存，下一次生成将使用这张图；已有成品保持原样'; }}/>
}

export function LocalAssetImportButton({ asset, disabled = false }: { asset: Asset; disabled?: boolean }) {
  const { project, mutate, run, busy, notify } = useStudio();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<(SelectedMedia & { revision: number }) | null>(null);
  const [decoded, setDecoded] = useState(false), [previewError, setPreviewError] = useState('');
  const image = asset.kind === 'image';
  const currentAsset = project?.assets.find(item => item.id === asset.id);
  const current = !!selected && currentAsset?.revision === selected.revision;
  const ongoing = asset.aiCover?.phase === 'generating' || ['generating-frame', 'submitting-video', 'generating-video'].includes(asset.aiProduction?.phase || '');
  const locked = disabled || busy || ongoing;
  const close = () => { setOpen(false); setSelected(null); setDecoded(false); setPreviewError(''); };
  return <><button type="button" className="button small" disabled={locked} onClick={() => { setSelected(null); setDecoded(false); setPreviewError(''); setOpen(true); }}><FolderOpen size={15}/>采用本地成品</button>
    {open && project && <Modal title={image ? '采用电脑中的成品图片' : '采用电脑中的成品视频'} description="选择或拖入文件，预览核对后保存到这份内容。" onClose={close} wide>
      <p className="info-box">文件将直接作为当前文案的{image ? '配图' : '视频'}成品保存，不调用生成模型。{image ? '如需让 AI 参考图片重新创作，请使用“参考图片”。' : '当前 AI 视频流程使用图片关键帧；这里上传的视频不会作为模型参考。'}</p>
      <LocalFileDrop kind={image ? 'image-asset' : 'video-asset'} label={image ? '选择或拖入成品图片' : '选择或拖入成品视频'} scopeKey={`${project.id}:${asset.id}:${asset.revision}`} disabled={locked} onFile={async file => { setDecoded(false); setPreviewError(''); setSelected({ ...file, revision: asset.revision }); }}/>
      {selected && <div className="local-asset-preview"><p>{selected.name} · {(selected.size / 1024 / 1024).toFixed(2)}MB</p>{image ? <img src={selected.data} alt="待采用的本地成品图片" onLoad={() => setDecoded(true)} onError={() => { setDecoded(false); setPreviewError('图片无法打开，请重新导出有效的 PNG 或 JPG 文件'); }}/> : <video key={selected.data.slice(0, 150) + selected.name} src={selected.data} controls playsInline preload="metadata" onLoadedMetadata={() => setDecoded(true)} onError={() => { setDecoded(false); setPreviewError('视频无法预览，请重新导出浏览器可播放的 MP4 或 WebM 文件'); }}/>}<h3>{asset.title}</h3><p className="preserve-lines">{asset.body}</p></div>}
      {previewError && <p className="error-text" role="alert">{previewError}</p>}
      {selected && !current && <p className="info-box" role="status">文案或成品已更新，请重新选择文件并核对最新内容，避免覆盖其他修改。</p>}
      <div className="modal-actions"><button type="button" className="button" onClick={close}>取消</button><button type="button" className="button primary" disabled={locked || !selected || !current || !decoded} onClick={() => void run(async () => { if (!selected || !currentAsset || currentAsset.revision !== selected.revision) throw new Error('内容版本已变化，请重新选择文件'); await mutate(`/projects/${project.id}/assets/${asset.id}`, 'PUT', { title: currentAsset.title, body: currentAsset.body, expectedRevision: selected.revision, mediaData: selected.data, mime: selected.mime }); notify('本地成品已采用，可以导出或前往发布；旧成品已保留在历史版本'); close(); })}><Check size={16}/>确认采用为成品</button></div>
    </Modal>}
  </>;
}
