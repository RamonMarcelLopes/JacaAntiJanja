import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import http from 'node:http';
import { URL } from 'node:url';

const STUN_SERVERS: Array<[string, number]> = [
  ['stun.l.google.com', 19302],
  ['stun1.l.google.com', 19302],
  ['stun.cloudflare.com', 3478],
];
const MAGIC_COOKIE = 0x2112a442;

export function buildStunRequest(txId: Buffer): Buffer {
  const buf = Buffer.alloc(20);
  buf.writeUInt16BE(0x0001, 0);
  buf.writeUInt16BE(0, 2);
  buf.writeUInt32BE(MAGIC_COOKIE, 4);
  txId.copy(buf, 8);
  return buf;
}

export function parseStunResponse(msg: Buffer, txId: Buffer): string | null {
  if (msg.length < 20 || msg.readUInt16BE(0) !== 0x0101) return null;
  if (!msg.subarray(8, 20).equals(txId)) return null;
  const end = Math.min(msg.length, 20 + msg.readUInt16BE(2));
  let off = 20;
  while (off + 4 <= end) {
    const type = msg.readUInt16BE(off);
    const len = msg.readUInt16BE(off + 2);
    const val = off + 4;
    if (type === 0x0020 && len >= 8 && msg[val + 1] === 0x01) {
      const ip = Buffer.alloc(4);
      msg.copy(ip, 0, val + 4, val + 8);
      const cookie = Buffer.alloc(4);
      cookie.writeUInt32BE(MAGIC_COOKIE, 0);
      for (let i = 0; i < 4; i++) ip[i] ^= cookie[i];
      return [...ip].join('.');
    }
    if (type === 0x0001 && len >= 8 && msg[val + 1] === 0x01) {
      return [...msg.subarray(val + 4, val + 8)].join('.');
    }
    off = val + len + ((4 - (len % 4)) % 4);
  }
  return null;
}

function stunQuery(host: string, port: number, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const txId = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)));
    const done = (v: string | null) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.once('error', () => done(null));
    sock.on('message', (m) => done(parseStunResponse(m, txId)));
    sock.send(buildStunRequest(txId), port, host, (err) => {
      if (err) done(null);
    });
  });
}

export async function discoverPublicIp(): Promise<string | null> {
  for (const [host, port] of STUN_SERVERS) {
    const ip = await stunQuery(host, port, 2500);
    if (ip) return ip;
  }
  return null;
}

export function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** CGNAT range 100.64.0.0/10. Tailscale also lives here, so callers must treat it as a hint only. */
export function isCgnatRange(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

export function localIpv4Addresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

/** Tries to open a TCP connection to the given endpoint. Used for the "test connectivity" button. */
export function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

// ---------------------------------------------------------------- UPnP (IGD)

interface Gateway {
  controlUrl: string;
  serviceType: string;
  localAddress: string;
}

function ssdpDiscover(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const st = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1';
    const req = Buffer.from(
      ['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${st}`, '', ''].join('\r\n'),
    );
    const done = (v: string | null) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.on('error', () => done(null));
    sock.on('message', (m) => {
      const loc = /^location:\s*(.+)$/im.exec(m.toString());
      if (loc) done(loc[1].trim());
    });
    sock.bind(0, () => sock.send(req, 1900, '239.255.255.250', (err) => err && done(null)));
  });
}

function httpRequest(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string; localAddress: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout: 4000 },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, localAddress: req.socket?.localAddress ?? '' }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function findGateway(): Promise<Gateway | null> {
  const location = await ssdpDiscover(3000);
  if (!location) return null;
  const res = await httpRequest(location, 'GET', {});
  const base = new URL(location);
  const re = /<service>[\s\S]*?<serviceType>(urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:\d)<\/serviceType>[\s\S]*?<controlURL>(.*?)<\/controlURL>[\s\S]*?<\/service>/g;
  const m = re.exec(res.text);
  if (!m) return null;
  const controlUrl = new URL(m[2], `${base.protocol}//${base.host}`).toString();
  return { controlUrl, serviceType: m[1], localAddress: res.localAddress.replace('::ffff:', '') };
}

function soap(g: Gateway, action: string, args: string): Promise<{ status: number; text: string }> {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${g.serviceType}">${args}</u:${action}></s:Body></s:Envelope>`;
  return httpRequest(
    g.controlUrl,
    'POST',
    {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${g.serviceType}#${action}"`,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  );
}

export interface PortMapping {
  remove(): Promise<void>;
}

/** Best-effort TCP port mapping through UPnP. Resolves null when the router does not cooperate. */
export async function mapPortUpnp(port: number): Promise<PortMapping | null> {
  try {
    const g = await findGateway();
    if (!g) return null;
    const add = (lease: number) =>
      soap(
        g,
        'AddPortMapping',
        `<NewRemoteHost></NewRemoteHost><NewExternalPort>${port}</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>${port}</NewInternalPort><NewInternalClient>${g.localAddress}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>Jaca anti Janja</NewPortMappingDescription><NewLeaseDuration>${lease}</NewLeaseDuration>`,
      );
    let res = await add(0);
    if (res.status !== 200) res = await add(3600);
    if (res.status !== 200) return null;
    return {
      remove: async () => {
        await soap(g, 'DeletePortMapping', `<NewRemoteHost></NewRemoteHost><NewExternalPort>${port}</NewExternalPort><NewProtocol>TCP</NewProtocol>`).catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Windows Firewall

const FIREWALL_RULE = 'Jaca anti Janja';

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60_000 }, (err, stdout) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
      resolve({ code, out: String(stdout ?? '') });
    });
  });
}

/**
 * Makes sure an inbound allow rule exists for this program. Without it Windows silently drops connections
 * from other PCs, which friends see as "the host did not answer in time". Adding the rule needs admin, so it
 * goes through one UAC prompt. Returns 'declined' when the user refuses it.
 */
export async function ensureFirewallRule(exePath: string): Promise<'exists' | 'added' | 'declined' | 'unsupported'> {
  if (process.platform !== 'win32') return 'unsupported';
  const show = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`, 'verbose']);
  if (show.code === 0 && show.out.toLowerCase().includes(exePath.toLowerCase())) return 'exists';

  const args = `advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="${exePath}" enable=yes profile=any protocol=TCP`;
  const ps = `Start-Process -FilePath netsh -ArgumentList '${args.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
  const elevated = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (elevated.code !== 0) return 'declined';
  const check = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`, 'verbose']);
  return check.code === 0 && check.out.toLowerCase().includes(exePath.toLowerCase()) ? 'added' : 'declined';
}

// ---------------------------------------------------------------- VPN detection

export interface VpnAddress {
  name: string;
  ip: string;
}

/** Finds Radmin VPN / Tailscale / ZeroTier / Hamachi adapters: a way around CGNAT and closed routers. */
export function detectVpnAddresses(): VpnAddress[] {
  const found: VpnAddress[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!/radmin|tailscale|zerotier|hamachi/i.test(name)) continue;
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) found.push({ name, ip: i.address });
  }
  return found;
}
