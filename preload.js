const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveBreakdown: (content) => ipcRenderer.invoke('save-breakdown', content),
});
