import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, safeStorage, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { encodeCloudInvite, encodeInvite, isValidSubdomain, parseWorkerAddress, roomIdFromBytes, workerHost } from '../shared/invite';
import { AppConfig, CaptureSource, ConnectivityResult, DEFAULT_PORT, MAX_ROOM_NAME, RoomInfo, SOUND_NAMES } from '../shared/protocol';
import { startAudio, stopAudio } from './audio';
import { checkForUpdates, currentUpdateState, initUpdater, installUpdate } from './updater';
import { detectVpnAddresses, discoverPublicIp, ensureFirewallRule, isPrivateIpv4, localIpv4Addresses, mapPortUpnp, natMappingTest, PortMapping, tcpProbe } from './network';
import { SignalingServer } from './signaling';

const DEFAULT_CONFIG: AppConfig = {
  name: '',
  avatar: null,
  port: DEFAULT_PORT,
  hostAddressOverride: '',
  excludeAudioProcess: 'Discord',
  roomName: '',
  soundVolume: 60,
  disabledSounds: [],
  connectionMode: 'direct',
  workerSubdomain: '',
  workerOwnerKeyEnc: '',
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
    const cfg: AppConfig = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
    // Cloudflare mode only works with the account name and the owner key; without them the mode is Direto
    if (cfg.connectionMode === 'cloudflare' && (!cfg.workerSubdomain || !cfg.workerOwnerKeyEnc)) cfg.connectionMode = 'direct';
    return cfg;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...patch };
  next.name = String(next.name ?? '').slice(0, 24);
  next.roomName = String(next.roomName ?? '').slice(0, MAX_ROOM_NAME);
  const volume = Number(next.soundVolume);
  next.soundVolume = Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 60;
  next.disabledSounds = Array.isArray(next.disabledSounds) ? [...new Set(next.disabledSounds.filter((n) => (SOUND_NAMES as readonly string[]).includes(n)))] : [];
  next.connectionMode = next.connectionMode === 'cloudflare' ? 'cloudflare' : 'direct';
  const subdomain = String(next.workerSubdomain ?? '').trim().toLowerCase();
  next.workerSubdomain = isValidSubdomain(subdomain) ? subdomain : '';
  next.workerOwnerKeyEnc = typeof next.workerOwnerKeyEnc === 'string' ? next.workerOwnerKeyEnc : '';
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

/** Collapses whitespace and limits the length; empty names fall back to "Sala de <host>". */
function cleanRoomName(raw: unknown, hostName: string): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME);
  return name || `Sala de ${hostName}`.slice(0, MAX_ROOM_NAME);
}

// ---------------------------------------------------------------- Cloudflare mode (the room owner's own Worker)

/** What the UI may see of the config: the encrypted owner key is replaced by a flag, so the UI can never read it. */
function publicConfig(cfg: AppConfig): AppConfig {
  return { ...cfg, workerOwnerKeyEnc: cfg.workerOwnerKeyEnc ? 'set' : '' };
}

/** Address of the room server. The real one is derived from the owner's subdomain; development and tests can point it at a local Worker. */
function workerBase(subdomain: string): { http: string; ws: string } {
  const local = !app.isPackaged ? process.env.JACA_WORKER_URL : undefined; // e.g. http://127.0.0.1:8799
  if (local) return { http: local, ws: local.replace(/^http/, 'ws') };
  const host = workerHost(subdomain);
  return { http: `https://${host}`, ws: `wss://${host}` };
}

function readOwnerKey(cfg: AppConfig): string | null {
  if (!cfg.workerOwnerKeyEnc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(cfg.workerOwnerKeyEnc, 'base64'));
  } catch {
    return null;
  }
}

async function checkWorker(httpBase: string, key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${httpBase}/api/check?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, message: 'Worker encontrado e chave correta.' };
    if (res.status === 401) return { ok: false, message: 'A chave do dono não confere com a do Worker.' };
    return { ok: false, message: `O endereço respondeu com erro ${res.status}. Confira o nome da conta e se o Worker foi publicado.` };
  } catch {
    return { ok: false, message: 'Não consegui alcançar o Worker. Confira o nome da conta, a internet e se o Worker foi publicado.' };
  }
}

/** Opened by the "Publicar na minha conta Cloudflare" button: Cloudflare's own page that copies the Worker into the person's account. */
const WORKER_DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/RamonMarcelLopes/JacaAntiJanja/tree/main/worker';

/** Registers a new random owner key on a Worker that has no owner yet (the first one to ask wins). */
async function claimWorker(httpBase: string, key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${httpBase}/api/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(8000) });
    if (res.status === 403) return { ok: false, message: 'Esse Worker já tem um dono (outra chave). Se foi você que o conectou antes, cole a chave do dono; se não, publique o seu próprio Worker.' };
    if (!res.ok) return { ok: false, message: `O endereço respondeu com erro ${res.status}. Confira se ele é mesmo o Worker jaca-sala publicado pelo botão.` };
    const check = await checkWorker(httpBase, key); // an old Worker answers 200 to anything, so confirm that the key really works
    return check.ok ? { ok: true, message: '' } : { ok: false, message: 'Esse endereço não parece ser o Worker do Jaca anti Janja (ou é uma versão antiga). Publique de novo pelo botão.' };
  } catch {
    return { ok: false, message: 'Não consegui alcançar o Worker. Confira o endereço, a internet e se a publicação na Cloudflare terminou.' };
  }
}

async function createCloudRoom(cfg: AppConfig): Promise<RoomInfo> {
  const key = readOwnerKey(cfg);
  if (!cfg.workerSubdomain || !key) throw new Error('Configure o seu Worker em Configurações > Rede (Cloudflare) antes de criar uma sala neste modo.');
  const base = workerBase(cfg.workerSubdomain);
  const check = await checkWorker(base.http, key);
  if (!check.ok) throw new Error(check.message);
  const roomId = roomIdFromBytes(randomBytes(7));
  return {
    code: encodeCloudInvite(roomId, cfg.workerSubdomain),
    ip: workerHost(cfg.workerSubdomain),
    port: 443,
    token: 0,
    upnp: false,
    warnings: [],
    mode: 'cloudflare',
    wsUrl: `${base.ws}/ws/${roomId}?create=1&key=${encodeURIComponent(key)}`,
  };
}

async function createRoom(requestedName: unknown): Promise<RoomInfo> {
  await closeRoom();
  const cfg = loadConfig();
  if (cfg.connectionMode === 'cloudflare') return createCloudRoom(cfg);
  const warnings: string[] = [];
  const srv = new SignalingServer(cfg.port, cleanRoomName(requestedName, cfg.name));
  try {
    await srv.start();
  } catch (e: any) {
    throw new Error(e?.code === 'EADDRINUSE' ? `A porta ${cfg.port} já está em uso.` : `Falha ao iniciar o servidor: ${e?.message ?? e}`);
  }
  server = srv;

  if (app.isPackaged) {
    const fw = await ensureFirewallRule(process.execPath);
    if (fw === 'declined') {
      warnings.push('Sem a permissão no firewall do Windows, os amigos não conseguem entrar. Crie a sala de novo e aceite o aviso de administrador.');
    }
  }

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
  const vpn = detectVpnAddresses();
  if (!cfg.hostAddressOverride.trim() && vpn.length) {
    const v = vpn[0];
    warnings.push(
      `Detectei ${v.name} (${v.ip}). Se seus amigos estão na mesma rede dessa VPN, coloque ${v.ip} em Configurações > Endereço manual e crie a sala de novo. Isso funciona mesmo com CGNAT.`,
    );
  }

  const code = encodeInvite({ ip, port: cfg.port, token: srv.token });
  srv.inviteCode = code; // everyone in the room gets it in the welcome message
  return { code, ip, port: cfg.port, token: srv.token, upnp: !!mapping, warnings, mode: 'direct' };
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

/** Screens come back fast; windows can take a while (one thumbnail each), so the renderer asks for them separately. */
async function listSources(kind?: unknown): Promise<CaptureSource[]> {
  const types: Array<'screen' | 'window'> = kind === 'screens' ? ['screen'] : kind === 'windows' ? ['window'] : ['screen', 'window'];
  const sources = await desktopCapturer.getSources({
    types,
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
  ipcMain.handle('config:get', () => publicConfig(loadConfig()));
  // the Worker address and owner key can only change through worker:save / worker:clear (which check them first)
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => {
    const { workerSubdomain: _s, workerOwnerKeyEnc: _k, ...allowed } = patch ?? {};
    return publicConfig(saveConfig(allowed));
  });
  ipcMain.handle('worker:status', () => {
    const cfg = loadConfig();
    return { configured: !!(cfg.workerSubdomain && cfg.workerOwnerKeyEnc), subdomain: cfg.workerSubdomain };
  });
  ipcMain.handle('worker:save', async (_e, subdomainRaw: unknown, keyRaw: unknown) => {
    const subdomain = parseWorkerAddress(String(subdomainRaw ?? ''));
    let key = String(keyRaw ?? '').trim();
    if (!subdomain) return { ok: false, message: 'O nome da conta só pode ter letras minúsculas, números e hífen (como aparece em seu-nome.workers.dev).' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: 'O Windows não liberou a criptografia para guardar a chave com segurança.' };
    if (!key) {
      // no key pasted: the Worker was published with the button, so this app creates the owner key itself and registers it
      key = randomBytes(24).toString('base64url');
      const claimed = await claimWorker(workerBase(subdomain).http, key);
      if (!claimed.ok) return claimed;
      saveConfig({ workerSubdomain: subdomain, workerOwnerKeyEnc: safeStorage.encryptString(key).toString('base64') });
      return { ok: true, message: 'Worker conectado. O app criou a chave do dono e a guardou criptografada neste PC.' };
    }
    if (key.length < 16 || key.length > 200) return { ok: false, message: 'A chave do dono parece incompleta. Cole exatamente o que o comando de publicação mostrou.' };
    const check = await checkWorker(workerBase(subdomain).http, key);
    if (!check.ok) return check;
    saveConfig({ workerSubdomain: subdomain, workerOwnerKeyEnc: safeStorage.encryptString(key).toString('base64') });
    return { ok: true, message: 'Worker conectado. A chave foi guardada criptografada neste PC.' };
  });
  ipcMain.handle('worker:open-deploy', () => shell.openExternal(WORKER_DEPLOY_URL));
  ipcMain.handle('worker:test', async () => {
    const cfg = loadConfig();
    const key = readOwnerKey(cfg);
    if (!cfg.workerSubdomain || !key) return { ok: false, message: 'Nenhum Worker configurado ainda.' };
    return checkWorker(workerBase(cfg.workerSubdomain).http, key);
  });
  ipcMain.handle('worker:clear', () => {
    saveConfig({ workerSubdomain: '', workerOwnerKeyEnc: '', connectionMode: 'direct' });
  });
  ipcMain.handle('worker:ws-base', (_e, subdomain: unknown) => (typeof subdomain === 'string' && isValidSubdomain(subdomain) ? workerBase(subdomain).ws : null));
  ipcMain.handle('net:detect-vpns', () => {
    const fake = !app.isPackaged ? process.env.JACA_FAKE_VPNS : undefined; // tests only
    if (fake) {
      try {
        return JSON.parse(fake);
      } catch {
        /* fall through to the real detection */
      }
    }
    return detectVpnAddresses();
  });
  ipcMain.handle('net:nat-test', () => natMappingTest());
  ipcMain.handle('room:create', (_e, roomName: string) => createRoom(roomName));
  ipcMain.handle('room:close', () => closeRoom());
  ipcMain.handle('net:test', () => testConnectivity());
  ipcMain.handle('capture:list', (_e, kind?: string) => listSources(kind));
  ipcMain.handle('audio:start', (_e, sourceId: string | null) =>
    startAudio(loadConfig().excludeAudioProcess, typeof sourceId === 'string' ? sourceId : null, (chunk) => win?.webContents.send('audio:data', chunk)),
  );
  ipcMain.handle('audio:stop', () => stopAudio());
  // Copying goes through the main process: the renderer has no browser clipboard permission on purpose.
  ipcMain.handle('clipboard:write', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 200) throw new Error('invalid text');
    clipboard.writeText(text);
  });
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) (w.isMaximized() ? w.unmaximize() : w.maximize());
  });
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('window:is-maximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);
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
    frame: false, // the title bar is drawn by the renderer (see titlebar.ts)
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
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  win.on('closed', () => (win = null));
}

/** Re-reads every stylesheet with a new cache-busting query, so CSS edits show up without reloading the page. */
const CSS_SWAP = `document.querySelectorAll('link[rel=stylesheet]').forEach((l) => { const u = new URL(l.href); u.searchParams.set('v', String(Date.now())); l.href = u.toString(); })`;

/**
 * Dev mode only (pnpm dev, see dev.mjs): reloads the window, or only swaps the CSS, when dev.mjs touches dist/.dev-reload.
 * F12 / Ctrl+Shift+I toggle the DevTools. Never active in the installed app.
 */
function setupDevReload(): void {
  if (!process.env.JACA_DEV || app.isPackaged) return;
  const dir = path.join(__dirname, '..'); // dist/
  const signalName = '.dev-reload';
  let timer: NodeJS.Timeout | undefined;
  let last = '';
  fs.watch(dir, (_event, name) => {
    if (name !== signalName) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      let content = '';
      try {
        content = fs.readFileSync(path.join(dir, signalName), 'utf8');
      } catch {
        return;
      }
      if (content === last) return;
      last = content;
      if (content.startsWith('css')) void win?.webContents.executeJavaScript(CSS_SWAP);
      else win?.webContents.reloadIgnoringCache();
    }, 60);
  });
  win?.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win?.webContents.toggleDevTools();
    }
  });
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
    setupDevReload();
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
