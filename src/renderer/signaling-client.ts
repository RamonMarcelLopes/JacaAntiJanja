import { ErrorCode, Message, MessageType, PeerInfo } from '../shared/protocol';

export interface WelcomePayload {
  peerId: string;
  peers: PeerInfo[];
  roomName: string;
  /** How long the room had been open when this client joined (absent on hosts older than this feature). */
  roomAgeMs?: number;
  /** The room's invite code, so every participant can copy it (absent on older hosts). */
  inviteCode?: string;
  /** Cloudflare rooms only: secret that lets this client take its place back after a dropped connection (absent on older Workers). */
  resumeToken?: string;
  /** True when this welcome answers a resume: `peers` is then the room as it is now. */
  resumed?: boolean;
}

export class JoinError extends Error {
  constructor(public code: ErrorCode | 'UNREACHABLE' | 'TIMEOUT') {
    super(code);
  }
}

export const JOIN_ERROR_TEXT: Record<string, string> = {
  ROOM_FULL: 'A sala está cheia (limite de 10 participantes).',
  BAD_TOKEN: 'Código de convite incorreto.',
  ROOM_CLOSED: 'A sala não existe ou já foi encerrada. Confira o código.',
  RATE_LIMITED: 'Muitas tentativas com código errado. Aguarde um minuto.',
  BAD_REQUEST: 'Pedido de entrada inválido.',
  UNREACHABLE: 'Host inacessível. Confira o código e se a porta do host está liberada (use "Testar conectividade" no host).',
  TIMEOUT:
    'O host não respondeu a tempo. Costuma ser firewall do Windows ou porta fechada no host, ou CGNAT do provedor. Peça para o host usar "Testar conectividade" nas Configurações ou uma VPN (Radmin, Tailscale) e mandar o novo código.',
};

/** Shown instead of the "host unreachable" text when a Cloudflare room cannot be reached. */
export const UNREACHABLE_CLOUD_TEXT =
  'Não consegui alcançar o servidor da sala (Cloudflare). Confira o código e a sua internet; o dono da sala pode ter removido o Worker dele.';

/** Cloudflare rooms: how often the client pings, and how long without any answer counts as a dead connection. */
const PING_MS = 10_000;
const DEAD_AFTER_MS = 30_000;
/** How long the client keeps trying to get its place back (the Worker keeps the place for 60 s). */
const RESUME_WINDOW_MS = 55_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SignalingClient {
  private ws: WebSocket | null = null;
  private keepAlive: number | null = null;
  onMessage: (msg: Message) => void = () => undefined;
  onClose: (reason: 'room-closed' | 'lost') => void = () => undefined;
  /** The connection dropped and the client is trying to get back in (true), or it is over that (false). */
  onReconnecting: (active: boolean) => void = () => undefined;
  /** The place in the room was taken back; `welcome.peers` is the room as it is now. */
  onResumed: (welcome: WelcomePayload) => void = () => undefined;
  private closedByRoom = false;
  private intentionalClose = false;
  private connectedAt = 0;
  private lastMessageAt = 0;
  private reconnecting = false;
  private url = '';
  private identity: { name: string; avatar: string | null } = { name: '', avatar: null };
  private peerId = '';
  private resumeToken = '';

  /** Writes a room-connection line to jaca.log (never the url, token or invite code). */
  private logRoom(text: string): void {
    void window.jaca.log('sala', text);
  }

  private get isCloud(): boolean {
    return this.url.includes('/ws/');
  }

  async connect(url: string, token: number, name: string, avatar: string | null, extra: { roomName?: string } = {}): Promise<WelcomePayload> {
    this.url = url;
    this.identity = { name, avatar };
    const { ws, welcome } = await this.openSocket(url, { token, name, avatar, canResume: true, ...(extra.roomName !== undefined ? { roomName: extra.roomName } : {}) });
    this.peerId = welcome.peerId;
    this.resumeToken = welcome.resumeToken ?? '';
    this.logRoom(`conectado à sala (${this.isCloud ? 'Cloudflare' : 'direto'}${this.resumeToken ? ', retomada disponível' : ''})`);
    this.adopt(ws);
    return welcome;
  }

  /** Opens a socket, sends the join message and waits for the welcome. The socket is closed again when anything goes wrong. */
  private openSocket(url: string, joinPayload: object): Promise<{ ws: WebSocket; welcome: WelcomePayload }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      const fail = (e: JoinError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(e);
      };
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new JoinError('UNREACHABLE'));
        return;
      }
      const timer = setTimeout(() => fail(new JoinError('TIMEOUT')), 7000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', to: null, payload: joinPayload }));
      ws.onerror = () => fail(new JoinError('UNREACHABLE'));
      ws.onclose = () => fail(new JoinError('UNREACHABLE'));
      ws.onmessage = (ev) => {
        let msg: Message;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          settled = true;
          clearTimeout(timer);
          resolve({ ws, welcome: msg.payload as WelcomePayload });
        } else if (msg.type === 'error') {
          fail(new JoinError(msg.payload?.code ?? 'BAD_REQUEST'));
        }
      };
    });
  }

  /** Makes a joined socket the live one: routes its messages and watches that it stays alive. */
  private adopt(ws: WebSocket): void {
    this.ws = ws;
    this.connectedAt = Date.now();
    this.lastMessageAt = this.connectedAt;
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg: Message;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'room-closed') this.closedByRoom = true;
      this.onMessage(msg);
    };
    ws.onerror = () => {
      if (ws === this.ws) this.logRoom(`erro no WebSocket (estado ${ws.readyState}, online ${navigator.onLine})`);
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      const kind = this.closedByRoom ? 'sala encerrada pelo host' : this.intentionalClose ? 'saída voluntária' : 'conexão perdida';
      this.logRoom(`WebSocket fechado: ${kind}; código ${ev.code}; motivo "${ev.reason}"; limpo ${ev.wasClean}; online ${navigator.onLine}; conectado há ${Math.round((Date.now() - this.connectedAt) / 1000)} s; última resposta há ${Math.round((Date.now() - this.lastMessageAt) / 1000)} s`);
      this.stopKeepAlive();
      if (this.intentionalClose) return;
      if (this.closedByRoom) return this.onClose('room-closed');
      this.lost();
    };
    this.stopKeepAlive();
    if (this.isCloud) {
      // the Worker answers the text "ping" without waking up, which keeps the connection alive through proxies and idle timeouts
      this.keepAlive = window.setInterval(() => {
        if (ws !== this.ws) return;
        if (Date.now() - this.lastMessageAt > DEAD_AFTER_MS) {
          this.logRoom(`sem resposta da sala há ${Math.round((Date.now() - this.lastMessageAt) / 1000)} s: considerando a conexão morta`);
          this.ws = null;
          ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          this.stopKeepAlive();
          this.lost();
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, PING_MS);
    }
  }

  /** The connection dropped by itself: get the place back when the Worker allows it, otherwise the session is over. */
  private lost(): void {
    if (this.resumeToken && this.isCloud) void this.reconnect();
    else this.onClose('lost');
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.onReconnecting(true);
    // the host connects with ?create=1&key=...; coming back needs neither (the resume token proves who it is)
    const resumeUrl = this.url.split('?')[0];
    const deadline = Date.now() + RESUME_WINDOW_MS;
    let delay = 500;
    let attempt = 0;
    while (!this.intentionalClose && Date.now() < deadline) {
      attempt++;
      try {
        const { ws, welcome } = await this.openSocket(resumeUrl, { token: 0, ...this.identity, resume: { peerId: this.peerId, token: this.resumeToken } });
        if (this.intentionalClose) {
          ws.onmessage = ws.onerror = ws.onclose = null;
          ws.close();
          break;
        }
        this.logRoom(`reconectado à sala na tentativa ${attempt}`);
        this.adopt(ws);
        this.reconnecting = false;
        this.onReconnecting(false);
        this.onResumed(welcome);
        return;
      } catch (e) {
        const code = e instanceof JoinError ? e.code : 'erro';
        this.logRoom(`tentativa ${attempt} de reconexão falhou: ${code}`);
        if (code === 'ROOM_CLOSED' || code === 'BAD_TOKEN') break; // the place is gone for good
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
    }
    this.reconnecting = false;
    this.onReconnecting(false);
    if (!this.intentionalClose) {
      this.logRoom('não consegui voltar para a sala a tempo');
      this.onClose('lost');
    }
  }

  send(type: MessageType, to: string | null, payload: unknown = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, to, payload }));
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== null) window.clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  close(): void {
    this.stopKeepAlive();
    this.intentionalClose = true;
    this.ws?.close(1000, 'leave'); // the reason tells the Worker this is a real leave, not a drop to wait out
    this.ws = null;
  }
}
