import { AppConfig, BITRATE_MBPS, CaptureSource, Fps, MAX_FAVORITE_ROOMS, Resolution, RoomInfo, ShareInfo, ShareMode, ShareSource } from '../../shared/protocol';
import { cropAvatar } from '../avatar-crop';
import { avatarEl, dismiss, dismissOnBackdrop, h, toast } from '../dom';
import { formatDuration } from '../../shared/time';
import { speakerSvg } from '../icons';
import { customSelect } from '../select';
import { PeerView, Session } from '../session';
import { renderSettings } from './settings';

export interface RoomContext {
  cfg: AppConfig;
  session: Session;
  room: RoomInfo | null;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  leave(): void;
}

const EYE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

// "Stop watching": a screen with an X in the middle.
const SCREEN_X_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M9.5 7.5l5 5M14.5 7.5l-5 5"/></svg>';

const STAR_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const STAR_ON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

// "Switch the shared screen": a monitor with an arrow pointing right inside.
const SCREEN_ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 10h9M13 7l3 3-3 3"/></svg>';

const FS_ENTER_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
const FS_EXIT_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>';

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

const CLOCK_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

const SIGNAL_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="2" y="15" width="3.5" height="6" rx="1"/><rect x="7.5" y="11" width="3.5" height="10" rx="1"/><rect x="13" y="7" width="3.5" height="14" rx="1"/><rect x="18.5" y="3" width="3.5" height="18" rx="1"/></svg>';

const QUALITY_LABEL = { good: 'Boa', ok: 'Média', bad: 'Ruim', unknown: '' } as const;

const selectOf = customSelect; // custom dropdown, see select.ts

function uploadEstimate(info: ShareInfo, viewers: number): string {
  const mbps = BITRATE_MBPS[info.resolution][info.fps] * viewers;
  return `${viewers} espectador${viewers === 1 ? '' : 'es'} × ${BITRATE_MBPS[info.resolution][info.fps]} Mbps ≈ ${mbps.toFixed(1)} Mbps de upload`;
}

type SourceKind = 'screens' | 'windows' | 'cameras';
/** Last known screens/windows with thumbnails: shown at once when the share dialog opens, then refreshed in the background. Cameras are only listed when their tab is opened. */
const sourceCache: Record<SourceKind, CaptureSource[] | null> = { screens: null, windows: null, cameras: null };

/**
 * The cameras of this PC. The names only show up once the camera was allowed, so when they come empty the camera is opened for an
 * instant (and closed again) to get the permission.
 */
async function listCameras(): Promise<CaptureSource[]> {
  let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  if (devices.length && devices.some((d) => !d.label)) {
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop());
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      /* not allowed (Windows privacy settings): the cameras are listed without names */
    }
  }
  return devices.map((d, i) => ({ id: `camera:${d.deviceId}`, name: d.label || `Câmera ${i + 1}`, thumbnail: '', isScreen: false }));
}

const SMALL_SCREEN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
const SMALL_CAMERA_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';

/** The small icon in the participants list that tells a screen from a camera (the apps and servers that do not say it mean a screen). */
function shareKindIcon(source: ShareSource | undefined): HTMLElement {
  const camera = source === 'camera';
  const icon = h('span', { class: 'share-kind', title: camera ? 'Câmera' : 'Tela', 'aria-label': camera ? 'Câmera' : 'Tela' });
  icon.innerHTML = camera ? SMALL_CAMERA_SVG : SMALL_SCREEN_SVG; // static markup, no user data
  return icon;
}

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
let lastPrefetch = 0;

/** Warms the cache (room open, mouse over the share button). Throttled; failures are ignored. */
function prefetchSources(): void {
  if (Date.now() - lastPrefetch < 5000) return;
  lastPrefetch = Date.now();
  for (const k of ['screens', 'windows'] as Array<'screens' | 'windows'>) {
    window.jaca.listSources(k).then((list) => (sourceCache[k] = list)).catch(() => undefined);
  }
}

export function renderRoom(ctx: RoomContext): { el: HTMLElement; dispose(): void } {
  const { session, cfg } = ctx;
  let draft: ShareInfo = { resolution: cfg.resolution, fps: cfg.fps, mode: cfg.mode };

  // ---- player (kept alive across renders so playback is not interrupted)
  const video = h('video', { autoplay: true, playsInline: true, disablePictureInPicture: true });
  const volume = h('input', { type: 'range', min: 0, max: 100, value: '100', class: 'volume', title: 'Volume' });
  // Speaker icon (click = mute / unmute), the slider and the percentage, grouped so they hide together on your own preview.
  const volumeBtn = h('button', { class: 'ghost icon-btn', title: 'Silenciar', 'aria-label': 'Silenciar' });
  const volumePct = h('span', { class: 'volume-pct' }, '100%');
  let volumeBeforeMute = 100;
  const applyVolume = () => {
    const v = Number(volume.value);
    video.volume = v / 100;
    volume.style.setProperty('--v', `${v}%`); // filled part of the custom slider
    volumePct.textContent = `${v}%`;
    volumeBtn.innerHTML = speakerSvg(v); // static markup, no user data
    const label = v === 0 ? 'Ativar o som' : 'Silenciar';
    volumeBtn.title = label;
    volumeBtn.setAttribute('aria-label', label);
    if (v > 0) volumeBeforeMute = v;
  };
  volume.oninput = applyVolume;
  volumeBtn.onclick = () => {
    volume.value = Number(volume.value) === 0 ? String(volumeBeforeMute) : '0';
    applyVolume();
  };
  applyVolume();
  const volumeGroup = h('div', { class: 'volume-group' }, volumeBtn, volume, volumePct);
  const playerTitle = h('span', { class: 'player-title' });
  // Signal-bars icon at the corner of your own preview; the upload estimate appears on hover.
  const netTip = h('div', { class: 'netinfo-tip', role: 'tooltip' });
  const netInfo = h('span', { class: 'netinfo', tabIndex: 0 }, netTip);
  netInfo.insertAdjacentHTML('afterbegin', SIGNAL_SVG); // static markup, no user data
  const placeholder = h('div', { class: 'player-empty' }, 'Quando alguém estiver ao vivo, clique no nome dele para assistir.');
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    // Your own screen in fullscreen on the monitor it is capturing would capture itself (an endless tunnel of previews whose colors drift to green)
    if (session.viewing === session.selfId && session.sharedSourceId && (await window.jaca.isOnAppMonitor(session.sharedSourceId))) {
      toast('Você está compartilhando o monitor onde o app está. Mova o app para outro monitor para ver sua tela em tela cheia.', 'error');
      return;
    }
    void player.requestFullscreen?.();
  };
  video.addEventListener('dblclick', toggleFullscreen);
  // Fullscreen is requested on the whole player (not just the video) so these controls stay visible and the
  // same button can leave fullscreen. The icon follows the real fullscreen state.
  const fsBtn = h('button', {
    class: 'ghost icon-btn',
    title: 'Tela cheia',
    'aria-label': 'Tela cheia',
    onclick: () => toggleFullscreen(),
  });
  fsBtn.innerHTML = FS_ENTER_SVG; // static markup, no user data
  const onFullscreenChange = () => {
    const on = document.fullscreenElement === player;
    fsBtn.innerHTML = on ? FS_EXIT_SVG : FS_ENTER_SVG;
    const label = on ? 'Sair da tela cheia' : 'Tela cheia';
    fsBtn.title = label;
    fsBtn.setAttribute('aria-label', label);
    wake();
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  // Red icon-only "stop watching" button, centered at the bottom of the picture.
  const stopBtn = h('button', {
    class: 'icon-btn stop-btn',
    title: 'Parar de assistir',
    'aria-label': 'Parar de assistir',
    onclick: () => session.stopViewing(),
  });
  stopBtn.innerHTML = SCREEN_X_SVG; // static markup, no user data
  // "Switch the shared screen": next to the stop button, only while you are sharing
  const switchBtn = h('button', {
    class: 'icon-btn switch-btn',
    title: 'Trocar a tela ou a câmera',
    'aria-label': 'Trocar a tela ou a câmera',
    onclick: () => openShareDialog(true),
    onmouseenter: () => prefetchSources(),
    onfocus: () => prefetchSources(),
  });
  switchBtn.innerHTML = SCREEN_ARROW_SVG; // static markup, no user data
  // Three areas: who/what you are watching (left), the stop button (center) and volume + fullscreen (right).
  // All of them (.pb-hover) only show while the pointer is over the picture, so nothing covers the shared screen the rest of the time.
  const playerBar = h(
    'div',
    { class: 'player-bar' },
    h('div', { class: 'pb-left pb-hover' }, netInfo, playerTitle),
    h('div', { class: 'pb-center pb-hover' }, stopBtn, switchBtn),
    h('div', { class: 'pb-right pb-hover' }, volumeGroup, fsBtn),
  );
  const player = h('div', { class: 'player' }, video, placeholder, playerBar);

  // In fullscreen the controls (and the cursor) hide after a moment without mouse movement and come back on movement.
  let idleTimer: number | undefined;
  function wake(): void {
    player.classList.remove('idle');
    window.clearTimeout(idleTimer);
    if (document.fullscreenElement !== player) return;
    idleTimer = window.setTimeout(() => {
      if (playerBar.matches(':hover')) wake(); // never hide controls under the pointer
      else player.classList.add('idle');
    }, 2500);
  }
  player.addEventListener('mousemove', wake);
  // A button keeps focus after a mouse click, and focused controls stay visible (keyboard users need that). Leaving the picture with the
  // mouse means you are done with the controls, so release that focus and let them hide.
  player.addEventListener('mouseleave', () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && playerBar.contains(active)) active.blur();
  });
  playerBar.addEventListener('focusin', wake);

  // How long the room has been open (counted from the age the host reported at join time, see Session.roomElapsedMs).
  const timerText = h('span', { class: 'room-timer-text' });
  const timer = h('span', { class: 'room-timer', title: 'Tempo desde que a sala foi aberta' });
  timer.innerHTML = CLOCK_SVG; // static markup, no user data
  timer.append(timerText);
  const tickTimer = () => {
    const elapsed = session.roomElapsedMs();
    timer.style.display = elapsed === null ? 'none' : 'inline-flex';
    if (elapsed !== null) timerText.textContent = formatDuration(elapsed);
  };
  tickTimer();
  const timerInterval = window.setInterval(tickTimer, 1000);

  const list = h('div', { class: 'peer-list' });
  const controls = h('div', { class: 'controls' });
  const root = h('div', { class: 'screen room' });

  const inviteCode = session.inviteCode; // every participant sees it, not only the host
  const codeChip = inviteCode
    ? h(
        'div',
        { class: 'code-chip' },
        h('span', { class: 'muted' }, 'Código'),
        h('code', {}, inviteCode),
        h(
          'button',
          {
            class: 'ghost',
            onclick: async () => {
              try {
                await window.jaca.copyText(inviteCode);
                toast('Código copiado.');
              } catch {
                toast('Não foi possível copiar o código.', 'error');
              }
            },
          },
          'Copiar código',
        ),
      )
    : null;

  // Star: a guest of a Cloudflare room saves it as a favorite (with the name the host gave it; guests cannot rename it)
  const favBtn =
    inviteCode && inviteCode.includes('@') && !session.isHost
      ? h('button', { class: 'icon-btn ghost fav-star', onclick: () => void toggleFavorite() })
      : null;
  const isFavorite = () => ctx.cfg.favoriteRooms.some((f) => f.code === inviteCode);
  function drawFavBtn(): void {
    if (!favBtn) return;
    const on = isFavorite();
    favBtn.classList.toggle('on', on);
    favBtn.title = on ? 'Remover a sala dos favoritos' : 'Favoritar esta sala';
    favBtn.setAttribute('aria-label', favBtn.title);
    favBtn.setAttribute('aria-pressed', String(on));
    favBtn.innerHTML = on ? STAR_ON_SVG : STAR_OFF_SVG; // static markup, no user data
  }
  async function toggleFavorite(): Promise<void> {
    if (!inviteCode) return;
    const rest = ctx.cfg.favoriteRooms.filter((f) => f.code !== inviteCode);
    if (isFavorite()) {
      await ctx.update({ favoriteRooms: rest });
      toast('Sala removida dos favoritos.');
    } else {
      if (rest.length >= MAX_FAVORITE_ROOMS) return toast(`Você já tem ${MAX_FAVORITE_ROOMS} salas favoritas. Remova uma para favoritar outra.`, 'error');
      await ctx.update({ favoriteRooms: [...rest, { code: inviteCode, name: session.roomName || 'Sala' }] });
      toast('Sala favoritada. Ela aparece na tela inicial e avisa quando abrir.');
    }
    drawFavBtn();
  }
  drawFavBtn();

  // Settings without leaving the room: the same Settings screen in a drawer that slides in from the right
  let closeDrawer: (() => void) | null = null;
  function openSettingsDrawer(): void {
    if (closeDrawer) return;
    const view = renderSettings({
      get cfg() {
        return ctx.cfg;
      },
      update: ctx.update,
      back: () => closeDrawer?.(),
    });
    const overlay = h('div', { class: 'drawer-overlay' }, h('div', { class: 'settings-drawer', role: 'dialog', 'aria-label': 'Configurações' }, view.el));
    let downOnBackdrop = false;
    overlay.addEventListener('mousedown', (e) => {
      downOnBackdrop = e.target === overlay;
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && downOnBackdrop) closeDrawer?.();
      downOnBackdrop = false;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer?.(); // an open dropdown list handles (and swallows) its own Esc first
    };
    document.addEventListener('keydown', onKey);
    closeDrawer = () => {
      closeDrawer = null;
      document.removeEventListener('keydown', onKey);
      view.dispose();
      dismiss(overlay);
    };
    document.body.append(overlay);
  }
  const settingsBtn = h('button', { class: 'icon-btn ghost', title: 'Configurações', 'aria-label': 'Configurações', onclick: openSettingsDrawer });
  settingsBtn.innerHTML = GEAR_SVG; // static markup, no user data

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('h1', { class: 'room-title', title: session.roomName }, session.roomName || (session.isHost ? 'Sua sala' : 'Sala')),
      codeChip,
      favBtn,
      h('span', { class: 'spacer' }),
      timer,
      settingsBtn,
      h('button', { class: 'danger', onclick: ctx.leave }, session.isHost ? 'Encerrar sala' : 'Sair'),
    ),
    h('main', { class: 'room-body' }, h('section', { class: 'stage' }, player, controls), h('aside', { class: 'sidebar' }, h('h2', {}, 'Participantes'), list)),
  );

  function peerCard(p: PeerView): HTMLElement {
    const isMe = p.peerId === session.selfId;
    const live = !!p.share;
    const selected = session.viewing === p.peerId;
    const clickable = live && (!isMe || session.sharing);
    const card = h(
      'button',
      {
        class: `peer ${live ? 'live' : ''} ${selected ? 'selected' : ''}`,
        disabled: !clickable,
        title: clickable ? (isMe ? 'Ver prévia da sua tela' : 'Assistir') : '',
        onclick: () => session.view(p.peerId),
      },
      avatarEl(p.name, p.avatar, 44),
      h(
        'div',
        { class: 'peer-info' },
        h('div', { class: 'peer-name' }, isMe ? `${p.name} (você)` : p.name),
        h(
          'div',
          { class: 'peer-meta muted' },
          live ? shareKindIcon(p.share!.source) : null,
          h('span', { class: 'meta-text' }, live ? `${p.share!.resolution} · ${p.share!.fps} fps` : 'Sem transmissão'),
          !isMe && p.quality !== 'unknown' ? h('span', { class: `dot ${p.quality}`, title: `${QUALITY_LABEL[p.quality]}${p.rtt !== null ? ` · ${p.rtt} ms` : ''}` }) : null,
          !isMe && p.rtt !== null ? h('span', { class: 'meta-rtt' }, `${p.rtt} ms`) : null,
        ),
      ),
      live ? h('span', { class: 'badge-live' }, 'AO VIVO') : null,
    );
    // Every card: a three-dot button inside the card's right edge opens the profile menu (visible on hover). It is a
    // sibling of the card button, positioned over it, because a button cannot sit inside another button.
    const kebab = h('button', {
      class: 'kebab',
      title: 'Opções do perfil',
      'aria-label': `Opções do perfil de ${p.name}`,
      'aria-haspopup': 'menu',
      'aria-expanded': String(menuPeerId === p.peerId),
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        openProfileMenu(kebab, p);
      },
    }, h('span', { class: 'kebab-dots', 'aria-hidden': 'true' }));
    return h('div', { class: 'peer-row' }, card, kebab);
  }

  let closeMenu: (() => void) | null = null;
  let menuPeerId: string | null = null; // whose three-dot menu is open
  function openProfileMenu(anchor: HTMLElement, p: PeerView): void {
    closeMenu?.();
    menuPeerId = p.peerId;
    anchor.setAttribute('aria-expanded', 'true');
    const view = h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { close(); openPeerProfile(p); } }, 'Ver perfil');
    const item = p.peerId === session.selfId ? h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { close(); openProfileDialog(); } }, 'Editar perfil') : null;
    const menu = h('div', { class: 'menu', role: 'menu' }, view, item);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    const onDown = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    function close() {
      dismiss(menu);
      menuPeerId = null;
      list.querySelectorAll('.kebab[aria-expanded="true"]').forEach((k) => k.setAttribute('aria-expanded', 'false'));
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      closeMenu = null;
    }
    closeMenu = close;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.body.append(menu);
    view.focus();
  }

  /** A participant's profile in a dialog: the photo large enough to see well, and the name. */
  function openPeerProfile(p: PeerView): void {
    const closeX = h('button', { class: 'ghost icon-btn profile-view-close', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => dismiss(overlay) });
    closeX.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'; // static markup, no user data
    const overlay = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'dialog small profile-view', role: 'dialog', 'aria-label': `Perfil de ${p.name}` },
        closeX,
        h('div', { class: 'profile-view-photo' }, avatarEl(p.name, p.avatar, 240)),
        h('h2', { class: 'profile-view-name' }, p.peerId === session.selfId ? `${p.name} (você)` : p.name),
      ),
    );
    dismissOnBackdrop(overlay);
    document.body.append(overlay);
  }

  /** Name/photo changes are saved and sent to everyone in the room as soon as they are made. */
  function openProfileDialog(): void {
    const preview = h('div', { class: 'avatar-holder' });
    const nameInput = h('input', { type: 'text', maxLength: 24, value: session.me().name });
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const draw = () => preview.replaceChildren(avatarEl(session.me().name, session.me().avatar, 88));
    const commit = async (name: string, avatar: string | null) => {
      const saved = await ctx.update({ name, avatar });
      session.updateProfile(saved.name, saved.avatar);
      draw();
    };
    nameInput.onchange = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.value = session.me().name;
        return;
      }
      await commit(name, session.me().avatar);
    };
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const avatar = await cropAvatar(file);
        if (avatar) await commit(session.me().name, avatar);
      } catch {
        toast('Não foi possível ler essa imagem.', 'error');
      }
    };
    draw();
    const overlay = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'dialog profile-dialog' },
        h('h2', {}, 'Editar perfil'),
        h(
          'div',
          { class: 'profile' },
          preview,
          h(
            'div',
            { class: 'profile-fields' },
            nameInput,
            h(
              'div',
              { class: 'row' },
              h('button', { onclick: () => fileInput.click() }, 'Escolher imagem'),
              h('button', { class: 'ghost', onclick: () => void commit(session.me().name, null) }, 'Remover'),
            ),
            fileInput,
          ),
        ),
        h('p', { class: 'muted' }, 'As mudanças aparecem na hora para todos na sala.'),
        h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: () => dismiss(overlay) }, 'Pronto')),
      ),
    );
    dismissOnBackdrop(overlay);
    document.body.append(overlay);
  }

  // Cards are cached and only rebuilt when their data changes, so the hover state (and the three dots on the
  // own card) does not blink every time someone else's connection stats refresh.
  const cards = new Map<string, { sig: string; el: HTMLElement }>();
  function syncList(): void {
    const peers = [...session.peers.values()];
    let changed = peers.length !== list.children.length;
    const els = peers.map((p, i) => {
      const sig = JSON.stringify([p.name, p.avatar, p.share, p.quality, p.rtt, session.viewing === p.peerId, session.sharing, menuPeerId === p.peerId, p.peerId === session.selfId]);
      let entry = cards.get(p.peerId);
      if (!entry || entry.sig !== sig) {
        entry = { sig, el: peerCard(p) };
        cards.set(p.peerId, entry);
      }
      if (list.children[i] !== entry.el) changed = true;
      return entry.el;
    });
    for (const id of [...cards.keys()]) if (!session.peers.has(id)) cards.delete(id);
    if (changed) list.replaceChildren(...els);
  }

  /** `switching`: already sharing, the dialog only picks another screen or window (quality stays, the transmission is not interrupted). */
  function openShareDialog(switching = false): void {
    type Kind = SourceKind;
    const kinds: Kind[] = ['screens', 'windows', 'cameras'];
    // start from the cache (instant) and refresh in the background; screens and windows load independently, screens first
    const lists: Record<Kind, CaptureSource[]> = { screens: sourceCache.screens ?? [], windows: sourceCache.windows ?? [], cameras: [] };
    const loaded: Record<Kind, boolean> = { screens: sourceCache.screens !== null, windows: sourceCache.windows !== null, cameras: false };
    let kind: Kind = 'screens';
    let chosen: string | null = lists.screens[0]?.id ?? null;

    // Quality: screens and windows start from the Transmissão defaults, the camera from the Câmera defaults (Configurações).
    // Changing between the two groups of tabs puts the defaults of the new group back in the dropdowns.
    const defaultsFor = (k: Kind): ShareInfo =>
      k === 'cameras'
        ? { resolution: ctx.cfg.cameraResolution, fps: ctx.cfg.cameraFps, mode: ctx.cfg.cameraMode }
        : { resolution: ctx.cfg.resolution, fps: ctx.cfg.fps, mode: ctx.cfg.mode };
    let qualityGroup: 'screen' | 'camera' = 'screen';
    draft = defaultsFor('screens');
    const qualityRow = h('div', { class: 'row wrap' });
    const drawQuality = () =>
      qualityRow.replaceChildren(
        selectOf<Resolution>(draft.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => { draft = { ...draft, resolution: v as Resolution }; }),
        selectOf<number>(draft.fps, [[30, '30 fps'], [60, '60 fps']], (v) => { draft = { ...draft, fps: Number(v) as Fps }; }),
        selectOf<ShareMode>(draft.mode, [['motion', 'Movimento'], ['detail', 'Detalhe']], (v) => { draft = { ...draft, mode: v as ShareMode }; }),
      );
    drawQuality();

    // Electron names screens in English ("Screen 1")
    const labelOf = (src: CaptureSource) => (src.isScreen ? src.name.replace(/^Screen (\d+)$/i, 'Tela $1').replace(/^Entire screen$/i, 'Tela inteira') : src.name);

    // Both lists live side by side in a sliding track: switching tabs swipes the track (the segmented control swipes its highlight too).
    const panels: Record<Kind, HTMLElement> = {
      screens: h('div', { class: 'source-panel', role: 'tabpanel' }),
      windows: h('div', { class: 'source-panel', role: 'tabpanel' }),
      cameras: h('div', { class: 'source-panel', role: 'tabpanel' }),
    };
    const track = h('div', { class: 'source-track' }, panels.screens, panels.windows, panels.cameras);
    const viewport = h('div', { class: 'source-viewport' }, track);
    const startLabel = switching ? 'Trocar' : 'Compartilhar';
    const startBtn = h('button', { class: 'primary' }, startLabel);
    let starting = false; // while the capture is being set up the dialog must stay
    const tabs = new Map<Kind, HTMLButtonElement>();

    const refreshSelection = () => {
      viewport.querySelectorAll<HTMLElement>('.source[data-id]').forEach((el) => el.classList.toggle('selected', el.dataset.id === chosen));
      startBtn.disabled = !chosen || starting;
    };

    // cards are reused between refreshes (so thumbnails update without blinking or restarting the entrance animation)
    const cards = new Map<string, HTMLButtonElement>();
    const skeletons = () => [0, 1, 2].map(() => h('div', { class: 'source skeleton', 'aria-hidden': 'true' }, h('div', { class: 'sk-img' }), h('span', { class: 'sk-line' })));
    const renderPanel = (k: Kind) => {
      const panel = panels[k];
      let els: HTMLElement[];
      if (lists[k].length) {
        els = lists[k].map((src) => {
          let card = cards.get(src.id);
          if (!card) {
            let picture: HTMLElement;
            if (src.id.startsWith('camera:')) {
              picture = h('div', { class: 'cam-icon' });
              picture.innerHTML = CAMERA_SVG; // static markup, no user data
            } else {
              picture = h('img', { src: src.thumbnail, alt: '' });
            }
            card = h('button', { class: 'source', onclick: () => { chosen = src.id; refreshSelection(); } }, picture, h('span', {}, labelOf(src)));
            card.dataset.id = src.id;
            cards.set(src.id, card);
          } else {
            const img = card.querySelector('img');
            if (img && img.getAttribute('src') !== src.thumbnail) img.setAttribute('src', src.thumbnail);
          }
          return card;
        });
      } else if (loaded[k]) {
        els = [h('div', { class: 'source-empty muted' }, k === 'screens' ? 'Nenhuma tela encontrada.' : k === 'windows' ? 'Nenhuma janela aberta para compartilhar.' : 'Nenhuma câmera encontrada. Confira se ela está ligada e liberada nas configurações de privacidade do Windows.')];
      } else {
        els = skeletons();
      }
      const same = panel.children.length === els.length && els.every((el, i) => panel.children[i] === el);
      if (!same) panel.replaceChildren(...els);
    };

    const seg = h('div', { class: 'seg seg3', role: 'tablist', 'aria-label': 'O que compartilhar' });
    // the cameras are listed the first time their tab is opened (that may ask for the camera permission, so it is not done earlier)
    const loadCameras = () => {
      if (loaded.cameras) return;
      listCameras()
        .then((list) => {
          sourceCache.cameras = list;
          if (!overlay.isConnected) return;
          lists.cameras = list;
          loaded.cameras = true;
          if (kind === 'cameras' && !list.some((src) => src.id === chosen)) chosen = list[0]?.id ?? null;
          renderPanel('cameras');
          refreshSelection();
        })
        .catch(() => {
          if (!overlay.isConnected) return;
          loaded.cameras = true;
          renderPanel('cameras');
          toast('Não foi possível listar as câmeras.', 'error');
        });
    };
    const showKind = (k: Kind) => {
      kind = k;
      if (!lists[k].some((src) => src.id === chosen)) chosen = lists[k][0]?.id ?? null; // the selection always belongs to the visible tab
      const index = kinds.indexOf(k);
      seg.dataset.pos = String(index); // slides the highlight under the buttons
      track.style.transform = `translateX(${-(index * 100) / kinds.length}%)`; // swipes the lists
      if (k === 'cameras') loadCameras();
      const group = k === 'cameras' ? 'camera' : 'screen';
      if (group !== qualityGroup) {
        qualityGroup = group;
        draft = defaultsFor(k);
        drawQuality();
      }
      for (const key of kinds) {
        const active = key === k;
        tabs.get(key)!.setAttribute('aria-selected', String(active));
        tabs.get(key)!.tabIndex = active ? 0 : -1;
        panels[key].toggleAttribute('inert', !active); // the hidden list cannot be tabbed into
      }
      refreshSelection();
    };
    for (const [k, label] of [['screens', 'Telas'], ['windows', 'Janelas'], ['cameras', 'Câmeras']] as Array<[Kind, string]>) {
      const btn = h('button', { class: 'seg-btn', role: 'tab', onclick: () => showKind(k) }, label);
      tabs.set(k, btn);
      seg.append(btn);
    }
    seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = kinds[(kinds.indexOf(kind) + (e.key === 'ArrowRight' ? 1 : kinds.length - 1)) % kinds.length];
      showKind(next);
      tabs.get(next)!.focus();
    });

    const overlay = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'dialog share-dialog' },
        h('h2', {}, switching ? 'Trocar o que você compartilha' : 'Compartilhar tela ou câmera'),
        seg,
        viewport,
        switching ? null : qualityRow,
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dismiss(overlay) }, 'Cancelar'), startBtn),
      ),
    );
    startBtn.onclick = async () => {
      if (!chosen) return;
      starting = true;
      startBtn.disabled = true;
      startBtn.textContent = switching ? 'Trocando...' : 'Iniciando...';
      try {
        if (switching) await session.switchSource(chosen);
        else await session.startSharing(chosen, draft);
        dismiss(overlay);
      } catch (e: any) {
        toast(switching ? `Não foi possível trocar: ${e?.message ?? e}` : `Não foi possível iniciar o compartilhamento: ${e?.message ?? e}`, 'error');
        starting = false;
        startBtn.disabled = false;
        startBtn.textContent = startLabel;
      }
    };

    for (const k of kinds) renderPanel(k);
    showKind(kind);
    dismissOnBackdrop(overlay, () => !starting);
    document.body.append(overlay); // the dialog is on screen right away; the lists fill in below

    // refresh in the background: screens (fast) and windows (slow) independently (the cameras load when their tab opens)
    for (const k of kinds.filter((x): x is 'screens' | 'windows' => x !== 'cameras')) {
      window.jaca
        .listSources(k)
        .then((list) => {
          sourceCache[k] = list;
          if (!overlay.isConnected) return;
          lists[k] = list;
          loaded[k] = true;
          if (kind === k && !list.some((src) => src.id === chosen)) chosen = list[0]?.id ?? null;
          renderPanel(k);
          refreshSelection();
        })
        .catch(() => {
          if (!overlay.isConnected) return;
          loaded[k] = true;
          renderPanel(k);
          toast('Não foi possível listar as telas e janelas.', 'error');
        });
    }
  }

  /** Eye icon + number of people watching (far right of the controls). */
  function viewersBadge(info: ShareInfo, count: number): HTMLElement {
    const label = count === 0 ? 'Ninguém assistindo' : `${count} espectador${count === 1 ? '' : 'es'}`;
    const badge = h('span', { class: `viewers ${count ? 'has' : ''}`, title: label, 'aria-label': label });
    badge.innerHTML = EYE_SVG; // static markup, no user data
    badge.append(h('span', { class: 'viewers-count' }, String(count)));
    return badge;
  }

  function drawControls(): void {
    if (!session.sharing || !session.shareInfo) {
      controls.replaceChildren(h('button', { class: 'primary', onclick: () => void openShareDialog(), onmouseenter: prefetchSources, onfocus: prefetchSources }, 'Compartilhar'));
      return;
    }
    const info = session.shareInfo;
    const change = (patch: Partial<ShareInfo>) => {
      void session.updateQuality({ ...info, ...patch });
    };
    controls.replaceChildren(
      h('button', { class: 'danger', onclick: () => session.stopSharing() }, 'Parar de compartilhar'),
      selectOf<Resolution>(info.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => change({ resolution: v as Resolution })),
      selectOf<number>(info.fps, [[30, '30 fps'], [60, '60 fps']], (v) => change({ fps: Number(v) as Fps })),
      selectOf<ShareMode>(info.mode, [['motion', 'Movimento'], ['detail', 'Detalhe']], (v) => change({ mode: v as ShareMode })),
      ...(session.audioNote ? [h('span', { class: 'muted' }, session.audioNote)] : []),
      viewersBadge(info, session.watcherCount),
    );
  }

  function render(): void {
    syncList();
    // Rebuild controls only when something relevant changed, so open dropdowns are not dismissed by stats updates.
    const sig = `${session.sharing}|${session.shareInfo?.resolution}|${session.shareInfo?.fps}|${session.shareInfo?.mode}|${session.watcherCount}|${session.audioNote}`;
    if (sig !== lastControlsSig) {
      lastControlsSig = sig;
      drawControls();
    }

    const viewing = session.viewing ? session.peers.get(session.viewing) : null;
    if (video.srcObject !== session.stream) video.srcObject = session.stream;
    video.muted = session.viewing === session.selfId || session.muteIncoming;
    placeholder.style.display = session.stream ? 'none' : 'flex';
    playerBar.style.display = session.viewing ? 'grid' : 'none';
    switchBtn.style.display = session.sharing ? '' : 'none';
    const ownPreview = !!viewing && viewing.peerId === session.selfId && !!session.shareInfo;
    netInfo.style.display = ownPreview ? 'inline-flex' : 'none';
    volumeGroup.style.display = ownPreview ? 'none' : ''; // you never listen to your own screen
    if (ownPreview) {
      const info = session.shareInfo!;
      const count = session.watcherCount;
      const lines =
        count === 0
          ? ['Ninguém assistindo agora', `Cada espectador usa ≈ ${BITRATE_MBPS[info.resolution][info.fps]} Mbps de upload (${info.resolution} · ${info.fps} fps)`]
          : [uploadEstimate(info, count), `${info.resolution} · ${info.fps} fps`];
      netTip.replaceChildren(...lines.map((l) => h('div', {}, l)));
      netInfo.setAttribute('aria-label', lines.join('. '));
    }
    if (viewing) {
      playerTitle.textContent = viewing.peerId === session.selfId ? viewing.name : `Assistindo ${viewing.name}`;
      placeholder.textContent = session.stream ? '' : 'Conectando à transmissão...';
      if (session.muteIncoming && viewing.peerId !== session.selfId) playerTitle.textContent += ' (sem áudio: compartilhe só uma janela para ouvir)';
    } else {
      placeholder.textContent = session.sharing
        ? 'Você está ao vivo. Clique no seu nome para ver a prévia.'
        : 'Quando alguém estiver ao vivo, clique no nome dele para assistir.';
    }
  }

  prefetchSources(); // have the screens/windows ready before the share dialog is opened
  let lastControlsSig = '';
  session.onChange = render;
  session.onNotice = toast;
  render();

  return {
    el: root,
    dispose: () => {
      closeMenu?.();
      closeDrawer?.();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.clearTimeout(idleTimer);
      window.clearInterval(timerInterval);
      if (document.fullscreenElement === player) void document.exitFullscreen();
      session.onChange = () => undefined;
      session.onNotice = () => undefined;
      video.srcObject = null;
    },
  };
}
