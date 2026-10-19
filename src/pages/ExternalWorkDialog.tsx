import { useState } from 'react';
import { Field, Modal } from '../components';
import { useStudio } from '../context';
import type { Publication } from '../types';
import { commentSource } from '../../desktop/comment-source.mjs';
export function ExternalWorkDialog({ initialUrl = '', onClose, onRegistered }: { initialUrl?: string; onClose: () => void; onRegistered: (id: string, accountId: string) => void }) {
  const { state, project, mutate, run, busy, notify } = useStudio();
  const [url, setUrl] = useState(initialUrl), [title, setTitle] = useState(''), [accountId, setAccountId] = useState(''), [publishedAt, setPublishedAt] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  let platform = ''; try { platform = commentSource(url).platform; } catch { /* Explain the link on submit. */ }
  const accounts = state.accounts.filter(account => !platform || account.platform === platform);
  if (!project) return null;
  return <Modal title="登记外部已发布作品" description="把先前在平台发布的作品关联到本项目，之后再选择采集与分析。这一步不会投稿，也不会读取平台数据。" onClose={onClose}>
    <Field label="完整作品链接"><input value={url} maxLength={8192} onChange={e => { setUrl(e.target.value); setAccountId(''); }} placeholder="粘贴作品详情页 HTTPS 链接"/></Field>
    <Field label="作品标题"><input value={title} maxLength={200} onChange={e => setTitle(e.target.value)}/></Field>
    <Field label="所属平台账号"><select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">请选择真实发布这篇作品的账号</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
    <Field label="实际发布时间（可选）" hint="不知道时留空，不以登记时间冒充发布时间。"><input type="datetime-local" value={publishedAt} onChange={e => setPublishedAt(e.target.value)}/></Field>
    <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对作品由所选账号发布，指标和评论归属此账号</label>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !confirmed || !title.trim() || !accountId || !url.trim()} onClick={() => void run(async () => {
      setError(''); try {
        const response = await mutate<Publication>(`/projects/${project.id}/review-works`, 'POST', { accountId, url, title, publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null, confirmed: true });
        notify('作品已登记，可按需采集数据'); onRegistered(response.result.id, response.result.accountId); onClose();
      } catch (failure) { setError(failure instanceof Error ? failure.message : '登记未完成'); }
    })}>保存并查看作品</button></div>
  </Modal>;
}
