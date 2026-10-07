import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jaca', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: unknown) => ipcRenderer.invoke('config:set', patch),
  createRoom: () => ipcRenderer.invoke('room:create'),
  closeRoom: () => ipcRenderer.invoke('room:close'),
  testConnectivity: () => ipcRenderer.invoke('net:test'),
  listSources: () => ipcRenderer.invoke('capture:list'),
  startAudio: (sourceId: string | null) => ipcRenderer.invoke('audio:start', sourceId),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
  onAudioData: (cb: (chunk: Uint8Array) => void) => {
    ipcRenderer.removeAllListeners('audio:data');
    ipcRenderer.on('audio:data', (_e, chunk) => cb(chunk));
  },
  getVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb: (state: unknown) => void) => {
    ipcRenderer.removeAllListeners('update:state');
    ipcRenderer.on('update:state', (_e, state) => cb(state));
  },
  selectSource: (id: string) => ipcRenderer.invoke('capture:select', id),
});
