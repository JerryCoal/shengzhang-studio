import { useState } from 'react';
import { Maximize2, ScanText } from 'lucide-react';
import type { ImageWatermarkCheck } from '../types';
import './image-watermark-review.css';

export function VisibleWatermarkOption({ checked, onChange, disabled, defaultSetting = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; defaultSetting?: boolean }) {
  return <div className="visible-watermark-option"><label><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/><span><b>{defaultSetting ? '默认添加可见水印' : '本次添加可见水印'}</b><small>{defaultSetting ? '保存后用于新的 Seedream 封面和关键帧，可在生成时临时调整。' : '仅影响这次 Seedream 请求，不修改默认设置。'}</small></span></label><p>新设置默认不请求可见水印，工作站不叠加水印。此开关不能去除服务商强制标识或已出现在画面内的文字，生成后仍需人工检查。</p></div>;
}

const normalized = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
function checkedRegions(check?: ImageWatermarkCheck) {
  return (check?.regions || []).flatMap(region => {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) return [];
    const x = normalized(region.x), y = normalized(region.y), width = Math.min(normalized(region.width), 1 - x), height = Math.min(normalized(region.height), 1 - y);
    return width > 0 && height > 0 ? [{ ...region, x, y, width, height }] : [];
  });
}
const position = (x: number, y: number, width: number, height: number) => [['左上方', '上方', '右上方'], ['左侧', '中部', '右侧'], ['左下方', '下方', '右下方']][y + height / 2 < .34 ? 0 : y + height / 2 > .66 ? 2 : 1][x + width / 2 < .34 ? 0 : x + width / 2 > .66 ? 2 : 1];
const checkedTime = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export function ImageWatermarkReview({ image, check, requested, label = '生成图片' }: { image: string; check?: ImageWatermarkCheck; requested?: boolean; label?: string }) {
  const [zoom, setZoom] = useState(1);
  const regions = checkedRegions(check);
  const detected = check?.status === 'detected';
  const title = !check ? '这张图尚未自动检查' : detected ? '发现可疑角标，请人工核对' : check.status === 'not_detected' ? '未识别到可疑角标' : '自动检查暂不可用';
  return <section className={`image-watermark-review ${detected ? 'detected' : ''}`} aria-label={`${label}水印与文字检查`}>
    <div className="watermark-review-heading"><ScanText size={17} aria-hidden="true"/><b>{title}</b></div>
    <p className="watermark-request">本次生成记录：{requested === true ? '已请求添加可见水印' : requested === false ? '已请求不添加可见水印' : '未记录可见水印选项（旧任务或其他图片服务）'}</p>
    <p>{check?.message || '请放大检查四角、边缘和画面文字，再决定是否采用。'}</p>
    {check?.status === 'not_detected' && <p>文字识别可能漏检，这个结果不代表保证无水印。请继续核对原图。</p>}
    {detected && regions.length > 0 && <ol className="watermark-region-list">{regions.map((region, index) => <li key={`${index}:${region.x}:${region.y}`}><b>{index + 1}. {position(region.x, region.y, region.width, region.height)}</b><span>“{region.text}”</span></li>)}</ol>}
    {checkedTime(check?.checkedAt) && <small>本机检查 · {checkedTime(check?.checkedAt)}</small>}
    {image && <details className="watermark-image-details"><summary><Maximize2 size={14} aria-hidden="true"/>放大查看原图{regions.length ? '与标记位置' : ''}</summary><div className="watermark-zoom-controls" role="group" aria-label={`${label}查看比例`}>{([1, 1.5, 2] as const).map(value => <button type="button" key={value} className={zoom === value ? 'selected' : ''} aria-pressed={zoom === value} onClick={() => setZoom(value)}>{value === 1 ? '适合窗口' : `放大 ${value} 倍`}</button>)}</div><div className="watermark-image-scroll"><div className="watermark-image-stage" style={{ width: `${zoom * 100}%` }}><img src={image} alt={`${label}原图，供核对角标与文字`}/>{regions.map((region, index) => <span className="watermark-image-region" key={index} title={`${index + 1}. ${region.text}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><i>{index + 1}</i></span>)}</div></div><p className="watermark-image-note">框线仅用于定位，不会写入原图，也不会自动删除画面内容。</p></details>}
  </section>;
}
