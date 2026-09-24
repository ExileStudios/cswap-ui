// Sandboxed preloads must be CommonJS. Exposes a minimal, fixed API; the page
// never sees ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld(
  'cswapUI',
  Object.freeze({
    getSettings: () => ipcRenderer.invoke('settings:get'),
    refresh: () => ipcRenderer.invoke('usage:refresh'),
    onUsage: subscribe('usage'),
    onSettings: subscribe('settings'),
    toggleSetting: (key) => ipcRenderer.send('settings:toggle', key),
    resize: (height) => ipcRenderer.send('window:resize', height),
    hide: () => ipcRenderer.send('window:hide'),
    openMenu: () => ipcRenderer.send('menu:open'),
    ready: () => ipcRenderer.send('renderer:ready'),
  }),
);
