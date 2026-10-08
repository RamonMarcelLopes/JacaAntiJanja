import { ErrorCode, Message, MessageType, PeerInfo } from '../shared/protocol';

export interface WelcomePayload {
  peerId: string;
  peers: PeerInfo[];
  roomName: string;
  /** How long the room had been open when this client joined (absent on hosts older than this feature). */
  roomAgeMs?: number;
  /** The room's invite code, so every participant can copy it (absent on older hosts). */
  inviteCode?: string;
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

export class SignalingClient {
  private ws: WebSocket | null = null;
  private keepAlive: number | null = null;
  onMessage: (msg: Message) => void = () => undefined;
  onClose: (reason: 'room-closed' | 'lost') => void = () => undefined;
  private closedByRoom = false;
  private intentionalClose = false;

  connect(url: string, token: number, name: string, avatar: string | null, extra: { roomName?: string } = {}): Promise<WelcomePayload> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e: JoinError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.intentionalClose = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(e);
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new JoinError('UNREACHABLE'));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => fail(new JoinError('TIMEOUT')), 7000);

      ws.onopen = () => this.send('join', null, { token, name, avatar, ...(extra.roomName !== undefined ? { roomName: extra.roomName } : {}) });
      ws.onerror = () => fail(new JoinError('UNREACHABLE'));
      ws.onclose = () => {
        this.stopKeepAlive();
        if (!settled) return fail(new JoinError('UNREACHABLE'));
        if (!this.intentionalClose) this.onClose(this.closedByRoom ? 'room-closed' : 'lost');
      };
      ws.onmessage = (ev) => {
        let msg: Message;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!settled) {
          if (msg.type === 'welcome') {
            settled = true;
            clearTimeout(timer);
            // the Worker answers this text without waking up, which keeps the connection alive through proxies and idle timeouts
            if (url.includes('/ws/')) this.keepAlive = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
            resolve(msg.payload as WelcomePayload);
          } else if (msg.type === 'error') {
            fail(new JoinError(msg.payload?.code ?? 'BAD_REQUEST'));
          }
          return;
        }
        if (msg.type === 'room-closed') this.closedByRoom = true;
        this.onMessage(msg);
      };
    });
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
    this.ws?.close();
    this.ws = null;
  }
}
