import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { createIntegrationPreferences } from '../server/integrations.mjs';
import { createModelStore } from '../server/models.mjs';

function vault() { let key = ''; return { status: () => ({ supported:true, configured:!!key, suffix:key.slice(-4) }), getKey: async () => key, save: async v => { key=v; }, remove: () => { key=''; } }; }
async function fixture(t, overrides = {}) {
  const store=createStore(':memory:'), redfoxVault=vault(), integrationPreferences=createIntegrationPreferences(); let calls=0;
  const app=createApp(store,{ profileMode:true, redfoxVault, integrationPreferences, modelStore:createModelStore(), redfoxFetcher:async()=>{calls++;throw Error('No external calls expected');},...overrides });
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await app.locals.integrations.close(); await new Promise(r=>server.close(r));store.close();});
  const req=async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'X-Studio-Client':'studio-v1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
  return {req,store,redfoxVault,integrationPreferences,calls:()=>calls};
}
test('saving Redfox key leaves routes off until explicitly selected and keeps old provider settings',async t=>{
  const f=await fixture(t), original=f.integrationPreferences.get();
  const saved=await f.req('/integrations/redfox','PUT',{apiKey:'synthetic-redfox-never-real'});assert.equal(saved.status,200,JSON.stringify(saved));
  assert(saved.data.redfox.configured);assert(!saved.data.redfox.enabled&&!saved.data.redfox.mediaEnabled&&!saved.data.redfox.searchEnabled);assert.equal(saved.data.redfox.verifiedAt,null);assert.equal(f.calls(),0);
  assert.deepEqual(f.integrationPreferences.get().seedance,original.seedance);assert.deepEqual(f.integrationPreferences.get().seedream,original.seedream);
  assert.equal((await f.req('/research/settings')).data.search.provider,'none');
  const enabled=await f.req('/integrations/redfox','PUT',{searchEnabled:true});assert(enabled.data.redfox.searchEnabled);assert.equal(enabled.data.redfox.mediaEnabled,false);assert.equal(enabled.data.redfox.enabled,false);assert.equal((await f.req('/research/settings')).data.search.provider,'redfox');assert.equal(f.calls(),0);
  const replaced=await f.req('/integrations/redfox','PUT',{apiKey:'synthetic-redfox-replacement'});assert(replaced.data.redfox.searchEnabled);assert.equal(replaced.data.redfox.mediaEnabled,false);assert.equal(replaced.data.redfox.enabled,false);
  for(const path of ['/integrations','/state','/backup'])assert(!JSON.stringify((await f.req(path)).data).includes('synthetic-redfox-never-real'));
  const off=await f.req('/integrations/redfox','PUT',{enabled:false,mediaEnabled:false,searchEnabled:false});assert(off.data.redfox.configured);assert.equal((await f.req('/research/settings')).data.search.provider,'none');
  await f.req('/integrations/redfox','DELETE');assert.equal(await f.redfoxVault.getKey(),'');assert.equal(f.calls(),0);
});
test('Redfox configuration denies remote credential access and malformed keys before any paid operation',async t=>{
  const f=await fixture(t,{authorizeCredentials:()=>false});
  assert.equal((await f.req('/integrations/redfox','PUT',{apiKey:'synthetic-key'})).status,403);
  assert.equal((await f.req('/integrations')).data.redfox.supported,false);assert.equal(f.calls(),0);
});
test('an unfinished provider task pins the existing Redfox credential even after the request has ended',async t=>{
  const f=await fixture(t);await f.req('/integrations/redfox','PUT',{apiKey:'synthetic-original-key'});
  f.store.mutate(state=>{state.projects[0].redfoxWebSearch={id:'job',taskId:'provider-task',status:'pending'};});
  assert.equal((await f.req('/integrations/redfox','PUT',{apiKey:'synthetic-replacement-key'})).status,409);
  assert.equal((await f.req('/integrations/redfox','DELETE')).status,409);assert.equal(await f.redfoxVault.getKey(),'synthetic-original-key');assert.equal(f.calls(),0);
});
