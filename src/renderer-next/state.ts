// One small store for the whole interface. Views subscribe and redraw; the real data comes from the config, the Session and the room status polling.
import { encodeCloudInvite } from '../shared/invite';
import { AppConfig, cleanRoomIcon, DEFAULT_ROOM_ICON, RoomInfo, RoomStatus, UpdateState } from '../shared/protocol';
import type { PeerView, Session } from '../renderer/session';

export interface RoomEntry {
  /** Unique in the list: the fixed room id, or the favorite code. */
  key: string;
  code: string;
  name: string;
  /** Rooms of this PC's owner (fixed) open with the same code every time; favorites are rooms of friends saved by the code. */
  kind: 'fixa' | 'favorita';
  fixedId?: string;
  state: 'open' | 'closed' | 'unknown';
  host?: string;
  count?: number;
  hue: number;
  icon: string;
}

export interface AppState {
  cfg: AppConfig;
  view: 'home' | 'room';
  session: Session | null;
  /** Set when this PC opened the room (not when it only joined). */
  room: RoomInfo | null;
  /** In a room: true shows the grid with everybody, false shows the picture in focus. Only meaningful while somebody is being watched. */
  gridMode: boolean;
  panel: boolean;
  settingsOpen: boolean;
  /** The column of the room / home is folded to the side; the profile, the update and the settings then live at the foot of the rail. */
  sideCollapsed: boolean;
  update: UpdateState;
  /** The X of the update notice hides it until the app is closed (nothing is kept on disk). */
  updateDismissed: boolean;
  /** What the room server says about each saved room, by code. */
  statuses: Map<string, RoomStatus>;
  version: string;
  /** The icon picked for a temporary room, for the time it is open. */
  tempIcon: string;
}

export const S: AppState = {
  cfg: undefined as unknown as AppConfig,
  view: 'home',
  session: null,
  room: null,
  gridMode: false,
  panel: false,
  settingsOpen: false,
  sideCollapsed: (() => {
    try {
      return localStorage.getItem('jaca-ui-side') === '1';
    } catch {
      return false;
    }
  })(),
  update: { status: 'idle' },
  updateDismissed: false,
  statuses: new Map(),
  version: '',
  tempIcon: 'users',
};

type Listener = (what: string) => void;
const listeners = new Set<Listener>();
export const subscribe = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
/** `what` tells the views what changed so they redraw only what they need ('route', 'session', 'rooms', 'panel', 'update', 'settings', 'layout', 'config'). */
export const emit = (what: string): void => listeners.forEach((fn) => fn(what));

// ---------------------------------------------------------------------------------------------------------------- config
export async function loadConfig(): Promise<void> {
  S.cfg = await window.jaca.getConfig();
}

/** Saves a change and keeps the window's copy of the config up to date (screens must read S.cfg again, it is replaced). */
export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  S.cfg = await window.jaca.setConfig(patch);
  emit('config');
  return S.cfg;
}

// ---------------------------------------------------------------------------------------------------------------- people and rooms
/** A color for a name, the same every time (the interface paints initials on a gradient of this hue). */
export function hueOf(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % 235; // 0-235: red to blue, never purple or pink
}

/** The picture of a room: the one its owner picked when creating it, otherwise the default (the same for everybody, so nobody sees a different picture for the same room). */
export function iconOf(picked: string | undefined): string {
  return cleanRoomIcon(picked) ?? DEFAULT_ROOM_ICON;
}

/** The saved rooms for the rail and the home: the fixed rooms of this PC (Cloudflare mode) and the favorites, with what the server last said about each. */
export function roomEntries(): RoomEntry[] {
  const entries: RoomEntry[] = [];
  // in the room, the picture the room itself carries wins: it is what everybody in it sees
  const here = (code: string) => (S.session && S.session.roomIcon && sameRoom(S.session.inviteCode, code) ? S.session.roomIcon : '');
  const sub = S.cfg.workerSubdomain;
  if (sub) {
    for (const r of S.cfg.fixedRooms) {
      const code = encodeCloudInvite(r.id, sub);
      const st = S.statuses.get(code);
      entries.push({ key: r.id, code, name: r.name, kind: 'fixa', fixedId: r.id, state: st?.state ?? 'unknown', host: st?.hostName, count: st?.count, hue: hueOf(r.id), icon: iconOf(here(code) || r.icon) });
    }
  }
  for (const f of S.cfg.favoriteRooms) {
    const st = S.statuses.get(f.code);
    entries.push({ key: f.code, code: f.code, name: st?.name || f.name, kind: 'favorita', state: st?.state ?? 'unknown', host: st?.hostName, count: st?.count, hue: hueOf(f.code), icon: iconOf(here(f.code) || st?.icon) });
  }
  return entries;
}

/** The part of an invite code that names the room (before the "@account"): two codes of the same room are equal by it. */
export const sameRoom = (a: string, b: string): boolean => !!a && !!b && a.split('@')[0].toUpperCase() === b.split('@')[0].toUpperCase();

export const peers = (): PeerView[] => (S.session ? [...S.session.peers.values()] : []);
export const isMe = (p: { peerId: string }): boolean => p.peerId === S.session?.selfId;

/** The person in focus, or null when the grid with everybody is showing. */
export const focusId = (): string | null => (S.gridMode ? null : (S.session?.viewing ?? null));

export function setSideCollapsed(v: boolean): void {
  S.sideCollapsed = v;
  try {
    localStorage.setItem('jaca-ui-side', v ? '1' : '0');
  } catch {
    /* storage can be blocked; the choice then lasts until the next reload */
  }
  emit('layout');
}
