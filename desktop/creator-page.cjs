// Operates on the visible official editor; submission requires a separate native confirmation.
function creatorPage(platform,action,draft) {
  const host=platform==='xiaohongshu'?'creator.xiaohongshu.com':'creator.douyin.com';
  if(location.protocol!=='https:'||location.hostname!==host)return {error:'请回到对应平台的官方创作中心'};
  const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const all=selector=>[...document.querySelectorAll(selector)];
  const text=el=>(el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||el.getAttribute('aria-label')||'');
  // Douyin's empty editor contains U+200B. Ignore editor sentinel characters
  // when comparing, but preserve the actual supplied text (including emoji ZWJ).
  const comparable=text=>text.replace(/\r\n/g,'\n').replace(/[\u200B\uFEFF]/g,'').trim();
  const value=el=>comparable('value' in el?el.value:el.innerText);
  const blockers=all('[class*="captcha"],[id*="captcha"],[class*="verify-dialog"],[class*="login-modal"]').filter(visible);
  if(blockers.length)return {error:'请先在官方页面完成登录或验证，再继续'};
  const inputs=all('input[type="file"]');
  const image=draft.mime.startsWith('image/');
  const files=inputs.map((el,index)=>({el,index})).filter(({el})=>!el.disabled&&(image?/image|\.png|\.jpg|\.jpeg/i:/video|\.mp4/i).test(el.accept));
  const titles=all('input:not([type="file"]):not([type="password"]):not([type="hidden"]),textarea').filter(el=>visible(el)&&!el.disabled&&!el.readOnly&&/标题/.test(text(el)));
  const bodyInputs=all('textarea,[contenteditable="true"]').filter(el=>visible(el)&&!el.disabled&&!el.readOnly&&!titles.includes(el));
  const marked=bodyInputs.filter(el=>/正文|描述|介绍|文案/.test(text(el))||el.matches('[data-placeholder*="正文"],.ProseMirror,.tiptap,[class*="editor-content"]'));
  const bodies=marked.length?marked:bodyInputs.filter(el=>el.getAttribute('contenteditable')==='true');
  if(action==='probe')return {url:location.href,fileIndex:files.length===1?files[0].index:-1,files:files.length,hasFile:files.length===1&&files[0].el.files.length>0,title:titles.length===1,body:bodies.length===1};
  if(!['fill','ready','submit'].includes(action))return {error:'未知编辑操作'};
  if(titles.length!==1||bodies.length!==1)return {error:'暂未识别到唯一的标题和正文编辑框。请完成上传、打开编辑页面后再试；也可使用上方复制按钮。'};
  const pairs=[[titles[0],draft.title,'标题'],[bodies[0],draft.body,'正文']];
  if(action==='ready'||action==='submit') {
    if(!pairs.every(([el,target])=>value(el)===comparable(target)))return {error:'标题或正文与本次草稿不一致，请核对后重新填写；未提交。'};
    const progress=all('[role="progressbar"],[class*="uploading"],[class*="transcoding"],[class*="upload-progress"]').filter(visible);
    if(progress.some(el=>el.getAttribute('aria-valuenow')!=='100'))return {error:'素材可能仍在上传或转码，请等待完成后再提交。'};
    const buttons=all('button,[role="button"]').filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&/^(发布|立即发布)$/.test((el.innerText||'').trim()));
    if(buttons.length!==1)return {error:'没有找到唯一可用的发布按钮。请检查必填项与素材处理进度，或在官方页面手动操作。'};
    if(action==='submit')buttons[0].click();
    return {url:location.href,ready:true,clicked:action==='submit'};
  }
  for(const [el,target,label] of pairs){
    if(value(el)&&value(el)!==comparable(target))return {error:`${label}中已有其他内容，已保留。请自行核对或清空后再填写。`};
    if('maxLength' in el&&el.maxLength>=0&&target.length>el.maxLength)return {error:`${label}超过平台输入框限制，请返回工作台缩短文案。`};
  }
  for(const [el,target] of pairs){
    if(value(el)===comparable(target))continue;
    el.focus();
    if('value' in el){
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,target);
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    }else{
      const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      // insertText preserves plain text and triggers the platform editor's input handling.
      if(!document.execCommand('insertText',false,target))return {error:'平台编辑器未接受输入，可点击“复制正文”手动粘贴。'};
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }
    el.blur();
  }
  return {url:location.href,filled:pairs.every(([el,target])=>value(el)===comparable(target)),message:'请核对标题、正文、素材、账号及可见范围，再由你决定是否在平台发布。'};
}
module.exports={creatorPage};
