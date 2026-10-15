const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studioDesktop', {
  documentParserStatus: args => ipcRenderer.invoke('studio:document-parser-status', args),
  configureDocumentParser: args => ipcRenderer.invoke('studio:document-parser-configure', args),
  parseDocument: args => ipcRenderer.invoke('studio:document-parse', args),
  cancelDocumentParse: args => ipcRenderer.invoke('studio:document-parse-cancel', args),
  startExternalMCP: args => ipcRenderer.invoke('studio:mcp-external-start', args),
  stopExternalMCP: args => ipcRenderer.invoke('studio:mcp-external-stop', args),
  getExternalMCPStatus: args => ipcRenderer.invoke('studio:mcp-external-status', args),
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
