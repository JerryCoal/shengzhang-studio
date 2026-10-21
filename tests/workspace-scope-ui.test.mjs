import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newProject, addAccount } from '../server/domain.mjs';
import { createContentDraft, createKnowledge } from '../server/content-workflow.mjs';
import { DEFAULT_ROUTES, MODELS } from '../server/models.mjs';

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('vite'))('esbuild');
const compiled = await build({ stdin:{contents:"export { WorkspaceScopePicker, WorkspaceScopeSummary } from './src/components/WorkspaceScope.tsx'; export { KnowledgePicker, KnowledgeLibrary } from './src/pages/KnowledgeLibrary.tsx'; export { StudioPage } from './src/pages/ContentStudio.tsx'; export { PublishWorkspace } from './src/pages/PublishWorkspace.tsx'; export { BatchPublishDialog } from './src/components/BatchPublishDialog.tsx'; export { Context } from './src/context.tsx';",resolveDir:process.cwd(),loader:'tsx'}, bundle:true, platform:'node', format:'cjs', write:false, packages:'external', loader:{'.css':'empty'}, define:{'import.meta.env.MODE':'"development"','import.meta.env.VITE_API_BASE_URL':'""'}, logLevel:'silent' });
const module = { exports:{} }; new Function('module','exports','require',compiled.outputFiles[0].text)(module,module.exports,require);
const { WorkspaceScopePicker, WorkspaceScopeSummary, KnowledgePicker, KnowledgeLibrary, StudioPage, PublishWorkspace, BatchPublishDialog, Context } = module.exports;
function fixture() {
  const make = name => newProject({name,brand:name,product:'演示产品',type:'daily',goal:'真实分享',audience:'读者',sellingPoints:'已知用途',facts:'',requirements:'不编造',channels:['xiaohongshu'],deadline:'2027-01-01',budgetUsd:10});
  const project=make('主编辑项目甲'), other=make('批量范围项目乙');
  const state={projects:[project,other],accounts:[],activities:[],installedSkills:[],skillsRevision:0};
  const accounts=['甲账号','乙账号','丙账号'].map(name=>addAccount(state,{platform:'xiaohongshu',name}));
  accounts.forEach((account,index)=>createContentDraft(state,project,{requestId:crypto.randomUUID(),accountId:account.id,kind:'image',requirement:'真实日常',title:`账号${index+1}专属草稿`}));
  createContentDraft(state,other,{requestId:crypto.randomUUID(),accountId:accounts[0].id,kind:'image',requirement:'其他品牌事实',title:'其他项目内容不可混入'});
  const scope={projectIds:[project.id,other.id],accountIds:[accounts[0].id,accounts[1].id]};
  const context={state,project,scope,setScope(){},accountScope:'',setAccountScope(){},target:{},settings:{routes:DEFAULT_ROUTES,models:MODELS,providers:{},openaiConfigured:false},busy:false,go(){},notify(){},run:async work=>work(),runBackground:async(_label,work)=>work(),mutate:async()=>{throw Error('Read only')},refresh:async()=>{},startProject(){}};
  return {state,project,other,accounts,scope,context};
}
const render=(component,context,props={})=>renderToStaticMarkup(createElement(Context.Provider,{value:context},createElement(component,props)));

test('sidebar has labelled multi-select controls and a separate primary editor action',()=>{
  const f=fixture(), html=renderToStaticMarkup(createElement(WorkspaceScopePicker,{projects:f.state.projects,accounts:f.accounts,primaryProjectId:f.project.id,scope:f.scope,onChange(){},onEditProject(){},onManage(){}}));
  assert.match(html,/当前编辑项目/); assert.match(html,/编辑项目 批量范围项目乙/);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,6);
  assert.match(html,/<input[^>]*disabled=""[^>]*checked=""/);
  assert.match(html,/勾选可多选/); assert.match(html,/创作账号仍在每篇中确认/);
});

test('persistent summary names both selected projects and accounts without presenting scope as generation identity',()=>{
  const f=fixture(), html=renderToStaticMarkup(createElement(WorkspaceScopeSummary,{projects:f.state.projects,accounts:f.accounts,primaryProjectId:f.project.id,scope:f.scope,onOpen(){}}));
  for(const text of ['当前编辑','主编辑项目甲','批量范围项目乙','甲账号','乙账号','每篇生成独立使用所属项目的资料']) assert(html.includes(text),text);
  assert.doesNotMatch(html,/丙账号/);
});

test('multi-account content lists remain in the primary project and do not include unselected accounts',()=>{
  const f=fixture(), html=render(StudioPage,f.context);
  assert.match(html,/账号1专属草稿/); assert.match(html,/账号2专属草稿/);
  assert.doesNotMatch(html,/账号3专属草稿|其他项目内容不可混入/);
});

test('experience picker renders title, text and native checkbox while hiding other-account material',()=>{
  const f=fixture();
  const entry=createKnowledge(f.state,f.project,{requestId:crypto.randomUUID(),kind:'experience',title:'经验标题可见',text:'先说明真实使用场景，再观察收藏变化。',accountId:f.accounts[0].id});
  createKnowledge(f.state,f.project,{requestId:crypto.randomUUID(),kind:'experience',title:'其他账号经验不得混入',text:'其他身份经验',accountId:f.accounts[2].id});
  const html=render(KnowledgePicker,f.context,{accountId:f.accounts[0].id,selectedIds:[entry.id],onChange(){}});
  assert.match(html,/经验标题可见/); assert.match(html,/先说明真实使用场景/); assert.match(html,/type="checkbox"[^>]*checked=""/);
  assert.doesNotMatch(html,/其他账号经验不得混入/);
});

test('experience library keeps project-shared entries and the selected accounts only',()=>{
  const f=fixture();
  for(const [name,account] of [['共享经验',null],['甲经验',f.accounts[0]],['乙经验',f.accounts[1]],['丙账号隐藏经验',f.accounts[2]]]) createKnowledge(f.state,f.project,{kind:'experience',title:name,text:'真实复盘记录',...(account?{accountId:account.id}:{})});
  const html=render(KnowledgeLibrary,f.context);
  assert.match(html,/共享经验/); assert.match(html,/甲经验/); assert.match(html,/乙经验/); assert.doesNotMatch(html,/丙账号隐藏经验/);
});

test('publish landing exposes the batch entry while keeping current-project content independent',()=>{
  const f=fixture(), html=render(PublishWorkspace,f.context);
  assert.match(html,/多选平台 \/ 批量发布/); assert.match(html,/账号1专属草稿/); assert.match(html,/账号2专属草稿/);
  assert.doesNotMatch(html,/账号3专属草稿|其他项目内容不可混入/);
});

test('batch candidates include selected project/account intersections only and start unconfirmed',()=>{
  const f=fixture();
  for(const project of f.state.projects) for(const asset of project.assets) Object.assign(asset,{status:'ready',body:'已核对正文',mime:'image/png',mediaData:'data:image/png;base64,iVBORw0KGgo='});
  const html=render(BatchPublishDialog,f.context,{onClose(){}});
  assert.match(html,/主编辑项目甲/); assert.match(html,/批量范围项目乙/); assert.match(html,/其他项目内容不可混入/);
  assert.match(html,/账号1专属草稿/); assert.match(html,/账号2专属草稿/); assert.doesNotMatch(html,/账号3专属草稿/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>确认发布所选 0 条<\/button>/);
  const single=render(BatchPublishDialog,{...f.context,scope:{projectIds:[f.project.id],accountIds:[f.accounts[0].id]}},{onClose(){}});
  assert.match(single,/账号1专属草稿/); assert.doesNotMatch(single,/账号2专属草稿|其他项目内容不可混入|批量范围项目乙/);
});

test('layout regression guards exclude native checkbox widths and compact the actual publish empty state',async()=>{
  const editor=await readFile(new URL('../src/content-editor.css',import.meta.url),'utf8');
  const agent=await readFile(new URL('../src/agent-workspace.css',import.meta.url),'utf8');
  const publish=await readFile(new URL('../src/publish-layout.css',import.meta.url),'utf8');
  assert.match(editor,/input:not\(\[type=checkbox\]\):not\(\[type=radio\]\)/);
  assert.match(agent,/knowledge-picker-item > span \{ flex: 1; min-width: 0;/);
  assert.match(publish,/publish-records > \.empty \{[^}]*min-height:0;/);
  assert.match(publish,/workflow-task \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(publish,/@media \(max-width:760px\)/);
});
