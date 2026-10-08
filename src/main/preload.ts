import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jaca', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: unknown) => ipcRenderer.invoke('config:set', patch),
  createRoom: (roomName: string) => ipcRenderer.invoke('room:create', roomName),
  closeRoom: () => ipcRenderer.invoke('room:close'),
  testConnectivity: () => ipcRenderer.invoke('net:test'),
  detectVpns: () => ipcRenderer.invoke('net:detect-vpns'),
  natTest: () => ipcRenderer.invoke('net:nat-test'),
  workerStatus: () => ipcRenderer.invoke('worker:status'),
  saveWorker: (subdomain: string, key: string) => ipcRenderer.invoke('worker:save', subdomain, key),
  testWorker: () => ipcRenderer.invoke('worker:test'),
  workerReachable: (subdomain: string) => ipcRenderer.invoke('worker:reach', subdomain),
  log: (kind: string, text: string) => ipcRenderer.invoke('log:write', kind, text),
  openLogFolder: () => ipcRenderer.invoke('log:open'),
  openWorkerDeploy: () => ipcRenderer.invoke('worker:open-deploy'),
  clearWorker: () => ipcRenderer.invoke('worker:clear'),
  workerWsBase: (subdomain: string) => ipcRenderer.invoke('worker:ws-base', subdomain),
  listSources: (kind?: 'screens' | 'windows') => ipcRenderer.invoke('capture:list', kind),
  startAudio: (sourceId: string | null) => ipcRenderer.invoke('audio:start', sourceId),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
  onAudioData: (cb: (chunk: Uint8Array) => void) => {
    ipcRenderer.removeAllListeners('audio:data');
    ipcRenderer.on('audio:data', (_e, chunk) => cb(chunk));
  },
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (cb: (maximized: boolean) => void) => {
    ipcRenderer.removeAllListeners('window:maximized');
    ipcRenderer.on('window:maximized', (_e, maximized) => cb(maximized));
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
