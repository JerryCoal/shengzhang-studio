import { Upload, X } from 'lucide-react';
import { Field } from '../components';
import type { Brief } from '../types';
import './NurtureFields.css';

export function NurtureFields({ value, onChange, imageData, onImage, onRemoveImage, imageStatus, disabled, existing }: {
  value: NonNullable<Brief['nurture']>;
  onChange: (value: NonNullable<Brief['nurture']>) => void;
  imageData: string;
  onImage: (file?: File) => void;
  onRemoveImage: () => void;
  imageStatus: string;
  disabled: boolean;
  existing: boolean;
}) {
  return <section className="nurture-fields" aria-label="养号图文资料">
    <div className="info-box">围绕一个主题持续分享。填写主题、场景和你的文案 Prompt，创建后即可生成发布正文与配图。</div>
    <Field label="养号发布主题 *" hint="这一篇想分享什么？">
      <input required maxLength={100} value={value.topic} onChange={e => onChange({ ...value, topic: e.target.value })} placeholder="例如：下班后的十分钟松弛日常"/>
    </Field>
    <Field label="主要场景 *" hint="写清地点、人物或物件、动作与氛围；也可以附上一张场景参考图。">
      <textarea required rows={3} maxLength={2000} value={value.scene} onChange={e => onChange({ ...value, scene: e.target.value })} placeholder="例如：傍晚的阳台，一杯茶、一本书，暖色自然光，安静放松的生活片段。"/>
    </Field>
    <div className="nurture-image-field">
      <div className="row between gap-10"><b>场景参考图片（可选）</b><label className={`button small file-button ${disabled ? 'disabled' : ''}`}><Upload size={15}/>{imageData ? '替换图片' : '上传图片'}<input aria-label="上传养号场景参考图" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e => { onImage(e.target.files?.[0]); e.target.value = ''; }}/></label></div>
      {imageData && <div className="nurture-image-preview"><img src={imageData} alt="养号主要场景参考图"/><button type="button" className="icon-button" disabled={disabled} onClick={onRemoveImage} aria-label="移除养号场景参考图"><X size={16}/></button></div>}
      <p className="small-note">PNG、JPEG 或 WebP，最大 8MB。{existing ? '图片修改后立即保存到当前项目。' : '图片在当前工作区暂存，创建项目后正式保存；刷新或退出前请先创建项目。'}</p>
      {imageStatus && <p className="small-note" role="status">{imageStatus}</p>}
    </div>
    <Field label="文案 Prompt（自己填写） *" hint="写明口吻、字数、结构、是否加话题，以及希望避开的表达；生成时会采用你的要求。">
      <textarea required rows={5} maxLength={4000} value={value.copyPrompt} onChange={e => onChange({ ...value, copyPrompt: e.target.value })} placeholder="例如：写一篇自然、轻松的小红书日常分享，标题不超过 20 字，正文约 200 字，分 3 段，结尾用一个问题互动，带 3 个相关话题。不要广告口吻，不编造亲身经历。"/>
    </Field>
  </section>;
}
