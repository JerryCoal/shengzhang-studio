import { useCallback, useEffect, useRef, useState } from 'react';
import { contentEditDraftKey, type EditBase, type EditFields } from '../server/content-edit-drafts.mjs';
import type { Asset } from './types';
import { readEditDraft, removeEditDraft, saveEditDraft } from './content-edit-drafts';
import { registerWorkspaceSaver } from './workspace-save';
import { assetAccountId } from '../server/workspace-view.mjs';
import { LOCAL_DATA } from './api';
import { localUsername } from './local-vault';

type Draft = EditFields & { base: EditBase };
const fromAsset = (asset: Asset): Draft => {
  const fields = { title: asset.title, body: asset.body, requirement: asset.contentBrief?.requirement || '', knowledgeIds: asset.contentBrief?.knowledgeIds || [] };
  return { ...fields, base: { ...fields, revision: asset.revision } };
};
const changed = (draft: Draft) => draft.title !== draft.base.title || draft.body !== draft.base.body || draft.requirement !== draft.base.requirement || JSON.stringify(draft.knowledgeIds) !== JSON.stringify(draft.base.knowledgeIds);
const workspaceIdentity = () => LOCAL_DATA ? localUsername() : typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('studio-session');

export function useContentEditDraft(asset: Asset, projectId: string, notify: (message: string) => void) {
  const accountId = assetAccountId(asset), identity = useRef(workspaceIdentity());
  const key = contentEditDraftKey(projectId, asset.id, accountId);
  const [draft, setDraft] = useState<Draft>(() => fromAsset(asset));
  const [loaded, setLoaded] = useState(false), [status, setStatus] = useState('正在读取临时编辑…'), [error, setError] = useState('');
  const latest = useRef(draft), revision = useRef<string | null>(null), fingerprint = useRef(''), ready = useRef<Promise<void>>(Promise.resolve()), queue = useRef<Promise<void>>(Promise.resolve()), mounted = useRef(false);
  latest.current = draft;
  const flush = useCallback(() => {
    const job = queue.current.catch(() => {}).then(async () => {
      await ready.current;
      if (identity.current !== workspaceIdentity()) throw new Error('工作区已切换，原账号的临时编辑不会写入其他用户。');
      const snapshot = structuredClone(latest.current), serialized = JSON.stringify(snapshot);
      if (serialized === fingerprint.current) return;
      if (mounted.current) { setStatus('正在加密暂存…'); setError(''); }
      try {
        if (changed(snapshot)) {
          const saved = await saveEditDraft(key, { projectId, assetId: asset.id, accountId, ...snapshot }, revision.current);
          revision.current = saved.revision;
        } else if (revision.current) {
          await removeEditDraft(key, revision.current); revision.current = null;
        }
        fingerprint.current = serialized;
        if (mounted.current) setStatus(changed(snapshot) ? '临时编辑已加密保存，可关闭后继续' : '内容与已保存版本一致');
      } catch (cause) {
        if (mounted.current) { setStatus('暂存失败'); setError(cause instanceof Error ? cause.message : '暂存失败，请保持页面并重试'); }
        throw cause;
      }
    });
    queue.current = job;
    return job;
  }, [key, projectId, asset.id, accountId]);
  useEffect(() => {
    mounted.current = true;
    ready.current = readEditDraft(key).then(saved => {
      if (identity.current !== workspaceIdentity()) throw new Error('工作区已切换，请重新打开原账号内容。');
      if (!mounted.current) return;
      if (saved) {
        const restored = { base: saved.base, title: saved.title, body: saved.body, requirement: saved.requirement, knowledgeIds: saved.knowledgeIds };
        revision.current = saved.revision; latest.current = restored; fingerprint.current = JSON.stringify(restored); setDraft(restored);
        setStatus('已恢复加密暂存的编辑；保存后才会更新作品');
      } else { fingerprint.current = JSON.stringify(latest.current); setStatus('内容与已保存版本一致'); }
      setLoaded(true);
    }).catch(cause => { if (mounted.current) { setError(cause instanceof Error ? cause.message : '无法读取临时编辑，请重新打开'); setStatus('暂存读取失败'); } throw cause; });
    void ready.current.catch(() => {});
    const unregister = registerWorkspaceSaver(flush);
    return () => {
      mounted.current = false;
      // Keep the saver registered until its final write finishes, so an app quit
      // immediately after navigating away still waits for this editor's disk IO.
      void flush().catch(cause => notify('临时编辑未能保存：' + (cause instanceof Error ? cause.message : '请重试'))).finally(unregister);
    };
  }, [key, flush, notify]);
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => { void flush().catch(() => {}); }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, flush]);
  const update = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [field]: value }));
  const sync = (value: Asset) => { const next = fromAsset(value); latest.current = next; setDraft(next); };
  const commit = async (value: Asset) => { sync(value); await flush(); };
  return { ...draft, setTitle: (value: string) => update('title', value), setBody: (value: string) => update('body', value), setRequirement: (value: string) => update('requirement', value), setKnowledgeIds: (value: string[]) => update('knowledgeIds', value), setBase: (value: EditBase) => update('base', value), loaded, status, error, flush, sync, commit };
}
