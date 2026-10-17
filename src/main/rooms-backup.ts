import fs from 'node:fs';
import path from 'node:path';
import { cleanFavorites, cleanFixedRooms } from '../shared/rooms';
import { FavoriteRoom, FixedRoom } from '../shared/protocol';

// The saved rooms are kept in a copy OUTSIDE the app's data folder (which an uninstall deletes and which a damaged config.json can lose), so favorite
// rooms and fixed rooms survive a reinstall. Only what is not secret: codes and names. A fixed room's Discord webhook is encrypted with a key that
// lives in the app's data folder, so it cannot come back and has to be pasted again.

export interface RoomsBackup {
  favoriteRooms: FavoriteRoom[];
  fixedRooms: Array<Pick<FixedRoom, 'id' | 'name' | 'icon'>>;
  /** Which interface was chosen, and whether the new one was ever opened (so the notice about it does not come back after a reinstall). */
  ui?: 'legacy' | 'next';
  newUiSeen?: boolean;
}

const fileIn = (dir: string) => path.join(dir, 'rooms.json');

export function writeRoomsBackup(dir: string, favoriteRooms: FavoriteRoom[], fixedRooms: FixedRoom[], interfaceChoice: { ui: 'legacy' | 'next'; newUiSeen: boolean } = { ui: 'legacy', newUiSeen: false }): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const body: RoomsBackup = { favoriteRooms, fixedRooms: fixedRooms.map((r) => ({ id: r.id, name: r.name, ...(r.icon ? { icon: r.icon } : {}) })), ui: interfaceChoice.ui, newUiSeen: interfaceChoice.newUiSeen };
    const tmp = `${fileIn(dir)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
    fs.renameSync(tmp, fileIn(dir));
  } catch {
    /* the copy is a safety net: failing to write it must never break saving the config */
  }
}

export function readRoomsBackup(dir: string): RoomsBackup | null {
  try {
    const raw = JSON.parse(fs.readFileSync(fileIn(dir), 'utf8'));
    const favoriteRooms = cleanFavorites(raw?.favoriteRooms);
    const fixedRooms = cleanFixedRooms((Array.isArray(raw?.fixedRooms) ? raw.fixedRooms : []).map((r: any) => ({ id: r?.id, name: r?.name, icon: r?.icon, discordWebhookEnc: '' })));
    return { favoriteRooms, fixedRooms: fixedRooms.map((r) => ({ id: r.id, name: r.name, ...(r.icon ? { icon: r.icon } : {}) })), ui: raw?.ui === 'next' ? 'next' : 'legacy', newUiSeen: raw?.newUiSeen === true };
  } catch {
    return null;
  }
}
