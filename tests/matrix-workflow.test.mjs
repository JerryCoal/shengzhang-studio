import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState,newProject,makeDraft,confirmStrategy,addAccount,confirmPublication} from '../server/domain.mjs';
import {PLATFORM_IDS,PLATFORM_NAMES,PLATFORM_WORK} from '../server/platform-catalog.mjs';
import {exportDetails,contentArchive} from '../server/content-export.mjs';
import {commentSource,sameCommentWork} from '../desktop/comment-source.mjs';
import {previewCreativeSkill} from '../server/creative-skills.mjs';
test('five-channel strategy creates distinct frozen tasks, preserving established channel IDs',()=>{
  const state=seedState(),project=newProject({...state.projects[0].brief,channels:[...PLATFORM_IDS]});
  const strategy=makeDraft(project);confirmStrategy(project,strategy.id);confirmStrategy(project,strategy.id);
  assert.equal(project.assets.length,5);assert.equal(new Set(project.assets.map(a=>a.key)).size,5);
  for(const asset of project.assets){assert.equal(asset.key,PLATFORM_WORK[asset.channel].key);assert(asset.prompt.includes(PLATFORM_NAMES[asset.channel]));if(asset.channel!=='xiaohongshu')assert.equal(asset.kind,'video');}
  assert.throws(()=>newProject({...project.brief,channels:['youtube','youtube']}));
});
test('all matrix channels support manual account, export naming and user-selected writing rules',async()=>{
  const state=seedState();
  for(const platform of PLATFORM_IDS){
    const account=addAccount(state,{platform,name:'fixture-'+platform});assert.equal(account.platform,platform);assert.equal(account.autoPublish,false);assert.throws(()=>addAccount(state,{platform,name:account.name}));
    const mediaData='data:image/png;base64,'+readFileSync('public/icon-192.png').toString('base64');
    const content={channel:platform,status:'ready',title:'合成标题',body:'已核对内容',revision:1,mime:'image/png',mediaData};
    assert(exportDetails(content).filename.includes(PLATFORM_NAMES[platform]));assert((await contentArchive(content)).data.length>0);
    const preview=previewCreativeSkill({fileName:'SKILL.md',text:`---\nname: fixture\ndescription: 用于平台表达\nversion: 1.0.0\nplatforms: [${platform}]\nstages: [copy]\n---\n只使用核实事实，不改产品条件。`});assert.deepEqual(preview.platforms,[platform]);
  }
});
test('overseas canonical links stay platform-specific and invalid manual links return input errors',()=>{
  const pairs=[['youtube','https://youtu.be/AbcdefGh_12','https://www.youtube.com/shorts/AbcdefGh_12'],['instagram','https://www.instagram.com/reel/ABCde12/','https://www.instagram.com/p/ABCde12/'],['tiktok','https://www.tiktok.com/@brand/video/7412345678901234567','https://www.tiktok.com/@brand/video/7412345678901234567?lang=en']];
  for(const [platform,a,b]of pairs){const one=commentSource(a),two=commentSource(b);assert.equal(one.platform,platform);assert(sameCommentWork(one,two));const project={revision:1,publications:[{id:'p',platform,status:'scheduled'}]};confirmPublication(project,'p',{url:b,confirmed:true});assert.equal(project.publications[0].status,'published');assert.throws(()=>confirmPublication(project,'p',{url:'https://attacker.example/video/123',confirmed:true}),error=>error.status===400);}
  for(const link of ['https://www.youtube.com.evil.example/watch?v=AbcdefGh_12','https://www.youtube.com/watch?v=AbcdefGh_12&v=Another0001','https://www.instagram.com/accounts/login/','https://www.tiktok.com/@brand'])assert.throws(()=>commentSource(link));
});
