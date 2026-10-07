import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { encodeInvite } from '../shared/invite';
import { AppConfig, CaptureSource, ConnectivityResult, DEFAULT_PORT, RoomInfo } from '../shared/protocol';
import { startAudio, stopAudio } from './audio';
import { checkForUpdates, currentUpdateState, initUpdater, installUpdate } from './updater';
import { discoverPublicIp, isPrivateIpv4, localIpv4Addresses, mapPortUpnp, PortMapping, tcpProbe } from './network';
import { SignalingServer } from './signaling';

const DEFAULT_CONFIG: AppConfig = {
  name: '',
  avatar: null,
  port: DEFAULT_PORT,
  hostAddressOverride: '',
  excludeAudioProcess: 'Discord',
  codec: 'auto',
  resolution: '1080p',
  fps: 30,
  mode: 'motion',
};

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'display-capture']);

let win: BrowserWindow | null = null;
let server: SignalingServer | null = null;
let mapping: PortMapping | null = null;
let selectedSourceId: string | null = null;

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig(): AppConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...patch };
  next.name = String(next.name ?? '').slice(0, 24);
  const port = Number(next.port);
  next.port = Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

async function closeRoom(): Promise<void> {
  stopAudio();
  server?.stop();
  server = null;
  await mapping?.remove();
  mapping = null;
}

async function createRoom(): Promise<RoomInfo> {
  await closeRoom();
  const cfg = loadConfig();
  const warnings: string[] = [];
  const srv = new SignalingServer(cfg.port);
  try {
    await srv.start();
  } catch (e: any) {
    throw new Error(e?.code === 'EADDRINUSE' ? `A porta ${cfg.port} já está em uso.` : `Falha ao iniciar o servidor: ${e?.message ?? e}`);
  }
  server = srv;

  mapping = await mapPortUpnp(cfg.port);
  if (!mapping) warnings.push('UPnP indisponível: libere a porta no roteador manualmente (port forwarding) ou use uma VPN mesh.');

  let ip = cfg.hostAddressOverride.trim();
  if (ip && !net.isIPv4(ip)) {
    warnings.push('O endereço manual nas configurações não é um IPv4 válido; ignorado.');
    ip = '';
  }
  if (!ip) {
    const found = await discoverPublicIp();
    if (found) ip = found;
    else {
      ip = localIpv4Addresses()[0] ?? '127.0.0.1';
      warnings.push('Não foi possível descobrir o IP público via STUN. O código usa o IP da rede local.');
    }
  }
  if (isPrivateIpv4(ip)) warnings.push('O IP do convite é privado: só funciona na mesma rede ou numa VPN mesh.');

  return { code: encodeInvite({ ip, port: cfg.port, token: srv.token }), ip, port: cfg.port, token: srv.token, upnp: !!mapping, warnings };
}

async function testConnectivity(): Promise<ConnectivityResult> {
  const cfg = loadConfig();
  const publicIp = cfg.hostAddressOverride.trim() || (await discoverPublicIp());
  if (!publicIp) return { ok: false, publicIp: null, message: 'Sem acesso à internet ou STUN bloqueado: não foi possível descobrir o IP público.' };

  let temp: net.Server | null = null;
  if (!server) {
    temp = net.createServer((s) => s.destroy());
    const listening = await new Promise<boolean>((resolve) => {
      temp!.once('error', () => resolve(false));
      temp!.listen(cfg.port, '0.0.0.0', () => resolve(true));
    });
    if (!listening) return { ok: false, publicIp, message: `A porta ${cfg.port} está em uso por outro programa.` };
  }
  const tempMap = server ? null : await mapPortUpnp(cfg.port);
  const reachable = await tcpProbe(publicIp, cfg.port);
  await tempMap?.remove();
  temp?.close();

  return reachable
    ? { ok: true, publicIp, message: `Porta ${cfg.port} acessível em ${publicIp}. Tudo certo.` }
    : {
        ok: false,
        publicIp,
        message: `Não foi possível alcançar ${publicIp}:${cfg.port}. Possíveis causas: CGNAT do provedor, firewall do Windows, roteador sem port forwarding/UPnP (ou sem suporte a hairpin NAT neste teste). Alternativas: IPv6 ou uma VPN mesh (Tailscale, ZeroTier, Radmin) e o IP da VPN no campo de endereço manual.`,
      };
}

async function listSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    isScreen: s.id.startsWith('screen:'),
  }));
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => saveConfig(patch));
  ipcMain.handle('room:create', () => createRoom());
  ipcMain.handle('room:close', () => closeRoom());
  ipcMain.handle('net:test', () => testConnectivity());
  ipcMain.handle('capture:list', () => listSources());
  ipcMain.handle('audio:start', (_e, sourceId: string | null) =>
    startAudio(loadConfig().excludeAudioProcess, typeof sourceId === 'string' ? sourceId : null, (chunk) => win?.webContents.send('audio:data', chunk)),
  );
  ipcMain.handle('audio:stop', () => stopAudio());
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:state', () => currentUpdateState());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('capture:select', (_e, id: string) => {
    selectedSourceId = typeof id === 'string' ? id : null;
  });
}

function setupSession(): void {
  // The app never asks for the microphone or camera; only fullscreen and screen capture are allowed.
  // Screen capture arrives as a 'media' request with no media types; real microphone/camera
  // requests list 'audio'/'video' and are denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    cb(ALLOWED_PERMISSIONS.has(permission) || (permission === 'media' && types.length === 0));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  session.defaultSession.setDisplayMediaRequestHandler(async (req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === selectedSourceId) ?? sources.find((s) => s.id.startsWith('screen:'));
      selectedSourceId = null;
      if (!source) return callback({});
      // 'loopback' captures the system audio on Windows.
      callback(req.audioRequested ? { video: source, audio: 'loopback' } : { video: source });
    } catch {
      callback({});
    }
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#14161a',
    title: 'Jaca anti Janja',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    registerIpc();
    setupSession();
    createWindow();
    initUpdater(() => win);
  });
  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    closeRoom().finally(() => app.quit());
  });
}
