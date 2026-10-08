import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, net as electronNet, safeStorage, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { encodeCloudInvite, encodeInvite, isValidSubdomain, parseWorkerAddress, roomIdFromBytes, workerHost } from '../shared/invite';
import { AppConfig, CaptureSource, ConnectivityResult, DEFAULT_PORT, MAX_ROOM_NAME, RoomInfo, SOUND_NAMES } from '../shared/protocol';
import { startAudio, stopAudio } from './audio';
import { deleteWorkerBackup, loadWorkerBackup, saveWorkerBackup, updateWorkerBackupMode } from './worker-backup';
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
const logPath = () => path.join(app.getPath('userData'), 'jaca.log');

/**
 * Appends one line to the log file (jaca.log in the app folder; the previous one is kept as jaca.old.log once it passes 512 KB).
 * It never holds owner keys, room tokens or full invite codes: the person may send this file to get help.
 */
function logEvent(kind: string, text: string): void {
  try {
    const file = logPath();
    try {
      if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, path.join(path.dirname(file), 'jaca.old.log'));
    } catch {
      /* no log yet */
    }
    const oneLine = text.split(/[\r\n]+/).join(' | ').slice(0, 2500);
    fs.appendFileSync(file, `${new Date().toISOString()} v${app.getVersion()} [${kind}] ${oneLine}${os.EOL}`);
  } catch {
    /* logging must never break the app */
  }
}

/** What this PC looks like to the app (no addresses of the PC itself): system, resolver settings, proxy and network adapters. */
async function environmentSnapshot(sampleUrl: string): Promise<string> {
  const parts: string[] = [`windows ${os.release()} ${os.arch()}`, `electron ${process.versions.electron} chromium ${process.versions.chrome}`, `idioma ${app.getLocale()}`];
  try {
    parts.push(`dns-servidores [${dns.getServers().join(', ')}]`);
  } catch {
    /* not available */
  }
  try {
    parts.push(`proxy "${await session.defaultSession.resolveProxy(sampleUrl)}"`);
  } catch {
    /* not available */
  }
  const nics = Object.entries(os.networkInterfaces()).map(([name, list]) => `${name}(${(list ?? []).some((a) => a.family === 'IPv4') ? 'v4' : ''}${(list ?? []).some((a) => a.family === 'IPv6') ? 'v6' : ''})`);
  parts.push(`placas [${nics.join(', ')}]`);
  parts.push(`dns-cloudflare-forcado ${dohForced ? 'sim' : 'nao'}`);
  return parts.join('; ');
}

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

/** Keeps the copy of the Cloudflare connection that survives uninstalling (see worker-backup.ts). Failing to write it never blocks connecting. */
async function keepWorkerBackup(subdomain: string, key: string): Promise<void> {
  try {
    await saveWorkerBackup({ subdomain, key, mode: loadConfig().connectionMode });
  } catch (e: any) {
    logEvent('erro', `não consegui guardar a cópia da conexão Cloudflare: ${e?.message ?? e}`);
  }
}

/** A fresh install (or wiped app data) with a saved copy: the Worker comes back by itself, so nobody has to recreate the owner key. */
async function restoreWorkerBackup(): Promise<void> {
  try {
    const cfg = loadConfig();
    if (cfg.workerSubdomain && cfg.workerOwnerKeyEnc) return;
    if (!safeStorage.isEncryptionAvailable()) return;
    const backup = await loadWorkerBackup();
    if (!backup || !isValidSubdomain(backup.subdomain)) return;
    saveConfig({ workerSubdomain: backup.subdomain, workerOwnerKeyEnc: safeStorage.encryptString(backup.key).toString('base64'), connectionMode: backup.mode });
    logEvent('info', `conexão com o Worker restaurada da cópia guardada (conta ${backup.subdomain}, modo ${backup.mode})`);
  } catch (e: any) {
    logEvent('erro', `não consegui restaurar a cópia da conexão Cloudflare: ${e?.message ?? e}`);
  }
}

let dohForced = false;

/**
 * Some PCs cannot resolve workers.dev inside the app (net::ERR_NAME_NOT_RESOLVED) although the browser can: seen with Radmin VPN, whose virtual
 * adapter lists DNS servers that never answer (fec0:0:0:ffff::1...). When resolving the Worker's name fails, the app asks Cloudflare's DNS over
 * HTTPS instead, reaching it by number (so no DNS is needed to find it), for the rest of the session. PCs where resolving works are left alone.
 */
async function ensureNameResolution(httpBase: string): Promise<void> {
  if (dohForced) return;
  let host = '';
  try {
    host = new URL(httpBase).hostname;
  } catch {
    return;
  }
  if (/^[d.]+$/.test(host) || host === 'localhost') return; // an address, nothing to resolve
  try {
    if (!app.isPackaged && process.env.JACA_FAKE_DNS_FAIL) throw new Error('fake DNS failure (tests only)');
    await Promise.race([session.defaultSession.resolveHost(host), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))]);
  } catch {
    // only switch when Cloudflare's DNS knows the name that this PC could not find (a mistyped account name is unknown to both, and changes nothing)
    try {
      const r = await electronNet.fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
      const answer = ((await r.json()) as { Answer?: Array<{ type: number }> }).Answer;
      if (!answer?.some((a) => a.type === 1)) return;
    } catch {
      return; // Cloudflare's DNS cannot be reached either: nothing better to switch to
    }
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'secure',
      secureDnsServers: ['https://1.1.1.1/dns-query', 'https://1.0.0.1/dns-query', 'https://8.8.8.8/dns-query'],
    });
    dohForced = true;
  }
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
  await ensureNameResolution(httpBase);
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
  await ensureNameResolution(httpBase);
  try {
    const res = await fetch(`${httpBase}/api/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(8000) });
    if (res.status === 403) return { ok: false, message: 'Esse Worker já tem um dono (outra chave). Se foi você que o conectou antes e perdeu a chave, o guia "Recuperar o acesso" (docs/cloudflare-recuperar-acesso.md, no GitHub do app; in English: cloudflare-recover-access.md) explica como definir uma chave nova em poucos passos. Se não foi você, publique o seu próprio Worker.' };
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
    const saved = saveConfig(allowed);
    if (allowed.connectionMode) updateWorkerBackupMode(saved.connectionMode); // the saved copy remembers which mode was in use
    return publicConfig(saved);
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
      await keepWorkerBackup(subdomain, key);
      return { ok: true, message: 'Worker conectado. O app criou a chave do dono e a guardou criptografada neste PC (e numa cópia que sobrevive a desinstalar o app).' };
    }
    if (key.length < 16 || key.length > 200) return { ok: false, message: 'A chave do dono parece incompleta. Cole exatamente o que o comando de publicação mostrou.' };
    const check = await checkWorker(workerBase(subdomain).http, key);
    if (!check.ok) return check;
    saveConfig({ workerSubdomain: subdomain, workerOwnerKeyEnc: safeStorage.encryptString(key).toString('base64') });
    await keepWorkerBackup(subdomain, key);
    return { ok: true, message: 'Worker conectado. A chave foi guardada criptografada neste PC (e numa cópia que sobrevive a desinstalar o app).' };
  });
  // plain HTTPS check of a Worker address (used to explain why a room could not be reached); only valid subdomains, only the health page
  ipcMain.handle('worker:reach', async (_e, subdomain: unknown): Promise<{ ok: boolean; detail: string; nameUnknown: boolean }> => {
    if (typeof subdomain !== 'string' || !isValidSubdomain(subdomain)) return { ok: false, detail: 'endereço inválido', nameUnknown: false };
    const base = workerBase(subdomain).http;
    let host = '';
    try {
      host = new URL(base).hostname;
    } catch {
      /* not a URL */
    }
    // A short report of what each part of this PC can do, shown in the error so a screenshot is enough to find the cause. It runs BEFORE the
    // app switches to Cloudflare's DNS, so it shows the PC as it really is.
    const parts: string[] = [];
    let nameUnknown = false; // Cloudflare's DNS does not know this address at all: the account name in the code is wrong or was cut
    const short =(e: any) => String(e?.code ?? /net::ERR_[A-Z_]+/.exec(String(e?.cause?.message ?? e?.message ?? e))?.[0] ?? e?.message ?? e).slice(0, 60);
    const step = async (name: string, fn: () => Promise<string>): Promise<void> => {
      try {
        const r = await Promise.race([fn(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error('tempo esgotado')), 5000))]);
        parts.push(`${name}=ok${r ? ' ' + r : ''}`);
      } catch (e) {
        parts.push(`${name}=${short(e)}`);
      }
    };
    if (host) {
      await step('dns-windows', async () => `${(await dns.promises.lookup(host, { all: true })).length} ip`);
      await step('dns-app', async () => `${(await session.defaultSession.resolveHost(host)).endpoints.length} ip`);
      await step('doh-1.1.1.1', async () => {
        const r = await electronNet.fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`http ${r.status}`);
        const answer = ((await r.json()) as { Answer?: Array<{ type: number }> }).Answer;
        nameUnknown = !answer?.some((a) => a.type === 1);
        return nameUnknown ? 'nome desconhecido' : 'nome existe';
      });
    }
    await ensureNameResolution(base);
    let ok = false;
    await step('https', async () => {
      const res = await electronNet.fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
      ok = res.ok;
      if (!res.ok) throw new Error(`http ${res.status}`);
      return '';
    });
    if (dohForced) parts.push('DNS da Cloudflare em uso');
    logEvent('rede', `${host || subdomain}: ${ok ? 'alcançável' : 'inalcançável'}; ${parts.join('; ')}; ${await environmentSnapshot(base)}`);
    return { ok, detail: parts.join('; '), nameUnknown };
  });
  // the renderer reports what went wrong (join and room creation errors); only short text, only a few kinds
  ipcMain.handle('log:write', (_e, kind: unknown, text: unknown) => {
    if (typeof kind === 'string' && ['entrar', 'criar', 'rede', 'erro'].includes(kind) && typeof text === 'string') logEvent(kind, text);
  });
  ipcMain.handle('log:open', () => {
    if (!fs.existsSync(logPath())) logEvent('info', 'registro aberto pelo usuário');
    shell.showItemInFolder(logPath());
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
    deleteWorkerBackup(); // "Remover" means forget it for good, including the copy that survives uninstalling
  });
  ipcMain.handle('worker:ws-base', async (_e, subdomain: unknown) => {
    if (typeof subdomain !== 'string' || !isValidSubdomain(subdomain)) return null;
    const base = workerBase(subdomain);
    await ensureNameResolution(base.http); // called right before joining a Cloudflare room
    return base.ws;
  });
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
  // anything that crashes or is thrown and never caught ends up in the log too, so a bug report does not depend on remembering what happened
  process.on('uncaughtException', (e) => logEvent('erro', `exceção não tratada: ${e?.stack ?? e}`));
  process.on('unhandledRejection', (e: any) => logEvent('erro', `promessa rejeitada: ${e?.stack ?? e}`));
  app.on('render-process-gone', (_e, _wc, details) => logEvent('erro', `janela encerrada: ${details.reason} (código ${details.exitCode})`));
  app.on('child-process-gone', (_e, details) => logEvent('erro', `processo ${details.type} encerrado: ${details.reason} (código ${details.exitCode})`));
  app.whenReady().then(async () => {
    logEvent('info', `app aberto (${app.isPackaged ? 'instalado' : 'desenvolvimento'}) em windows ${os.release()} ${os.arch()}, idioma ${app.getLocale()}`);
    await restoreWorkerBackup(); // before the window asks for the config
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
