import { AppConfig, BITRATE_MBPS, CaptureSource, Fps, MAX_FAVORITE_ROOMS, Resolution, RoomInfo, ShareInfo, ShareMode, ShareSource } from '../../shared/protocol';
import { cropAvatar } from '../avatar-crop';
import { listCameras } from '../cameras';
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

const STAR_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const STAR_ON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

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

type SourceKind = 'screens' | 'windows';
/** Last known screens/windows with thumbnails: shown at once when the share dialog opens, then refreshed in the background. Cameras are only listed when their tab is opened. */
const sourceCache: Record<SourceKind, CaptureSource[] | null> = { screens: null, windows: null };

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

const DOCK_SVG_ATTRS = 'viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const DOCK_CHEVRON = `<span class="dock-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>`;
/** Inner markup of the 24x24 stroke icons in the screen button's menus. */
const MENU_ICONS = {
  swap: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 10h9M13 7l3 3-3 3"/>',
  camera: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  quality: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  resolution: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  fps: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1 1 17.4 0"/>',
  mode: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  motion: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  detail: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
} as const;
const TILE_STOP_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const MENU_ARROW_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const DOCK_CAMERA_SVG = `<svg ${DOCK_SVG_ATTRS}><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>${DOCK_CHEVRON}`;
const DOCK_SCREEN_SVG = `<svg ${DOCK_SVG_ATTRS}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M10.5 7.5v5l4-2.5z" fill="currentColor"/></svg>${DOCK_CHEVRON}`;
const DOCK_SCREEN_X_SVG = `<svg ${DOCK_SVG_ATTRS}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M9.5 7.5l5 5M14.5 7.5l-5 5"/></svg>${DOCK_CHEVRON}`;
const DOCK_LEAVE_SVG = `<svg ${DOCK_SVG_ATTRS}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/><path d="M16 2l6 6M22 2l-6 6"/></svg>`;

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
  // One video per person being watched (several can be open at once). They live in `videoHolder` (hidden) until placed in the player or a tile.
  const videos = new Map<string, HTMLVideoElement>();
  const videoHolder = h('div', { class: 'video-holder' });
  let volumeLevel = 1;
  const volume = h('input', { type: 'range', min: 0, max: 100, value: '100', class: 'volume', title: 'Volume' });
  // Speaker icon (click = mute / unmute), the slider and the percentage, grouped so they hide together on your own preview.
  const volumeBtn = h('button', { class: 'ghost icon-btn', title: 'Silenciar', 'aria-label': 'Silenciar' });
  const volumePct = h('span', { class: 'volume-pct' }, '100%');
  let volumeBeforeMute = 100;
  const applyVolume = () => {
    const v = Number(volume.value);
    volumeLevel = v / 100;
    for (const video of videos.values()) video.volume = volumeLevel;
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
  // One click on the focused picture shows the grid; it waits a moment so a double click (fullscreen) does not also switch the view.
  let clickTimer: number | undefined;
  const makeVideo = (): HTMLVideoElement => {
    const video = h('video', { autoplay: true, playsInline: true, disablePictureInPicture: true });
    video.volume = volumeLevel;
    video.addEventListener('dblclick', () => {
      window.clearTimeout(clickTimer);
      void toggleFullscreen();
    });
    video.addEventListener('click', () => {
      if (gridMode) return; // in the grid the tile around the picture handles the click
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => setGridMode(true), 230);
    });
    return video;
  };
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
  // Three areas: who/what you are watching (left), the call dock (center) and volume + fullscreen (right).
  // All of them (.pb-hover) only show while the pointer is over the picture, so nothing covers the shared screen the rest of the time.
  // Call-style dock (speaker, camera, screen, leave). Preview only: the buttons do nothing yet. It sits at the bottom of the green
  // empty screen while nothing is open, and moves into the player bar while you watch or share.
  const dockBtn = (cls: string, title: string, svg: string, onclick?: (e: MouseEvent) => void) => {
    const b = h('button', { class: `dock-btn ${cls}`, title, 'aria-label': title, onclick, onmouseenter: prefetchSources, onfocus: prefetchSources });
    b.innerHTML = svg; // static markup, no user data
    return b;
  };
  // Camera button: shares the default camera (Configurações > Câmera) at once; pressing it again while the camera is shared stops it.
  // Replacing a screen that is being shared asks first. Green only while your camera is the thing being shared.
  const confirmReplaceScreen = () =>
    new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        dismiss(overlay);
        resolve(ok);
      };
      const overlay = h(
        'div',
        { class: 'overlay' },
        h(
          'div',
          { class: 'dialog small', role: 'dialog', 'aria-label': 'Trocar a tela pela câmera' },
          h('h2', {}, 'Trocar a tela pela câmera'),
          h('p', {}, 'Você está compartilhando a tela. Se continuar, o compartilhamento da tela termina e a sua câmera passa a ser transmitida.'),
          h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => done(false) }, 'Cancelar'), h('button', { class: 'primary', onclick: () => done(true) }, 'Trocar para a câmera')),
        ),
      );
      dismissOnBackdrop(overlay, () => {
        resolve(false);
        return true;
      });
      document.body.append(overlay);
    });
  const cameraDockBtn = dockBtn('dock-camera', 'Câmera', DOCK_CAMERA_SVG, async (e) => {
    if ((e.target as HTMLElement).closest('.dock-chev')) return toggleCameraMenu();
    if (session.sharing && session.shareInfo?.source === 'camera') return void session.stopSharing();
    try {
      let id = ctx.cfg.defaultCameraId;
      if (!id) {
        // no default picked yet: the first camera found becomes the default (it can be changed in Configurações > Câmera)
        id = (await listCameras())[0]?.id ?? '';
        if (!id) return void toast('Nenhuma câmera encontrada. Confira se ela está ligada e liberada nas configurações de privacidade do Windows.', 'error');
        await ctx.update({ defaultCameraId: id });
      }
      if (session.sharing) {
        if (!(await confirmReplaceScreen())) return;
        await session.switchSource(id);
      } else {
        await session.startSharing(id, { resolution: ctx.cfg.cameraResolution, fps: ctx.cfg.cameraFps, mode: ctx.cfg.cameraMode });
      }
    } catch (e: any) {
      toast(`Não foi possível ligar a câmera: ${e?.message ?? e}`, 'error');
    }
  });
  const leaveLabel =session.isHost ? 'Encerrar sala' : 'Sair';
  // Screen button: opens the share dialog; while you share or watch it turns red with an X and ends that instead.
  // Watching someone else's screen wins over your own share (you leave their screen first), otherwise your share ends.
  // The chevron in its corner opens the cascading menu (Trocar tela / Qualidade) instead.
  const screenDockBtn = dockBtn('dock-screen', 'Compartilhar tela', DOCK_SCREEN_SVG, (e) => {
    if ((e.target as HTMLElement).closest('.dock-chev')) return toggleScreenMenu();
    if (!gridMode && session.viewing && session.viewing !== session.selfId) session.stopViewing(); // in the grid there is no "stop watching" here: each tile has its own
    else if (session.sharing && session.shareInfo?.source === 'camera') openShareDialog(true); // sharing the camera: this button picks a screen instead
    else if (session.sharing) void session.stopSharing();
    else if (session.viewing && !gridMode) session.stopViewing();
    else openShareDialog();
  });
  let screenDockMode = '';
  const drawScreenDock = (): void => {
    const focused = !!session.viewing && !gridMode; // in the grid the button only deals with your own share
    const watchingOther = focused && session.viewing !== session.selfId;
    const sharingScreen = session.sharing && session.shareInfo?.source !== 'camera'; // a camera transmission leaves this button as it was
    const mode = watchingOther ? 'stop-watching' : sharingScreen || (focused && !session.sharing) ? 'stop-sharing' : 'share';
    if (mode === screenDockMode) return;
    screenDockMode = mode;
    const label = mode === 'stop-watching' ? 'Parar de assistir' : mode === 'stop-sharing' ? (session.sharing ? 'Parar de compartilhar' : 'Parar de assistir') : 'Compartilhar tela';
    screenDockBtn.classList.toggle('active', mode !== 'share');
    screenDockBtn.innerHTML = mode === 'share' ? DOCK_SCREEN_SVG : DOCK_SCREEN_X_SVG; // static markup, no user data
    screenDockBtn.title = label;
    screenDockBtn.setAttribute('aria-label', label);
  };
  // Cascading menu of the screen button: level 1 above the chevron (Trocar tela, Qualidade), level 2 to its right a little lower
  // (Resolução, FPS, Modo), level 3 right beside level 2 at the same height (the choices). Choosing a value applies it to the share
  // in progress, or becomes the default for the next one when nothing is being shared.
  const QUALITY_ROWS: Array<{ key: 'resolution' | 'fps' | 'mode'; label: string; options: Array<[string | number, string]> }> = [
    { key: 'resolution', label: 'Resolução', options: [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']] },
    { key: 'fps', label: 'FPS', options: [[30, '30 fps'], [60, '60 fps']] },
    { key: 'mode', label: 'Modo', options: [['motion', 'Movimento'], ['detail', 'Detalhe']] },
  ];
  let menuLevels: HTMLElement[] = [];
  let closeScreenMenuListeners: (() => void) | null = null;
  // Both menus (screen and camera) tune the share in progress, so they always read it from the session.
  const currentQuality = (): ShareInfo => session.shareInfo ?? { resolution: ctx.cfg.resolution, fps: ctx.cfg.fps, mode: ctx.cfg.mode };
  let menuOwner: HTMLElement | null = null; // the dock button whose chevron opened the menu
  function closeScreenMenu(): void {
    for (const m of menuLevels) dismiss(m);
    menuLevels = [];
    menuOwner?.querySelector('.dock-chev')?.classList.remove('open');
    menuOwner = null;
    closeScreenMenuListeners?.();
    closeScreenMenuListeners = null;
  }
  function toggleScreenMenu(): void {
    if (screenDockBtn.classList.contains('no-menu') && !menuLevels.length) return; // the menu is only for your own screen
    toggleDockMenu(screenDockBtn, () => [
      { label: 'Trocar tela', icon: MENU_ICONS.swap, onSelect: () => { closeScreenMenu(); openShareDialog(session.sharing); } },
      { label: 'Qualidade', icon: MENU_ICONS.quality, sub: () => openQualityMenu() },
    ]);
  }
  /** Camera chevron: "Mudar câmera" opens the list of cameras beside it; the picked one becomes the default (and is switched to at once if the camera is live). */
  function toggleCameraMenu(): void {
    toggleDockMenu(cameraDockBtn, () => [
      { label: 'Mudar câmera', icon: MENU_ICONS.camera, sub: () => void openCameraListMenu() },
      // the same quality choices as the screen's, for the camera transmission (only while it is live)
      ...(session.sharing && session.shareInfo?.source === 'camera' ? [{ label: 'Qualidade', icon: MENU_ICONS.quality, sub: () => openQualityMenu() }] : []),
    ]);
  }
  async function openCameraListMenu(): Promise<void> {
    const parent = menuLevels[0];
    const pr = parent.getBoundingClientRect();
    const cameras = await listCameras().catch(() => []);
    if (menuLevels[0] !== parent) return; // the menu was closed while the list loaded
    const saved = ctx.cfg.defaultCameraId;
    const rows: MenuRow[] = cameras.length
      ? cameras.map((c) => ({
          label: c.name,
          icon: MENU_ICONS.camera,
          checked: c.id === saved || (!saved && c === cameras[0]),
          onSelect: () => {
            closeScreenMenu();
            void ctx.update({ defaultCameraId: c.id });
            if (session.sharing && session.shareInfo?.source === 'camera' && session.sharedSourceId !== c.id) {
              void session.switchSource(c.id).catch((e: any) => toast(`Não foi possível trocar de câmera: ${e?.message ?? e}`, 'error'));
            }
          },
        }))
      : [{ label: 'Nenhuma câmera encontrada', icon: MENU_ICONS.camera, onSelect: closeScreenMenu }];
    openMenuLevel(1, rows, () => ({ left: pr.right + 6, top: pr.top })); // beside the first menu, same height
  }
  function toggleDockMenu(owner: HTMLElement, firstRows: () => MenuRow[]): void {
    if (menuLevels.length) {
      const same = menuOwner === owner;
      closeScreenMenu();
      if (same) return;
    }
    menuOwner = owner;
    owner.querySelector('.dock-chev')?.classList.add('open');
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuLevels.some((m) => m.contains(t)) || menuOwner?.querySelector('.dock-chev')?.contains(t)) return;
      closeScreenMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeScreenMenu();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    closeScreenMenuListeners = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const chev = owner.querySelector('.dock-chev')!.getBoundingClientRect();
    openMenuLevel(0, firstRows(), (menu) => ({ left: chev.left - 8, top: chev.top - 8 - menu.offsetHeight }));
  }
  type MenuRow = { label: string; icon: string; value?: string; checked?: boolean; onSelect?: () => void; sub?: (row: HTMLElement) => void };
  /** Shows menu level `depth` (closing the deeper ones). `place` gets the built menu and returns where it goes. */
  function openMenuLevel(depth: number, rows: MenuRow[], place: (menu: HTMLElement) => { left: number; top: number }): HTMLElement {
    for (const m of menuLevels.splice(depth)) dismiss(m);
    const menu = h('div', { class: 'menu dock-menu', role: 'menu' });
    for (const r of rows) {
      const row = h('button', { class: `menu-item dock-menu-item ${r.sub ? 'sub' : ''}`, role: 'menuitem' });
      const icon = h('span', { class: 'mi-icon', 'aria-hidden': 'true' });
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${r.icon}</svg>`; // static markup, no user data
      row.append(icon, h('span', { class: 'mi-label' }, r.label));
      if (r.value) row.append(h('span', { class: 'mi-val' }, r.value));
      if (r.checked) row.append(h('span', { class: 'mi-check', 'aria-hidden': 'true' }, '✓'));
      if (r.sub) {
        const arrow = h('span', { class: 'mi-arrow', 'aria-hidden': 'true' }); // right-pointing chevron: this row opens another menu to its right
        arrow.innerHTML = MENU_ARROW_SVG; // static markup, no user data
        row.append(arrow);
      }
      row.onclick = () => {
        if (r.sub) {
          menu.querySelectorAll('.menu-item.open').forEach((x) => x.classList.remove('open'));
          row.classList.add('open');
          r.sub(row);
        } else r.onSelect?.();
      };
      menu.append(row);
    }
    menu.style.visibility = 'hidden';
    player.append(menu);
    const pos = place(menu);
    menu.style.left = `${Math.max(8, Math.min(pos.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(pos.top, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.style.visibility = '';
    menuLevels[depth] = menu;
    return menu;
  }
  function openQualityMenu(): void {
    const parent = menuLevels[0];
    const pr = parent.getBoundingClientRect();
    const info = currentQuality();
    const rows: MenuRow[] = QUALITY_ROWS.map((q) => ({
      label: q.label,
      icon: MENU_ICONS[q.key],
      value: q.options.find(([v]) => v === info[q.key])?.[1],
      sub: () => openChoiceMenu(q),
    }));
    // a little lower than the first menu (about 10% of its height), to the right of it
    openMenuLevel(1, rows, () => ({ left: pr.right + 6, top: pr.top + pr.height * 0.1 }));
  }
  function openChoiceMenu(q: (typeof QUALITY_ROWS)[number]): void {
    const parent = menuLevels[1];
    const pr = parent.getBoundingClientRect();
    const current = currentQuality()[q.key];
    const rows: MenuRow[] = q.options.map(([v, label]) => ({
      label,
      icon: q.key === 'mode' ? (v === 'detail' ? MENU_ICONS.detail : MENU_ICONS.motion) : MENU_ICONS[q.key],
      checked: v === current,
      onSelect: () => {
        if (session.sharing && session.shareInfo) void session.updateQuality({ ...session.shareInfo, [q.key]: v } as ShareInfo);
        closeScreenMenu();
      },
    }));
    openMenuLevel(2, rows, () => ({ left: pr.right + 6, top: pr.top })); // same height as the menu it came from
  }
  const dock = h(
    'div',
    { class: 'call-dock' },
    cameraDockBtn,
    screenDockBtn,
    dockBtn('dock-leave', leaveLabel, DOCK_LEAVE_SVG, ctx.leave),
  );
  const emptyDock = h('div', { class: 'empty-dock' });
  const pbCenter = h('div', { class: 'pb-center pb-hover' });
  const playerBar = h(
    'div',
    { class: 'player-bar' },
    h('div', { class: 'pb-left pb-hover' }, netInfo, playerTitle),
    pbCenter,
    h('div', { class: 'pb-right pb-hover' }, volumeGroup, fsBtn),
  );
  // Nothing open: one scale-green tile per participant (photo in the middle, name at the bottom-left), like a call.
  const tiles = h('div', { class: 'tiles' });
  let tilesSig = '';
  // While watching, a click on the picture shows everyone again (grid mode) with the watched person's live picture in place of their
  // scales; clicking it again goes back to the focus view. Picking another person, or stopping, always returns to focus.
  let gridMode = false;
  let lastViewing: string | null = null;
  const tileOf = new Map<string, HTMLElement>();
  const setGridMode = (on: boolean): void => {
    gridMode = on;
    render();
  };
  const drawTiles = (): void => {
    const peers = [...session.peers.values()];
    const watchedIds = gridMode ? [...session.watched] : []; // in the grid every watched person shows their live picture
    const sig = JSON.stringify([peers.map((p) => [p.peerId, p.name, p.avatar, !!p.share]), session.selfId, session.sharing, watchedIds.map((id) => [id, !!session.streamOf(id)])]);
    if (sig === tilesSig) return;
    tilesSig = sig;
    tileOf.clear();
    const cols = peers.length === 2 ? 1 : Math.max(1, Math.ceil(Math.sqrt(peers.length))); // two people sit one above the other
    const size = peers.length <= 1 ? 140 : peers.length <= 4 ? 112 : 84; // photos are saved at 128 px, so they stay sharp
    tiles.style.setProperty('--cols', String(cols));
    tiles.style.setProperty('--rows', String(Math.max(1, Math.ceil(peers.length / cols))));
    tiles.replaceChildren(
      ...peers.map((p) => {
        const isMe = p.peerId === session.selfId;
        const live = !!p.share;
        const clickable = live && (!isMe || session.sharing); // same rule as the participants list
        const label = isMe ? `${p.name} (você)` : p.name;
        const watched = watchedIds.includes(p.peerId);
        const hasPicture = watched && !!session.streamOf(p.peerId);
        const action = watched ? 'Colocar em foco' : isMe ? 'Ver prévia da sua tela' : `Assistir ${p.name}`;
        // a watched tile holds a stop button, so it cannot be a button itself
        const tile = h(
          clickable && !watched ? 'button' : 'div',
          {
            class: `tile ${live ? 'live' : ''} ${hasPicture ? 'watching' : ''}`,
            ...(clickable ? { title: action, 'aria-label': action } : {}),
            ...(clickable && !watched ? { type: 'button' } : {}),
            ...(watched ? { role: 'button', tabIndex: 0 } : {}),
          },
          avatarEl(p.name, p.avatar, size),
          h('span', { class: 'tile-name' }, watched && !hasPicture ? `${label} · conectando...` : label),
          live ? h('span', { class: 'badge-live tile-live' }, 'AO VIVO') : null,
        );
        if (watched) {
          const focusIt = () => {
            session.focus(p.peerId);
            setGridMode(false);
          };
          tile.onclick = focusIt;
          tile.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              focusIt();
            }
          };
          const stop = h('button', { class: 'tile-stop', type: 'button', title: 'Parar de assistir', 'aria-label': `Parar de assistir ${p.name}`, onclick: (e: MouseEvent) => {
            e.stopPropagation();
            session.removeView(p.peerId);
          } });
          stop.innerHTML = TILE_STOP_SVG; // static markup, no user data
          tile.append(stop);
        } else if (clickable) {
          tile.onclick = () => session.addView(p.peerId); // one more picture, the ones already open stay
        }
        tileOf.set(p.peerId, tile);
        return tile;
      }),
    );
  };
  const player = h('div', { class: 'player' }, videoHolder, placeholder, tiles, emptyDock, playerBar);

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
  // Viewer count and audio note float over the corner of the picture, so they take no room and the picture keeps the same size
  const controls = h('div', { class: 'controls' });
  player.append(controls);
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
    ),
    h('main', { class: 'room-body' }, h('section', { class: 'stage' }, player), h('aside', { class: 'sidebar' }, h('h2', {}, 'Participantes'), list)),
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
        // name on the left; on the right the number of people watching and AO VIVO (the count is not sent by older apps and servers)
        h(
          'div',
          { class: 'peer-top' },
          h('div', { class: 'peer-name' }, isMe ? `${p.name} (você)` : p.name),
          live ? h('span', { class: 'peer-side' }, typeof p.share!.viewers === 'number' ? viewersBadge(p.share!.viewers) : null, h('span', { class: 'badge-live' }, 'AO VIVO')) : null,
        ),
        h(
          'div',
          { class: 'peer-meta muted' },
          live ? shareKindIcon(p.share!.source) : null,
          h('span', { class: 'meta-text' }, live ? `${p.share!.resolution} · ${p.share!.fps} fps` : 'Sem transmissão'),
          !isMe && p.quality !== 'unknown' ? h('span', { class: `dot ${p.quality}`, title: `${QUALITY_LABEL[p.quality]}${p.rtt !== null ? ` · ${p.rtt} ms` : ''}` }) : null,
          !isMe && p.rtt !== null ? h('span', { class: 'meta-rtt' }, `${p.rtt} ms`) : null,
        ),
      ),
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
    const kinds: Kind[] = ['screens', 'windows'];
    // start from the cache (instant) and refresh in the background; screens and windows load independently, screens first
    const lists: Record<Kind, CaptureSource[]> = { screens: sourceCache.screens ?? [], windows: sourceCache.windows ?? [] };
    const loaded: Record<Kind, boolean> = { screens: sourceCache.screens !== null, windows: sourceCache.windows !== null };
    let kind: Kind = 'screens';
    let chosen: string | null = lists.screens[0]?.id ?? null;

    // Quality starts from the Transmissão defaults (Configurações). The camera has its own menu on the camera button.
    draft = { resolution: ctx.cfg.resolution, fps: ctx.cfg.fps, mode: ctx.cfg.mode };
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
    };
    const track = h('div', { class: 'source-track' }, panels.screens, panels.windows);
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
            card = h('button', { class: 'source', onclick: () => { chosen = src.id; refreshSelection(); } }, h('img', { src: src.thumbnail, alt: '' }), h('span', {}, labelOf(src)));
            card.dataset.id = src.id;
            cards.set(src.id, card);
          } else {
            const img = card.querySelector('img');
            if (img && img.getAttribute('src') !== src.thumbnail) img.setAttribute('src', src.thumbnail);
          }
          return card;
        });
      } else if (loaded[k]) {
        els = [h('div', { class: 'source-empty muted' }, k === 'screens' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta para compartilhar.')];
      } else {
        els = skeletons();
      }
      const same = panel.children.length === els.length && els.every((el, i) => panel.children[i] === el);
      if (!same) panel.replaceChildren(...els);
    };

    const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'O que compartilhar' });
    const showKind = (k: Kind) => {
      kind = k;
      if (!lists[k].some((src) => src.id === chosen)) chosen = lists[k][0]?.id ?? null; // the selection always belongs to the visible tab
      const index = kinds.indexOf(k);
      seg.dataset.pos = String(index); // slides the highlight under the buttons
      track.style.transform = `translateX(${-(index * 100) / kinds.length}%)`; // swipes the lists
      for (const key of kinds) {
        const active = key === k;
        tabs.get(key)!.setAttribute('aria-selected', String(active));
        tabs.get(key)!.tabIndex = active ? 0 : -1;
        panels[key].toggleAttribute('inert', !active); // the hidden list cannot be tabbed into
      }
      refreshSelection();
    };
    for (const [k, label] of [['screens', 'Telas'], ['windows', 'Janelas']] as Array<[Kind, string]>) {
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
        h('h2', {}, switching ? 'Trocar a tela ou janela que você compartilha' : 'Compartilhar tela'),
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

    // refresh in the background: screens (fast) and windows (slow) independently
    for (const k of kinds) {
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

  /** Eye icon + number of people watching somebody, shown in that person's card of the participants list. */
  function viewersBadge(count: number): HTMLElement {
    const label = count === 0 ? 'Ninguém assistindo' : `${count} espectador${count === 1 ? '' : 'es'}`;
    const badge = h('span', { class: `viewers ${count ? 'has' : ''}`, title: label, 'aria-label': label });
    badge.innerHTML = EYE_SVG; // static markup, no user data
    badge.append(h('span', { class: 'viewers-count' }, String(count)));
    return badge;
  }

  function drawControls(): void {
    // starting a share is the screen button of the dock over the player; only the audio warning stays here
    controls.replaceChildren(...(session.sharing && session.audioNote ? [h('span', { class: 'muted' }, session.audioNote)] : []));
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
    if (session.viewing !== lastViewing) {
      lastViewing = session.viewing;
      gridMode = false; // a different person (or none) always opens in focus
      window.clearTimeout(clickTimer);
    }
    const showTiles = !session.viewing || gridMode;
    placeholder.style.display = !session.stream && session.viewing && !gridMode ? 'flex' : 'none'; // with nothing open (or in the grid) the tiles show instead
    tiles.style.display = showTiles ? 'flex' : 'none';
    if (showTiles) drawTiles();
    // One video per person being watched. In focus only the focused one is shown in the player (and heard); in the grid every one sits in
    // its own tile. A video not on screen waits in the hidden holder, so it keeps playing. Moving a video element pauses it, so it is resumed.
    for (const [id, v] of [...videos]) {
      if (session.watched.has(id)) continue;
      v.srcObject = null;
      v.remove();
      videos.delete(id);
    }
    for (const id of session.watched) {
      let v = videos.get(id);
      if (!v) {
        v = makeVideo();
        videos.set(id, v);
        videoHolder.append(v);
      }
      const stream = session.streamOf(id);
      if (v.srcObject !== stream) v.srcObject = stream;
      v.muted = id === session.selfId || session.muteIncoming || (!gridMode && id !== session.viewing);
      const host = gridMode ? ((stream && tileOf.get(id)) || videoHolder) : id === session.viewing ? player : videoHolder;
      if (v.parentElement !== host) {
        host.prepend(v);
        void v.play().catch(() => undefined);
      }
    }
    // The bar (who you watch, volume, fullscreen, and the dock inside it) is only for the focused picture; the grid has the dock on its own, always visible
    const focusedView = !!session.viewing && !gridMode;
    playerBar.style.display = focusedView ? 'grid' : 'none';
    const dockHost = focusedView ? pbCenter : emptyDock;
    if (dock.parentElement !== dockHost) dockHost.append(dock);
    emptyDock.style.display = focusedView ? 'none' : 'flex';
    drawScreenDock();
    // Trocar tela / Qualidade belong to the owner of the transmission, and only show while looking at your own screen (not someone else's)
    const ownMenu = session.sharing && session.shareInfo?.source !== 'camera' && session.viewing === session.selfId; // a camera transmission has its own menu on the camera button
    screenDockBtn.classList.toggle('no-menu', !ownMenu);
    if (!ownMenu && menuLevels.length) closeScreenMenu();
    cameraDockBtn.classList.toggle('on', session.sharing && session.shareInfo?.source === 'camera');
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
      for (const video of videos.values()) video.srcObject = null;
    },
  };
}
