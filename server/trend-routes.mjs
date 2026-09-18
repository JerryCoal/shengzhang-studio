import { z } from 'zod';
import { configureTrends, trendsOf, commitCollection, selectTrends, changeTrendTag, trendSettingsSchema } from './trends.mjs';
import { collectNews } from './news-crawler.mjs';
import { touch, activity, assert } from './domain.mjs';

export function mountTrendRoutes(app,store,config,{project}) {
  const running=new Set();
  app.put('/api/projects/:id/trends/settings',(req,res)=>{const result=store.mutate(state=>{const p=project(state,req.params.id);assert(!running.has(p.id),'采集正在进行，请完成后再修改热点设置',409);const result=configureTrends(p,req.body);touch(p);return result;});res.json({result,state:store.get()});});
  app.post('/api/projects/:id/trends/refresh',async(req,res)=>{
    const input=z.object({expectedRevision:z.number().int().nonnegative()}).strict().parse(req.body), pid=req.params.id;
    assert(!running.has(pid),'正在更新此项目的热点，请勿重复提交',409);
    const previous=trendsOf(project(store.get(),pid));assert(previous.revision===input.expectedRevision,'热点设置已变化，请刷新重试',409);
    const settings=trendSettingsSchema.parse(previous.settings);
    assert(!previous.updatedAt||Date.now()-Date.parse(previous.updatedAt)>=60000,'刚刚已更新，请一分钟后再采集；已采集内容仍可筛选',429);
    running.add(pid);
    try {
      const collected=await collectNews(settings,{fetcher:config.newsFetcher,resolver:config.newsResolver});
      const result=store.mutate(state=>{const p=project(state,pid),current=trendsOf(p);assert(current.revision===input.expectedRevision,'采集期间热点设置已变化，请重新更新',409);const result=commitCollection(p,settings,collected);touch(p);activity(state,'近七天热点已更新',`${result.articles.length} 条新闻 · ${result.candidates.length} 个候选`,p.id);return result;});res.json({result,state:store.get()});
    }finally{running.delete(pid);}
  });
  app.post('/api/projects/:id/trends/select',(req,res)=>{const result=store.mutate(state=>{const p=project(state,req.params.id);assert(!running.has(p.id),'请等待热点更新完成',409);const result=selectTrends(p,req.body);touch(p);return result;});res.json({result,state:store.get()});});
  app.put('/api/projects/:id/trends/tags/:tagId',(req,res)=>{const result=store.mutate(state=>{const p=project(state,req.params.id);const result=changeTrendTag(p,req.params.tagId,req.body);touch(p);return result;});res.json({result,state:store.get()});});
}
