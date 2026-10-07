export const MAX_PEERS = 10;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const JOIN_TIMEOUT_MS = 5000;
export const HEARTBEAT_MS = 15000;
export const DEFAULT_PORT = 47800;
export const MAX_ROOM_NAME = 32;

export type ErrorCode = 'ROOM_FULL' | 'BAD_TOKEN' | 'ROOM_CLOSED' | 'RATE_LIMITED' | 'BAD_REQUEST';

export type Resolution = '720p' | '1080p' | '1440p';
export type Fps = 30 | 60;
export type ShareMode = 'motion' | 'detail';

export interface ShareInfo {
  resolution: Resolution;
  fps: Fps;
  mode: ShareMode;
}

export interface PeerInfo {
  peerId: string;
  name: string;
  avatar: string | null;
  share: ShareInfo | null;
}

export type MessageType =
  | 'join'
  | 'welcome'
  | 'error'
  | 'peer-joined'
  | 'peer-left'
  | 'peer-updated'
  | 'profile-update'
  | 'share-started'
  | 'share-stopped'
  | 'watch'
  | 'unwatch'
  | 'offer'
  | 'answer'
  | 'ice'
  | 'room-closed';

export interface Message {
  type: MessageType;
  from?: string;
  to?: string | null;
  payload?: any;
}

// Messages a client may send. Everything else is dropped by the server.
export const CLIENT_TYPES: ReadonlySet<string> = new Set([
  'join',
  'profile-update',
  'share-started',
  'share-stopped',
  'watch',
  'unwatch',
  'offer',
  'answer',
  'ice',
]);

// Messages that carry a `to` and are relayed to a single peer without inspection.
export const RELAY_TYPES: ReadonlySet<string> = new Set(['watch', 'unwatch', 'offer', 'answer', 'ice']);

export const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
};

// Reference bitrate per viewer in Mbps.
export const BITRATE_MBPS: Record<Resolution, Record<Fps, number>> = {
  '720p': { 30: 2.5, 60: 4 },
  '1080p': { 30: 4, 60: 6 },
  '1440p': { 30: 7, 60: 12 },
};

export interface AppConfig {
  name: string;
  avatar: string | null;
  port: number;
  hostAddressOverride: string;
  excludeAudioProcess: string;
  /** Last room name typed when creating a room. */
  roomName: string;
  codec: 'auto' | 'vp9' | 'h264' | 'av1';
  resolution: Resolution;
  fps: Fps;
  mode: ShareMode;
}

export interface AudioStartResult {
  ok: boolean;
  /** True when only the shared window's process is captured, so the app's own audio and Discord are left out. */
  isolated: boolean;
  message: string;
}

export interface RoomInfo {
  code: string;
  ip: string;
  port: number;
  token: number;
  upnp: boolean;
  warnings: string[];
}

export interface ConnectivityResult {
  ok: boolean;
  publicIp: string | null;
  message: string;
}

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
  isScreen: boolean;
}

export interface UpdateState {
  status: 'idle' | 'disabled' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}
