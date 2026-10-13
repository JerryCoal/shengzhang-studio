const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('creatorDraft',{
  command:action=>ipcRenderer.invoke('studio:creator-toolbar',{action}),
  onProgress:callback=>ipcRenderer.on('studio:creator-progress',(_event,state)=>callback(state)),
});
