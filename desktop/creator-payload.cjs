const { randomUUID }=require('node:crypto');
const { join }=require('node:path');
const { mkdir,writeFile,rm }=require('node:fs/promises');
const CREATORS={douyin:'https://creator.douyin.com/',xiaohongshu:'https://creator.xiaohongshu.com/'};
function creatorAllowed(value,platform) {
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname===new URL(CREATORS[platform]).hostname;}catch{return false;}
}
function validateDraft(value) {
  if(!value||!Object.hasOwn(CREATORS,value.platform))throw Error('请选择抖音或小红书');
  const limits={title:20,body:1000};
  if(typeof value.title!=='string'||!value.title.trim()||[...value.title].length>limits.title)throw Error(`请先将标题调整至 ${limits.title} 字以内`);
  if(typeof value.body!=='string'||[...value.body].length>limits.body)throw Error(`请先将正文调整至 ${limits.body} 字以内`);
  const types={'image/png':'png','image/jpeg':'jpg','video/mp4':'mp4'};
  if(!Object.hasOwn(types,value.mime))throw Error('请使用 PNG / JPG 图片或 MP4 视频；其他格式可先通过导出转换');
  if(typeof value.mediaData!=='string'||value.mediaData.length>180_000_000)throw Error('请选择 128MB 以内的素材');
  const prefix=`data:${value.mime};base64,`;
  if(!value.mediaData.startsWith(prefix)||value.mediaData.slice(prefix.length).length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.mediaData.slice(prefix.length)))throw Error('素材编码不正确，请重新生成或导入');
  const bytes=Buffer.from(value.mediaData.slice(prefix.length),'base64');
  if(value.platform==='xiaohongshu'&&value.mime.startsWith('image/')&&bytes.length>32*1024*1024)throw Error('小红书单张图片需在 32MB 以内，请压缩后重试');
  if(value.platform==='douyin'&&value.mime.startsWith('image/')&&bytes.length>50*1024*1024)throw Error('抖音单张图片需在 50MB 以内，请压缩后重试');
  const valid=value.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):value.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.length>12&&bytes.toString('ascii',4,8)==='ftyp';
  if(!valid||bytes.length>128*1024*1024)throw Error('素材格式与文件内容不一致，或超出 128MB');
  return {platform:value.platform,title:value.title.trim(),body:value.body,mime:value.mime,extension:types[value.mime],bytes};
}
async function stageDraft(value,tempRoot) {
  const draft=validateDraft(value),directory=join(tempRoot,'studio-draft-'+randomUUID());
  await mkdir(directory,{recursive:true});
  const file=join(directory,'素材.'+draft.extension);
  try{await writeFile(file,draft.bytes,{flag:'wx'});}catch(e){await rm(directory,{recursive:true,force:true});throw e;}
  const {bytes,...safe}=draft;
  return {...safe,file,dispose:()=>rm(directory,{recursive:true,force:true})};
}
module.exports={CREATORS,creatorAllowed,validateDraft,stageDraft};
