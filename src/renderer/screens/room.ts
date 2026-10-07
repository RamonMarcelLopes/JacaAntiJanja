import { AppConfig, BITRATE_MBPS, CaptureSource, Fps, Resolution, RoomInfo, ShareInfo, ShareMode } from '../../shared/protocol';
import { avatarEl, dismiss, dismissOnBackdrop, h, resizeAvatar, toast } from '../dom';
import { formatDuration } from '../../shared/time';
import { customSelect } from '../select';
import { PeerView, Session } from '../session';

export interface RoomContext {
  cfg: AppConfig;
  session: Session;
  room: RoomInfo | null;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  leave(): void;
}

const EYE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/** Speaker icon that follows the volume: crossed out at 0, one wave when low, two waves when high. */
function speakerSvg(volume: number): string {
  const cone = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>';
  const inner = volume === 0 ? '<line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>' : volume < 50 ? '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' : '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cone}${inner}</svg>`;
}

// "Stop watching": a screen with an X in the middle.
const SCREEN_X_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M9.5 7.5l5 5M14.5 7.5l-5 5"/></svg>';

const FS_ENTER_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
const FS_EXIT_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>';

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
/** Last known screens/windows with thumbnails: shown at once when the share dialog opens, then refreshed in the background. */
const sourceCache: Record<SourceKind, CaptureSource[] | null> = { screens: null, windows: null };
let lastPrefetch = 0;

/** Warms the cache (room open, mouse over the share button). Throttled; failures are ignored. */
function prefetchSources(): void {
  if (Date.now() - lastPrefetch < 5000) return;
  lastPrefetch = Date.now();
  for (const k of ['screens', 'windows'] as SourceKind[]) {
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
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void player.requestFullscreen?.();
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
  // Three areas: who/what you are watching (left, always visible), the stop button (center) and volume + fullscreen (right).
  // The center and right controls (.pb-hover) only show while the pointer is over the picture.
  const playerBar = h(
    'div',
    { class: 'player-bar' },
    h('div', { class: 'pb-left' }, netInfo, playerTitle),
    h('div', { class: 'pb-center pb-hover' }, stopBtn),
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

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('h1', { class: 'room-title', title: session.roomName }, session.roomName || (session.isHost ? 'Sua sala' : 'Sala')),
      codeChip,
      h('span', { class: 'spacer' }),
      timer,
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
          live ? `${p.share!.resolution} · ${p.share!.fps} fps` : 'Sem transmissão',
          !isMe && p.quality !== 'unknown' ? h('span', { class: `dot ${p.quality}`, title: `${QUALITY_LABEL[p.quality]}${p.rtt !== null ? ` · ${p.rtt} ms` : ''}` }) : null,
          !isMe && p.rtt !== null ? ` ${p.rtt} ms` : null,
        ),
      ),
      live ? h('span', { class: 'badge-live' }, 'AO VIVO') : null,
    );
    if (!isMe) return card;
    // Own card: a three-dot button inside the card's right edge opens the profile menu (visible on hover). It is a
    // sibling of the card button, positioned over it, because a button cannot sit inside another button.
    const kebab = h('button', {
      class: 'kebab',
      title: 'Opções do perfil',
      'aria-label': 'Opções do perfil',
      'aria-haspopup': 'menu',
      'aria-expanded': String(menuOpen),
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        openProfileMenu(kebab);
      },
    }, h('span', { class: 'kebab-dots', 'aria-hidden': 'true' }));
    return h('div', { class: 'peer-row' }, card, kebab);
  }

  let closeMenu: (() => void) | null = null;
  let menuOpen = false;
  function openProfileMenu(anchor: HTMLElement): void {
    closeMenu?.();
    menuOpen = true;
    anchor.setAttribute('aria-expanded', 'true');
    const item = h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { close(); openProfileDialog(); } }, 'Editar perfil');
    const menu = h('div', { class: 'menu', role: 'menu' }, item);
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
      menuOpen = false;
      list.querySelector('.kebab')?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      closeMenu = null;
    }
    closeMenu = close;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.body.append(menu);
    item.focus();
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
        await commit(session.me().name, await resizeAvatar(file));
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
      const sig = JSON.stringify([p.name, p.avatar, p.share, p.quality, p.rtt, session.viewing === p.peerId, session.sharing, menuOpen, p.peerId === session.selfId]);
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

  function openShareDialog(): void {
    type Kind = SourceKind;
    const kinds: Kind[] = ['screens', 'windows'];
    // start from the cache (instant) and refresh in the background; screens and windows load independently, screens first
    const lists: Record<Kind, CaptureSource[]> = { screens: sourceCache.screens ?? [], windows: sourceCache.windows ?? [] };
    const loaded: Record<Kind, boolean> = { screens: sourceCache.screens !== null, windows: sourceCache.windows !== null };
    let kind: Kind = 'screens';
    let chosen: string | null = lists.screens[0]?.id ?? null;

    // Electron names screens in English ("Screen 1")
    const labelOf = (src: CaptureSource) => (src.isScreen ? src.name.replace(/^Screen (\d+)$/i, 'Tela $1').replace(/^Entire screen$/i, 'Tela inteira') : src.name);

    // Both lists live side by side in a sliding track: switching tabs swipes the track (the segmented control swipes its highlight too).
    const panels: Record<Kind, HTMLElement> = {
      screens: h('div', { class: 'source-panel', role: 'tabpanel' }),
      windows: h('div', { class: 'source-panel', role: 'tabpanel' }),
    };
    const track = h('div', { class: 'source-track' }, panels.screens, panels.windows);
    const viewport = h('div', { class: 'source-viewport' }, track);
    const startBtn = h('button', { class: 'primary' }, 'Compartilhar');
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
            const img = h('img', { src: src.thumbnail, alt: '' });
            card = h('button', { class: 'source', onclick: () => { chosen = src.id; refreshSelection(); } }, img, h('span', {}, labelOf(src)));
            card.dataset.id = src.id;
            cards.set(src.id, card);
          } else {
            const img = card.querySelector('img')!;
            if (img.getAttribute('src') !== src.thumbnail) img.setAttribute('src', src.thumbnail);
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
      seg.dataset.kind = k; // slides the highlight under the buttons
      track.style.transform = k === 'windows' ? 'translateX(-50%)' : 'translateX(0)'; // swipes the lists
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
      const next: Kind = kind === 'screens' ? 'windows' : 'screens';
      showKind(next);
      tabs.get(next)!.focus();
    });

    const overlay = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'dialog share-dialog' },
        h('h2', {}, 'Compartilhar tela'),
        seg,
        viewport,
        h(
          'div',
          { class: 'row wrap' },
          selectOf<Resolution>(draft.resolution, [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], (v) => { draft = { ...draft, resolution: v as Resolution }; }),
          selectOf<number>(draft.fps, [[30, '30 fps'], [60, '60 fps']], (v) => { draft = { ...draft, fps: Number(v) as Fps }; }),
          selectOf<ShareMode>(draft.mode, [['motion', 'Movimento'], ['detail', 'Detalhe']], (v) => { draft = { ...draft, mode: v as ShareMode }; }),
        ),
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dismiss(overlay) }, 'Cancelar'), startBtn),
      ),
    );
    startBtn.onclick = async () => {
      if (!chosen) return;
      starting = true;
      startBtn.disabled = true;
      startBtn.textContent = 'Iniciando...';
      try {
        await session.startSharing(chosen, draft);
        dismiss(overlay);
      } catch (e: any) {
        toast(`Não foi possível iniciar o compartilhamento: ${e?.message ?? e}`, 'error');
        starting = false;
        startBtn.disabled = false;
        startBtn.textContent = 'Compartilhar';
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
      controls.replaceChildren(h('button', { class: 'primary', onclick: () => void openShareDialog(), onmouseenter: prefetchSources, onfocus: prefetchSources }, 'Compartilhar tela'));
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
