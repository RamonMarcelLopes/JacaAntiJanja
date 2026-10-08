// Jaca anti Janja room server for Cloudflare Workers.
//
// It only relays the small signaling messages (who is in the room, names, photos, WebRTC offers/answers/candidates). Video and audio
// never pass through here: the PCs connect to each other directly.
//
// Each room is one Durable Object, found by its 10-character id. It speaks the same protocol as the Node signaling server of the app
// (src/main/signaling.ts), so the app uses the same client for both. Creating a room needs the OWNER_KEY secret of this Worker; joining
// a room needs only its id (which is part of the invite code and not guessable: 50 random bits).
//
// Who is the owner: either the OWNER_KEY secret (set by `pnpm worker:deploy`), or, when that secret does not exist (the "Deploy to Cloudflare" button
// cannot ask for one), the first key an app registers at /api/claim. Only a hash of it is stored, and once registered it can never be replaced.
import { DurableObject } from 'cloudflare:workers';
import { formatRoomId, isValidRoomId, WORKER_SCRIPT_NAME } from './shared/invite';
import { CLIENT_TYPES, MAX_MESSAGE_BYTES, MAX_PEERS, MAX_ROOM_NAME, RELAY_TYPES } from './shared/protocol';
import type { ErrorCode, Message, PeerInfo, ShareInfo } from '../../src/shared/protocol';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  OWNER: DurableObjectNamespace<Owner>;
  /** Optional secret set at publish time (wrangler secret put OWNER_KEY). Without it the owner is whoever claims the Worker first. */
  OWNER_KEY?: string;
}

/** Constant-time comparison (both sides are hashed first, so the lengths do not leak either). An empty expected key never matches. */
async function sameKey(given: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const ownerStub = (env: Env) => env.OWNER.get(env.OWNER.idFromName('owner'));
const MIN_KEY = 24;
const MAX_KEY = 200;

/** True when `key` is the owner's: the secret when there is one, otherwise the key registered by the first claim. */
async function isOwner(env: Env, key: string): Promise<boolean> {
  if (env.OWNER_KEY) return sameKey(key, env.OWNER_KEY);
  if (key.length < MIN_KEY || key.length > MAX_KEY) return false;
  const res = await ownerStub(env).fetch('https://owner/verify', { method: 'POST', body: JSON.stringify({ key }) });
  return res.ok;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return Response.json({ ok: true, service: WORKER_SCRIPT_NAME });

    if (url.pathname === '/api/check') {
      return (await isOwner(env, url.searchParams.get('key') ?? '')) ? Response.json({ ok: true }) : new Response('unauthorized', { status: 401 });
    }

    // The app of the person who published this Worker registers its own random key here, once. With an OWNER_KEY secret this is closed.
    if (url.pathname === '/api/claim' && request.method === 'POST') {
      if (env.OWNER_KEY) return new Response('already has an owner', { status: 403 });
      const body = await request.text();
      if (body.length > 1000) return new Response('bad request', { status: 400 });
      return ownerStub(env).fetch('https://owner/claim', { method: 'POST', body });
    }
    if (url.pathname === '/api/status') {
      if (env.OWNER_KEY) return Response.json({ service: WORKER_SCRIPT_NAME, claimed: true });
      return ownerStub(env).fetch('https://owner/status');
    }

    const match = /^\/ws\/([0-9A-Z]+)$/.exec(url.pathname);
    if (match && isValidRoomId(match[1])) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const create = url.searchParams.get('create') === '1';
      if (create && !(await isOwner(env, url.searchParams.get('key') ?? ''))) return new Response('unauthorized', { status: 401 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      const headers = new Headers(request.headers);
      headers.set('x-room-id', match[1]);
      headers.set('x-create', create ? '1' : '0');
      headers.set('x-host', url.hostname);
      return stub.fetch(new Request(request, { headers }));
    }

    return new Response('Jaca anti Janja room server', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Remembers who owns this Worker (only a hash of the key). A Durable Object handles one request at a time, so two claims can never both win. */
export class Owner extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const stored = await this.ctx.storage.get<string>('keyHash');
    if (path === '/status') return Response.json({ service: WORKER_SCRIPT_NAME, claimed: !!stored });
    let key = '';
    try {
      const body = (await request.json()) as { key?: unknown };
      key = typeof body.key === 'string' ? body.key : '';
    } catch {
      /* no key given */
    }
    if (key.length < MIN_KEY || key.length > MAX_KEY) return new Response('bad key', { status: 400 });
    const hash = await sha256Hex(key);
    if (path === '/claim') {
      if (!stored) {
        await this.ctx.storage.put('keyHash', hash);
        return Response.json({ ok: true, claimed: true });
      }
      return (await sameKey(hash, stored)) ? Response.json({ ok: true, claimed: false }) : new Response('already has an owner', { status: 403 });
    }
    if (path === '/verify') return stored && (await sameKey(hash, stored)) ? Response.json({ ok: true }) : new Response('unauthorized', { status: 401 });
    return new Response('not found', { status: 404 });
  }
}

interface Meta {
  createdAt: number;
  inviteCode: string;
  roomName: string;
}

/** Kept on each socket (survives hibernation). `peerId` is null until the socket has joined. */
interface Attachment {
  peerId: string | null;
  create: boolean;
  isHost?: boolean;
  name?: string;
  avatar?: string | null;
  share?: ShareInfo | null;
}

const toInfo = (a: Attachment): PeerInfo => ({ peerId: a.peerId!, name: a.name ?? '', avatar: a.avatar ?? null, share: a.share ?? null });

function cleanRoomName(raw: unknown, hostName: string): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME);
  return name || `Sala de ${hostName}`.slice(0, MAX_ROOM_NAME);
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // clients send the text "ping" now and then; it is answered without waking the object (so it costs almost nothing)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const create = request.headers.get('x-create') === '1';
    const roomId = request.headers.get('x-room-id') ?? '';
    const meta = await this.ctx.storage.get<Meta>('meta');

    if (create) {
      if (meta) return new Response('room id already in use', { status: 409 });
      const m = /^jaca-sala\.([a-z0-9-]+)\.workers\.dev$/.exec(request.headers.get('x-host') ?? '');
      const subdomain = m ? m[1] : 'local'; // 'local' only when running `wrangler dev`
      await this.ctx.storage.put<Meta>('meta', { createdAt: Date.now(), inviteCode: `${formatRoomId(roomId)}@${subdomain}`, roomName: '' });
      await this.ctx.storage.setAlarm(Date.now() + 30_000); // an owner who never joins leaves nothing behind
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server); // hibernation API: the object can sleep while the sockets stay open
    server.serializeAttachment({ peerId: null, create } satisfies Attachment);
    if (!create && !meta) this.reject(server, 'ROOM_CLOSED'); // nobody created this room (or it is over)
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------------ sockets

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg: Message;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string' || !CLIENT_TYPES.has(msg.type)) return;
    const att = ws.deserializeAttachment() as Attachment;
    if (att.peerId === null) {
      if (msg.type === 'join') await this.handleJoin(ws, att, msg);
      return;
    }
    this.handleMessage(ws, att, msg);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onLeave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onLeave(ws);
  }

  /** An owner who never joined: clean up the room. */
  async alarm(): Promise<void> {
    if (this.joined().length === 0) {
      for (const ws of this.ctx.getWebSockets()) this.safeClose(ws, 1000, 'room-closed');
      await this.ctx.storage.deleteAll();
    }
  }

  // ------------------------------------------------------------------ protocol

  private async handleJoin(ws: WebSocket, att: Attachment, msg: Message): Promise<void> {
    const p = msg.payload ?? {};
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
    if (!name) return this.reject(ws, 'BAD_REQUEST');
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return this.reject(ws, 'ROOM_CLOSED');
    const peers = this.joined();
    const hostPresent = peers.some(([, a]) => a.isHost);
    if (att.create ? hostPresent : !hostPresent) return this.reject(ws, att.create ? 'BAD_REQUEST' : 'ROOM_CLOSED');
    if (peers.length >= MAX_PEERS) return this.reject(ws, 'ROOM_FULL');

    if (att.create) {
      meta.roomName = cleanRoomName(p.roomName, name);
      await this.ctx.storage.put('meta', meta);
      await this.ctx.storage.deleteAlarm();
    }
    const avatar = typeof p.avatar === 'string' && p.avatar.startsWith('data:image/') ? p.avatar : null;
    const peerId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const me: Attachment = { ...att, peerId, name, avatar, share: null, isHost: att.create };
    ws.serializeAttachment(me);
    ws.send(
      JSON.stringify({
        type: 'welcome',
        payload: { peerId, peers: peers.map(([, a]) => toInfo(a)), roomName: meta.roomName, roomAgeMs: Date.now() - meta.createdAt, inviteCode: meta.inviteCode },
      }),
    );
    this.broadcast({ type: 'peer-joined', payload: toInfo(me) }, peerId);
  }

  private handleMessage(ws: WebSocket, att: Attachment, msg: Message): void {
    const peerId = att.peerId!;
    if (msg.type === 'join') return;

    if (msg.type === 'profile-update') {
      const p = msg.payload ?? {};
      const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : att.name ?? '';
      if (!name) return;
      att.name = name;
      att.avatar = typeof p.avatar === 'string' && p.avatar.startsWith('data:image/') ? p.avatar : null;
      ws.serializeAttachment(att);
      this.broadcast({ type: 'peer-updated', payload: { peerId, name: att.name, avatar: att.avatar } }, peerId);
      return;
    }
    if (msg.type === 'share-started') {
      const s = msg.payload as ShareInfo | undefined;
      if (!s || typeof s.resolution !== 'string' || typeof s.fps !== 'number') return;
      att.share = { resolution: s.resolution, fps: s.fps, mode: s.mode === 'detail' ? 'detail' : 'motion' };
      ws.serializeAttachment(att);
      this.broadcast({ type: 'share-started', from: peerId, payload: att.share }, peerId);
      return;
    }
    if (msg.type === 'share-stopped') {
      att.share = null;
      ws.serializeAttachment(att);
      this.broadcast({ type: 'share-stopped', from: peerId, payload: {} }, peerId);
      return;
    }
    if (RELAY_TYPES.has(msg.type) && typeof msg.to === 'string') {
      const target = this.joined().find(([, a]) => a.peerId === msg.to);
      if (target) this.send(target[0], { type: msg.type, from: peerId, to: msg.to, payload: msg.payload });
    }
  }

  private async onLeave(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att?.peerId) return;
    if (att.isHost) {
      // the room lives as long as its owner does
      this.broadcast({ type: 'room-closed', payload: {} }, att.peerId);
      for (const other of this.ctx.getWebSockets()) this.safeClose(other, 1000, 'room-closed');
      await this.ctx.storage.deleteAll();
      return;
    }
    this.broadcast({ type: 'peer-left', payload: { peerId: att.peerId } }, att.peerId);
  }

  // ------------------------------------------------------------------ helpers

  private joined(): Array<[WebSocket, Attachment]> {
    const out: Array<[WebSocket, Attachment]> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.peerId) out.push([ws, att]);
    }
    return out;
  }

  private send(ws: WebSocket, msg: Message): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* the socket is already closing */
    }
  }

  private broadcast(msg: Message, exceptPeerId?: string): void {
    for (const [ws, att] of this.joined()) if (att.peerId !== exceptPeerId) this.send(ws, msg);
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private reject(ws: WebSocket, code: ErrorCode): void {
    this.send(ws, { type: 'error', payload: { code } });
    this.safeClose(ws, 4000, code.toLowerCase());
  }
}
