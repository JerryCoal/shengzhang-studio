const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('commentCapture', {
  command: (action, options) => ipcRenderer.invoke('studio:comment-toolbar', { action, options }),
  onProgress: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on('studio:comment-progress', handler); return () => ipcRenderer.removeListener('studio:comment-progress', handler); },
});
