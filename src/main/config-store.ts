import fs from 'node:fs';
import path from 'node:path';

// Reading and writing config.json without ever losing what the person saved (favorite rooms, fixed rooms, profile).
// Kept apart from main.ts (no Electron) so it can be unit tested.

export type ConfigRead =
  | { status: 'ok'; value: Record<string, unknown>; from: 'file' | 'backup' }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string };

const backupOf = (file: string) => `${file}.bak`;

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Waits a moment (an antivirus or the installer can hold the file for a few hundred milliseconds right after an update). */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readText(file: string): { text: string } | { missing: true } | { error: string } {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return { text: fs.readFileSync(file, 'utf8') };
    } catch (e: any) {
      if (e?.code === 'ENOENT') return { missing: true };
      last = String(e?.code ?? e?.message ?? e);
      pause(150);
    }
  }
  return { error: last };
}

/**
 * Reads the config. A file that cannot be read or is damaged is NEVER treated as "no config": the copy of the last good save (config.json.bak)
 * is used, and the damaged file is kept under another name instead of being overwritten by the next save.
 */
export function readConfig(file: string): ConfigRead {
  const main = readText(file);
  if ('text' in main) {
    const value = parseObject(main.text);
    if (value) return { status: 'ok', value, from: 'file' };
    quarantine(file);
  } else if ('error' in main) {
    // the file exists but could not be opened (locked): do not touch it, only fall back to the copy for this run
    const copy = readBackup(file);
    return copy ?? { status: 'unreadable', reason: main.error };
  }
  const copy = readBackup(file);
  if (copy) return copy;
  return 'text' in main ? { status: 'unreadable', reason: 'damaged file and no copy' } : { status: 'missing' };
}

function readBackup(file: string): ConfigRead | null {
  const copy = readText(backupOf(file));
  if (!('text' in copy)) return null;
  const value = parseObject(copy.text);
  return value ? { status: 'ok', value, from: 'backup' } : null;
}

/** Renames a damaged config.json to config.damaged-<time>.json (keeping only the three newest) so its content is never destroyed. */
function quarantine(file: string): void {
  try {
    const dir = path.dirname(file);
    fs.renameSync(file, path.join(dir, `config.damaged-${Date.now()}.json`));
    const old = fs
      .readdirSync(dir)
      .filter((n) => /^config\.damaged-\d+\.json$/.test(n))
      .sort();
    for (const n of old.slice(0, Math.max(0, old.length - 3))) fs.rmSync(path.join(dir, n), { force: true });
  } catch {
    /* not critical */
  }
}

/**
 * Saves the config in a way that cannot leave a half-written file: the new text goes to a temporary file that then replaces config.json,
 * and the previous good config.json is kept as config.json.bak.
 */
export function writeConfig(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(data, null, 2);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    const current = fs.readFileSync(file, 'utf8');
    if (parseObject(current)) fs.writeFileSync(backupOf(file), current);
  } catch {
    /* first save: nothing to keep */
  }
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, text); // the file is held by another program: write over it directly
    fs.rmSync(tmp, { force: true });
  }
}
