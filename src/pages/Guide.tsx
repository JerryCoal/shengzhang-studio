import { useState } from 'react';
import { ArrowRight, BookOpen, Check, CircleHelp, GraduationCap, Pause, Play, Search, Sparkles, X } from 'lucide-react';
import { guideProgress } from '../../server/guide.mjs';
import { useStudio } from '../context';
import { Empty, PageTitle } from '../components';
import { LOCAL_DATA } from '../api';
import type { GuideState, Page } from '../types';
import { SeedreamHelp, SEEDREAM_HELP_TITLE, SEEDREAM_HELP_SUMMARY } from '../SeedreamHelp';

const practiceSteps = ['确认策略', '制作封面', '导出素材'];
function usePractice() {
  const { mutate, run, go } = useStudio();
  return () => void run(async () => {
    const result = await mutate<GuideState>('/guide', 'PUT', { action: 'start' });
    const progress = guideProgress(result.state);
    go(progress.step === 0 ? 'strategy' : 'studio', result.result.projectId);
  });
}

export function WelcomeGuide() {
  const { state, busy, mutate, run, startProject, go } = useStudio();
  const { guide, project, complete, step } = guideProgress(state);
  const start = usePractice();
  if (guide.welcomeDismissed) return project && !guide.active && !complete ? <section className="guide-resume" aria-label="继续新手练习"><GraduationCap size={21}/><div><b>上次的练习，还在这里</b><span>接着完成第 {step + 1} 步：{practiceSteps[step]}</span></div><button className="button small" disabled={busy} onClick={start}>继续练习 <ArrowRight size={15}/></button></section> : null;
  return <section className="guide-welcome" aria-labelledby="welcome-guide-title">
    <div className="guide-intro"><span className="guide-kicker"><GraduationCap size={18}/> 从这里开始</span><h2 id="welcome-guide-title">先做出第一张品牌封面。</h2><p>不用准备 API，跟着示例走一遍，把想法变成可导出的内容。</p><div className="guide-benefits"><span>免费本地制作</span><span>独立示例项目</span><span>随时暂停继续</span></div><div className="guide-actions"><button className="button primary" disabled={busy} onClick={start}><Play size={16}/>开始免费练习</button><button className="button" disabled={busy} onClick={startProject}>直接创建我的项目 <ArrowRight size={16}/></button></div><button className="text-button green" onClick={() => go('help')}>先看看完整使用指南</button></div>
    <ol className="guide-intro-steps">{practiceSteps.map((label, i) => <li key={label}><span>0{i + 1}</span><div><b>{label}</b><p>{['理解策略如何变成制作清单', '用本地模板生成一张海报', '获得图片与配套发布文案'][i]}</p></div></li>)}</ol>
    <button className="icon-button guide-dismiss" disabled={busy} title="以后可从使用指南开始练习" aria-label="暂时跳过新手引导" onClick={() => void run(async () => { await mutate('/guide', 'PUT', { action: 'dismiss' }); })}><X size={18}/></button>
  </section>;
}

export function PracticeCoach({ page }: { page: Page }) {
  const { state, project: selected, busy, run, mutate, go, startProject } = useStudio();
  const { guide, project, asset, steps, step, complete } = guideProgress(state);
  if (!guide.active || !project || page === 'help') return null;
  const target: Page = step === 0 ? 'strategy' : 'studio';
  const here = project.id === selected?.id && page === target;
  const instructions = [
    '浏览下方的宣传主题、核心表达和制作清单。然后点击“确认并开始制作”，系统会创建一项图文任务。',
    `找到“${asset?.name || '图文封面'}”卡片，点击“本地模板制作 · 免费”。完成后可以点击画面预览。`,
    `检查“${asset?.name || '图文封面'}”的画面和正文，然后点击卡片上的“导出素材包”，获得图片和文案。`,
  ];
  return <section className={`guide-coach ${complete ? 'guide-complete' : ''}`} aria-label="新手练习进度">
    <div className="guide-coach-top"><span className="guide-kicker"><GraduationCap size={18}/> 免费练习 · 山野咖啡</span><button className="text-button muted" disabled={busy} onClick={() => void run(async () => { await mutate('/guide', 'PUT', { action: 'pause' }); })}>{complete ? <Check size={14}/> : <Pause size={14}/>} {complete ? '收起引导' : '暂停练习'}</button></div>
    <ol className="guide-progress" aria-label="练习步骤">{practiceSteps.map((label, i) => <li key={label} className={steps[i] ? 'done' : step === i ? 'current' : ''} aria-current={step === i ? 'step' : undefined}><span>{steps[i] ? <Check size={15}/> : i + 1}</span>{label}<small>{steps[i] ? '已完成' : step === i ? '进行中' : '待完成'}</small></li>)}</ol>
    <div className="guide-coach-body" aria-live="polite"><div><h2>{complete ? '第一份素材，准备好了。' : `${step + 1}. ${practiceSteps[step]}`}</h2><p>{complete ? '已发起素材包导出，请在下载位置检查文件。练习不会发布到平台；正式使用时，先用自己的品牌资料创建项目。' : here ? instructions[step] : `练习进度已保留。前往“${step === 0 ? '策略与 Prompt' : '内容制作'}”，继续示例项目的这一步。`}</p><small>{complete ? '接下来：准备真实资料 → 创作 → 发布后收集评论 → 优化下期内容。' : '这三步不调用付费模型。示例预算为 $0，不需要填写密钥。'}</small></div>
      {complete ? <div className="guide-actions"><button className="button primary" disabled={busy} onClick={startProject}>创建自己的项目 <ArrowRight size={16}/></button><button className="button" onClick={() => go('help')}>了解 AI 与发布</button></div> : !here && <button className="button primary" disabled={busy} onClick={() => go(target, project.id)}>继续第 {step + 1} 步 <ArrowRight size={16}/></button>}
    </div>
  </section>;
}

type Topic = { id: string; title: string; summary: string; page: Page; action: string; steps: string[]; note: string };
const topics: Topic[] = [
  { id: 'seedream-endpoint', title: `Q：${SEEDREAM_HELP_TITLE}`, summary: SEEDREAM_HELP_SUMMARY, page: 'settings', action: '返回连接与设置', steps: [], note: '开通管理、Model ID、Endpoint ID、模型或接入点不存在、API Key、账号权限、模型下线、Request ID、cURL 示例' },
  { id: 'trends', title: '近七天热点 → 项目文案标签', summary: '新闻、关键词、匹配、风险确认、热点标签', page: 'trends', action: '打开热点与灵感', steps: ['选择当前项目，在“热点与灵感”输入或点选 1–12 个宣传关键词；建议使用受众和具体场景。', '点击“更新近七天热点”，查看所选来源的成功或失败状态，再展开候选，核对日期、摘要和匹配分。', '最多选 5 个候选。涉及人物、品牌或作品时逐项确认使用条件，再点击“确认选择并生成标签”。', '在策略或 AI 文案要求框下点选“项目热点”，会追加方向与来源；在正文编辑框中点选则只加话题标签。可撤销、停用；七天外的证据不再推荐。'], note: '采集和规则筛选不消耗模型额度，仅覆盖公开新闻源的返回条目，不代表全网热榜。名称风险提示不是授权证明，通用词和争议信号过滤可在页面中补充。数据仍保存在当前本地用户的项目里。' },
  { id: 'project', title: '01 · 创建项目，准备真实资料', summary: '品牌、目标、自动保存、导入文档', page: 'projects', action: '查看项目', steps: ['点击“新建项目”，填写品牌、产品、目标受众和卖点，选择需要制作的渠道。', '价格、规格和效果只填已核实的信息；未知内容保留为待补充。', '项目资料编辑时会自动保存，请留意“已保存”状态。新项目的未完成表单会保留为草稿，再次新建时可继续。'], note: '其他编辑器请按页面提示保存。已有项目资料更新后，历史策略与成品保留原版本；需要生成或确认新策略才能用于后续制作。' },
  { id: 'corpus', title: '02 · 让介绍文档成为语料库', summary: 'TXT、Markdown、Word、PDF、检索', page: 'corpus', action: '打开项目语料库', steps: ['先选中项目，再导入 TXT、Markdown、DOCX、PDF，或粘贴介绍文字。扫描图片 PDF 需先转为可识别文字。', '用产品或卖点关键词查询资料，核对结果；停用不适合本项目的文档。', '生成策略或 AI 文案前，可以预览检索结果。系统选取最多 5 段相关资料，生成结果保留引用线索。'], note: '文档保存在当前用户的本地工作区。使用 AI 时，相关资料会随请求发送给所选服务商；本地模板无需联网。' },
  { id: 'strategy', title: '03 · 从资料到可执行的策略', summary: '本地模板、AI、Prompt、确认策略', page: 'strategy', action: '查看策略', steps: ['点击“生成 / 调整策略”，选择免费本地模板或已配置的文本模型；可以填写本轮想强调的方向。', '核对宣传主题、核心表达和镜头要求。Prompt 就是给制作过程的详细要求，可展开修改。', '点击“确认并开始制作”后锁定此策略版本，自动建立图文或短片任务。'], note: '确认过的策略再修改，会另存为草稿。只有再次确认后才生成新版本的制作任务，旧内容不会被覆盖。' },
  { id: 'studio', title: '04 · 制作画面，导出成品', summary: '小红书 AI 封面、免费海报、视频、Seedream、Seedance', page: 'studio', action: '打开内容制作', steps: ['先用“本地模板制作 · 免费”生成封面或本地短片。可上传产品图；短片也可添加配音文件。', '小红书图文点击“AI 封面 · Seedream”：选择风格与构图，检索语料、检查提示词后确认生成；检查候选图，再点击“确认采用为封面”。', '需要 AI 视频时，在短片任务中先用 GPT Image 2 或火山 Seedream 生成关键帧，检查画面，再提交 Seedance 生成视频。', '检查画面与文案后点击“导出素材包”。包内包含成品和文案；下载完成后再去目标平台发布。'], note: '本地模板不消耗模型额度。AI 文案改动后需要重新制作画面。生成进行中请保持应用运行，先查看任务状态再决定是否重试。' },
  { id: 'ai', title: '05 · 配好 AI，只为需要的步骤付费', summary: 'API、OpenAI、DeepSeek、火山、密钥、余额、预算', page: 'settings', action: '打开连接与设置', steps: ['文本服务可配置 OpenAI 或 DeepSeek，并为策略、文案、分类、复盘选择模型；无需一次配齐全部服务。', '小红书 AI 封面使用 Seedream；视频关键帧可选 GPT Image 2 或 Seedream，视频使用 Seedance。分别保存对应服务的密钥和模型设置，检查连接状态。', '在正式项目里设置模型费用上限。每次 AI 操作前核对服务商、模型和费用提示，再手动提交。'], note: '保存密钥或连接通过不等于账户有可用额度；OpenAI API 计费也与 ChatGPT 订阅分开。Seedream 和 Seedance 需开通相应模型权限。新手练习项目预算为 $0。' },
  { id: 'publish', title: '06 · 发布到平台，留下作品记录', summary: '小红书、抖音、导出、授权、自动发布', page: 'publish', action: '打开发布中心', steps: ['选用已完成的素材，核对平台和账号，再加入发布计划。', '手动方式：导出素材 → 在平台上传并发布 → 回到工作台登记作品链接、确认发布。小红书当前使用这种方式。', '抖音自动发布需要开放平台应用权限和账号授权，并为每条作品单独启用。应用运行且平台确认公开后才会标记为已发布。'], note: '加入计划、导出或提交审核都不代表已公开发布。授权失败时可以使用手动导出；应用不会代替你绕过平台权限。' },
  { id: 'comments', title: '07 · 用评论改善下一轮内容', summary: '导入、分类、分析评论、复盘、品牌经验', page: 'comments', action: '打开评论与复盘', steps: ['选择作品，粘贴或导入评论，保留来源；示例项目可以点击“体验示例评论”。', '点击“分析评论”，使用本地规则或所选 AI。核对建议所引用的评论原文，纠正误分类和无关评论。', '采用有依据的建议后，在“下期策划”生成新策略。已采用经验会与项目资料一起用于下一轮。'], note: '抖音自动同步需要相应评论权限。小红书当前使用手动导入；少量评论只能作为初步观察。' },
  { id: 'assist', title: '快捷输入与提示词，少写一点也能说清楚', summary: '标签、撤销、RAG、语料引用、提示词规范', page: 'studio', action: '试试输入辅助', steps: ['点击输入框下方的标签，系统会追加建议，不覆盖你已写的内容；未继续修改时可撤销这次添加。含“待补充”的事实模板需要自己填实。', '展开“从本项目语料库引用”，输入关键词检索，核对文档名、段落和原文后再引用。只查当前项目启用的资料；新建项目时先保存再导入文档。', '每一步可展开“本步骤的输入与输出”。封面写静态主体和构图，首尾帧写开场与结束状态，视频写动作过程与运镜；生成前可查看实际画面提示词和引用资料。'], note: '语料检索为本地关键词匹配，不消耗模型额度；调用 AI 时，相关片段会发送给所选服务商。封面和视频提示词最多带入 3 段资料，过长片段会截取并明确标记。' },
  { id: 'rules', title: '敏感词筛选，保留自己的规则', summary: '词库、自定义、替换、审核', page: 'settings', action: '管理敏感词库', steps: ['在“连接与设置”的敏感词库中添加词条和替换词，按需要启用或停用。', '生成策略、AI 文案等流程会按词库筛选和替换，可在结果中查看命中记录。', '导出和发布前，仍需人工检查事实、图片中的文字以及最终语境。'], note: '词库是可维护的文字匹配工具，不能保证识别所有变体或判断所有平台规则。' },
  { id: 'data', title: '保存、切换用户与更新应用', summary: '本地、自动登录、密码、备份、退出、托盘', page: 'settings', action: '查看数据与备份', steps: ['每个本地用户的数据独立加密保存。登录时勾选“自动登录”后，下次可点击对应用户进入；共用电脑时可在登录页取消记住。', '更新 Windows 应用：完整解压新版本，退出旧程序后打开新版本。项目数据另存于本机，不随安装目录更新而覆盖。', '定期在设置页导出工作区备份。关闭 Windows 窗口会缩到托盘；从托盘选择“退出并停止后台任务”才会完全退出。'], note: '请牢记本地密码，无法找回。导出备份为明文且不含 API 密钥，请妥善保管。网页版各浏览器独立保存，不会自动与 Windows 版或其他设备同步。' },
  { id: 'trouble', title: '遇到问题，先看这里', summary: '报错、额度、429、连接失败、无成品、不能导出', page: 'settings', action: '检查连接与调用状态', steps: ['额度或频率受限：在设置查看具体诊断；额度不足需到对应服务商检查 API 余额，频率限制则按提示等待。换一把相同账户的密钥通常不能增加额度。', '看不到制作任务：先确认策略，并检查当前项目、内容类型和策略版本筛选。导出按钮不可用时，请先完成制作。', '连接中断或生成结果不确定：先查看任务状态和服务商记录；不要连续提交同一付费任务。网络恢复后再按页面提示检查或继续。'], note: '排查时可记录操作步骤、版本号和错误提示。不要把完整 API 密钥放进截图或发给他人。' },
];

const pageTips: Partial<Record<Page, { topic: string; title: string; text: string }>> = {
  projects: { topic: 'project', title: '先建项目，再开始创作', text: '填好产品事实、受众和目标，后续策略就有了依据。介绍文档可以在“项目语料库”导入。' },
  trends: { topic: 'trends', title: '先看来源，再把热点带入文案', text: '选关键词后手动更新新闻。确认候选与名称使用条件，再生成项目专属标签；已有文案不会自动改变。' },
  corpus: { topic: 'corpus', title: '导入后，先查一次', text: '用产品或卖点关键词检索，确认资料能够被找到。生成策略时会优先带入相关段落。' },
  strategy: { topic: 'strategy', title: '确认策略，才会产生制作任务', text: '先核对主题和制作清单，再点击“确认并开始制作”。修改已确认策略会另存为新草稿。' },
  studio: { topic: 'studio', title: '先做一份免费成品', text: '“本地模板制作 · 免费”无需 API。制作完成后可预览、导出；小红书卡片可生成 Seedream 封面，短片卡片可生成 AI 关键帧与视频。' },
  publish: { topic: 'publish', title: '加入计划之后，还需要发布', text: '手动发布需在平台上传后登记链接；自动发布需授权并逐条启用。只有确认公开后才算已发布。' },
  comments: { topic: 'comments', title: '先导入原文，再分析和采用建议', text: '复盘以评论原文为依据。采用建议后，它会进入品牌经验，用于下期策划。' },
  planning: { topic: 'comments', title: '把已采用的反馈带进下一轮', text: '先在评论复盘中采用建议，再生成下期策略。新策略保留草稿，确认后才进入制作。' },
  settings: { topic: 'ai', title: '先选服务，再保存对应密钥', text: '文本、图片和视频分别配置；不用一次配齐全部服务。本地模板、手动导出和本地评论分析可以先免费使用。' },
};

export function PageHelp({ page }: { page: Page }) {
  const { state, busy, mutate, run, go } = useStudio();
  const { guide } = guideProgress(state); const tip = pageTips[page];
  if (!tip || !guide.showTips || guide.active) return null;
  return <aside className="guide-page-help"><details key={page}><summary><CircleHelp size={17}/>这页怎么用：{tip.title}</summary><p>{tip.text}</p><button className="text-button green" onClick={() => go('help')}>打开完整使用指南 <ArrowRight size={14}/></button></details><button className="icon-button" disabled={busy} title="可在使用指南中重新开启" aria-label="隐藏各页操作提示" onClick={() => void run(async () => { await mutate('/guide', 'PUT', { action: 'tips', enabled: false }); })}><X size={15}/></button></aside>;
}

export function GuidePage() {
  const { state, settings, busy, run, mutate, go, startProject } = useStudio();
  const { guide, project, complete } = guideProgress(state);
  const [query, setQuery] = useState(''); const [category, setCategory] = useState('all');
  const start = usePractice();
  const supportTopics = ['ai', 'seedream-endpoint', 'rules', 'data', 'trouble'];
  const filtered = topics.filter(t => (category === 'all' || (category === 'workflow' ? !supportTopics.includes(t.id) : supportTopics.includes(t.id))) && [t.title, t.summary, ...t.steps, t.note].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageTitle eyebrow="A LITTLE GUIDANCE" title="每一步，都有路可循。" subtitle="从第一张封面到下一轮策划，按需要学习，随时回来查。"><span className="guide-version">v{settings.version} · 使用指南</span></PageTitle>
    <section className="guide-help-hero"><span className="guide-help-icon"><GraduationCap size={32}/></span><div><h2>{complete ? '练习已完成，开始你的品牌故事。' : '第一次使用？从免费示例练起。'}</h2><p>确认策略 → 制作封面 → 导出素材。无需 API，进度保存在当前用户的本地工作区。</p><div className="guide-actions"><button className="button primary" disabled={busy} onClick={start}><Play size={16}/>{project ? complete ? '查看练习成果' : '继续免费练习' : '开始免费练习'}</button><button className="button" disabled={busy} onClick={startProject}>创建自己的项目 <ArrowRight size={16}/></button></div></div></section>
    <div className="guide-tools"><label className="guide-search"><Search size={18}/><input type="search" aria-label="搜索使用指南" placeholder="搜索操作或问题，例如：Seedream、导出、自动保存…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="清空指南搜索" onClick={() => setQuery('')}><X size={16}/></button>}</label><label className="guide-tips-toggle"><input type="checkbox" checked={guide.showTips} disabled={busy} onChange={e => { const enabled = e.target.checked; void run(async () => { await mutate('/guide', 'PUT', { action: 'tips', enabled }); }); }}/>显示各页操作提示</label></div>
    <div className="guide-categories" role="group" aria-label="指南分类">{[['all', '全部指南'], ['workflow', '创作流程'], ['support', '设置与排查']].map(([key, label]) => <button key={key} aria-pressed={category === key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>{label}</button>)}<span aria-live="polite">{filtered.length} 篇</span></div>
    <div className="guide-topics">{filtered.map(topic => <details className="guide-topic" key={topic.id}><summary><span className="guide-topic-icon"><BookOpen size={18}/></span><span><b>{topic.title}</b><small>{topic.summary}</small></span><span className="guide-topic-expand">展开</span></summary><div className="guide-topic-body">{topic.id === 'seedream-endpoint' ? <SeedreamHelp/> : <><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol><p className="guide-topic-note">{topic.note}</p></>}<button className="button small" onClick={() => go(topic.page)}>{topic.action} <ArrowRight size={15}/></button></div></details>)}</div>
    {!filtered.length && <div className="panel"><Empty title="暂时没找到对应说明" text="试试更短的词，如“密钥”“导出”或“评论”。"><button className="button" onClick={() => { setQuery(''); setCategory('all'); }}>查看全部指南</button></Empty></div>}
    <div className="guide-bottom-note"><Sparkles size={18}/><p>{LOCAL_DATA ? '网页的用户与数据保存在当前浏览器。' : '桌面版的项目与密钥按用户保存在这台电脑。'}指南可离线阅读；联网 AI 仍需对应服务的密钥与额度。按 F1 可随时回到这里。</p></div>
  </>;
}
