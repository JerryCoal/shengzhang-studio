import { useEffect, useState } from 'react';
import { Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useStudio } from '../context';
import { rulesOf } from '../../server/workflow.mjs';
import { mergeRules, parseRules, serializeRules } from '../../server/sensitive-checker.mjs';
import { CopyCheckPanel } from '../components/CopyCheckPanel';
import type { ContentRule } from '../types';

const template = '# 敏感词|处理方式|推荐替换|风险类型\n最好|replace|更适合|A\n百分百|replace|尽可能|A\n第一|rewrite||A\n治愈|rewrite||M\n根治|rewrite||M\n官方认证|rewrite||Q\n加微信|rewrite||P\n[笑哭R]|allow||E\n❤️|allow||E\n元|semantic|圆|PRICE';
function download(text: string, name: string) { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function ContentRulesSettings() {
  const { state, mutate, run, busy, notify } = useStudio();
  const [rules, setRules] = useState<ContentRule[]>(() => rulesOf(state));
  const [revision, setRevision] = useState(state.rulesRevision || 0);
  const [query, setQuery] = useState(''), [batch, setBatch] = useState(''), [testText, setTestText] = useState('');
  const [incoming, setIncoming] = useState<ContentRule[] | null>(null);
  const dirty = JSON.stringify(rules) !== JSON.stringify(rulesOf(state));
  useEffect(() => { if (!dirty) { setRules(rulesOf(state)); setRevision(state.rulesRevision || 0); } }, [state.rulesRevision]);
  const change = (id: string, values: Partial<ContentRule>) => setRules(rules => rules.map(rule => rule.id === id ? { ...rule, ...values } : rule));
  const parse = (text: string, format = 'txt') => { try { setIncoming(parseRules(text, format)); } catch (error) { notify((error as Error).message, true); } };
  return <section className="panel content-rule-settings">
    <div className="section-heading"><div><h2><ShieldCheck size={20}/>敏感词与替换词库</h2><p className="muted">本地先检查和固定替换，疑难表达再交 AI 修改，最后复检。</p></div><span>{rules.filter(r => r.enabled).length} 条启用</span></div>
    <p className="small-note">词库按当前用户保存，已有自定义词条会保留。A 夸张承诺 · M 功效表达 · Q 资质依据 · P 平台表达 · E 表情 · PRICE 价格语境。分类是复核提示，不代表违规判定。</p>
    <details><summary>管理词条与替换方式{dirty ? ' · 有未保存修改' : ''}</summary>
      <div className="rule-toolbar"><label className="rule-search"><Search size={16}/><input aria-label="搜索敏感词库" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索词条或替换词"/></label>
        <button className="button small" disabled={busy || rules.length >= 500} onClick={() => { setRules([...rules, { id: crypto.randomUUID(), term: '', replacement: '', enabled: true, action: 'replace', risk: 'A' }]); setQuery(''); }}><Plus size={15}/>添加词条</button>
        <button className="button primary small" disabled={busy || !dirty} onClick={() => void run(async () => { const result = await mutate<{ rules: ContentRule[]; revision: number }>('/content-rules', 'PUT', { rules, expectedRevision: revision }); setRules(result.result.rules); setRevision(result.result.revision); notify('词库已保存，后续检查使用新规则'); })}>保存词库</button>
        <button className="text-button" disabled={busy} onClick={() => { setRules(rulesOf(state)); setRevision(state.rulesRevision || 0); }}>放弃修改并重新载入</button>
      </div>
      <p className="small-note">固定替换：使用你填写的文字，留空表示删除。上下文改写：保留原文并提示复核，推荐替换可给 AI 参考。语义替换（价格场景）：先由 AI 判断每个位置是否在表达价格，再严格使用你填写的替换词，例如“元→圆”；非价格语境保留。允许词条：仅豁免精确命中的文字；长词优先，不豁免整段文案。</p>
      <div className="rule-table"><div className="rule-row rule-head"><span>启用</span><span>敏感词／允许词</span><span>处理方式</span><span>推荐替换</span><span>风险类</span><span/></div>
        {rules.filter(r => `${r.term} ${r.replacement}`.includes(query)).map(rule => <div className="rule-row" key={rule.id}>
          <input type="checkbox" aria-label={`启用词条 ${rule.term || '新词条'}`} checked={rule.enabled} onChange={e => change(rule.id, { enabled: e.target.checked })}/>
          <input aria-label={`词条 ${rule.term || '新词条'}`} value={rule.term} maxLength={60} onChange={e => change(rule.id, { term: e.target.value })}/>
          <select aria-label={`处理方式 ${rule.term || '新词条'}`} value={rule.action || 'replace'} onChange={e => change(rule.id, { action: e.target.value as ContentRule['action'] })}><option value="replace">固定替换</option><option value="rewrite">上下文改写</option><option value="allow">允许词条</option><option value="semantic">语义替换（价格）</option></select>
          <input aria-label={`替换词 ${rule.term || '新词条'}`} value={rule.replacement} disabled={rule.action === 'allow'} maxLength={120} onChange={e => change(rule.id, { replacement: e.target.value })}/>
          <input aria-label={`风险类型 ${rule.term || '新词条'}`} value={rule.risk || 'A'} maxLength={20} onChange={e => change(rule.id, { risk: e.target.value })}/>
          <button className="icon-button" aria-label={`删除词条 ${rule.term || '新词条'}`} onClick={() => setRules(rules.filter(r => r.id !== rule.id))}><Trash2 size={15}/></button>
        </div>)}
      </div>
      <div className="rule-toolbar"><label className="button small file-button">导入 TXT / CSV<input type="file" accept=".txt,.csv" aria-label="导入敏感词库" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > 600000) { notify('文件过大，请使用 600 KB 以内的 UTF-8 词库', true); return; } try { const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); parse(text, file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'txt'); } catch { notify('读取失败，请将文件另存为 UTF-8 编码', true); } }}/></label>
        <button className="button small" onClick={() => download(serializeRules(rules), 'sensitive_words.txt')}>导出当前 TXT</button><button className="button small" onClick={() => download(serializeRules(rules, 'csv'), 'sensitive_words.csv')}>导出当前 CSV</button><button className="text-button" onClick={() => download('\uFEFF' + template, 'sensitive_words_template.txt')}>下载格式模板</button><button className="text-button" onClick={() => parse(template)}>补充示例词条</button>
      </div>
      <details className="rules-batch"><summary>批量粘贴（兼容原来的 敏感词=替换词）</summary><textarea aria-label="批量添加词条" rows={5} value={batch} onChange={e => setBatch(e.target.value)} maxLength={200000} placeholder={'最好|replace|更适合|A\n治愈|rewrite||M\n[笑哭R]|allow||E\n元|semantic|圆|PRICE\n原格式也可：必买=了解后选择'}/><button className="button small" disabled={!batch.trim()} onClick={() => parse(batch)}>预览导入</button></details>
      {incoming && <div className="info-box" role="status"><b>待合并 {incoming.length} 条</b><p>同名词条保留你当前的设置；新增词条加入编辑列表后，需要点击“保存词库”。</p><p>{incoming.slice(0, 8).map(r => r.term).join('、')}{incoming.length > 8 ? '…' : ''}</p><button className="button small" onClick={() => { try { const result = mergeRules(rules, incoming); setRules(result.rules); setIncoming(null); setBatch(''); setQuery(''); notify(`加入 ${result.added} 条，保留已有 ${result.skipped} 条同名设置；请保存词库`); } catch (error) { notify((error as Error).message, true); } }}>合并到编辑列表</button><button className="text-button" onClick={() => setIncoming(null)}>取消导入</button></div>}
    </details>
    <details><summary>试查一段文案 · 本地免费</summary><p className="small-note">使用已保存词库，不会发往模型。支持原样粘贴 Emoji 和 [笑哭R] 等平台表情文本。</p><textarea aria-label="试查文案" rows={4} maxLength={8000} value={testText} onChange={e => setTestText(e.target.value)} placeholder="在这里粘贴文案，查看命中位置和替换结果"/>{testText && <CopyCheckPanel draft={{ title: '', body: testText }} onApply={v => setTestText(v.body)}/>}</details>
  </section>;
}
