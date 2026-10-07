import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import {
  CLIENT_TYPES,
  ErrorCode,
  HEARTBEAT_MS,
  JOIN_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  MAX_PEERS,
  Message,
  PeerInfo,
  RELAY_TYPES,
  ShareInfo,
} from '../shared/protocol';

interface Peer extends PeerInfo {
  ws: WebSocket;
  alive: boolean;
}

const BAD_TOKEN_LIMIT = 5;
const BAD_TOKEN_WINDOW_MS = 60_000;

export class SignalingServer {
  private wss: WebSocketServer | null = null;
  private peers = new Map<string, Peer>();
  private badTokens = new Map<string, number[]>();
  private heartbeat: NodeJS.Timeout | null = null;
  readonly token: number;
  private readonly startedAt = Date.now();
  /** Invite code of the room, set by the main process once the public address is known; sent to everyone on join. */
  inviteCode = '';

  constructor(
    private port: number,
    readonly roomName: string,
  ) {
    this.token = randomBytes(4).readUInt32BE(0);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.port, maxPayload: MAX_MESSAGE_BYTES });
      wss.once('error', reject);
      wss.once('listening', () => {
        wss.off('error', reject);
        wss.on('error', () => undefined);
        this.wss = wss;
        wss.on('connection', (ws, req) => this.onConnection(ws, req.socket.remoteAddress ?? 'unknown'));
        this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.broadcast({ type: 'room-closed', payload: {} });
    for (const p of this.peers.values()) p.ws.close(1000, 'room-closed');
    this.peers.clear();
    this.wss?.close();
    this.wss = null;
  }

  private ping(): void {
    for (const p of this.peers.values()) {
      if (!p.alive) {
        p.ws.terminate();
        continue;
      }
      p.alive = false;
      p.ws.ping();
    }
  }

  private send(ws: WebSocket, msg: Message): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendError(ws: WebSocket, code: ErrorCode): void {
    this.send(ws, { type: 'error', payload: { code } });
  }

  private broadcast(msg: Message, exceptId?: string): void {
    for (const p of this.peers.values()) {
      if (p.peerId !== exceptId) this.send(p.ws, msg);
    }
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const hits = (this.badTokens.get(ip) ?? []).filter((t) => now - t < BAD_TOKEN_WINDOW_MS);
    this.badTokens.set(ip, hits);
    return hits.length >= BAD_TOKEN_LIMIT;
  }

  private recordBadToken(ip: string): void {
    const hits = this.badTokens.get(ip) ?? [];
    hits.push(Date.now());
    this.badTokens.set(ip, hits);
  }

  private onConnection(ws: WebSocket, ip: string): void {
    let peer: Peer | null = null;
    const joinTimer = setTimeout(() => {
      if (!peer) ws.close(4000, 'join-timeout');
    }, JOIN_TIMEOUT_MS);

    ws.on('pong', () => {
      if (peer) peer.alive = true;
    });

    ws.on('message', (raw) => {
      let msg: Message;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string' || !CLIENT_TYPES.has(msg.type)) return;

      if (!peer) {
        if (msg.type !== 'join') return;
        peer = this.handleJoin(ws, ip, msg);
        if (peer) clearTimeout(joinTimer);
        return;
      }
      peer.alive = true;
      this.handleMessage(peer, msg);
    });

    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (peer && this.peers.get(peer.peerId)?.ws === ws) {
        this.peers.delete(peer.peerId);
        this.broadcast({ type: 'peer-left', payload: { peerId: peer.peerId } });
      }
    });
    ws.on('error', () => undefined);
  }

  private handleJoin(ws: WebSocket, ip: string, msg: Message): Peer | null {
    if (this.isRateLimited(ip)) {
      this.sendError(ws, 'RATE_LIMITED');
      ws.close(4001, 'rate-limited');
      return null;
    }
    const p = msg.payload ?? {};
    if (typeof p.token !== 'number' || p.token !== this.token) {
      this.recordBadToken(ip);
      this.sendError(ws, 'BAD_TOKEN');
      ws.close(4002, 'bad-token');
      return null;
    }
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
    if (!name) {
      this.sendError(ws, 'BAD_REQUEST');
      ws.close(4003, 'bad-request');
      return null;
    }
    if (this.peers.size >= MAX_PEERS) {
      this.sendError(ws, 'ROOM_FULL');
      ws.close(4004, 'room-full');
      return null;
    }
    const avatar = typeof p.avatar === 'string' && p.avatar.startsWith('data:image/') ? p.avatar : null;
    const peer: Peer = { peerId: randomBytes(6).toString('hex'), name, avatar, share: null, ws, alive: true };
    const others = [...this.peers.values()].map(toInfo);
    this.peers.set(peer.peerId, peer);
    this.send(ws, { type: 'welcome', payload: { peerId: peer.peerId, peers: others, roomName: this.roomName, roomAgeMs: Date.now() - this.startedAt, inviteCode: this.inviteCode } });
    this.broadcast({ type: 'peer-joined', payload: toInfo(peer) }, peer.peerId);
    return peer;
  }

  private handleMessage(peer: Peer, msg: Message): void {
    if (msg.type === 'join') return;
    if (msg.type === 'profile-update') {
      const p = msg.payload ?? {};
      const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : peer.name;
      if (!name) return;
      peer.name = name;
      peer.avatar = typeof p.avatar === 'string' && p.avatar.startsWith('data:image/') ? p.avatar : null;
      this.broadcast({ type: 'peer-updated', payload: { peerId: peer.peerId, name: peer.name, avatar: peer.avatar } }, peer.peerId);
      return;
    }
    if (msg.type === 'share-started') {
      const s = msg.payload as ShareInfo | undefined;
      if (!s || typeof s.resolution !== 'string' || typeof s.fps !== 'number') return;
      peer.share = { resolution: s.resolution, fps: s.fps, mode: s.mode === 'detail' ? 'detail' : 'motion' };
      this.broadcast({ type: 'share-started', from: peer.peerId, payload: peer.share }, peer.peerId);
      return;
    }
    if (msg.type === 'share-stopped') {
      peer.share = null;
      this.broadcast({ type: 'share-stopped', from: peer.peerId, payload: {} }, peer.peerId);
      return;
    }
    if (RELAY_TYPES.has(msg.type) && typeof msg.to === 'string') {
      const target = this.peers.get(msg.to);
      if (target) this.send(target.ws, { type: msg.type, from: peer.peerId, to: msg.to, payload: msg.payload });
    }
  }
}

function toInfo(p: Peer): PeerInfo {
  return { peerId: p.peerId, name: p.name, avatar: p.avatar, share: p.share };
}
