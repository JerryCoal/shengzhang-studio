const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studioDesktop', {
  resetPlatformConnections: () => ipcRenderer.invoke('studio:platform-lock'),
  openDouyinAuthorization: url => ipcRenderer.invoke('studio:douyin-authorize', url),
  cancelDouyinAuthorization: () => ipcRenderer.invoke('studio:douyin-cancel'),
  openCommentCapture: url => ipcRenderer.invoke('studio:comments-open', url),
  cancelCommentCapture: () => ipcRenderer.invoke('studio:comments-cancel'),
  openCreatorDraft: draft => ipcRenderer.invoke('studio:creator-open', draft),
  cancelCreatorDraft: () => ipcRenderer.invoke('studio:creator-cancel'),
});
