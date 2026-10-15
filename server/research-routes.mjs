import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isLocalClient } from './ai-routes.mjs';
import { assert, touch, activity, now } from './domain.mjs';
import { stageConfig, MODELS } from './models.mjs';
import { generateStructured, estimateStructuredReservation, tokenCost } from './ai.mjs';
import { researchDefinition, researchInstructions } from './research-ai.mjs';
import { skillVersionsFor } from './ai-skill-registry.mjs';
import { researchOf, cleanReferences, researchCorpus, selectResearch } from './research-data.mjs';
import { RESEARCH_PLATFORMS, RESEARCH_PLATFORM_NAMES, TOPIC_SORTS, rankTopicReferences } from './topic-performance.mjs';
import { searchWeb } from './research-sources.mjs';
import { searchQwen, qwenSearchSupport, QWEN_SEARCH_RESERVATION_CNY } from './qwen-search.mjs';
import { enrichResearchPages } from './research-page-reader.mjs';
import { collectNews } from './news-crawler.mjs';
import { trendsOf } from './trends.mjs';
import { searchCorpus } from './workflow.mjs';
import { planIndex, buildIndex, retrieve, estimateQueryCny } from './rag.mjs';

const budgetCny = 1;
const spendCny = p => (p.researchPreviousCny || 0) + (p.researchUsage || []).reduce((n, u) => n + u.amountCny, 0);
const discoverySchema = z.object({ timeRange: z.enum(['week','month','all']), sortBy: z.enum(TOPIC_SORTS), noteType: z.enum(['all','image','video']), platform: z.enum(RESEARCH_PLATFORMS).optional() }).strict();
const runInput = z.object({ keywords: z.array(z.string().trim().min(1).max(30)).min(1).max(8), sources: z.array(z.enum(['web','rss', ...RESEARCH_PLATFORMS])).min(1).max(3), expectedRevision: z.number().int().nonnegative(), confirmed: z.literal(true), useSemantic: z.boolean().default(false), reuseCollected: z.boolean().default(false), discovery: discoverySchema.optional(), analysisModel: z.string().max(80).optional(), accountId: z.string().regex(/^[\w-]{1,100}$/u).optional() }).strict();
const xhsAnalysisModel = routes => MODELS[routes.analysis]?.provider === 'deepseek' ? routes.analysis : 'deepseek-flash';

export function mountResearchRoutes(app, store, config, { project, activeJobs }) {
  let settingsBusy = false;
  const available = req => config.profileMode === true && !config.authorizeCredentials && isLocalClient(req);
  const local = req => assert(available(req), '近期内容研究目前需要 Windows 版的本地加密工作区；网页仍可使用新闻线索功能。', 403);
  const price = () => store.get().researchSettings?.reservationCny ?? .02;
  function searchSettings(req) {
    const accessible = available(req), volcano = accessible ? config.researchVault?.status() || {} : {}, qwen = accessible ? config.qwenVault?.status() || {} : {};
    const support = qwenSearchSupport(config.getQwenConnection());
    const saved = store.get().researchSettings?.provider;
    // Preserve pre-upgrade search subscriptions, but new workspaces need no separate search account.
    const provider = ['none', 'qwen', 'volcengine'].includes(saved) ? saved : volcano.configured ? 'volcengine' : 'none';
    const providers = [
      { id: 'none', name: '公开新闻 · 无需搜索密钥', configured: true, supported: true, note: '采集公开新闻，AI 分析沿用已有文字模型。无需申请搜索 API；不等同于全网热榜。', reservationCny: 0, maxRequests: 0 },
      { id: 'qwen', name: 'Qwen 联网 · 复用文字模型密钥', configured: !!qwen.configured && !qwen.problem, supported: support.supported, suffix: qwen.suffix || '', note: support.note, reservationCny: QWEN_SEARCH_RESERVATION_CNY, maxRequests: 1, setupUrl: 'https://help.aliyun.com/zh/model-studio/web-search' },
      { id: 'volcengine', name: '豆包搜索 Custom版（火山）', configured: !!volcano.configured && !volcano.problem, supported: true, suffix: volcano.suffix || '', note: '可选的专用搜索服务，需要独立搜索密钥；不能直接填写 Seedream / Seedance 密钥。', reservationCny: price(), maxRequests: 3, setupUrl: 'https://console.volcengine.com/search-infinity/web-search', keyUrl: 'https://console.volcengine.com/search-infinity/api-key?tab=post_paid' },
    ];
    const selected = providers.find(item => item.id === provider);
    return { provider, configured: accessible && provider !== 'none' && selected.supported && selected.configured, suffix: selected.suffix || '', editable: accessible && !!config.researchVault?.status().supported, reservationCny: selected.reservationCny, maxRequests: selected.maxRequests, providers };
  }
  async function settings(req) {
    const routes = config.modelStore.get();
    let mcp = {}; const platformSources = [];
    if (available(req)) for (const platform of RESEARCH_PLATFORMS) {
      let status = {};
      try { status = await app.locals.integrations?.mcpResearchStatus?.(req, { platform }) || {}; } catch { /* no secrets or raw MCP error */ }
      if (platform === 'xiaohongshu') mcp = status;
      platformSources.push({ platform, name: RESEARCH_PLATFORM_NAMES[platform], configured: !!status.configured, supported: status.supported ?? !!status.configured, note: status.note || '请连接此平台 MCP 并检查搜索能力。',
        accountId: status.sourceAccountId || status.accountId || '', accountName: status.sourceAccountName || status.accountName || '',
        accounts: Array.isArray(status.accounts) ? status.accounts.map(account => ({ id: account.id, name: account.name, configured: !!account.configured })).slice(0, 20) : [] });
    }
    const deepseek = available(req) ? config.deepseekVault?.status() || {} : {};
    return { available: available(req), search: searchSettings(req), models: { query: routes.classification, analysis: routes.analysis, xiaohongshuAnalysis: xhsAnalysisModel(routes) }, deepseekConfigured: !!deepseek.configured && !deepseek.problem, mcpSearchSupported: mcp.supported ?? mcp.configured ?? false, mcpConfigured: mcp.configured || false, mcpNote: mcp.note || '', platformSources, budgetCny };
  }
  app.get('/api/research/settings', async (req,res) => res.json(await settings(req)));
  app.put('/api/research/settings', async (req,res) => {
    local(req); assert(!settingsBusy && activeJobs.size === 0, '请等待当前任务完成后修改检索连接。', 409);
    const input = z.object({ provider: z.enum(['none', 'qwen', 'volcengine']).optional(), apiKey: z.string().trim().min(8).max(2048).regex(/^[\x21-\x7e]+$/).optional(), clearKey: z.boolean().optional(), reservationCny: z.number().finite().min(.001).max(1).optional() }).strict().parse(req.body);
    assert(!(input.apiKey && input.clearKey), '保存和清除密钥不能同时进行。');
    assert(!(input.provider && input.provider !== 'volcengine' && (input.apiKey || input.clearKey || input.reservationCny !== undefined)), 'Qwen 复用文字模型密钥，公开新闻无需搜索密钥；此输入只用于火山独立搜索。');
    settingsBusy = true;
    try {
      if (input.apiKey || input.clearKey) {
        assert(config.researchVault?.status().supported, '当前工作区没有可用的加密凭据存储。');
        if (input.apiKey) await config.researchVault.save(input.apiKey); else await config.researchVault.remove();
      }
      if (input.reservationCny !== undefined || input.provider || input.apiKey) store.mutate(state => { state.researchSettings = { ...state.researchSettings, ...(input.reservationCny !== undefined ? { reservationCny: input.reservationCny } : {}), ...(input.provider || input.apiKey ? { provider: input.provider || 'volcengine' } : {}) }; });
      res.json(await settings(req));
    } finally { settingsBusy = false; }
  });
  app.get('/api/projects/:id/research/status', (req,res) => {
    local(req); const p = project(store.get(),req.params.id); res.json({ research: researchOf(p), usageCny: spendCny(p), budgetCny });
  });
  app.post('/api/projects/:id/research/select', (req,res) => {
    local(req); assert(!activeJobs.has(req.params.id), '研究正在进行，请等待完成后选用。', 409);
    const result = store.mutate(state => { const p = project(state,req.params.id); const result = selectResearch(p,req.body); touch(p); return result; });
    res.json({ result, state: store.get() });
  });
  async function modelKey(route) {
    const vault = route.provider === 'qwen' ? config.qwenVault : route.provider === 'deepseek' ? config.deepseekVault : config.vault;
    const status = vault?.status() || {};
    assert(!status.problem, '模型凭据无法读取，请在设置中重新保存。');
    const value = status.configured ? await vault.getKey() : route.provider === 'openai' ? config.apiKey : '';
    assert(value, `请在文字模型设置中配置 ${route.provider} 密钥；检索方向沿用评论分类模型，参考分析沿用评论复盘模型。`);
    return value;
  }
  app.post('/api/projects/:id/research/run', async (req,res) => {
    local(req); const input = runInput.parse(req.body), pid = req.params.id;
    const discovery = input.discovery;
    const platform = discovery?.platform || 'xiaohongshu', platformName = RESEARCH_PLATFORM_NAMES[platform];
    assert(!discovery || input.sources.length === 1 && input.sources[0] === platform, '同话题内容研究每轮只比较一个平台，请选择对应来源。');
    assert(discovery || input.sources.every(source => ['web','xiaohongshu','rss'].includes(source)), '跨平台内容请在同话题内容研究中逐个平台采集。');
    assert(!input.accountId || discovery, '请在同话题内容研究中选择采集账号。');
    assert(discovery || !input.analysisModel, '单独选择分析模型仅用于同话题内容研究。');
    assert(!discovery || input.keywords.length <= 3, '每轮最多 3 个关键词，请分批查找更具体的受众或场景。');
    assert(!discovery || !input.useSemantic, '同话题内容研究使用本地匹配与指标排序，无需额外语义检索密钥。');
    assert(!settingsBusy && !activeJobs.has(pid), '此项目正在执行任务，请等待完成。', 409);
    const initial = project(store.get(),pid), previous = researchOf(initial);
    assert(previous.revision === input.expectedRevision, '参考库已变化，请刷新后重试。', 409);
    assert(!previous.run?.finishedAt || Date.now()-Date.parse(previous.run.finishedAt) >= 15000, '刚刚已完成一轮，请稍后再操作；已有参考可以直接选用。', 429);
    const routes = config.modelStore.get();
    const queryRoute = { ...stageConfig('classification',routes), id: 'research_query', label: '热点检索方向', maxTokens: 800, thinking: false };
    const analysisModel = input.analysisModel || xhsAnalysisModel(routes);
    assert(!discovery || MODELS[analysisModel]?.provider === 'deepseek', '请选择工作台支持的 DeepSeek 分析模型。');
    const analysisRoute = { ...stageConfig('analysis',discovery ? { ...routes, analysis: analysisModel } : routes), id: 'research_analysis', label: discovery ? `${platformName}同话题内容与改进建议` : '热点参考分析', maxTokens: discovery ? 6500 : 4500 };
    const sources = [...new Set(input.sources)], webSettings = searchSettings(req), searchPrice = webSettings.reservationCny, useQwenSearch = sources.includes('web') && webSettings.provider === 'qwen';
    const qwenConnection = config.getQwenConnection();
    let searchKey = '', queryKey = '', analysisKey, embeddingKey = '', sourceAccount = null;
    activeJobs.add(pid);
    const runId = randomUUID(), startedAt = now(), briefFingerprint = JSON.stringify(initial.brief);
    const filters = { blockTerms: trendsOf(initial).settings.blockTerms || [], genericTerms: trendsOf(initial).settings.genericTerms || [] };
    const filterFingerprint = JSON.stringify(filters);
    let started = false;
    const current = () => project(store.get(),pid);
    const assertActive = () => {
      const p = current(), r = researchOf(p);
      assert(r.run?.id === runId && r.run.status === 'running' && JSON.stringify(p.brief) === briefFingerprint && JSON.stringify({blockTerms:trendsOf(p).settings.blockTerms || [],genericTerms:trendsOf(p).settings.genericTerms || []}) === filterFingerprint, '研究期间项目或过滤词已修改，已停止后续步骤；现有资料和已发生用量保留。', 409);
    };
    const phase = (name, changes = {}) => {
      assertActive(); store.mutate(state => { const p = project(state,pid), r = researchOf(p); p.research = { ...r, ...changes, revision: r.revision+1, run: { ...r.run, phase:name } }; touch(p); });
    };
    async function ai(kind,payload,route,key) {
      assertActive(); const definition = researchDefinition(kind), instructions = researchInstructions(kind);
      const reservation = estimateStructuredReservation(payload,route,definition,instructions), job = randomUUID();
      assert(Buffer.byteLength(JSON.stringify(payload)) <= 70000, '研究输入过长，请缩小范围。');
      store.mutate(state => { const p = project(state,pid); assert(p.usage.reduce((n,u)=>n+u.amountUsd,0)+reservation <= p.brief.budgetUsd, '项目的文字模型预算不足，请调整后使用“仅重新分析已保存参考”。'); p.usage.push({id:job,stage:route.id,model:route.model,skillVersions:skillVersionsFor(kind==='query'?'research-query':'research-analysis'),status:'running',amountUsd:reservation,estimated:true,at:now(),note:route.label+' · 请求中，预留费用'}); touch(p); });
      try {
        const output = await generateStructured(payload,{...route,apiKey:key},definition,instructions,config.fetcher);
        const cost = tokenCost(output.usage,route);
        settle('completed',cost ?? reservation,cost===null,output.usage); assertActive(); return output.value;
      } catch(error) { const cost = tokenCost(error.usage,route); settle(error.noCharge?'failed':'uncertain',cost ?? (error.noCharge?0:reservation),!error.noCharge&&cost===null,error.usage); throw error; }
      function settle(status,amount,estimated,tokens) { store.mutate(state => { const p=project(state,pid),u=p.usage.find(u=>u.id===job); if(u.status!=='running')return; Object.assign(u,{status,amountUsd:amount,estimated,tokens:tokens||null,note:route.label+' · '+(estimated?'按预留费用记录，请核对账单':'按返回用量估算，实际以账单为准')}); touch(p); }); }
    }
    function reserveCny(amount,operation) {
      assertActive(); const job=randomUUID();
      store.mutate(state => {const p=project(state,pid);assert(spendCny(p)+amount<=budgetCny+1e-9,'本项目近期研究的 1 元检索预算不足，请减少来源或使用本地关键词检索。');p.researchUsage||=[];while(p.researchUsage.length>=200)p.researchPreviousCny=(p.researchPreviousCny||0)+p.researchUsage.shift().amountCny;p.researchUsage.push({id:job,runId,operation,amountCny:amount,status:'uncertain',estimated:true,at:now(),note:operation==='web'?'按已配置的每次搜索预留记账，非服务商实际账单。':operation==='qwen-web'?'Qwen 联网模型及搜索费预留，尚待返回用量。':'向量请求中，保留预留金额。'});touch(p);});return job;
    }
    async function embeddings(operation,reservation,work) {
      const job=reserveCny(reservation,operation);let total=0,tokens=0,estimated=false,status='completed';
      const onUsage=usage=>{total+=usage.amountCny;tokens+=usage.tokens||0;estimated||=usage.estimated;if(usage.status==='uncertain'||usage.status==='failed'&&status==='completed')status=usage.status;assertActive();assert(spendCny(current())-reservation+total<=budgetCny+1e-9,'返回用量超出检索预算，已停止后续请求。');};
      try{return await work(onUsage);}catch(error){if(status==='completed')status='failed';throw error;}finally{store.mutate(state=>{const p=project(state,pid),u=p.researchUsage.find(u=>u.id===job);Object.assign(u,{amountCny:total,tokens,estimated,status,note:estimated?'包含未完成请求估算，请核对百炼账单。':'向量费用按返回用量估算，实际以账单为准。'});touch(p);});}
    }
    try {
      analysisKey = await modelKey(analysisRoute);
      if (!input.reuseCollected && !useQwenSearch && !discovery) queryKey = await modelKey(queryRoute);
      if (sources.includes('web') && !input.reuseCollected) {
        const selected = webSettings.providers.find(provider => provider.id === webSettings.provider);
        assert(webSettings.provider !== 'none', '公开新闻模式无需网页搜索。请取消“联网网页”，或在联网检索设置选择 Qwen / 豆包搜索。');
        assert(selected.supported, selected.note);
        assert(webSettings.configured, useQwenSearch ? '请先在文字模型设置保存北京地域 Qwen 密钥；此处会直接复用，无需另一份搜索密钥。' : '请在联网检索设置保存豆包搜索 Custom版的独立密钥，或选择无需新增密钥的公开新闻。');
        searchKey = await (useQwenSearch ? config.qwenVault : config.researchVault).getKey();
        assert(spendCny(initial)+searchPrice*webSettings.maxRequests<=budgetCny+1e-9, '剩余检索预算不足以执行本轮搜索，请取消网络来源或重用已保存参考。');
      }
      if (input.useSemantic) { assert(config.getQwenConnection().ragSupported, '本版语义检索的模型和预算按北京地域核验；请配置北京地域配套 Qwen Key，或取消语义检索使用本地关键词。尚未发送付费研究请求。'); embeddingKey = await modelKey({provider:'qwen'}); }
      if ((discovery || sources.includes('xiaohongshu'))&&!input.reuseCollected) {
        const status=await app.locals.integrations?.mcpResearchStatus?.(req, { platform, accountId: input.accountId });
        assert(status?.supported ?? status?.configured,status?.note || `请先在“账号与发布”中配置并登录${platformName}外部 MCP；内置发布助手不提供热点搜索。`);
        sourceAccount = { id: status?.sourceAccountId || status?.accountId || input.accountId || '', name: status?.sourceAccountName || status?.accountName || '' };
      }
      assert(current().research?.revision===previous.revision || !current().research&&previous.revision===0, '参考库已变化，请刷新。',409);
      store.mutate(state=>{const p=project(state,pid);p.research={...researchOf(p),keywords:input.keywords,...filters,revision:previous.revision+1,run:{id:runId,status:'running',phase:input.reuseCollected?'clean':useQwenSearch||discovery?'search':'query',startedAt,webProvider:sources.includes('web')?webSettings.provider:'none',...(discovery?{discovery,analysisModel,sourceAccount}: {})},reports:[],...(!input.reuseCollected?{pendingReferences:[]}: {})};touch(p);}); started=true;
      const groupedKeywords = input.keywords.reduce((groups, word) => { const last = groups.length - 1; if (last >= 0 && groups[last].length + word.length + 1 <= 100) groups[last] += '、' + word; else groups.push(word); return groups; }, []);
      let queries = useQwenSearch ? groupedKeywords : input.keywords.slice(0,3), raw=[],reports=[];
      if(!input.reuseCollected){
        if (!useQwenSearch && !discovery) { const planned=await ai('query',{brief:{product:initial.brief.product,audience:initial.brief.audience,goal:initial.brief.goal},keywords:input.keywords},queryRoute,queryKey); queries=planned.queries; }
        phase('search',{queries});
        if(sources.includes('web')){
          if (useQwenSearch) {
            let searchJob;
            const result = await searchQwen(queries, { key: searchKey, connection: qwenConnection, fetcher: config.qwenSearchFetcher, at: Date.now(), onRequest: () => { searchJob = reserveCny(searchPrice, 'qwen-web'); }, onUsage: usage => {
              assert(searchJob, '搜索尚未开始，不能记录费用。');
              store.mutate(state => { const p = project(state,pid), u = p.researchUsage.find(item => item.id === searchJob); const amount = Number.isFinite(usage.costCny) && usage.costCny >= 0 ? usage.costCny : searchPrice; Object.assign(u, { amountCny: amount, estimated: usage.estimated !== false, status: usage.status || 'completed', model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, searchCount: usage.searchCount, note: usage.estimated === false ? 'Qwen 联网模型与搜索费用按返回用量估算，以百炼账单为准。' : 'Qwen 联网请求用量不完整，保留估算费用，请核对百炼账单。' }); touch(p); });
              assertActive(); assert(spendCny(current()) <= budgetCny + 1e-9, '返回用量超过研究预算，已停止后续请求，请核对账单。');
            } });
            assertActive(); reports.push(...result.reports);
            const read = await enrichResearchPages(result.items, { fetcher: config.researchPageFetcher, resolver: config.researchPageResolver, at: Date.now(), assertActive });
            assertActive(); raw.push(...read.items); reports.push(...read.reports);
            const pendingReferences = result.items.filter(item => !read.items.some(found => found.url === item.url && found.publishedAt && found.text)).slice(0,24).map(item => ({title:item.title,url:item.url,reason:'尚未取得可核对的原文与明确发布时间；未纳入近七天分析。'}));
            phase('search',{reports,pendingReferences});
          } else {const result=await searchWeb(queries,{key:searchKey,fetcher:config.searchFetcher,at:Date.now(),onRequest:()=>reserveCny(searchPrice,'web')});raw.push(...result.items);reports.push(...result.reports);phase('search',{reports});}
        }
        if(discovery || sources.includes('xiaohongshu')){try{const result=await app.locals.integrations.mcpResearchSearch(req,{platform,accountId:sourceAccount?.id || input.accountId,queries,at:Date.now(),assertActive,...(discovery?{discovery}: {})});raw.push(...result.items);reports.push(...result.reports);}catch(error){assertActive();reports.push({sourceId:platform,name:`${platformName} MCP`,status:'failed',count:0,message:'MCP 搜索未完成，请检查本机服务、登录或平台验证后重试。'});}phase('search',{reports});}
        if(sources.includes('rss')){const selected=trendsOf(initial).settings;const collected=await collectNews({...selected,keywords:input.keywords},{fetcher:config.newsFetcher,resolver:config.newsResolver});raw.push(...collected.articles.map(a=>({kind:'rss',title:a.title,url:a.url,text:a.excerpt,publishedAt:a.publishedAt,collectedAt:a.fetchedAt,dateBasis:'publisher-feed',sourceName:a.source,metrics:null})));reports.push(...collected.reports.map(r=>({...r,sourceId:'rss'})));}
      } else raw=previous.references.map(r=>({...r,metrics:Object.fromEntries(Object.entries(r.metrics).map(([k,v])=>[k,v.raw||v.value]))}));
      phase('clean',{queries,reports});
      if (discovery) raw = raw.filter(item => item.kind === platform);
      const cleaned=cleanReferences(raw,{...filters,keywords:input.keywords,at:Date.now(),...(discovery?{discovery}: {})});
      const ranked = discovery ? rankTopicReferences(cleaned.references,{keywords:input.keywords,sortBy:discovery.sortBy,platform}) : null;
      if (ranked) cleaned.references = ranked.references;
      // Retain sources required by the last analysis if this run later fails.
      const merged=[...new Map([...cleaned.references,...previous.references].map(r=>[r.id,r])).values()].slice(-160);
      const knownURLs = new Set(cleaned.references.map(reference => reference.url.replace(/\/$/, '')));
      const pendingReferences = (researchOf(current()).pendingReferences || []).filter(item => !knownURLs.has(item.url.replace(/\/$/, '')));
      phase('retrieve',{references:merged,excluded:cleaned.excluded,pendingReferences,...(ranked?{retrieval:{method:'sample-interaction',count:ranked.analysisReferences.length,note:ranked.summary.note,comparison:ranked.summary}}:{})});
      assert(cleaned.references.length,discovery?`没有取得符合所选时间范围、可核对正文与日期的${platformName}内容。旧参考已保留；请检查 MCP 登录与来源报告，或扩大范围、更换具体关键词。`:'本次没有取得可核对发布时间的近七天内容。旧参考已保留；请检查来源报告或更换关键词。');
      assert(!ranked || ranked.analysisReferences.length, '候选内容未命中本次主题，已保留候选供核对，没有发起 AI 分析。请使用更具体的关键词或添加同义词后重试。');
      assert(!ranked || ranked.summary.knownMetrics > 0, '同话题候选均未提供所选比较指标，已保存供核对，没有发起 AI 分析。请改选确实可见的点赞、收藏或评论指标，或检查来源服务。');
      const corpus=researchCorpus(cleaned.references,pid), query=queries.join(' ').slice(0,500);
      let retrieved={results:searchCorpus(corpus,query,10),method:'keyword'}, index=previous.ragIndex;
      if(input.useSemantic){
        corpus.ragIndex=index; const plan=planIndex(corpus);
        index=await embeddings('index',plan.estimatedCny,onUsage=>buildIndex(corpus,{key:embeddingKey,fetcher:config.ragFetcher,onUsage}));corpus.ragIndex=index;corpus.ragEnabled=true;
        retrieved=await embeddings('query',estimateQueryCny(query),onUsage=>retrieve(corpus,query,{key:embeddingKey,fetcher:config.ragFetcher,onUsage,limit:10}));
      }
      // When keywords have no literal hit, keep the evidence set small and label
      // this as a recent-candidate fallback rather than a semantic match.
      const byId=new Map(cleaned.references.map(r=>[r.id,r]));
      const relevant=[...new Set(retrieved.results.map(r=>r.documentId))].map(id=>byId.get(id)).filter(Boolean).slice(0,10);
      const references=ranked?ranked.analysisReferences:relevant.length?relevant:cleaned.references.slice(0,8);
      const retrieval=ranked?{method:'sample-interaction',count:references.length,note:ranked.summary.note,comparison:ranked.summary}:{method:relevant.length?retrieved.method:'recent-candidates',count:references.length,note:relevant.length?'已检索相关原文，仍须核对用途与语境。':'没有关键词命中，使用本轮少量近期候选供 AI 判断；不代表语义匹配。'};
      phase('analyze',{retrieval,ragIndex:index});
      const result=await ai(discovery?'xhs-analysis':'analysis',{brief:{product:initial.brief.product,audience:initial.brief.audience,goal:initial.brief.goal,facts:initial.brief.facts},keywords:input.keywords,...filters,references:references.map(({sourceAccountId,sourceAccountName,...reference})=>reference),...(discovery?{discovery,sampleComparison:ranked.summary}: {})},analysisRoute,analysisKey);
      assertActive();
      store.mutate(state=>{const p=project(state,pid),r=researchOf(p);p.research={...r,references:cleaned.references,analyses:result.analyses.map(a=>({...a,id:runId+':'+a.id})),selectedIds:[],acknowledgedIds:[],revision:r.revision+1,run:{...r.run,status:'completed',phase:'completed',finishedAt:now()},analysisModel:analysisRoute.model,skillVersions:skillVersionsFor('research-analysis')};touch(p);activity(state,discovery?`${platformName}同话题研究已完成`:'近期内容研究已完成',`${cleaned.references.length} 条来源 · ${result.analyses.length} 个参考方向，等待选用`,pid);});
      res.json({result:researchOf(current()),state:store.get()});
    }catch(error){
      if(started)store.mutate(state=>{const p=project(state,pid),r=researchOf(p);if(r.run?.id!==runId)return;p.research={...r,revision:r.revision+1,run:{...r.run,status:'failed',phase:'failed',finishedAt:now(),error:'本轮未完成，已保留此前参考及本轮已采集资料；请查看来源报告、连接状态和费用后重试。'}};touch(p);});
      throw error;
    }finally{activeJobs.delete(pid);}
  });
}
