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
