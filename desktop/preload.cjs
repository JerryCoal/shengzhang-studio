const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studioDesktop', {
  openDouyinAuthorization: url => ipcRenderer.invoke('studio:douyin-authorize', url),
  cancelDouyinAuthorization: () => ipcRenderer.invoke('studio:douyin-cancel'),
});
