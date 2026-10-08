import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The Cloudflare connection (account name + owner key) is hard to recreate: the owner key can only be registered once per Worker, and a lost key
// means adding a secret by hand in the Cloudflare dashboard. So a copy is kept OUTSIDE the app's data folder, which the uninstaller deletes.
// The key in that copy is protected by Windows itself (DPAPI, tied to this Windows user), not by Electron's safeStorage: safeStorage keeps its
// master key inside the app's data folder, so a copy protected that way could not be read again after a reinstall.

export interface WorkerBackup {
  subdomain: string;
  key: string;
  mode: 'direct' | 'cloudflare';
}

/** Installed app: %LOCALAPPDATA%\JacaAntiJanja-Backup. Development and tests never touch it (a folder of their own, or JACA_BACKUP_DIR). */
export function backupDir(): string {
  if (!app.isPackaged) return process.env.JACA_BACKUP_DIR || path.join(app.getPath('userData'), 'backup-dev');
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'JacaAntiJanja-Backup');
}

const backupFile = () => path.join(backupDir(), 'cloudflare.json');

const PROTECT = "Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in), $null, 'CurrentUser'))";
const UNPROTECT = "Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd().Trim(); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $null, 'CurrentUser'))";

/** Runs a short PowerShell script with the text on stdin (never on the command line, where other programs could read it). */
function powershell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, 20_000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`powershell exit ${code}`));
    });
    child.stdin.end(input);
  });
}

export async function saveWorkerBackup(data: WorkerBackup): Promise<void> {
  const protectedKey = await powershell(PROTECT, data.key);
  fs.mkdirSync(backupDir(), { recursive: true });
  fs.writeFileSync(backupFile(), JSON.stringify({ subdomain: data.subdomain, keyProtected: protectedKey, mode: data.mode }, null, 2));
}

/** null when there is no copy, or when it cannot be read (another Windows user, a damaged file). */
export async function loadWorkerBackup(): Promise<WorkerBackup | null> {
  try {
    const raw = JSON.parse(fs.readFileSync(backupFile(), 'utf8')) as { subdomain?: unknown; keyProtected?: unknown; mode?: unknown };
    if (typeof raw.subdomain !== 'string' || typeof raw.keyProtected !== 'string') return null;
    const key = await powershell(UNPROTECT, raw.keyProtected);
    return { subdomain: raw.subdomain, key, mode: raw.mode === 'cloudflare' ? 'cloudflare' : 'direct' };
  } catch {
    return null;
  }
}

/** Keeps the saved connection mode in step with the app, without touching the key. */
export function updateWorkerBackupMode(mode: 'direct' | 'cloudflare'): void {
  try {
    const raw = JSON.parse(fs.readFileSync(backupFile(), 'utf8'));
    fs.writeFileSync(backupFile(), JSON.stringify({ ...raw, mode }, null, 2));
  } catch {
    /* no copy yet */
  }
}

/** "Remover" in Settings: the person chose to forget the Worker, so the copy goes too. */
export function deleteWorkerBackup(): void {
  try {
    fs.rmSync(backupFile(), { force: true });
  } catch {
    /* nothing to delete */
  }
}
