import { Check, RefreshCcw, Type } from 'lucide-react';
import { DEFAULT_APPEARANCE, FONT_SIZES, useAppearance } from '../appearance';
import { useStudio } from '../context';
import { CopyKeywords } from '../components/CopyKeywords';

export function AppearanceSettings() {
  const appearance = useAppearance(), { project } = useStudio();
  if (!appearance) return null;
  const { preferences, change, saving, error, retry } = appearance;
  const brand = project?.brief.brand || '生长 STUDIO';
  const product = project?.brief.product || '运营工作站';
  return <section className="panel settings-card appearance-settings" aria-label="外观与阅读设置">
    <div className="section-heading"><div><h2><Type size={20}/>让阅读更轻松</h2><p className="muted">即时预览，自动保存到当前用户的本地工作区。等待 AI 时也能调整。</p></div><button type="button" className="button small" onClick={() => change(DEFAULT_APPEARANCE)}><RefreshCcw size={15}/>恢复默认</button></div>
    <fieldset className="appearance-sizes"><legend>字体大小</legend><div>{FONT_SIZES.map(size => <label key={size.value} className={preferences.fontScale === size.value ? 'selected' : ''}><input type="radio" name="studio-font-size" value={size.value} checked={preferences.fontScale === size.value} onChange={() => change({ fontScale: size.value })}/><span><b>{size.label}</b><small>{size.hint}</small></span>{preferences.fontScale === size.value && <Check size={16}/>}</label>)}</div></fieldset>
    <label className="appearance-emphasis"><input type="checkbox" checked={preferences.emphasize} onChange={event => change({ emphasize: event.target.checked })}/><span><b>重点文字加重加深</b><small>突出界面标题、操作步骤和关键提示；在文案阅读区强调项目名、品牌、产品、卖点短语和已确认标签。</small></span></label>
    <div className={`appearance-save-status${error ? ' error' : ''}`} role="status" aria-live="polite">{error ? <><span>{error}</span><button type="button" className="button small" onClick={retry}>重试保存</button></> : saving ? '正在保存到当前用户…' : <><Check size={15}/><span>已保存到当前用户</span></>}</div>
    <div className="appearance-preview" aria-label="阅读效果预览"><span className="eyebrow">实时预览</span><h3>准备好下一篇好内容</h3><p><CopyKeywords text={`${brand} 的 ${product}，从真实使用场景出发，把产品信息讲清楚。`} keywords={[brand, product]}/></p><div className="info-box"><b>下一步：</b><span>核对事实、检查文案，再确认发布。</span></div><small>字号调整会覆盖导航、正文、表单与弹窗，图片和视频不放大。</small></div>
    <p className="small-note">文案重点按项目已有词语匹配，不调用 AI 猜测语义。在“内容制作”的预览和“编辑与自检”的阅读区查看效果；输入框保留纯文本。强调只改变阅读效果，不改变文案、复制内容和导出素材，也不代表这些词已通过敏感词检查。</p>
  </section>;
}
