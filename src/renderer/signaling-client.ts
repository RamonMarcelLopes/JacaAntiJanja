import { ErrorCode, Message, MessageType, PeerInfo } from '../shared/protocol';
import { fitAvatar } from './dom';

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
  /** What exactly happened (phase, times, close code), for the log and for the technical line of the error; never a key or a code. */
  detail = '';
  constructor(public code: ErrorCode | 'UNREACHABLE' | 'TIMEOUT') {
    super(code);
  }
}

/** How long a join waits for the room's answer, per attempt. A Cloudflare join gets two attempts: the route to workers.dev sometimes takes seconds to open. */
export const JOIN_WAIT_MS = 15_000;
const CLOUD_JOIN_ATTEMPTS = 2;

/**
 * A server answer as it came, for the log: photos shortened to their size, the resume token and the invite code hidden (they are ways
 * into a room), the rest untouched and cut at 700 characters.
 */
export function redact(raw: string): string {
  return raw
    .replace(/"avatar":"data:image\/[^"]*"/g, (m) => `"avatar":"<foto ${m.length} bytes>"`)
    .replace(/"(resumeToken|token|key|inviteCode)":"[^"]*"/g, '"$1":"<oculto>"')
    .slice(0, 700);
}

/** The network the browser reports (type, round trip, speed): one more clue in the log when a join is slow. */
function networkHint(): string {
  const c = (navigator as any).connection;
  return `online ${navigator.onLine}${c ? `, rede ${c.effectiveType ?? '?'} rtt ${c.rtt ?? '?'} ms ${c.downlink ?? '?'} Mbps${c.saveData ? ' economia de dados' : ''}` : ''}`;
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
    // a photo bigger than the room server accepts would make it stay silent, so a smaller copy goes (see fitAvatar); the same copy is used to get back in
    const sentAvatar = await fitAvatar(avatar);
    this.identity = { name, avatar: sentAvatar };
    const payload = { token, name, avatar: sentAvatar, canResume: true, ...(extra.roomName !== undefined ? { roomName: extra.roomName } : {}) };
    // Cloudflare: when the room does not answer (nothing, not even "closed"), one more attempt before giving up; a clear answer (closed, full...) is final
    // (not for the host creating a room: if the first attempt did reach the Worker, a second "create" would be refused because the host is already there)
    const attempts = this.isCloud && !url.includes('create=1') ? CLOUD_JOIN_ATTEMPTS : 1;
    const details: string[] = [];
    let lastError: JoinError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const { ws, welcome } = await this.openSocket(url, payload, { kind: 'entrar', label: `entrada ${attempt}/${attempts}` });
        this.peerId = welcome.peerId;
        this.resumeToken = welcome.resumeToken ?? '';
        this.logRoom(`conectado à sala (${this.isCloud ? 'Cloudflare' : 'direto'}${this.resumeToken ? ', retomada disponível' : ''}; ${welcome.peers.length} pessoa(s) na sala; tentativa ${attempt}/${attempts})`);
        this.adopt(ws);
        return welcome;
      } catch (e) {
        if (!(e instanceof JoinError)) throw e;
        lastError = e;
        details.push(`tentativa ${attempt}: ${e.detail || e.code}`);
        const silent = e.code === 'TIMEOUT' || e.code === 'UNREACHABLE';
        if (!silent || attempt === attempts) break;
        void window.jaca.log('entrar', `sem resposta na tentativa ${attempt}/${attempts}; tentando de novo em 1 s`);
        await sleep(1000);
      }
    }
    lastError!.detail = details.join(' | ');
    throw lastError!;
  }

  /**
   * Opens a socket, sends the join message and waits for the welcome. The socket is closed again when anything goes wrong.
   * Every step is written to the log (when the connection opened, what came back and how big, how it ended), because "timeout" alone
   * does not say whether the connection never opened or the room never answered.
   */
  private openSocket(url: string, joinPayload: object, opts: { waitMs?: number; label?: string; kind?: 'entrar' | 'sala' } = {}): Promise<{ ws: WebSocket; welcome: WelcomePayload }> {
    const waitMs = opts.waitMs ?? JOIN_WAIT_MS;
    const label = opts.label ?? 'entrada';
    const kind = opts.kind ?? 'sala';
    const cloud = url.includes('/ws/');
    let host = 'servidor direto';
    if (cloud) {
      try {
        host = new URL(url).host; // the Worker address only: never the room id, the token or the key that the url may carry
      } catch {
        host = 'endereço inválido';
      }
    }
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const ms = () => Math.round(performance.now() - t0);
      const log = (text: string) => void window.jaca.log(kind, `${label}: ${text}`);
      let openedAt = 0;
      let settled = false;
      let ws: WebSocket;
      const fail = (code: JoinError['code'], why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        const e = new JoinError(code);
        e.detail = `${why} [${host}, ${ms()} ms, ${networkHint()}]`;
        log(`falhou (${code}): ${e.detail}`);
        reject(e);
      };
      log(`conectando a ${host} (espera até ${waitMs / 1000} s; ${networkHint()})`);
      try {
        ws = new WebSocket(url);
      } catch (err: any) {
        const e = new JoinError('UNREACHABLE');
        e.detail = `não foi possível criar a conexão: ${err?.message ?? err}`;
        log(`falhou (UNREACHABLE): ${e.detail}`);
        reject(e);
        return;
      }
      const timer = setTimeout(
        () => fail('TIMEOUT', openedAt ? `a conexão abriu em ${openedAt} ms, mas a sala não respondeu em ${waitMs / 1000} s` : `a conexão nem chegou a abrir em ${waitMs / 1000} s`),
        waitMs,
      );
      ws.onopen = () => {
        openedAt = ms();
        log(`conexão aberta em ${openedAt} ms; enviando o pedido de entrada`);
        ws.send(JSON.stringify({ type: 'join', to: null, payload: joinPayload }));
      };
      ws.onerror = (ev) => {
        log(`evento de erro da conexão: ${(ev as ErrorEvent).message || 'sem mensagem (o navegador não dá detalhes)'}; tipo ${ev.type}; estado ${ws.readyState} (0 conectando, 1 aberta, 2 fechando, 3 fechada); ${openedAt ? `aberta em ${openedAt} ms` : 'nunca abriu'}`);
        fail('UNREACHABLE', openedAt ? 'erro depois de abrir a conexão' : 'a conexão falhou antes de abrir');
      };
      ws.onclose = (ev) => fail('UNREACHABLE', `a conexão fechou antes da resposta (código ${ev.code}, motivo "${ev.reason}", limpa ${ev.wasClean}${openedAt ? `, aberta em ${openedAt} ms` : ', nunca abriu'})`);
      ws.onmessage = (ev) => {
        const raw = String(ev.data);
        let msg: Message;
        try {
          msg = JSON.parse(raw);
        } catch {
          log(`resposta que não é JSON (${raw.length} bytes) em ${ms()} ms`);
          return;
        }
        log(`resposta "${msg.type}"${msg.type === 'error' ? ` (${msg.payload?.code})` : ''}, ${raw.length} bytes, em ${ms()} ms; conteúdo: ${redact(raw)}`);
        if (msg.type === 'welcome') {
          settled = true;
          clearTimeout(timer);
          resolve({ ws, welcome: msg.payload as WelcomePayload });
        } else if (msg.type === 'error') {
          fail((msg.payload?.code ?? 'BAD_REQUEST') as JoinError['code'], `a sala respondeu ${msg.payload?.code ?? 'erro'}`);
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
      // everything that comes in is in the log too, except network candidates and the descriptions of connections (big): only their size
      if (msg.type !== 'ice') this.logRoom(`recebido ${msg.type}${msg.from ? ' de ' + msg.from.slice(0, 4) : ''}: ${msg.type === 'offer' || msg.type === 'answer' ? `${String(ev.data).length} bytes` : redact(String(ev.data))}`);
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
    if (this.ws?.readyState !== WebSocket.OPEN) {
      if (type !== 'ice') this.logRoom(`não enviei "${type}": a conexão com a sala não está aberta (estado ${this.ws?.readyState ?? 'sem conexão'})`);
      return;
    }
    const raw = JSON.stringify({ type, to, payload });
    this.ws.send(raw);
    // everything that goes out is in the log, except the stream of network candidates (hundreds per connection)
    if (type !== 'ice') this.logRoom(`enviado ${type}${to ? ' para ' + to.slice(0, 4) : ''}: ${type === 'offer' || type === 'answer' ? `${raw.length} bytes` : redact(raw)}`);
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
