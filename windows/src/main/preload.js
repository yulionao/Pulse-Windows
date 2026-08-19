const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageBoard', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshAll: () => ipcRenderer.invoke('refresh:all'),
  refreshPlugin: (stateID) => ipcRenderer.invoke('refresh:plugin', stateID),
  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),
  updatePlugin: (stateID, patch) => ipcRenderer.invoke('plugin:update', stateID, patch),
  getPythonInfo: () => ipcRenderer.invoke('python:info'),
  startCodexLogin: () => ipcRenderer.invoke('codex:login'),
  cancelCodexLogin: () => ipcRenderer.invoke('codex:cancel-login'),
  getCodexLoginStatus: () => ipcRenderer.invoke('codex:login-status'),
  startClaudeLogin: () => ipcRenderer.invoke('claude:login'),
  cancelClaudeLogin: () => ipcRenderer.invoke('claude:cancel-login'),
  getClaudeLoginStatus: () => ipcRenderer.invoke('claude:login-status'),
  setView: (view) => ipcRenderer.invoke('view:set', view),
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('view:changed', listener);
    return () => ipcRenderer.removeListener('view:changed', listener);
  },
  onCodexLogin: (callback) => {
    const listener = (_event, loginState) => callback(loginState);
    ipcRenderer.on('codex:login-changed', listener);
    return () => ipcRenderer.removeListener('codex:login-changed', listener);
  },
  onClaudeLogin: (callback) => {
    const listener = (_event, loginState) => callback(loginState);
    ipcRenderer.on('claude:login-changed', listener);
    return () => ipcRenderer.removeListener('claude:login-changed', listener);
  }
});
