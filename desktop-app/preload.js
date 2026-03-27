const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  platform: process.platform,
  version: require('./package.json').version,
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (id) => ipcRenderer.invoke('save-session', id),
});
