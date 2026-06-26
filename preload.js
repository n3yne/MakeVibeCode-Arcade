const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  aiRequest: (payload) => ipcRenderer.invoke('ai-request', payload),
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (data) => ipcRenderer.invoke('settings-set', data),
  convList: () => ipcRenderer.invoke('conv-list'),
  convLoad: (id) => ipcRenderer.invoke('conv-load', id),
  convSave: (conv) => ipcRenderer.invoke('conv-save', conv),
  convDelete: (id) => ipcRenderer.invoke('conv-delete', id),
});
