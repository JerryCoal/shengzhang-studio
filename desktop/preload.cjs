const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studioDesktop', {
  startExternalMCP: args => ipcRenderer.invoke('studio:mcp-external-start', args),
  stopExternalMCP: args => ipcRenderer.invoke('studio:mcp-external-stop', args),
  restartMCP: () => ipcRenderer.invoke('studio:mcp-restart'),
  openPlatformLogin: args => ipcRenderer.invoke('studio:platform-login', args),
  resetPlatformConnections: () => ipcRenderer.invoke('studio:platform-lock'),
  openDouyinAuthorization: url => ipcRenderer.invoke('studio:douyin-authorize', url),
  cancelDouyinAuthorization: () => ipcRenderer.invoke('studio:douyin-cancel'),
  openCommentCapture: url => ipcRenderer.invoke('studio:comments-open', url),
  cancelCommentCapture: () => ipcRenderer.invoke('studio:comments-cancel'),
  openCreatorDraft: draft => ipcRenderer.invoke('studio:creator-open', draft),
  cancelCreatorDraft: () => ipcRenderer.invoke('studio:creator-cancel'),
});
