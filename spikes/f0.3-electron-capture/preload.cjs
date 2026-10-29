// Bridge mínima: expõe somente os canais da PoC; nenhum objeto Electron/Node vaza ao renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poc', {
  plan: () => ipcRenderer.invoke('poc:plan'),
  grant: (sourceId, audio) => ipcRenderer.invoke('poc:grant', { sourceId, audio }),
  result: (test) => ipcRenderer.invoke('poc:result', test),
  externalTone: (hz) => ipcRenderer.invoke('poc:externalTone', hz),
  closeTarget: () => ipcRenderer.invoke('poc:closeTarget'),
  done: () => ipcRenderer.invoke('poc:done'),
});
