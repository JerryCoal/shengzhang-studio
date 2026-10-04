import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useStudio } from '../context';
type VideoItem = { itemId: string; title: string; url: string; createTime: number };
type VideoPage = { list: VideoItem[]; cursor: string | number; hasMore: boolean };
export function DouyinVideoPicker({ accountId, selected, onSelect }: { accountId: string; selected: string; onSelect: (itemId: string) => void }) {
  const { run, busy } = useStudio();
  const [items, setItems] = useState<VideoItem[]>([]), [cursor, setCursor] = useState<string | number>(0), [pages, setPages] = useState(0), [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState('');
  const load = (reset = false) => run(async () => {
    setProblem('');
    try {
      const data = await api<VideoPage>('/integrations/douyin/videos', 'POST', { accountId, cursor: reset ? 0 : cursor });
      setItems(old => [...new Map([...(reset ? [] : old), ...data.list].map(item => [item.itemId, item])).values()]);
      setCursor(data.cursor); setPages(old => reset ? 1 : old + 1); setHasMore(data.hasMore);
    } catch (error) { setProblem(error instanceof Error ? error.message : '作品列表暂时不可用'); }
  });
  return <div className="douyin-video-picker">
    <div className="row gap-10 wrap"><button className="button" disabled={busy} onClick={() => void load(true)}><RefreshCw size={15}/>读取授权账号的作品</button><small>需要另外开通并授权 video.list</small></div>
    {problem && <p className="info-box">{problem}。可到连接设置勾选“同时授权作品列表”后重新连接，或在下方手动填写已知 item_id。</p>}
    {pages > 0 && !items.length && <p className="small-note">本页没有可关联的公开作品。可加载下一页，或核对账号、作品可见性和平台审核状态。</p>}
    {items.length > 0 && <div className="douyin-video-list">{items.map(item => <label key={item.itemId} className="douyin-video-item"><input type="radio" name="douyin-platform-video" checked={selected === item.itemId} onChange={() => onSelect(item.itemId)}/><span><b>{item.title}</b><small>{item.createTime > 0 ? new Date(item.createTime * 1000).toLocaleDateString('zh-CN') : '发布时间待确认'} · <a href={item.url} target="_blank" rel="noreferrer">在抖音核对 ↗</a></small></span></label>)}</div>}
    {hasMore && pages < 4 && <button className="button small" disabled={busy} onClick={() => void load()}>加载下一页</button>}
    {hasMore && pages >= 4 && <p className="small-note">已读取接口支持的 4 页；更早的作品可填写平台提供的 item_id 关联。</p>}
  </div>;
}
