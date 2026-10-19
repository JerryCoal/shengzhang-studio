import { useState } from 'react';
import { ArrowRight, BookOpen, Check, CircleHelp, GraduationCap, Pause, Play, Search, Sparkles, X } from 'lucide-react';
import { guideProgress } from '../../server/guide.mjs';
import { useStudio } from '../context';
import { Empty, PageTitle } from '../components';
import { LOCAL_DATA } from '../api';
import type { GuideState, Page } from '../types';
import { SeedreamHelp, SEEDREAM_HELP_TITLE, SEEDREAM_HELP_SUMMARY } from '../SeedreamHelp';

const practiceSteps = ['确认示例方案', '制作封面', '下载成品'];
function usePractice() {
  const { mutate, run, go } = useStudio();
  return () => void run(async () => {
    const result = await mutate<GuideState>('/guide', 'PUT', { action: 'start' });
    const progress = guideProgress(result.state);
    go(progress.step === 0 ? 'strategy' : 'studio', result.result.projectId, progress.asset ? { assetId: progress.asset.id, tab: progress.step === 1 ? 'media' : 'check' } : undefined);
  });
}

export function WelcomeGuide() {
  const { state, busy, mutate, run, startProject, go } = useStudio();
  const { guide, project, complete, step } = guideProgress(state);
  const start = usePractice();
  if (guide.welcomeDismissed) return project && !guide.active && !complete ? <section className="guide-resume" aria-label="继续新手练习"><GraduationCap size={21}/><div><b>上次的练习，还在这里</b><span>接着完成第 {step + 1} 步：{practiceSteps[step]}</span></div><button className="button small" disabled={busy} onClick={start}>继续练习 <ArrowRight size={15}/></button></section> : null;
  return <section className="guide-welcome" aria-labelledby="welcome-guide-title">
    <div className="guide-intro"><span className="guide-kicker"><GraduationCap size={18}/> 可选免费练习</span><h2 id="welcome-guide-title">用示例做出第一张封面。</h2><p>示例沿用方案练习。正式创作可直接新建内容，写下需求并选择账号，无需先做策略。</p><div className="guide-benefits"><span>免费本地制作</span><span>独立示例项目</span><span>随时暂停继续</span></div><div className="guide-actions"><button className="button primary" disabled={busy} onClick={start}><Play size={16}/>开始免费练习</button><button className="button" disabled={busy} onClick={startProject}>直接创建我的项目 <ArrowRight size={16}/></button></div><button className="text-button green" onClick={() => go('help')}>先看看完整使用指南</button></div>
    <ol className="guide-intro-steps">{practiceSteps.map((label, i) => <li key={label}><span>0{i + 1}</span><div><b>{label}</b><p>{['采用已准备好的示例制作要求', '在本篇图片步骤中使用本地模板', '核对并下载图片与配套文案'][i]}</p></div></li>)}</ol>
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
    `打开“${asset?.name || '图文封面'}”，在“图片”步骤点击“本地模板制作 · 免费”。完成后可以点击画面预览。`,
    `打开“${asset?.name || '图文封面'}”的“发布核对”步骤，检查画面和正文，点击“下载成品”，再在导出窗口下载图片与文案。`,
  ];
  return <section className={`guide-coach ${complete ? 'guide-complete' : ''}`} aria-label="新手练习进度">
    <div className="guide-coach-top"><span className="guide-kicker"><GraduationCap size={18}/> 免费练习 · 山野咖啡</span><button className="text-button muted" disabled={busy} onClick={() => void run(async () => { await mutate('/guide', 'PUT', { action: 'pause' }); })}>{complete ? <Check size={14}/> : <Pause size={14}/>} {complete ? '收起引导' : '暂停练习'}</button></div>
    <ol className="guide-progress" aria-label="练习步骤">{practiceSteps.map((label, i) => <li key={label} className={steps[i] ? 'done' : step === i ? 'current' : ''} aria-current={step === i ? 'step' : undefined}><span>{steps[i] ? <Check size={15}/> : i + 1}</span>{label}<small>{steps[i] ? '已完成' : step === i ? '进行中' : '待完成'}</small></li>)}</ol>
    <div className="guide-coach-body" aria-live="polite"><div><h2>{complete ? '第一份素材，准备好了。' : `${step + 1}. ${practiceSteps[step]}`}</h2><p>{complete ? '已发起素材包导出，请在下载位置检查文件。练习不会发布到平台；正式使用时可以新建内容，直接描述需求。' : here ? instructions[step] : `练习进度已保留。前往“${step === 0 ? '示例内容计划' : '内容'}”，继续示例项目的这一步。`}</p><small>{complete ? '接下来：选题与资料 → 内容 → 发布 → 复盘，把经验用于下一篇。' : '这三步不调用付费模型。示例预算为 $0，不需要填写密钥。'}</small></div>
      {complete ? <div className="guide-actions"><button className="button primary" disabled={busy} onClick={startProject}>创建自己的项目 <ArrowRight size={16}/></button><button className="button" onClick={() => go('help')}>了解 AI 与发布</button></div> : !here && <button className="button primary" disabled={busy} onClick={() => go(target, project.id, asset ? { assetId: asset.id, tab: step === 1 ? 'media' : 'check' } : undefined)}>继续第 {step + 1} 步 <ArrowRight size={16}/></button>}
    </div>
  </section>;
}

type Topic = { id: string; title: string; summary: string; page: Page; target?: { tab: string }; action: string; steps: string[]; note: string };
const topics: Topic[] = [
  { id: 'quickstart', title: '入门 · 五个入口，完成一篇内容', summary: '工作台、选题与资料、内容、发布、复盘、直接草稿、养号', page: 'studio', action: '打开内容', steps: ['工作台：继续上次的草稿，或点击“新建内容”。首次使用先创建项目，并在“账号连接与身份”准备目标账号。', '选题与资料：需要参考时，发现选题、核对来源，点击“用来创作”；也可先“收藏资料”或“保存为经验”，以后在“已保存”中选用。已有明确想法可以直接创作。', '内容：描述这次想做什么，选择发布账号和图文或短视频，免费创建草稿。按“需求 → 文案 → 图片或视频 → 发布核对”逐步处理，每次只编辑一篇。', '发布：从本篇“前往发布核对”进入，检查账号和成品，再选择发布方式。平台确认成功后登记真实作品链接。', '复盘：选择已发布作品，查看表现和评论，保存有依据的待验证经验，再点击“用来创作”开始下一篇。'], note: '养号、日常分享、宣传等用途直接写进本次需求，不需要单独选择项目类型。顶部账号范围只筛选列表；每篇生成仍使用该篇绑定的账号身份与创作规则。' },
  { id: 'knowledge', title: '资料与经验 · 保存后带入下一篇', summary: '收藏资料、保存为经验、用来创作、已保存、适用账号、知识引用', page: 'trends', target: { tab: 'saved' }, action: '打开已保存资料', steps: ['在“选题与资料”的研究结果或热榜条目中，按用途选择“收藏资料”“保存为经验”或“用来创作”。先核对正文与出处，再保存。', '设置适用账号或项目共享范围；需要时填写使用期限。在“已保存”中可以编辑、停用，也可以手动添加资料。', '点击“用来创作”，相关资料会预选到新内容；补充本次需求并核对发布账号。已有草稿也可在“需求”中展开参考资料与经验，最多选择 5 条。', '生成前查看本次实际带入的参考摘要。创作和复盘仍需检查来源、事实与适用条件。'], note: '停用、到期或不适用于当前账号的条目不能用于新创作，历史引用保留。经验是待验证建议，不会自动成为产品事实。' },
  { id:'research-connect', title:'联网研究：最少需要哪些 API', summary:'公开新闻、Qwen 复用密钥、豆包搜索 Custom版、火山 API 在哪', page:'settings', action:'打开连接与设置', steps:['已有文字模型即可使用公开新闻研究。在“选题与资料 → 发现选题 → 同话题与网页”填写关键词，按需选择联网来源。新闻采集无需搜索密钥，AI 分析按已有模型计费。','想扩大网页范围，可选择 Qwen 联网：复用文字模型中北京地域的 Qwen 密钥，不用再填一份搜索 Key。保存后，研究时勾选联网网页。','已有火山搜索套餐时，展开高级连接，按开通服务 → 创建按量或订阅搜索 Key → 保存并使用操作。搜索产品现名豆包搜索 Custom版，密钥不同于 Seedream/Seedance。','核对研究结果中的原文、日期和应用建议，再收藏资料或用来创作。缺少原文或日期的网页留在待核实线索，不进入近七天参考。'], note:'仅调用选定的服务，不会自动切换收费来源。Qwen 当前适配北京地域；默认本地关键词检索，可另选 Qwen 语义检索。'},
  { id:'qwen-connect', title:'Qwen 密钥保存与连接', summary:'百炼 API Key、地域、业务空间、格式错误', page:'settings', action:'设置文字模型', steps:['选择 Qwen 服务商，并选择创建密钥时的百炼地域。','复制完整的 API Key，点击加密保存；不要填写 AccessKey 或 Coding Plan 专用密钥。','点击检查连接，再使用 Qwen 分工并保存。保存不等于验证，模型可见不等于额度足够。'], note:'保存阶段只在本机检查输入格式，不会消耗模型额度。密钥由当前本地用户加密保存。'},
  { id: 'xhs-discovery', title: '找同话题选题和高互动帖子', summary: 'Redfox、小红书 MCP、DeepSeek、热门帖子、历史内容、选题', page: 'trends', action: '打开选题与资料', steps: ['在连接与设置准备所选采集服务及文字模型。进入“选题与资料 → 发现选题 → 同话题与网页”。', '输入具体场景或话题关键词，按页面选择平台、时间、排序和内容形式，核对本次采集来源与模型。', '开始查找并分析前确认费用与发送内容。结果素材默认收起，展开查看帖子原文、可见互动、具体改进动作及验证方法。', '需要马上创作时点击“用来创作”，核对并保存参考后进入本篇草稿；想以后复用则收藏资料或保存为经验。'], note: '排名只代表本次返回样本，历史帖子不算近期热点。没有曝光等数据时不推断点击率或承诺增长；来源和费用以当次确认窗口为准。' },
  { id: 'appearance', title: '调整字号，让重点更清晰', summary: '字体大小、特大字、加粗加深、重点词、阅读、外观', page: 'settings', action: '前往连接与设置', steps: ['打开“外观与阅读”，在标准、舒适、大字、特大中选择，立即预览并自动保存。', '打开“重点文字加重加深”，突出界面提示与文案中的项目、品牌、产品、卖点短语和已确认标签。输入框仍保留纯文本，复制和导出不变。', '设置按用户在本地加密保存。等待 AI 时也能调整；保存失败可重试，点击“恢复默认”即可重置。'], note: '重点按已有词语匹配，不调用 AI，也不代表敏感词审核通过。字号不会改变生成图片或视频的尺寸。' },
  { id: 'background', title: '等待 AI 时继续处理其他工作', summary: '后台任务、收起窗口、切换项目、候选结果、生成中', page: 'studio', action: '打开内容', steps: ['支持后台处理的文案、策略或评论分析开始后，可点击弹窗的“收起窗口”；收起不会取消请求。', '从左侧导航查看其他页面，或切换项目继续工作。生成中的项目暂停相关保存和重复 AI 提交，模型与连接设置暂时锁定。', '右上角“后台任务”显示运行状态和待查看结果。返回发起时的项目或内容查看；敏感词修改候选仍需采用到编辑框并保存。'], note: '请保持应用运行。任务列表及尚未采用的候选仅保留在本次会话；刷新或彻底退出后不会自动恢复。Windows 关闭主窗口会缩到托盘。图片和视频进度可在对应内容的制作步骤查看。' },
  { id:'mcp-connect', title:'小红书 / 抖音如何连接', summary:'内置 MCP、外部服务、服务器没打开、登录、修复连接', page:'settings', action:'打开连接与设置', steps:['优先选应用自带页面助手。检查服务连接，失败时点击修复内置连接；仍不通，从托盘完全退出旧版再打开新版。','点击打开官方登录窗口，用自己的平台账号登录后关闭窗口。窗口关闭本身不代表已验证登录成功。','到发布中心确认草稿再投送；已发布的自有作品先登记链接，再到评论与复盘预览并导入评论。','外部服务需单独安装。按页面发布页下载解压，选择 MCP 主程序并启动；工作台自动保存和检查连接，再完成该服务独立的扫码登录。'], note:'小红书外部服务使用 18060 端口，抖音适配 panwenda/douyin-publish-mcp 的 HTTP 模式，默认 18080。工作台当前通过该抖音外部 MCP 接入发布与登录；评论请切换自带助手。MCP 不需要 Qwen/OpenAI 密钥。'},
  { id: 'seedream-endpoint', title: `Q：${SEEDREAM_HELP_TITLE}`, summary: SEEDREAM_HELP_SUMMARY, page: 'settings', action: '返回连接与设置', steps: [], note: '开通管理、Model ID、Endpoint ID、模型或接入点不存在、API Key、账号权限、模型下线、Request ID、cURL 示例' },
  { id: 'trends', title: '公开新闻 · 保存参考或生成文案标签', summary: '新闻、关键词、匹配、风险确认、热点标签', page: 'trends', action: '打开选题与资料', steps: ['选择当前项目，在“选题与资料 → 发现选题 → 公开新闻”输入或点选 1–12 个关键词；建议使用受众和具体场景。', '点击“更新近七天热点”，查看来源状态，再展开候选，核对日期、摘要和匹配分。需要完整参考时点击“收藏资料”或“用来创作”。', '需要话题标签时，最多选 5 个候选。涉及人物、品牌或作品时逐项确认使用条件，再点击“确认选择并生成标签”。', '在文案步骤展开“添加话题或引用项目资料”，点选已确认标签。标签可撤销或停用；七天外的证据不再推荐。'], note: '采集和规则筛选不消耗模型额度，仅覆盖公开新闻源的返回条目，不代表全网热榜。名称风险提示不是授权证明，通用词和争议信号过滤可在页面中补充。' },
  { id: 'project', title: '准备 · 项目长期资料与账号身份', summary: '项目名称、品牌、账号、身份记忆、Skills、自动保存', page: 'projects', action: '查看项目与账号', steps: ['点击“新建项目”，填写项目名称、长期方向和已确认事实；品牌或栏目可按需填写。产品细节与预算在“更多项目资料与费用设置”中展开。', '在“账号连接与身份”添加平台账号，维护各自的身份记忆与创作规则。每篇创建草稿时再选择目标账号与内容形式。', '价格、规格和效果只填已核实的信息。项目资料编辑会自动保存，请留意保存状态；点击“创建并开始创作”可直接描述第一篇内容。'], note: '项目保存共用长期资料，单篇需求描述这次的主题、用途与场景。修改长期资料不会自动改写旧成品；后续生成会使用对应账号与当前资料。' },
  { id: 'corpus', title: '项目文档 · 导入可检索的介绍资料', summary: 'TXT、Markdown、Word、PDF、语料库、检索', page: 'trends', target: { tab: 'corpus' }, action: '打开项目文档', steps: ['先选中项目，进入“选题与资料 → 项目文档”，导入 TXT、Markdown、DOCX、PDF，或粘贴介绍文字。扫描图片 PDF 需先转为可识别文字。', '用产品或卖点关键词查询资料并核对结果，停用不适合本项目的文档。', '生成文案前可以预览检索片段；在文案步骤展开“添加话题或引用项目资料”也可主动引用。结果保留引用线索。'], note: '文档保存在当前用户的工作区。调用 AI 时，选取的相关资料会随请求发送给所选服务商；本地模板无需联网。' },
  { id: 'strategy', title: '可选 · 继续历史策略与批量方案', summary: '历史策略、本地模板、AI、Prompt、确认策略', page: 'strategy', action: '查看历史策略', steps: ['普通单篇创作直接点“新建内容”。已有策略或需要按旧方案制作时，在内容列表的“更多”中选择“查看历史策略”。', '按需生成或调整方案，核对主题、核心表达与制作清单；详细 Prompt 可以展开编辑。', '使用方案流程时，点击“确认并开始制作”才会按该方案建立任务，再到内容列表选择一篇继续。'], note: '这是保留的方案流程，不是新建内容的前置步骤。修改已确认策略会另存草稿，旧内容和历史版本继续保留。' },
  { id: 'image-watermark', title: 'Seedream 图片的可见水印与角标检查', summary: 'AI生成、水印、角标、本机检查、放大原图、Seedream', page: 'studio', action: '打开内容制作', steps: ['在连接与设置的 Seedream 图片连接中选择默认是否添加可见水印，并保存设置。旧设置沿用开启。', '生成封面或 Seedream 首尾帧前，可临时切换本次水印选项，不改变保存的默认设置。', '生成完成后查看本次请求记录和角标检查。发现可疑文字时核对标记位置，并放大原图检查产品、标题和角标。', '确认画面后采用封面，或继续生成视频。可以收起弹窗等待，保持应用运行。'], note: 'Windows 本机 OCR 检查不调用额外 AI，不修改图片；缺少识别组件时提示人工核对。未发现不代表不存在水印；开关仅控制服务商可见角标，不移除隐式标识。' },
  { id: 'studio', title: '内容 · 一篇一篇完成文案与画面', summary: '直接草稿、需求、文案、图片、视频、本地文件、拖拽、标题评分、诊断', page: 'studio', action: '打开内容', steps: ['在内容列表点击“新建内容”，用自然语言写主题、场景和要求，选择发布账号与图文或短视频。资料可按需添加；“创建草稿”不调用模型。已有内容点击“继续制作”或“继续核对”。', '在“需求”中补充说明与参考，保存后进入“文案”。可以自己写，也可点“生成文案”并核对模型、账号与费用。小红书的更多标题、标题评分、改写正文和正文诊断就在相应位置，工具默认使用本篇内容。', '在“图片”或“视频”步骤选择生成、本地模板，或“采用本地成品”。电脑上的已有文件可以选择或拖入，不需要先生成一次；参考图片与本地配音在下方按需展开。', '在“发布核对”检查标题、正文和画面，按提示补齐未完成项，再“前往发布核对”或“下载成品”。旧结果可在“版本与历史”中查看。'], note: '每篇显示绑定账号、版本和状态；切换列表浏览账号不会更换这篇的创作身份。请先保存修改再生成，失败后按具体提示重试，避免重复提交付费任务。' },
  { id: 'ai', title: '配好 AI，只为需要的步骤付费', summary: 'API、OpenAI、DeepSeek、Qwen、火山、Redfox、密钥、余额、预算', page: 'settings', action: '打开连接与设置', steps: ['文本服务可配置 OpenAI、DeepSeek 或 Qwen，并按步骤选择模型；无需一次配齐全部服务。', '图片与视频按生成窗口提供的服务选择，并保存对应密钥与模型设置。使用 Redfox、Seedream 或 Seedance 等服务前，核对连接与可用额度。', '在项目长期资料的更多设置中调整模型预算。每次 AI 操作前核对账号、服务商、模型、参考资料和费用提示，再手动提交。'], note: '保存密钥或连接通过不等于账户有可用额度；OpenAI API 计费也与 ChatGPT 订阅分开。新建草稿、本地模板和采用已有成品无需模型调用。' },
  { id: 'publish', title: '发布 · 核对本篇，再登记真实结果', summary: '准备发布、目标账号、尚需制作、发布助手、MCP、素材导出', page: 'publish', action: '打开发布', steps: ['在本篇“发布核对”点击“前往发布核对”，或从发布列表点击“准备发布”。未完成内容会说明缺少什么，并提供“继续制作”。', '核对标题、正文、媒体版本与目标账号，再从当前可用方式中选择 MCP、页面助手或导出。更换发布账号时，重新核对身份与表达是否适合。', '按对应窗口确认投送；手动方式则在官方创作中心上传发布。加入待办或导出素材后，仍需确认平台上的真实结果。', '发布成功后登记作品链接，在这条记录点击“查看表现与反馈”，进入同一篇作品的复盘。'], note: '创建待办、导出和打开创作中心均不会发布；到达计划时间也不会自动投送。发布前的确认范围沿用对应方式的提示。' },
  { id: 'comments', title: '复盘 · 把作品反馈变成下一篇参考', summary: '作品表现、评论与建议、运营经验、账号归属、用来创作', page: 'comments', action: '打开复盘', steps: ['先登记已发布作品。在“复盘”选择对应作品，切换“作品表现”“评论与建议”查看同一篇的数据；未知指标留空。', '导入或采集这条作品的评论，再使用本地规则或所选 AI 分析。核对建议引用的原文，纠正误分类和无关评论。', '在“把这次观察留给下一篇”点击“保存为经验”，补充可验证的改进、适用条件和账号归属。', '进入“运营经验”，找到这条经验并点击“用来创作”。经验会预选到新内容，再描述下一篇具体想验证什么。'], note: '少量评论与累计指标只提供观察依据，不直接证明效果原因。历史品牌经验仍可展开查看，并保存为带账号范围的运营经验。' },
  { id: 'assist', title: '按需展开输入辅助与参考', summary: '标签、撤销、RAG、语料引用、提示词规范、小红书工具', page: 'studio', action: '打开内容', steps: ['在本篇文案步骤展开“添加话题或引用项目资料”，按需点选标签。建议会追加到已有内容；含“待补充”的事实模板需要自己填实。', '需要引用项目文档时，展开对应检索区域，输入关键词并核对文档名、段落与原文。只查当前项目启用资料。', '更多标题、评分、正文改写、诊断与封面方案会在本篇对应位置打开。需要参考样本时再展开添加，不必反复选择内容或复制正文。', '生成画面前可查看提示词与引用资料：图片写静态主体和构图，首尾帧写开场与结束状态，视频写动作过程与运镜。'], note: '本地关键词检索不消耗模型额度；如启用语义检索或 AI 分析，以页面显示的传输与费用提示为准。样本、知识和经验都需核对适用性。' },
  { id: 'rules', title: '敏感词筛选，保留自己的规则', summary: '词库、自定义、替换、审核', page: 'settings', action: '管理敏感词库', steps: ['在“连接与设置”的敏感词库中添加词条和替换词，按需要启用或停用。', '生成策略、AI 文案等流程会按词库筛选和替换，可在结果中查看命中记录。', '导出和发布前，仍需人工检查事实、图片中的文字以及最终语境。'], note: '词库是可维护的文字匹配工具，不能保证识别所有变体或判断所有平台规则。' },
  { id: 'data', title: '保存、切换用户与更新应用', summary: '本地、自动登录、密码、备份、退出、托盘', page: 'settings', action: '查看数据与备份', steps: ['每个本地用户的数据独立加密保存。登录时勾选“自动登录”后，下次可点击对应用户进入；共用电脑时可在登录页取消记住。', '更新 Windows 应用：完整解压新版本，退出旧程序后打开新版本。项目数据另存于本机，不随安装目录更新而覆盖。', '定期在设置页导出工作区备份。关闭 Windows 窗口会缩到托盘；从托盘选择“退出并停止后台任务”才会完全退出。'], note: '请牢记本地密码，无法找回。导出备份为明文且不含 API 密钥，请妥善保管。网页版各浏览器独立保存，不会自动与 Windows 版或其他设备同步。' },
  { id: 'trouble', title: '遇到问题，先看这里', summary: '报错、额度、429、连接失败、无成品、不能发布、不能导出', page: 'settings', action: '检查连接与调用状态', steps: ['额度或频率受限：在设置查看具体诊断；额度不足需到对应服务商检查 API 余额，频率限制则按提示等待。换一把相同账户的密钥通常不能增加额度。', '看不到内容：检查顶部项目、账号范围和图文或视频筛选；没有草稿时直接“新建内容”。', '不能继续生成或发布：先保存本篇修改，查看“发布核对”或发布页“尚需制作”中的具体原因，再补齐文案或画面。账号缺失时到“账号连接与身份”检查。', '连接中断或生成结果不确定：先查看任务状态和服务商记录；不要连续提交同一付费任务。网络恢复后再按提示检查或继续。'], note: '排查时可记录操作步骤、版本号和错误提示。不要把完整 API 密钥放进截图或发给他人。' },
];

const pageTips: Partial<Record<Page, { topic: string; title: string; text: string }>> = {
  dashboard: { topic: 'quickstart', title: '从上次停下的内容继续', text: '工作台汇总草稿与发布待办。已有想法直接新建内容，需要参考再到“选题与资料”；完成发布后，把复盘经验用于下一篇。' },
  projects: { topic: 'project', title: '项目存长期资料，单篇写本次需求', text: '创建项目后可直接创作。各账号的身份与风格在“账号连接与身份”维护；每篇创建时选择目标账号。' },
  trends: { topic: 'knowledge', title: '发现、保存，再用来创作', text: '在发现选题中核对来源，收藏资料或保存经验；点击“用来创作”会把参考带入新草稿。“已保存”统一管理可复用资料，“项目文档”保留介绍文档检索。' },
  corpus: { topic: 'corpus', title: '导入后，先查一次', text: '用产品或卖点关键词检索，确认资料能够被找到。内容生成时可预览相关片段，文案步骤也能主动引用。' },
  strategy: { topic: 'strategy', title: '这是可选的历史方案流程', text: '按方案制作时，核对清单后确认。普通单篇创作直接到“内容”点击“新建内容”，无需先生成或确认策略。' },
  studio: { topic: 'studio', title: '选择一篇，按需完成四步', text: '新建内容时描述需求并选择账号；再处理文案、图片或视频、发布核对。已有文件可以直接采用；标题、改写、诊断等工具在本篇相应位置打开。' },
  publish: { topic: 'publish', title: '核对账号和成品，再登记平台结果', text: '点击准备发布选择可用方式；尚需制作会说明缺少什么。发布成功后登记作品链接，从记录直接查看表现与反馈。计划时间只作待办，导出不等于发布。' },
  comments: { topic: 'comments', title: '围绕同一篇作品积累经验', text: '选作品后查看表现、评论与建议；保存可验证的经验，再到“运营经验”点击“用来创作”，把参考带到下一篇。' },
  analytics: { topic: 'comments', title: '先记录真实数据，再比较变化', text: '先选择已发布作品，未知指标留空。作品数据与评论作为观察依据，适合复用的改进可保存为待验证经验。' },
  planning: { topic: 'comments', title: '把运营经验带进下一篇', text: '在运营经验中核对适用条件与账号，点击“用来创作”。新草稿会预选这条经验，再补充本次具体需求。' },
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
    <PageTitle eyebrow="A LITTLE GUIDANCE" title="每一步，都有路可循。" subtitle="工作台 → 选题与资料 → 内容 → 发布 → 复盘。围绕一篇内容持续推进。"><span className="guide-version">v{settings.version} · 使用指南</span></PageTitle>
    <section className="guide-help-hero"><span className="guide-help-icon"><GraduationCap size={32}/></span><div><h2>从一句需求，开始第一篇内容。</h2><p>创建项目并准备账号后，直接新建内容。需求 → 文案 → 图片或视频 → 发布核对；需要参考时再发现和保存资料，发布后把复盘经验带回下一篇。</p><div className="guide-actions"><button className="button primary" disabled={busy} onClick={() => go('studio')}>打开内容 <ArrowRight size={16}/></button><button className="button" disabled={busy} onClick={startProject}>创建自己的项目</button><button className="text-button green" disabled={busy} onClick={start}><Play size={16}/>{project ? complete ? '查看免费练习成果' : '继续可选免费练习' : '试做免费示例'}</button></div><small>免费示例保留“确认示例方案 → 制作封面 → 下载成品”的练习，正式创作无需先做策略。</small></div></section>
    <div className="guide-tools"><label className="guide-search"><Search size={18}/><input type="search" aria-label="搜索使用指南" placeholder="搜索操作或问题，例如：Seedream、导出、自动保存…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="清空指南搜索" onClick={() => setQuery('')}><X size={16}/></button>}</label><label className="guide-tips-toggle"><input type="checkbox" checked={guide.showTips} disabled={busy} onChange={e => { const enabled = e.target.checked; void run(async () => { await mutate('/guide', 'PUT', { action: 'tips', enabled }); }); }}/>显示各页操作提示</label></div>
    <div className="guide-categories" role="group" aria-label="指南分类">{[['all', '全部指南'], ['workflow', '创作流程'], ['support', '设置与排查']].map(([key, label]) => <button key={key} aria-pressed={category === key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>{label}</button>)}<span aria-live="polite">{filtered.length} 篇</span></div>
    <div className="guide-topics">{filtered.map(topic => <details className="guide-topic" key={topic.id}><summary><span className="guide-topic-icon"><BookOpen size={18}/></span><span><b>{topic.title}</b><small>{topic.summary}</small></span><span className="guide-topic-expand">展开</span></summary><div className="guide-topic-body">{topic.id === 'seedream-endpoint' ? <SeedreamHelp/> : <><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol><p className="guide-topic-note">{topic.note}</p></>}<button className="button small" onClick={() => go(topic.page, undefined, topic.target)}>{topic.action} <ArrowRight size={15}/></button></div></details>)}</div>
    {!filtered.length && <div className="panel"><Empty title="暂时没找到对应说明" text="试试更短的词，如“密钥”“导出”或“评论”。"><button className="button" onClick={() => { setQuery(''); setCategory('all'); }}>查看全部指南</button></Empty></div>}
    <div className="guide-bottom-note"><Sparkles size={18}/><p>{LOCAL_DATA ? '网页的用户与数据保存在当前浏览器。' : '桌面版的项目与密钥按用户保存在这台电脑。'}指南可离线阅读；联网 AI 仍需对应服务的密钥与额度。按 F1 可随时回到这里。</p></div>
  </>;
}
