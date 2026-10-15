import {useState} from 'react';
import {useStudio} from '../context';
import {Field,Modal} from '../components';
import {PLATFORM_IDS,PLATFORM_NAMES} from '../../server/platform-catalog.mjs';
import type {Platform} from '../types';
export function ManualAccountCreator(){
  const {mutate,run,busy,notify}=useStudio();
  const [open,setOpen]=useState(false),[platform,setPlatform]=useState<Platform>('xiaohongshu'),[name,setName]=useState('');
  return <><button className="button small" onClick={()=>setOpen(true)}>添加发布账号标识</button>{open&&<Modal title="添加发布账号标识" description="用于计划、导出、评论与数据归属。此操作不登录平台；MCP 连接账号可在下方独立设置。" onClose={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();void run(async()=>{await mutate('/accounts','POST',{platform,name:name.trim()});setOpen(false);setName('');notify('发布账号标识已保存');});}}><Field label="平台"><select value={platform} onChange={e=>setPlatform(e.target.value as Platform)}>{PLATFORM_IDS.map(id=><option value={id} key={id}>{PLATFORM_NAMES[id]}</option>)}</select></Field><Field label="账号名称"><input required value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="例如：Wereus 海外官方号"/></Field><div className="modal-actions"><button className="button" type="button" onClick={()=>setOpen(false)}>取消</button><button className="button primary" disabled={busy||!name.trim()}>保存</button></div></form></Modal>}</>;
}
