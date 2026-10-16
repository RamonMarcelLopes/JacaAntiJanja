import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UpdateState } from '../shared/protocol';

/** The update flow writes its own lines to the same jaca.log as the rest of the app (file only, never shown on screen). */
function ulog(text: string): void {
  try {
    const file = path.join(app.getPath('userData'), 'jaca.log');
    fs.appendFileSync(file, `${new Date().toISOString()} v${app.getVersion()} [atualizacao] ${text.split(/[\r\n]+/).join(' | ').slice(0, 2500)}${os.EOL}`);
  } catch {
    /* logging must never break the app */
  }
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { status: 'idle' };
let getWindow: () => BrowserWindow | null = () => null;
let installRequested = false;

function setState(next: UpdateState): void {
  state = next;
  getWindow()?.webContents.send('update:state', state);
}

export function currentUpdateState(): UpdateState {
  return state;
}

/** Looks for a newer GitHub release. Only works in the installed app, never in dev or a loose exe. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({ status: 'disabled', message: 'Atualizações só funcionam no app instalado.' });
    return state;
  }
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return state;
  setState({ status: 'checking' });
  const t0 = Date.now();
  ulog(`procurando atualização (versão instalada ${app.getVersion()}, canal ${autoUpdater.channel ?? 'padrão'}, versões de teste ${autoUpdater.allowPrerelease ? 'aceitas' : 'ignoradas'})`);
  try {
    const result = await autoUpdater.checkForUpdates();
    // The 'update-available' / 'update-not-available' events set the final state.
    ulog(`resposta da procura em ${Date.now() - t0} ms: ${result ? `versão mais nova publicada ${result.updateInfo?.version}, lançada em ${result.updateInfo?.releaseDate}; arquivo ${result.updateInfo?.files?.[0]?.url ?? result.updateInfo?.path}, ${result.updateInfo?.files?.[0]?.size ?? '?'} bytes` : 'nenhuma informação devolvida'}`);
    if (!result) setState({ status: 'none' });
  } catch (e: any) {
    // the whole error as it came (GitHub status, feed address, stack), not only the first line the person sees
    ulog(`a procura FALHOU depois de ${Date.now() - t0} ms: ${e?.name ?? 'Erro'}${e?.code ? ' [' + e.code + ']' : ''}: ${e?.message ?? e} | ${String(e?.stack ?? '').split('\n').slice(1, 4).join(' | ')}`);
    setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] });
  }
  return state;
}

/** Downloads the pending update and restarts into the installer once it is ready. */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'available') return;
  installRequested = true;
  ulog(`a pessoa apertou para atualizar: baixando a versão ${state.version}`);
  setState({ ...state, status: 'downloading', percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (e: any) {
    installRequested = false;
    ulog(`o download FALHOU: ${e?.name ?? 'Erro'}${e?.code ? ' [' + e.code + ']' : ''}: ${e?.message ?? e} | ${String(e?.stack ?? '').split('\n').slice(1, 4).join(' | ')}`);
    setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] });
  }
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  // Nothing is downloaded or installed by itself: it only happens when the person presses the update button.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Always follow the latest.yml of the newest published release. Without this, a build whose version has a suffix (a test Setup such as 0.1.18-1)
  // looks at another feed and fails with "No published versions on GitHub".
  autoUpdater.allowPrerelease = false;
  autoUpdater.channel = 'latest';
  autoUpdater.logger = null;

  let lastLoggedPercent = -1;
  autoUpdater.on('checking-for-update', () => ulog('conferindo o feed de versões da GitHub'));
  autoUpdater.on('update-available', (info) => {
    ulog(`há atualização: ${info.version} (instalada ${app.getVersion()})`);
    setState({ status: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    ulog(`nenhuma atualização: a mais nova publicada é ${info?.version ?? '?'} e a instalada é ${app.getVersion()}`);
    setState({ status: 'none' });
  });
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent);
    if (pct >= lastLoggedPercent + 10 || pct === 100) {
      lastLoggedPercent = pct;
      ulog(`baixando: ${pct}% (${Math.round(p.transferred / 1048576)} de ${Math.round(p.total / 1048576)} MB, ${Math.round(p.bytesPerSecond / 1024)} KB/s)`);
    }
    setState({ status: 'downloading', version: state.version, percent: pct });
  });
  autoUpdater.on('update-downloaded', (info) => {
    ulog(`download terminado (versão ${info.version}); ${installRequested ? 'fechando o app para instalar' : 'aguardando'}`);
    setState({ status: 'ready', version: state.version });
    if (installRequested) autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', (e) => {
    ulog(`erro do atualizador: ${(e as any)?.name ?? 'Erro'}: ${e?.message ?? e}`);
    setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] });
  });

  if (app.isPackaged) {
    setTimeout(() => void checkForUpdates(), 8000);
    setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
  }
}
