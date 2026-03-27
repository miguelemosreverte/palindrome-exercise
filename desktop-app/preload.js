const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  platform: process.platform,
  version: require('./package.json').version,
});
