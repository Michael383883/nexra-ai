const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('nexra', {
  version: '0.1.0',
  platform: process.platform
});
