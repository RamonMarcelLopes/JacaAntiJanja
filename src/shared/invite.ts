// Invite code: IPv4 (4 bytes) + port (2 bytes) + token (4 bytes) = 10 bytes = 80 bits,
// encoded as 16 Crockford Base32 characters shown in groups of 4.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface InviteData {
  ip: string;
  port: number;
  token: number;
}

export function encodeInvite(data: InviteData): string {
  const octets = data.ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error('Invalid IPv4 address');
  }
  if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
    throw new Error('Invalid port');
  }
  const bytes = [
    ...octets,
    (data.port >>> 8) & 0xff,
    data.port & 0xff,
    (data.token >>> 24) & 0xff,
    (data.token >>> 16) & 0xff,
    (data.token >>> 8) & 0xff,
    data.token & 0xff,
  ];
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 15; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return out.match(/.{4}/g)!.join('-');
}

export function decodeInvite(code: string): InviteData | null {
  const clean = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== 16) return null;
  let bits = 0n;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    bits = (bits << 5n) | BigInt(v);
  }
  const bytes: number[] = [];
  for (let i = 9; i >= 0; i--) bytes.push(Number((bits >> BigInt(i * 8)) & 255n));
  const token = ((bytes[6] << 24) | (bytes[7] << 16) | (bytes[8] << 8) | bytes[9]) >>> 0;
  return {
    ip: bytes.slice(0, 4).join('.'),
    port: (bytes[4] << 8) | bytes[5],
    token,
  };
}

// ---------------------------------------------------------------- Cloudflare rooms
// The room owner publishes the worker `jaca-sala` in their own Cloudflare account. A room code there is a 10-character random id
// plus the owner's workers.dev subdomain: `K7QM2-XRA9T@ramonlopes`. The address of the room server is derived from it, so a code can
// only ever point at `jaca-sala.<subdomain>.workers.dev`.

export const WORKER_SCRIPT_NAME = 'jaca-sala';
export const ROOM_ID_LENGTH = 10;
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_RE.test(subdomain);
}

export function workerHost(subdomain: string): string {
  return `${WORKER_SCRIPT_NAME}.${subdomain}.workers.dev`;
}

/** A room id from random bytes: the first 50 bits of the first 7 bytes, as 10 Crockford characters. */
export function roomIdFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 7) throw new Error('Need at least 7 random bytes');
  let bits = 0n;
  for (let i = 0; i < 7; i++) bits = (bits << 8n) | BigInt(bytes[i]);
  bits &= (1n << 50n) - 1n;
  let out = '';
  for (let i = 9; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return out;
}

export function isValidRoomId(id: string): boolean {
  return id.length === ROOM_ID_LENGTH && [...id].every((c) => ALPHABET.includes(c));
}

export function formatRoomId(id: string): string {
  return `${id.slice(0, 5)}-${id.slice(5)}`;
}

export function encodeCloudInvite(roomId: string, subdomain: string): string {
  if (!isValidRoomId(roomId) || !isValidSubdomain(subdomain)) throw new Error('Invalid Cloudflare invite');
  return `${formatRoomId(roomId)}@${subdomain}`;
}

export type ParsedInvite = ({ kind: 'direct' } & InviteData) | { kind: 'cloud'; roomId: string; subdomain: string };

/** Understands both kinds of codes: `XXXX-XXXX-XXXX-XXXX` (direct) and `XXXXX-XXXXX@subdomain` (Cloudflare). */
export function parseInvite(code: string): ParsedInvite | null {
  const text = code.trim();
  const at = text.lastIndexOf('@');
  if (at >= 0) {
    const roomId = text.slice(0, at).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    const subdomain = text.slice(at + 1).trim().toLowerCase();
    return isValidRoomId(roomId) && isValidSubdomain(subdomain) ? { kind: 'cloud', roomId, subdomain } : null;
  }
  const direct = decodeInvite(text);
  return direct ? { kind: 'direct', ...direct } : null;
}
