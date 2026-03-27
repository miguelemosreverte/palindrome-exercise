const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

function readSession() {
  var locations = [
    path.join(process.env.HOME || '', '.bridge', 'session'),
    path.join(process.env.HOME || '', '.bridge-session'),
  ];
  for (var i = 0; i < locations.length; i++) {
    try {
      var s = fs.readFileSync(locations[i], 'utf8').trim();
      if (s) return s;
    } catch (e) {}
  }
  return null;
}

contextBridge.exposeInMainWorld('bridge', {
  platform: process.platform,
  version: require('./package.json').version,
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  readSession: readSession,
});
