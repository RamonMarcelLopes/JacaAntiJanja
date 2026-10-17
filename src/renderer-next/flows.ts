// What happens when a person starts a room, joins one or leaves: the same steps as the original interface, without any screen in them.
import { encodeCloudInvite, encodeInvite, parseInvite } from '../shared/invite';
import { AppConfig, cleanRoomIcon, DEFAULT_ROOM_ICON, FixedRoom, RoomInfo } from '../shared/protocol';
import { diagnoseCloud } from '../renderer/cloud-diagnose';
import { playSound } from '../renderer/sounds';
import { Session } from '../renderer/session';
import { JOIN_ERROR_TEXT, JoinError, UNREACHABLE_CLOUD_TEXT } from '../renderer/signaling-client';
import { toast } from './fx';
import { askFixedRoomBusy } from './ui/dialogs';
import { emit, S, updateConfig } from './state';

export const DEFAULT_ROOM_NAME = 'Jaca room';
export const TEMPORARY = 'temporary';
export const NEW_FIXED = 'new-fixed';

const errorText = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Makes the room the one on screen. Everything the room reports (people, pictures, notices) comes through the session. */
export function enterRoom(session: Session, room: RoomInfo | null): void {
  S.session = session;
  S.room = room;
  S.view = 'room';
  S.gridMode = false;
  S.panel = false;
  session.onChange = () => emit('session');
  session.onNotice = (text, kind) => toast(text, kind === 'error' ? 'warn' : 'info');
  // a notice pinned just now (yours or somebody's) has its own sound; quiet while a whole screen is shared, or it would go into the stream
  session.onRoomNoticeAdded = () => !session.muteIncoming && playSound('notice');
  session.onEnded = async (reason) => {
    playSound('self-leave'); // leaving, the room being closed or the connection dropping
    if (session.isHost) await window.jaca.closeRoom();
    if (reason === 'room-closed') toast('A sala foi encerrada pelo host.', 'warn');
    else if (reason === 'lost') toast('Conexão com a sala perdida.', 'warn');
    session.onChange = () => undefined;
    session.onNotice = () => undefined;
    S.session = null;
    S.room = null;
    S.view = 'home';
    emit('route');
  };
  void window.jaca.log('app', 'tela: sala');
  playSound('self-join');
  emit('route');
}

/** Leaves the room on screen (the host ends it for everybody). */
export function leaveRoom(): void {
  S.session?.leave();
}

export interface CreateOptions {
  /** TEMPORARY, NEW_FIXED or the id of one of the fixed rooms. */
  kind: string;
  name: string;
  webhook?: string;
  icon?: string;
  takeover?: boolean;
  /** Called with the progress text of the button while it works. */
  progress?: (text: string) => void;
}

/** Opens a room. Returns true when it opened (the person is then inside it). */
export async function createRoom(opts: CreateOptions): Promise<boolean> {
  const cfg = S.cfg;
  if (!cfg.name.trim()) {
    toast('Escolha um nome de exibição primeiro.', 'warn');
    return false;
  }
  const typedName = opts.name.replace(/\s+/g, ' ').trim() || DEFAULT_ROOM_NAME;
  if (opts.kind === NEW_FIXED && cfg.fixedRooms.some((r) => r.name.toLowerCase() === typedName.toLowerCase())) {
    toast('Você já tem uma sala fixa com esse nome. Escolha ela na lista.', 'warn');
    return false;
  }
  const webhook = (opts.webhook ?? '').trim();
  opts.progress?.(opts.kind !== TEMPORARY && opts.kind !== NEW_FIXED ? 'Iniciando sala...' : webhook ? 'Testando o Discord...' : 'Criando sala...');
  let fixed: FixedRoom | undefined;
  try {
    if (opts.kind === NEW_FIXED) {
      // the new fixed room is kept (with its Discord webhook, tested first) before the room is opened; a bad webhook stops everything here
      const saved = await window.jaca.saveFixedRoom({ name: typedName, icon: opts.icon, webhook: webhook || undefined });
      if (!saved.ok) throw new Error(saved.message);
      await updateConfig({});
      fixed = S.cfg.fixedRooms.find((r) => r.id === saved.id);
      if (!fixed) throw new Error('Não foi possível criar a sala fixa.');
      opts.progress?.('Criando sala...');
    } else if (opts.kind !== TEMPORARY) {
      fixed = S.cfg.fixedRooms.find((r) => r.id === opts.kind);
      if (!fixed) throw new Error('Essa sala fixa não existe mais.');
    }
    const roomName = fixed ? fixed.name : typedName;
    // the picture is chosen here, once, and travels with the room: everybody who joins sees this same one (a fixed room without one gets the default)
    const roomIcon = cleanRoomIcon(fixed ? fixed.icon : opts.icon) ?? DEFAULT_ROOM_ICON;
    const room = await window.jaca.createRoom(roomName, fixed?.id, opts.takeover, roomIcon);
    // Cloudflare mode: the owner's Worker is the room server (the key is inside wsUrl and never shown); direct mode: our own local server
    const session =
      room.mode === 'cloudflare'
        ? await Session.join(room.wsUrl!, 0, S.cfg, true, room.code, { roomName, roomIcon })
        : await Session.join(`ws://127.0.0.1:${room.port}`, room.token, S.cfg, true);
    room.warnings.forEach((w) => toast(w, 'warn'));
    if (!fixed && opts.icon) S.tempIcon = opts.icon;
    enterRoom(session, room);
    // the notice in the Discord channel of THIS fixed room (if it has a webhook) goes out only now that the room really is open
    if (fixed) {
      void window.jaca.discordNotify({ fixedId: fixed.id, code: room.code }).then((r) => {
        if (!r.ok) toast(`Não consegui avisar no Discord: ${r.message}`, 'warn');
      });
    }
    return true;
  } catch (e: any) {
    void window.jaca.log('criar', `${e instanceof JoinError ? e.code : 'erro'}: ${String(e?.message ?? e)} (modo ${S.cfg.connectionMode})${e instanceof JoinError && e.detail ? ' | o que aconteceu: ' + e.detail : e?.stack ? ' | ' + String(e.stack).split('\n').slice(1, 3).join(' ') : ''}`);
    await window.jaca.closeRoom();
    if (!(e instanceof JoinError) && fixed && errorText(e) === 'FIXED_ROOM_BUSY') {
      // the fixed room still looks open (the app closed without ending it): reopen the same room, or open a temporary one instead
      const choice = await askFixedRoomBusy(fixed.name);
      if (choice === 'takeover') return createRoom({ ...opts, takeover: true });
      if (choice === 'temporary') return createRoom({ ...opts, kind: TEMPORARY, name: fixed.name, webhook: '' });
      return false;
    }
    toast(e instanceof JoinError ? (e.code === 'UNREACHABLE' && S.cfg.connectionMode === 'cloudflare' ? UNREACHABLE_CLOUD_TEXT : (JOIN_ERROR_TEXT[e.code] ?? e.message)) : errorText(e), 'warn');
    return false;
  }
}

/** Joins with a typed code or the code of a saved room. Returns true when it got in. */
export async function joinRoom(codeText: string, progress?: (text: string) => void): Promise<boolean> {
  const cfg: AppConfig = S.cfg;
  if (!cfg.name.trim()) {
    toast('Escolha um nome de exibição primeiro.', 'warn');
    return false;
  }
  const invite = parseInvite(codeText);
  if (!invite) {
    toast('Código de convite inválido.', 'warn');
    return false;
  }
  progress?.('Entrando...');
  try {
    let session: Session;
    if (invite.kind === 'cloud') {
      // the address is derived from the code (jaca-sala.<subdomain>.workers.dev); the main process re-checks the subdomain
      const base = await window.jaca.workerWsBase(invite.subdomain);
      if (!base) throw new Error('Código de convite inválido.');
      session = await Session.join(`${base}/ws/${invite.roomId}`, 0, cfg, false, encodeCloudInvite(invite.roomId, invite.subdomain));
    } else {
      session = await Session.join(`ws://${invite.ip}:${invite.port}`, invite.token, cfg, false, encodeInvite(invite));
    }
    enterRoom(session, null);
    return true;
  } catch (e: any) {
    void window.jaca.log('entrar', `${e instanceof JoinError ? e.code : 'erro'}: ${String(e?.message ?? e)} (${invite.kind === 'cloud' ? 'Cloudflare, conta ' + invite.subdomain : 'direto'})${e instanceof JoinError && e.detail ? ' | o que aconteceu: ' + e.detail : e?.stack ? ' | ' + String(e.stack).split('\n').slice(1, 3).join(' ') : ''}`); // never the full code: it is a way into the room
    let text = e instanceof JoinError ? (JOIN_ERROR_TEXT[e.code] ?? e.message) : String(e?.message ?? 'Falha ao entrar na sala.');
    if (e instanceof JoinError && (e.code === 'UNREACHABLE' || e.code === 'TIMEOUT') && invite.kind === 'cloud') {
      // find out whether this PC's network is the problem, instead of just saying it failed
      progress?.('Verificando...');
      const base = await window.jaca.workerWsBase(invite.subdomain);
      text = base ? await diagnoseCloud(base, invite.subdomain, e.code === 'TIMEOUT' ? 'TIMEOUT' : 'UNREACHABLE') : UNREACHABLE_CLOUD_TEXT;
    }
    void window.jaca.log('rede', `mensagem mostrada: ${text}`);
    toast(text, 'warn');
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------- room status polling
let pollTimer: number | undefined;

/** Asks the room server whether the saved rooms are open (every 20 s, and now). Tells the person when a favorite opens. */
export async function pollRooms(): Promise<void> {
  if (document.hidden) return;
  const codes = [...new Set([...S.cfg.favoriteRooms.map((f) => f.code), ...(S.cfg.workerSubdomain ? S.cfg.fixedRooms.map((r) => encodeCloudInvite(r.id, S.cfg.workerSubdomain)) : [])])];
  if (!codes.length) return;
  const results = await window.jaca.roomsStatus(codes);
  let renamed = false;
  const favorites = S.cfg.favoriteRooms.map((fav) => {
    const st = results.find((r) => r.code === fav.code);
    if (!st) return fav;
    if (S.statuses.get(fav.code)?.state === 'closed' && st.state === 'open') toast(`A sala ${st.name || fav.name} abriu.`, 'info');
    S.statuses.set(fav.code, st);
    // the name is the host's: when the host renames the room, the favorite follows
    if (st.state === 'open' && st.name && st.name !== fav.name) {
      renamed = true;
      return { ...fav, name: st.name };
    }
    return fav;
  });
  for (const st of results) if (!S.cfg.favoriteRooms.some((f) => f.code === st.code)) S.statuses.set(st.code, st); // fixed rooms of this PC
  if (renamed) await updateConfig({ favoriteRooms: favorites });
  emit('rooms');
}

export function startPolling(): void {
  window.clearInterval(pollTimer);
  window.setTimeout(() => void pollRooms(), 100);
  pollTimer = window.setInterval(() => void pollRooms(), 20_000);
}
