// The stage of a room: tiles of the people (grid) or one big picture (focus), the top bar and the floating call bar.
import { Camera, CameraOff, ChevronDown, Copy, Eye, Gauge, Maximize2, Megaphone, Monitor, MonitorOff, MonitorUp, PanelRight, PhoneOff, SlidersHorizontal, Volume2, VolumeX, X, Zap, Activity, ZoomIn } from 'lucide';
import { AppConfig, Fps, Resolution, ShareInfo, ShareMode } from '../../shared/protocol';
import { listCameras } from '../../renderer/cameras';
import { PeerView } from '../../renderer/session';
import { h, icon, reducedMotion } from '../dom';
import { burst, rollingNumber, toast } from '../fx';
import { leaveRoom } from '../flows';
import { emit, focusId, hueOf, iconOf, isMe, peers, roomEntries, S, sameRoom, updateConfig } from '../state';
import { gradient, personAvatar, ROOM_ICONS } from './controls';
import { noticeChip, openNewNotice } from './notices';
import { confirmDialog, openShare, prefetchSources } from './dialogs';
import { closeMenus, toggleMenu, type MenuRow } from './menus';

interface Tile {
  el: HTMLElement;
  id: string;
  viewers: ReturnType<typeof rollingNumber>;
  video: HTMLVideoElement | null;
  refs: { clip: HTMLElement; scene: HTMLElement; avatarWrap: HTMLElement; gate: HTMLElement; badges: HTMLElement; controls: HTMLElement; name: HTMLElement; edge: HTMLElement | null; connecting: HTMLElement; volume: HTMLInputElement; mute: HTMLButtonElement };
  sig: string;
  infoSig: string;
}

const QUALITY_ROWS: Array<{ key: 'resolution' | 'fps' | 'mode'; label: string; icon: typeof Monitor; options: Array<[string | number, string]> }> = [
  { key: 'resolution', label: 'Resolução', icon: Monitor, options: [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']] },
  { key: 'fps', label: 'FPS', icon: Zap, options: [[30, '30 fps'], [60, '60 fps']] },
  { key: 'mode', label: 'Modo', icon: SlidersHorizontal, options: [['motion', 'Movimento'], ['detail', 'Detalhe']] },
];

/** The picture and color of the room on screen: the icon of the owner's fixed room when it is one, otherwise one taken from the code. */
export function currentRoomLook(): { icon: string; hue: number } {
  const code = S.session?.inviteCode ?? '';
  const entry = roomEntries().find((r) => sameRoom(r.code, code));
  if (entry) return { icon: entry.icon, hue: entry.hue };
  return { icon: iconOf(S.session?.roomIcon), hue: hueOf(code || S.session?.roomName || 'sala') };
}

/**
 * Watching somebody from their tile. In the grid with other pictures already open the new one just joins them (the grid stays, like the original
 * interface); otherwise the picture opens in focus.
 */
function watchFromTile(peerId: string): void {
  const session = S.session;
  if (!session) return;
  const others = [...session.watched].some((id) => id !== peerId);
  closeMenus();
  session.addView(peerId);
  if (!(S.gridMode && others)) {
    session.focus(peerId);
    S.gridMode = false;
  }
  emit('session');
}

export function stage(): HTMLElement & { draw(animate?: boolean): void; tick(): void } {
  const tiles = new Map<string, Tile>();
  const root = h('section', { class: 'relative flex-1 flex flex-col min-w-0 bg-s2', 'data-testid': 'stage' });
  const topbar = h('div', { class: 'h-12 px-4 flex items-center gap-3 border-b border-line flex-none bg-s2/80 backdrop-blur z-10' });
  const arena = h('div', { class: 'relative flex-1 min-h-0 overflow-hidden' });
  const content = h('div', { class: 'absolute inset-0 z-[1]' });
  const callbar = h('div', { class: 'callbar-wrap absolute left-1/2 bottom-5 z-20 -translate-x-1/2 transition-opacity duration-300' });
  const notice = h('div', { class: 'absolute left-1/2 top-3 z-20 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none' });
  // the pinned notices of the room sit in the same spot, above the short messages (reconnecting, audio); the chip is clickable, the rest is not
  const pinned = noticeChip();
  const pills = h('div', { class: 'flex flex-col items-center gap-2' });
  notice.append(pinned.el, pills);
  arena.append(h('div', { class: 'aurora' }, h('i'), h('i'), h('i')), content, notice, callbar);
  root.append(topbar, arena);
  let layout: 'grid' | 'focus' | '' = '';
  let gridEl: HTMLElement | null = null;
  let focusWrap: HTMLElement | null = null;
  let holderEl: HTMLElement | null = null;
  let clickTimer: number | undefined;

  // ------------------------------------------------------------------------------------------------ fullscreen
  // Esc leaves the fullscreen picture (Electron does not do it by itself)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.fullscreenElement) void document.exitFullscreen();
  });
  const toggleFullscreen = async (t: Tile) => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    const session = S.session;
    // Your own screen in fullscreen on the monitor it is capturing would capture itself (an endless tunnel of previews whose colors drift to green)
    if (session && t.id === session.selfId && session.sharedSourceId && (await window.jaca.isOnAppMonitor(session.sharedSourceId))) {
      toast('Você está compartilhando o monitor onde o app está. Mova o app para outro monitor para ver sua tela em tela cheia.', 'warn');
      return;
    }
    void t.el.requestFullscreen?.();
  };

  // ------------------------------------------------------------------------------------------------ one tile
  function makeTile(p: PeerView): Tile {
    const el = h('div', { class: 'tile animate-pop', 'data-key': p.peerId, 'data-person': p.name });
    const clip = h('div', { class: 'clip' });
    const hue = hueOf(p.peerId);
    const bg = h('div', { class: 'absolute inset-0', style: { background: `radial-gradient(120% 90% at 20% 10%, hsl(${hue} 55% 26%), transparent 60%), radial-gradient(100% 100% at 90% 100%, hsl(${(hue + 50) % 360} 60% 20%), transparent 65%), var(--s3)` } });
    const scene = h('div', { class: 'absolute inset-0 opacity-0 transition-opacity duration-500 bg-black' });
    const avatarWrap = h('div', { class: 'tile-avatar absolute inset-0 grid place-items-center transition-all duration-500' }, h('div', { class: 'animate-float', 'data-slot': 'avatar' }));
    const connecting = h('div', { class: 'absolute inset-0 grid place-items-center text-[13px] font-semibold text-muted pointer-events-none opacity-0 transition-opacity duration-300' }, 'Conectando à transmissão...');
    const gate = h('div', { class: 'absolute inset-0 grid place-items-center bg-black/35 backdrop-blur-md transition-opacity duration-300 opacity-0 pointer-events-none' },
      h('button', { class: 'btn btn-primary ripple h-10 px-5 text-sm', 'aria-label': `Assistir ${p.name}` }, icon(Eye, 16), 'Assistir'),
    );
    clip.append(bg, scene, avatarWrap, connecting, gate);

    const badges = h('div', { class: 'tile-info absolute top-3 left-3 right-3 flex items-center justify-between z-[4] pointer-events-none' });
    const viewers = rollingNumber(0);
    const name = h('div', { class: 'tile-info absolute left-3 bottom-3 z-[4] flex items-center gap-2 px-2.5 h-7 rounded-lg bg-black/55 backdrop-blur text-[13px] font-semibold max-w-[70%]' });
    const volume = h('input', { type: 'range', min: '0', max: '100', value: '100', class: 'range !w-20', 'aria-label': 'Volume', style: { '--v': '100%' } }) as HTMLInputElement;
    const mute = h('button', { class: 'icon-btn !text-white', 'data-tip': 'Silenciar', 'aria-label': 'Silenciar' }, icon(Volume2, 16));
    const controls = h('div', { class: 'controls absolute right-3 bottom-3 z-[5] flex items-center gap-1 px-2 h-9 rounded-xl bg-black/65 backdrop-blur' },
      mute,
      volume,
      h('button', { class: 'icon-btn !text-white', 'data-tip': 'Tela cheia', 'aria-label': 'Tela cheia', onclick: (e: Event) => { e.stopPropagation(); void toggleFullscreen(tile); } }, icon(Maximize2, 16)),
      h('button', { class: 'tile-stop icon-btn !text-white hover:!bg-live', 'data-tip': 'Parar de assistir', 'aria-label': `Parar de assistir ${p.name}`, onclick: (e: Event) => { e.stopPropagation(); S.session?.removeView(p.peerId); } }, icon(X, 16)),
    );
    el.append(clip, badges, name, controls);
    el.addEventListener('animationend', (e) => { if (e.target === el) el.classList.remove('animate-pop'); }); // the entrance plays once, never again when the tile is moved
    const tile: Tile = { el, id: p.peerId, viewers, video: null, refs: { clip, scene, avatarWrap, gate, badges, controls, name, edge: null, connecting, volume, mute }, sig: '', infoSig: '' };

    const applyVolume = () => {
      const v = Number(volume.value);
      volume.style.setProperty('--v', `${v}%`);
      if (tile.video) tile.video.volume = v / 100;
      mute.replaceChildren(icon(v === 0 ? VolumeX : Volume2, 16));
      mute.setAttribute('aria-label', v === 0 ? 'Ativar o som' : 'Silenciar');
    };
    volume.addEventListener('input', applyVolume);
    let before = 100;
    mute.onclick = (e) => {
      e.stopPropagation();
      if (Number(volume.value) === 0) volume.value = String(before);
      else {
        before = Number(volume.value);
        volume.value = '0';
      }
      applyVolume();
    };
    el.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.controls')) return;
      window.clearTimeout(clickTimer);
      void toggleFullscreen(tile);
    });
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.controls')) return;
      const session = S.session;
      const person = session?.peers.get(p.peerId);
      if (!session || !person?.share || (isMe(person) && !session.sharing)) {
        el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
        return;
      }
      if (!session.watched.has(p.peerId)) return void watchFromTile(p.peerId);
      // one click on a picture that is open: in the grid it comes to the focus, in the focus it goes back to the grid (a double click is the fullscreen)
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        if (focusId() === p.peerId) S.gridMode = true;
        else {
          session.focus(p.peerId);
          S.gridMode = false;
        }
        emit('session');
      }, 230);
    });
    return tile;
  }

  /** Brings a tile in line with the person's state: live or not, being watched or not, viewers. */
  function updateTile(t: Tile, p: PeerView): void {
    const session = S.session!;
    const { refs } = t;
    const live = !!p.share;
    const me = isMe(p);
    const watching = live && session.watched.has(p.peerId);
    const gated = live && !watching && (!me || session.sharing);
    const stream = watching ? session.streamOf(p.peerId) : null;
    t.el.classList.toggle('live', live);
    t.el.style.cursor = live ? 'pointer' : 'default';
    if (live && !refs.edge) {
      refs.edge = h('i', { class: 'live-edge' });
      t.el.append(refs.edge);
    } else if (!live && refs.edge) {
      refs.edge.remove();
      refs.edge = null;
    }
    // the avatar (photo or initials) is redrawn only when it changes
    const avatarSig = `${p.name}|${p.avatar?.length ?? 0}`;
    if (t.sig !== avatarSig) {
      t.sig = avatarSig;
      refs.avatarWrap.firstElementChild!.replaceChildren(personAvatar(p, 96));
      t.el.dataset.person = p.name;
    }
    // the picture: one <video> per person being watched, kept while the stream is the same
    if (watching && !t.video) {
      t.video = h('video', { autoplay: true, playsInline: true, disablePictureInPicture: true, class: 'absolute inset-0 w-full h-full object-contain bg-black' });
      t.video.volume = Number(refs.volume.value) / 100;
      refs.scene.append(t.video);
    } else if (!watching && t.video) {
      t.video.srcObject = null;
      t.video.remove();
      t.video = null;
    }
    if (t.video) {
      if (t.video.srcObject !== stream) {
        t.video.srcObject = stream;
        void t.video.play().catch(() => undefined);
      }
      // you never hear your own screen; incoming sound is muted while a whole screen is shared (it would loop back into the stream);
      // in the focus only the picture in focus is heard, in the grid everybody is
      t.video.muted = me || session.muteIncoming || (!S.gridMode && focusId() !== null && focusId() !== p.peerId);
    }
    const showPicture = !!stream;
    refs.scene.style.opacity = showPicture ? '1' : '0';
    refs.connecting.style.opacity = watching && !stream ? '1' : '0';
    refs.avatarWrap.style.opacity = live && (showPicture || watching) ? '0' : live ? '0.35' : '1';
    refs.avatarWrap.style.transform = live && (showPicture || watching) ? 'scale(0.6)' : '';
    refs.avatarWrap.style.filter = gated ? 'blur(6px)' : '';
    refs.gate.style.opacity = gated ? '1' : '0';
    refs.gate.style.pointerEvents = gated ? 'auto' : 'none';
    refs.gate.style.visibility = gated ? 'visible' : 'hidden';
    (refs.gate.firstElementChild as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      watchFromTile(p.peerId);
    };
    refs.controls.style.display = watching && !me ? '' : me && watching ? '' : 'none';
    refs.volume.parentElement!.querySelectorAll<HTMLElement>('[aria-label="Volume"], [aria-label="Silenciar"], [aria-label="Ativar o som"]').forEach((c) => (c.style.display = me ? 'none' : ''));

    // top badges
    const viewerCount = p.share?.viewers;
    // the labels are rebuilt only when they change: this runs every second, and rebuilding restarted the blinking dot of AO VIVO
    const infoSig = JSON.stringify([live, typeof viewerCount === 'number', p.share?.source ?? '', me, p.name]);
    if (t.infoSig !== infoSig) {
      t.infoSig = infoSig;
      refs.badges.replaceChildren(
        ...[live ? h('span', { class: 'badge-live' }, 'AO VIVO') : h('span'), live && typeof viewerCount === 'number' ? h('span', { class: 'inline-flex items-center gap-1.5 px-2 h-6 rounded-lg bg-black/55 backdrop-blur text-xs font-bold', 'data-viewers': '' }, icon(Eye, 13), t.viewers.el) : null].filter((x): x is HTMLElement => !!x),
      );
      // name pill
      refs.name.replaceChildren(
        ...[live ? icon(p.share!.source === 'camera' ? Camera : MonitorUp, 14, 'text-accent') : null, h('span', { class: 'truncate' }, me ? `${p.name} (você)` : p.name)].filter((x): x is HTMLSpanElement | SVGElement => !!x),
      );
    }
    refs.badges.querySelector('[data-viewers]')?.setAttribute('aria-label', `${viewerCount ?? 0} assistindo`);
    t.viewers.set(viewerCount ?? 0);
  }

  // ------------------------------------------------------------------------------------------------ layouts
  function relayout(list: PeerView[], force = false): void {
    const before = new Map<string, DOMRect>();
    for (const [id, t] of tiles) if (t.el.isConnected) before.set(id, t.el.getBoundingClientRect());

    const fid = focusId();
    const focus = fid && list.some((p) => p.peerId === fid) ? fid : null;
    const next: 'grid' | 'focus' = focus ? 'focus' : 'grid';
    const ids = list.map((p) => p.peerId);

    // tiles that left
    for (const [id, t] of [...tiles]) {
      if (ids.includes(id)) continue;
      tiles.delete(id);
      if (t.video) t.video.srcObject = null;
      t.el.style.pointerEvents = 'none';
      t.el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.8)' }], { duration: 280, fill: 'forwards' }).onfinish = () => t.el.remove();
    }
    // tiles that came
    for (const p of list) if (!tiles.has(p.peerId)) tiles.set(p.peerId, makeTile(p));
    for (const p of list) updateTile(tiles.get(p.peerId)!, p);

    if (next === 'grid') {
      const n = list.length;
      const cols = n === 2 ? 1 : Math.max(1, Math.ceil(Math.sqrt(n)));
      // the same grid element is kept while the layout stays a grid: re-inserting the tiles would restart their CSS animations (they would jump)
      const keep = layout === 'grid' && gridEl && content.firstElementChild === gridEl;
      const grid = keep ? gridEl! : h('div', { class: 'tiles absolute inset-0' });
      grid.style.setProperty('--cols', String(cols));
      grid.style.setProperty('--rows', String(Math.max(1, Math.ceil(n / cols))));
      const els = list.map((p) => tiles.get(p.peerId)!.el);
      els.forEach((el) => el.classList.remove('big', 'fit-w'));
      if (!(keep && Array.from(grid.children).filter((c) => els.includes(c as HTMLElement)).every((c, i) => c === els[i]) && els.every((el) => el.parentElement === grid))) grid.append(...els);
      gridEl = grid;
      if (!keep) content.replaceChildren(grid);
    } else {
      const main = tiles.get(focus!)!;
      main.el.classList.remove('fit-w');
      main.el.classList.add('big');
      // the focus shows only the picture: the people are already in the column on the left, so there is no second list here
      for (const p of list) if (p.peerId !== focus) tiles.get(p.peerId)!.el.classList.remove('big', 'fit-w');
      // the other people wait in a hidden holder, so the pictures that are open keep playing (a video that leaves the page stops being shown)
      // the wrappers are kept while the layout stays in focus: re-inserting the picture would restart its animations (the colors of its edge jump)
      const keep = layout === 'focus' && focusWrap && holderEl && content.children[0] === focusWrap && content.children[1] === holderEl;
      const wrap = keep ? focusWrap! : h('div', { class: 'absolute inset-0 grid place-items-center p-4', style: { containerType: 'size' } });
      const holder = keep ? holderEl! : h('div', { class: 'absolute left-0 top-0 w-px h-px overflow-hidden opacity-0 pointer-events-none', 'aria-hidden': 'true' });
      if (main.el.parentElement !== wrap) wrap.replaceChildren(main.el);
      for (const p of list) if (p.peerId !== focus) {
        const el = tiles.get(p.peerId)!.el;
        if (el.parentElement !== holder) holder.append(el);
      }
      focusWrap = wrap;
      holderEl = holder;
      if (!keep) content.replaceChildren(wrap, holder);
    }
    // moving a video element pauses it: every picture on screen is resumed
    for (const t of tiles.values()) if (t.video?.srcObject) void t.video.play().catch(() => undefined);
    const stayedInFocus = layout === 'focus' && next === 'focus'; // somebody joining must not make the picture in focus jump
    layout = next;
    // in focus the call bar hides until the pointer is over the picture (like the real player); in the grid it stays
    arena.classList.toggle('arena-focus', next === 'focus');
    arena.dataset.layout = next;

    if (!reducedMotion() && (force || before.size) && !stayedInFocus) {
      for (const [id, t] of tiles) {
        const old = before.get(id);
        if (!old || !t.el.isConnected) continue;
        const now = t.el.getBoundingClientRect();
        if (!now.width) continue;
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        const sx = old.width / now.width;
        const sy = old.height / now.height;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
        t.el.animate([{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: 'top left', transform: 'none' }], { duration: 560, easing: 'cubic-bezier(0.34, 1.25, 0.64, 1)' });
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ top bar
  let topSig = '';
  function drawTop(): void {
    const session = S.session!;
    const look = currentRoomLook();
    // rebuilt only when something on it changed (rebuilding under a resting pointer made its buttons jump)
    const sig = JSON.stringify([look, session.roomName, session.isHost, session.inviteCode, S.panel]);
    if (sig === topSig) return;
    topSig = sig;
    const children: Array<Node | null> = [
      h('div', { class: 'grid place-items-center w-7 h-7 rounded-lg flex-none', 'data-testid': 'room-icon', 'data-icon': look.icon, style: { background: gradient(look.hue) } }, icon(ROOM_ICONS[look.icon], 15, 'text-white')),
      h('h1', { class: 'font-display font-bold text-[15px]', 'data-testid': 'room-title' }, session.roomName || (session.isHost ? 'Sua sala' : 'Sala')),
      session.inviteCode
        ? h('button', { class: 'inline-flex items-center gap-2 h-7 px-2.5 rounded-lg bg-s3 border border-line text-xs hover:border-accent transition-colors group', 'data-tip': 'Copiar código', 'aria-label': 'Copiar código da sala', 'data-code': session.inviteCode, onclick: async () => {
            try {
              await window.jaca.copyText(session.inviteCode);
              toast('Código copiado', 'ok');
            } catch {
              toast('Não foi possível copiar o código', 'warn');
            }
          } },
          h('span', { class: 'text-muted' }, 'Código'), h('code', { class: 'font-bold text-accent tracking-wider' }, session.inviteCode.split('@')[0]), icon(Copy, 13, 'text-muted group-hover:text-fg'))
        : null,
      h('div', { class: 'flex-1' }),
      h('button', { class: 'icon-btn', 'data-tip': 'Novo aviso', 'data-tip-side': 'bottom', 'aria-label': 'Novo aviso', onclick: () => openNewNotice() }, icon(Megaphone, 18)),
      h('button', { class: `icon-btn ${S.panel ? '!bg-accent !text-accent-fg' : ''}`, 'data-tip': 'Detalhes da transmissão', 'data-tip-side': 'bottom', 'aria-label': 'Detalhes', onclick: () => { S.panel = !S.panel; emit('panel'); } }, icon(PanelRight, 18)),
    ];
    topbar.replaceChildren(...children.filter((c): c is Node => !!c));
  }

  // ------------------------------------------------------------------------------------------------ the call bar
  const chevron = (open: () => void, dim = false) =>
    h('span', { class: `chev ${dim ? 'opacity-45' : ''}`, role: 'button', 'aria-label': 'Mais opções', onclick: (e: Event) => { e.stopPropagation(); open(); } }, icon(ChevronDown, 12));

  type Kind = 'screen' | 'camera';
  /** The saved defaults of a kind of transmission (Configurações > Transmissão for the screen, > Câmera for the camera: they are separate). */
  const defaultsOf = (kind: Kind): ShareInfo => (kind === 'camera' ? { resolution: S.cfg.cameraResolution, fps: S.cfg.cameraFps, mode: S.cfg.cameraMode } : { resolution: S.cfg.resolution, fps: S.cfg.fps, mode: S.cfg.mode });
  /** Is the transmission in progress of this kind? */
  const liveOf = (kind: Kind) => {
    const s = S.session;
    return s?.sharing && s.shareInfo && (s.shareInfo.source === 'camera') === (kind === 'camera') ? s : null;
  };
  /** What the menu shows: the quality of the transmission while that kind is live, otherwise the default of that kind. */
  const qualityOf = (kind: Kind): ShareInfo => liveOf(kind)?.shareInfo ?? defaultsOf(kind);
  const DEFAULT_KEYS = { screen: { resolution: 'resolution', fps: 'fps', mode: 'mode' }, camera: { resolution: 'cameraResolution', fps: 'cameraFps', mode: 'cameraMode' } } as const;
  /** Qualidade menu of the screen or of the camera. Live: it changes the transmission now. Not live: it changes the default used by the next one. */
  const qualityMenu = (kind: Kind) => (): MenuRow[] =>
    QUALITY_ROWS.map((q) => ({
      label: q.label,
      icon: q.icon,
      value: q.options.find(([v]) => v === qualityOf(kind)[q.key])?.[1],
      sub: () =>
        q.options.map(([v, text]) => ({
          label: text,
          icon: q.key === 'mode' ? (v === 'detail' ? ZoomIn : Activity) : q.icon,
          checked: v === qualityOf(kind)[q.key],
          onSelect: () => {
            const live = liveOf(kind);
            if (live?.shareInfo) {
              void live.updateQuality({ ...live.shareInfo, [q.key]: v } as ShareInfo);
              toast(`${q.label}: ${text}`, 'ok');
            } else {
              void updateConfig({ [DEFAULT_KEYS[kind][q.key]]: v } as Partial<AppConfig>);
              toast(`${q.label} ${kind === 'camera' ? 'da câmera' : 'da tela'}: ${text}`, 'ok');
            }
          },
        })),
    }));

  async function cameraRows(): Promise<MenuRow[]> {
    const cameras = await listCameras().catch(() => []);
    const saved = S.cfg.defaultCameraId;
    if (!cameras.length) return [{ label: 'Nenhuma câmera encontrada', icon: Camera }];
    return cameras.map((c) => ({
      label: c.name,
      icon: Camera,
      checked: c.id === saved || (!saved && c === cameras[0]),
      onSelect: () => {
        void updateConfig({ defaultCameraId: c.id });
        const session = S.session;
        if (session?.sharing && session.shareInfo?.source === 'camera' && session.sharedSourceId !== c.id) {
          void session.switchSource(c.id).catch((e: any) => toast(`Não foi possível trocar de câmera: ${e?.message ?? e}`, 'warn'));
        } else toast(`Câmera padrão: ${c.name}`, 'ok');
      },
    }));
  }

  let callbarSig = '';
  function drawCallbar(force = false): void {
    const session = S.session!;
    const camOn = session.sharing && session.shareInfo?.source === 'camera';
    const scrOn = session.sharing && session.shareInfo?.source !== 'camera';
    // the screen button only shares or ends your own share: watching somebody never changes it (you can start yours while watching theirs;
    // a picture is closed by the X on it)
    const sig = [camOn, scrOn, session.isHost].join('|');
    if (sig === callbarSig && !force) return;
    callbarSig = sig;
    closeMenus();
    const cam = h('button', { class: `call-btn ${camOn ? 'on' : ''}`, 'data-tip': camOn ? 'Parar a câmera' : 'Ligar a câmera', 'aria-label': 'Câmera', onmouseenter: prefetchSources }, icon(camOn ? Camera : CameraOff, 22));
    cam.append(chevron(() => toggleMenu(cam, () => [
      { label: 'Mudar câmera', icon: Camera, sub: cameraRows },
      { label: 'Qualidade', icon: Gauge, sub: qualityMenu('camera') },
    ])));
    cam.onclick = async (e) => {
      if ((e.target as HTMLElement).closest('.chev')) return;
      if (camOn) return void session.stopSharing();
      try {
        let id = S.cfg.defaultCameraId;
        if (!id) {
          // no default picked yet: the first camera found becomes the default (it can be changed in Configurações > Câmera)
          id = (await listCameras())[0]?.id ?? '';
          if (!id) return void toast('Nenhuma câmera encontrada. Confira se ela está ligada e liberada nas configurações de privacidade do Windows.', 'warn');
          await updateConfig({ defaultCameraId: id });
        }
        const go = async () => {
          try {
            if (session.sharing) await session.switchSource(id);
            else await session.startSharing(id, { resolution: S.cfg.cameraResolution, fps: S.cfg.cameraFps, mode: S.cfg.cameraMode });
            burst(e.clientX, e.clientY);
          } catch (err: any) {
            toast(`Não foi possível ligar a câmera: ${err?.message ?? err}`, 'warn');
          }
        };
        if (scrOn) confirmDialog('Trocar a tela pela câmera', 'Você está compartilhando a tela. Se continuar, o compartilhamento da tela termina e a sua câmera passa a ser transmitida.', 'Trocar para a câmera', () => void go(), false, Camera);
        else await go();
      } catch (err: any) {
        toast(`Não foi possível ligar a câmera: ${err?.message ?? err}`, 'warn');
      }
    };

    const scr = h('button', { class: `call-btn ${scrOn ? 'stop' : ''}`, 'data-tip': scrOn ? 'Parar de compartilhar' : 'Compartilhar tela', 'aria-label': scrOn ? 'Parar de compartilhar' : 'Compartilhar tela', onmouseenter: prefetchSources }, icon(scrOn ? MonitorOff : MonitorUp, 22));
    scr.append(chevron(() => scrOn && toggleMenu(scr, () => [
      { label: 'Trocar tela', icon: MonitorUp, onSelect: () => openShare({ switching: true }) },
      { label: 'Qualidade', icon: Gauge, sub: qualityMenu('screen') },
    ]), !scrOn));
    scr.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.chev')) return;
      if (camOn) return openShare({ switching: true }); // sharing the camera: this button picks a screen instead
      if (scrOn) return void session.stopSharing();
      openShare();
    };
    const leave = h('button', { class: 'call-btn leave', 'data-tip': session.isHost ? 'Encerrar sala' : 'Sair da sala', 'aria-label': session.isHost ? 'Encerrar sala' : 'Sair da sala', onclick: leaveRoom /* leaving with this button is direct, no question */ }, icon(PhoneOff, 22));
    callbar.replaceChildren(h('div', { class: 'callbar !animate-none' }, cam, scr, h('i', { class: 'w-px h-8 bg-line mx-1' }), leave));
  }

  // ------------------------------------------------------------------------------------------------ public
  let lastViewing: string | null | undefined;
  let bound: unknown = null;
  const draw = (animate = false) => {
    const session = S.session;
    if (!session) return;
    if (bound !== session) {
      // a different room: nothing of the previous one stays
      bound = session;
      animate = true;
      callbarSig = '';
    }
    // a different person (or none) in focus always opens in focus
    if (session.viewing !== lastViewing) {
      lastViewing = session.viewing;
      S.gridMode = false;
      window.clearTimeout(clickTimer);
    }
    if (animate) {
      for (const t of tiles.values()) if (t.video) t.video.srcObject = null;
      tiles.clear();
      content.replaceChildren();
      layout = '';
    }
    drawTop();
    drawCallbar(animate);
    relayout(peers(), animate);
    pinned.update();
    pills.replaceChildren(
      ...[
        session.reconnecting ? h('div', { class: 'px-3 h-8 inline-flex items-center rounded-full bg-live/90 text-white text-[13px] font-semibold animate-fade-up' }, 'Reconectando à sala…') : null,
        session.sharing && session.audioNote ? h('div', { class: 'px-3 h-8 inline-flex items-center rounded-full bg-black/60 backdrop-blur text-[13px] animate-fade-up' }, session.audioNote) : null,
      ].filter((x): x is HTMLDivElement => !!x),
    );
  };
  const tick = () => {
    pinned.update();
    for (const p of peers()) {
      const t = tiles.get(p.peerId);
      if (t) updateTile(t, p);
    }
  };
  return Object.assign(root, { draw, tick });
}

export type { Fps, Resolution, ShareMode };
