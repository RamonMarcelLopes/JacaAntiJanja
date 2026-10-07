import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UpdateState } from '../shared/protocol';

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
  try {
    const result = await autoUpdater.checkForUpdates();
    // The 'update-available' / 'update-not-available' events set the final state.
    if (!result) setState({ status: 'none' });
  } catch (e: any) {
    setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] });
  }
  return state;
}

/** Downloads the pending update and restarts into the installer once it is ready. */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'available') return;
  installRequested = true;
  setState({ ...state, status: 'downloading', percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (e: any) {
    installRequested = false;
    setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] });
  }
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => setState({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => setState({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', version: state.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => {
    setState({ status: 'ready', version: state.version });
    if (installRequested) autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', (e) => setState({ status: 'error', message: String(e?.message ?? e).split('\n')[0] }));

  if (app.isPackaged) {
    setTimeout(() => void checkForUpdates(), 8000);
    setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
  }
}
