// Modals: create room, join with a code, share (screens / windows), confirm, profile, crop of the photo, fixed rooms.
import { Camera, Cast, Check, DoorOpen, Eye, Gauge, Info, KeyRound, MonitorUp, Pencil, Plus, Signal, Star, Trash2, X, type IconNode } from 'lucide';
import { AppConfig, CaptureSource, Fps, FixedRoom, MAX_ROOM_NAME, Resolution, ShareInfo, ShareMode } from '../../shared/protocol';
import { dismiss, h, icon } from '../dom';
import { burst, toast } from '../fx';
import { createRoom, DEFAULT_ROOM_NAME, joinRoom, NEW_FIXED, TEMPORARY } from '../flows';
import { emit, hueOf, S, updateConfig } from '../state';
import { avatar, choice, iconPicker, segmented, select, toggle } from './controls';

/** Opens a modal. Returns a function that closes it with its exit animation. */
export function modal(content: HTMLElement, opts: { width?: string; onClose?: () => void; canClose?: () => boolean } = {}): () => void {
  const box = h('div', { class: 'modal', style: { width: `min(${opts.width ?? '520px'}, 100%)` }, role: 'dialog' }, content);
  const backdrop = h('div', { class: 'backdrop' }, box);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    dismiss(backdrop, 220);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.menu') && (opts.canClose?.() ?? true) && close();
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === backdrop));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && downOnBackdrop && (opts.canClose?.() ?? true)) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  return close;
}

const header = (title: string, sub: string | null, close: () => void, ico: IconNode) =>
  h('div', { class: 'flex items-start gap-3 p-6 pb-2' },
    h('div', { class: 'grid place-items-center w-10 h-10 rounded-xl bg-accent/20 text-accent flex-none' }, icon(ico, 20)),
    h('div', { class: 'flex-1' }, h('h2', { class: 'font-display text-xl font-bold' }, title), sub ? h('p', { class: 'text-muted text-[13px] mt-0.5' }, sub) : null),
    h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, icon(X, 18)),
  );

const footer = (...buttons: HTMLElement[]) => h('div', { class: 'flex justify-end gap-2 p-6 pt-4 border-t border-line mt-4' }, ...buttons);
const label = (text: string, control: Node) => h('label', { class: 'block mb-4' }, h('span', { class: 'block text-xs font-bold tracking-wide text-muted uppercase mb-1.5' }, text), control);
const shake = (el: HTMLElement) => el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 380 });
const WEBHOOK_HELP = 'No Discord: configurações do canal > Integrações > Webhooks > Novo webhook > copiar a URL. Fica guardada criptografada neste PC e nunca aparece na tela. Quem tiver essa URL consegue postar no canal, e o código da sala fica visível para todos que veem o canal.';

// ---------------------------------------------------------------------------------------------------------------- the Discord part of a fixed room
interface DiscordPart {
  el: HTMLElement;
  on(): boolean;
  value(): string;
}

/** A switch and, only while it is on, the field for the webhook of THAT room. `hasSaved`: the room already has one (the switch starts on). */
function discordPart(hasSaved: boolean): DiscordPart {
  let on = hasSaved;
  const input = h('input', { class: 'field font-mono text-[13px]', type: 'password', autocomplete: 'off', spellcheck: false, maxLength: 300, 'aria-label': 'Webhook desta sala', placeholder: hasSaved ? 'Webhook guardado (cole outro para trocar)' : 'https://discord.com/api/webhooks/...' });
  const box = h('div', { class: on ? 'mb-4' : 'hidden mb-4' }, label('Link do webhook do Discord', input), h('p', { class: 'text-muted text-[13px] -mt-2' }, WEBHOOK_HELP));
  const sw = toggle(on, (v) => {
    on = v;
    box.classList.toggle('hidden', !v);
    if (v) {
      box.classList.remove('animate-fade-up');
      void box.offsetWidth; // restart the animation every time it opens
      box.classList.add('animate-fade-up');
      input.focus();
    }
  }, 'Avisar no Discord quando a sala abrir');
  const el = h('div', {},
    h('div', { class: 'flex items-center justify-between gap-4 p-3 rounded-xl bg-s3 border border-line mb-4' },
      h('div', {}, h('div', { class: 'font-semibold' }, 'Avisar no Discord'), h('div', { class: 'text-muted text-[13px]' }, 'Posta num canal quando a sala abrir, com o código.')),
      sw),
    box);
  return { el, on: () => on, value: () => input.value.trim() };
}

// ---------------------------------------------------------------------------------------------------------------- create room
export function openCreateRoom(): void {
  const cloud = S.cfg.connectionMode === 'cloudflare';
  let kind = TEMPORARY;
  let iconKey = S.tempIcon;
  let busy = false;
  const name = h('input', { class: 'field', placeholder: DEFAULT_ROOM_NAME, maxLength: MAX_ROOM_NAME, value: DEFAULT_ROOM_NAME, 'aria-label': 'Nome da sala' }) as HTMLInputElement;
  const discord = discordPart(false);
  const discordBox = h('div', { class: 'hidden' }, discord.el);
  const iconRow = h('div', {}, label('Ícone da sala', iconPicker(iconKey, hueOf(DEFAULT_ROOM_NAME), (k) => (iconKey = k))));
  const create = h('button', { class: 'btn btn-primary ripple' }, icon(Plus, 16), 'Criar sala');
  const title = h('h2', { class: 'font-display text-xl font-bold' }, 'Iniciar sala');
  void title;
  const sync = () => {
    const fixed = S.cfg.fixedRooms.find((r) => r.id === kind);
    name.disabled = !!fixed; // a fixed room keeps its own name
    if (fixed) name.value = fixed.name;
    discordBox.classList.toggle('hidden', kind !== NEW_FIXED);
    iconRow.classList.toggle('hidden', !!fixed); // the icon of a fixed room is changed in Configurações > Salas fixas
    create.lastChild!.textContent = fixed ? 'Iniciar sala' : 'Criar sala';
  };
  const kindOptions: Array<[string, string]> = [[TEMPORARY, 'Sala temporária'], ...S.cfg.fixedRooms.map((r): [string, string] => [r.id, `Sala fixa: ${r.name}`]), [NEW_FIXED, '+ Nova sala fixa']];
  const kindSelect = select<string>(kindOptions, kind, (v) => {
    kind = v;
    const fixed = S.cfg.fixedRooms.find((r) => r.id === v);
    name.value = fixed ? fixed.name : DEFAULT_ROOM_NAME;
    sync();
    if (!fixed) {
      name.focus();
      name.select();
    }
  }, 340, 'Tipo de sala');
  const close = modal(
    h('div', {},
      h('div', { class: 'flex items-start gap-3 p-6 pb-2' },
        h('div', { class: 'grid place-items-center w-10 h-10 rounded-xl bg-accent/20 text-accent flex-none' }, icon(DoorOpen, 20)),
        h('div', { class: 'flex-1' }, title, h('p', { class: 'text-muted text-[13px] mt-0.5' }, 'Você vira o host. Os amigos entram com o código.')),
        h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => !busy && close() }, icon(X, 18))),
      h('div', { class: 'p-6 pt-4' },
        cloud ? label('Tipo de sala', kindSelect) : null,
        label('Nome da sala', name),
        discordBox,
        iconRow),
      footer(h('button', { class: 'btn btn-ghost', onclick: () => !busy && close() }, 'Cancelar'), create),
    ),
    { canClose: () => !busy },
  );
  const submit = async (e: Event) => {
    if (busy) return;
    const useDiscord = kind === NEW_FIXED && discord.on();
    if (useDiscord && !discord.value()) {
      toast('Cole o webhook do canal ou desligue o aviso no Discord.', 'warn');
      return;
    }
    busy = true;
    create.disabled = true;
    const original = create.textContent;
    const at = { x: (e as MouseEvent).clientX ?? innerWidth / 2, y: (e as MouseEvent).clientY ?? innerHeight / 2 };
    const ok = await createRoom({ kind, name: name.value, webhook: useDiscord ? discord.value() : '', icon: iconKey, progress: (t) => (create.textContent = t) });
    busy = false;
    create.disabled = false;
    if (ok) {
      close();
      burst(at.x, at.y);
    } else create.textContent = original;
  };
  create.onclick = submit;
  name.addEventListener('keydown', (e) => e.key === 'Enter' && void submit(e));
  name.focus();
  name.select();
}

// ---------------------------------------------------------------------------------------------------------------- join with a code
export function openJoin(): void {
  const code = h('input', { class: 'field text-center font-mono text-lg tracking-[0.12em]', placeholder: 'XXXXX-XXXXX@conta', maxLength: 80, spellcheck: false, 'aria-label': 'Código da sala' }) as HTMLInputElement;
  const hint = h('p', { class: 'text-muted text-[13px] mt-2 min-h-5' }, 'Cole o código inteiro que o dono da sala mandou.');
  const join = h('button', { class: 'btn btn-primary ripple' }, icon(KeyRound, 16), 'Entrar');
  let busy = false;
  const close = modal(
    h('div', {},
      header('Entrar em uma sala', 'Só precisa do código.', () => !busy && close(), KeyRound),
      h('div', { class: 'p-6 pt-4' }, label('Código da sala', code), hint),
      footer(h('button', { class: 'btn btn-ghost', onclick: () => !busy && close() }, 'Cancelar'), join),
    ),
    { width: '460px', canClose: () => !busy },
  );
  const go = async () => {
    if (busy) return;
    busy = true;
    join.disabled = true;
    const original = join.textContent;
    const ok = await joinRoom(code.value, (t) => (join.textContent = t));
    busy = false;
    join.disabled = false;
    if (ok) close();
    else {
      join.textContent = original;
      shake(code);
    }
  };
  join.onclick = () => void go();
  code.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  code.focus();
}

// ---------------------------------------------------------------------------------------------------------------- share
type SourceKind = 'screens' | 'windows';
/** Last known screens/windows with thumbnails: shown at once when the dialog opens, then refreshed in the background. */
const sourceCache: Record<SourceKind, CaptureSource[] | null> = { screens: null, windows: null };
let lastPrefetch = 0;

/** Warms the cache (room open, mouse over the share button). Throttled; failures are ignored. */
export function prefetchSources(): void {
  if (Date.now() - lastPrefetch < 5000) return;
  lastPrefetch = Date.now();
  for (const k of ['screens', 'windows'] as SourceKind[]) window.jaca.listSources(k).then((list) => (sourceCache[k] = list)).catch(() => undefined);
}

/** Electron names screens in English ("Screen 1"). */
const sourceLabel = (src: CaptureSource) => (src.isScreen ? src.name.replace(/^Screen (\d+)$/i, 'Tela $1').replace(/^Entire screen$/i, 'Tela inteira') : src.name);

export function openShare(opts: { switching?: boolean } = {}): void {
  const session = S.session;
  if (!session) return;
  const kinds: Array<[SourceKind, string]> = [['screens', 'Telas'], ['windows', 'Janelas']];
  const lists: Record<SourceKind, CaptureSource[]> = { screens: sourceCache.screens ?? [], windows: sourceCache.windows ?? [] };
  const loaded: Record<SourceKind, boolean> = { screens: sourceCache.screens !== null, windows: sourceCache.windows !== null };
  let kind: SourceKind = 'screens';
  let chosen: string | null = lists.screens[0]?.id ?? null;
  let starting = false;
  // the quality starts from the Transmissão defaults (Configurações); the camera has its own menu on the camera button
  let draft: ShareInfo = { resolution: S.cfg.resolution, fps: S.cfg.fps, mode: S.cfg.mode };
  const grid = h('div', { class: 'grid grid-cols-2 gap-3 p-1 h-[317px] auto-rows-max [align-content:safe_center] overflow-auto' });
  const start = h('button', { class: 'btn btn-primary ripple' }, icon(MonitorUp, 16), opts.switching ? 'Trocar' : 'Compartilhar');
  const cards = new Map<string, HTMLButtonElement>();

  const paintSelection = () => {
    cards.forEach((card, id) => {
      const on = id === chosen;
      card.setAttribute('aria-pressed', String(on));
      card.style.borderColor = on ? 'var(--accent)' : '';
      card.style.boxShadow = on ? '0 0 0 4px color-mix(in oklab, var(--accent) 22%, transparent)' : '';
    });
    start.disabled = !chosen || starting;
  };
  const draw = () => {
    const list = lists[kind];
    if (!list.length) {
      grid.replaceChildren(...(loaded[kind]
        ? [h('div', { class: 'col-span-2 text-center text-muted py-10' }, kind === 'screens' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta para compartilhar.')]
        : Array.from({ length: 4 }, () => h('div', { class: 'rounded-xl overflow-hidden border border-line' }, h('div', { class: 'skeleton aspect-video' }), h('div', { class: 'skeleton h-8 mt-px' })))));
      paintSelection();
      return;
    }
    const els = list.map((src, i) => {
        let card = cards.get(src.id);
        if (!card) {
          card = h('button', { class: 'source text-left rounded-xl overflow-hidden border-2 border-line bg-s3 transition-all duration-300 hover:-translate-y-0.5 animate-pop', style: { animationDelay: `${i * 60}ms` }, onclick: () => { chosen = src.id; paintSelection(); } },
            h('div', { class: 'aspect-video bg-black' }, h('img', { src: src.thumbnail, alt: '', class: 'w-full h-full object-contain' })),
            h('div', { class: 'px-3 py-2 text-[13px] font-semibold truncate' }, sourceLabel(src)));
          card.dataset.id = src.id;
          // the entrance plays once: a card put back in the page (the lists are refreshed in the background) must not play it again
          card.addEventListener('animationend', () => { card!.classList.remove('animate-pop'); card!.style.animationDelay = ''; }, { once: true });
          cards.set(src.id, card);
        } else {
          const img = card.querySelector('img');
          if (img && img.getAttribute('src') !== src.thumbnail) img.setAttribute('src', src.thumbnail);
        }
        return card;
    });
    // only touch the page when the cards are not already the ones on it (re-inserting them would restart their animation and make them jump)
    if (!(grid.children.length === els.length && els.every((el, i) => grid.children[i] === el))) grid.replaceChildren(...els);
    paintSelection();
  };
  const tabs = segmented<SourceKind>(kinds, kind, (k) => {
    kind = k;
    if (!lists[k].some((s) => s.id === chosen)) chosen = lists[k][0]?.id ?? null; // the selection always belongs to the visible tab
    draw();
  });
  // the quality of this transmission: three small groups of options in one line
  const setQuality = (patch: Partial<ShareInfo>) => {
    draft = { ...draft, ...patch };
  };
  const quality = opts.switching ? null : h('div', { class: 'h-[58px] flex flex-wrap items-center gap-2' }, // half the height it had; the options are centered in it
    choice<Resolution>('Resolução', [['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p']], draft.resolution, (v) => setQuality({ resolution: v })),
    choice<number>('FPS', [[30, '30 fps'], [60, '60 fps']], draft.fps, (v) => setQuality({ fps: v as Fps })),
    choice<ShareMode>('Modo', [['motion', 'Movimento'], ['detail', 'Detalhe']], draft.mode, (v) => setQuality({ mode: v })));
  const footerEl = footer(h('button', { class: 'btn btn-ghost', onclick: () => !starting && close() }, 'Cancelar'), start);
  if (!opts.switching) footerEl.classList.replace('mt-4', 'mt-0'); // the quality row (58 px, options centered) sits right above it
  const close = modal(
    h('div', {},
      header(opts.switching ? 'Trocar a tela ou janela que você compartilha' : 'Compartilhar tela', 'Escolha o que os amigos vão ver.', () => !starting && close(), Cast),
      h('div', { class: opts.switching ? 'p-6 pt-4' : 'px-6 pt-4 pb-3' }, tabs, h('div', { class: 'mt-4' }, grid), quality),
      footerEl,
    ),
    { width: '640px', canClose: () => !starting },
  );
  draw();
  start.onclick = async (e) => {
    if (!chosen) return;
    starting = true;
    start.disabled = true;
    const original = start.lastChild!.textContent;
    start.lastChild!.textContent = opts.switching ? 'Trocando...' : 'Iniciando...';
    try {
      if (opts.switching) await session.switchSource(chosen);
      else await session.startSharing(chosen, draft);
      close();
      burst((e as MouseEvent).clientX, (e as MouseEvent).clientY);
    } catch (err: any) {
      toast(opts.switching ? `Não foi possível trocar: ${err?.message ?? err}` : `Não foi possível iniciar o compartilhamento: ${err?.message ?? err}`, 'warn');
      starting = false;
      start.disabled = false;
      start.lastChild!.textContent = original;
    }
  };
  // refresh in the background: screens (fast) and windows (slow) independently
  for (const [k] of kinds) {
    window.jaca.listSources(k).then((list) => {
      sourceCache[k] = list;
      if (!grid.isConnected) return;
      lists[k] = list;
      loaded[k] = true;
      if (kind === k && !list.some((s) => s.id === chosen)) chosen = list[0]?.id ?? null;
      draw();
    }).catch(() => {
      if (!grid.isConnected) return;
      loaded[k] = true;
      draw();
      toast('Não foi possível listar as telas e janelas.', 'warn');
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------- confirm
export function confirmDialog(title: string, text: string, confirm: string, onYes: () => void, danger = false, ico: IconNode = Info): void {
  const yes = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'} ripple` }, confirm);
  const close = modal(h('div', {}, header(title, null, () => close(), ico), h('p', { class: 'px-6 pt-2 text-muted leading-relaxed' }, text), footer(h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancelar'), yes)), { width: '460px' });
  yes.onclick = () => {
    close();
    onYes();
  };
}

/** A fixed room still looks open (the app closed without ending it). Asks what to do. */
export function askFixedRoomBusy(roomName: string): Promise<'takeover' | 'temporary' | null> {
  return new Promise((resolve) => {
    let answer: 'takeover' | 'temporary' | null = null;
    const finish = (v: typeof answer) => {
      answer = v;
      close();
    };
    const close = modal(
      h('div', {},
        header('A sala ainda aparece aberta', null, () => finish(null), Info),
        h('p', { class: 'px-6 pt-2 text-muted leading-relaxed' }, `A sala fixa "${roomName}" ainda está aberta no servidor. Costuma acontecer quando o app fechou sem encerrar a sala. Você pode reabrir a mesma sala, com o mesmo código (quem ainda estiver nela é desconectado), ou criar uma sala temporária com outro código.`),
        footer(h('button', { class: 'btn btn-ghost', onclick: () => finish(null) }, 'Cancelar'), h('button', { class: 'btn btn-ghost', onclick: () => finish('temporary') }, 'Criar temporária'), h('button', { class: 'btn btn-primary ripple', onclick: () => finish('takeover') }, 'Reabrir esta sala'))),
      { width: '520px', onClose: () => resolve(answer) },
    );
  });
}

// ---------------------------------------------------------------------------------------------------------------- favorite
/** Favorites the room being visited. Taking it out of the favorites asks first. */
export async function toggleFavorite(code: string, name: string): Promise<void> {
  const isFav = S.cfg.favoriteRooms.some((f) => f.code === code);
  const rest = S.cfg.favoriteRooms.filter((f) => f.code !== code);
  if (!isFav) {
    if (rest.length >= 20) return void toast('Você já tem 20 salas favoritas. Remova uma para favoritar outra.', 'warn');
    await updateConfig({ favoriteRooms: [...rest, { code, name: name || 'Sala' }] });
    toast(`${name || 'A sala'} entrou nos favoritos`, 'ok');
    return;
  }
  confirmDialog('Tirar dos favoritos', `${name} deixa de aparecer nas suas salas favoritas. Você pode favoritar de novo quando quiser.`, 'Tirar dos favoritos', async () => {
    await updateConfig({ favoriteRooms: rest });
    toast(`${name} saiu dos favoritos`, 'ok');
  }, true, Star);
}

// ---------------------------------------------------------------------------------------------------------------- the photo
const CROP_VIEW = 260; // diameter in px of the circle the person positions the photo in
const CROP_OUT = 256; // size of the saved picture
const CROP_MAX_ZOOM = 4;

/** Dialog to choose which part of a picture becomes the profile photo: drag to move it, slider or wheel to zoom. Resolves with a JPEG data URL, or null when cancelled. */
export function cropAvatar(file: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = h('img', { alt: '', draggable: false, class: 'absolute max-w-none select-none pointer-events-none' });
    let nw = 0, nh = 0, zoom = 1, ox = 0, oy = 0, done = false;
    const scale = () => (CROP_VIEW / Math.min(nw, nh)) * zoom;
    const draw = () => {
      const mx = Math.max(0, (nw * scale() - CROP_VIEW) / 2);
      const my = Math.max(0, (nh * scale() - CROP_VIEW) / 2);
      ox = Math.min(mx, Math.max(-mx, ox));
      oy = Math.min(my, Math.max(-my, oy));
      const s = scale();
      img.style.width = `${nw * s}px`;
      img.style.height = `${nh * s}px`;
      img.style.left = `${CROP_VIEW / 2 + ox - (nw * s) / 2}px`;
      img.style.top = `${CROP_VIEW / 2 + oy - (nh * s) / 2}px`;
      zoomSlider.style.setProperty('--v', `${((zoom - 1) / (CROP_MAX_ZOOM - 1)) * 100}%`);
    };
    const zoomSlider = h('input', { type: 'range', min: '1', max: String(CROP_MAX_ZOOM), step: '0.01', value: '1', class: 'range flex-1', 'aria-label': 'Zoom' });
    zoomSlider.addEventListener('input', () => { zoom = Number(zoomSlider.value); draw(); });
    const frame = h('div', { class: 'relative overflow-hidden rounded-full border-2 border-accent mx-auto cursor-grab touch-none bg-black', style: { width: `${CROP_VIEW}px`, height: `${CROP_VIEW}px` } }, img);
    let drag: { x: number; y: number; ox: number; oy: number } | null = null;
    frame.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; frame.setPointerCapture(e.pointerId); });
    frame.addEventListener('pointermove', (e) => { if (!drag) return; ox = drag.ox + (e.clientX - drag.x); oy = drag.oy + (e.clientY - drag.y); draw(); });
    frame.addEventListener('pointerup', () => (drag = null));
    frame.addEventListener('pointercancel', () => (drag = null));
    frame.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(CROP_MAX_ZOOM, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); zoomSlider.value = String(zoom); draw(); }, { passive: false });
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      closeCrop();
      resolve(result);
    };
    const save = h('button', { class: 'btn btn-primary ripple', disabled: true }, icon(Check, 16), 'Usar esta foto');
    save.onclick = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = CROP_OUT;
      const s = scale();
      const left = CROP_VIEW / 2 + ox - (nw * s) / 2;
      const top = CROP_VIEW / 2 + oy - (nh * s) / 2;
      canvas.getContext('2d')!.drawImage(img, -left / s, -top / s, CROP_VIEW / s, CROP_VIEW / s, 0, 0, CROP_OUT, CROP_OUT);
      finish(canvas.toDataURL('image/jpeg', 0.88));
    };
    const closeCrop = modal(
      h('div', {},
        header('Ajustar foto', 'Arraste para escolher a parte da imagem e use o zoom para aproximar.', () => finish(null), Pencil),
        h('div', { class: 'p-6 pt-4' }, frame, h('div', { class: 'flex items-center gap-3 mt-4 px-8' }, h('span', { class: 'text-muted' }, '−'), zoomSlider, h('span', { class: 'text-muted' }, '+'))),
        footer(h('button', { class: 'btn btn-ghost', onclick: () => finish(null) }, 'Cancelar'), save)),
      { width: '420px', onClose: () => finish(null) },
    );
    img.onload = () => {
      nw = img.naturalWidth;
      nh = img.naturalHeight;
      if (!nw || !nh) return finish(null);
      save.disabled = false;
      draw();
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      closeCrop();
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------------------------------------------- profile
export function openProfile(): void {
  const session = S.session;
  const current = () => ({ name: session ? session.me().name : S.cfg.name, avatar: session ? session.me().avatar : S.cfg.avatar });
  const nameInput = h('input', { class: 'field', value: current().name, maxLength: 24, placeholder: 'Seu nome', 'aria-label': 'Seu nome' }) as HTMLInputElement;
  const preview = h('div', { class: 'grid place-items-center py-2' });
  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const draw = () => preview.replaceChildren(avatar(nameInput.value || current().name || '?', hueOf(S.cfg.name || 'eu'), 96, { photo: current().avatar }));
  /** Name and photo are saved, and sent to everyone in the room, as soon as they are changed. */
  const commit = async (patch: Partial<Pick<AppConfig, 'name' | 'avatar'>>) => {
    const saved = await updateConfig(patch);
    session?.updateProfile(saved.name, saved.avatar);
    draw();
    emit('people');
  };
  nameInput.addEventListener('input', draw);
  nameInput.addEventListener('change', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.value = current().name;
      draw();
      return;
    }
    await commit({ name });
  });
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const photo = await cropAvatar(f);
      if (photo) await commit({ avatar: photo });
    } catch {
      toast('Não foi possível ler essa imagem.', 'warn');
    }
  };
  draw();
  const close = modal(
    h('div', {},
      header('Editar perfil', session ? 'As mudanças aparecem na hora para todos na sala.' : 'Como seus amigos veem você.', () => close(), Pencil),
      h('div', { class: 'p-6 pt-4' }, preview, h('div', { class: 'flex justify-center gap-2 mb-5' }, h('button', { class: 'btn btn-ghost', onclick: () => file.click() }, 'Escolher imagem'), h('button', { class: 'btn btn-ghost', onclick: () => void commit({ avatar: null }) }, 'Remover'), file), label('Nome', nameInput)),
      footer(h('button', { class: 'btn btn-primary ripple', onclick: async () => {
        const name = nameInput.value.trim();
        if (name && name !== current().name) await commit({ name });
        close();
      } }, icon(Check, 16), 'Pronto'))),
    { width: '440px' },
  );
  nameInput.focus();
}

const QUALITY_WORD = { good: 'Boa', ok: 'Média', bad: 'Ruim', unknown: 'Medindo…' } as const;

/** A participant's profile: a colored banner, the photo on top of it (click to see it large), who they are in this room and what they are doing right now. */
export function openPeerProfile(p: { peerId: string; name: string; avatar: string | null }): void {
  const session = S.session;
  const you = p.peerId === session?.selfId;
  const live = session?.peers.get(p.peerId); // what the room says about them right now
  const share = live?.share ?? null;
  const hue = hueOf(p.peerId);
  const delay = (i: number) => ({ animationDelay: `${120 + i * 70}ms` });

  const banner = h('div', { class: 'relative h-32 overflow-hidden', style: { background: `linear-gradient(120deg, hsl(${hue} 65% 38%), hsl(${(hue + 55) % 360} 70% 30%))` } },
    h('div', { class: 'absolute -left-10 -top-16 w-56 h-56 rounded-full blur-3xl opacity-60', style: { background: `hsl(${(hue + 20) % 360} 90% 60%)` } }),
    h('div', { class: 'absolute -right-8 -bottom-20 w-52 h-52 rounded-full blur-3xl opacity-50', style: { background: `hsl(${(hue + 90) % 360} 80% 55%)` } }),
  );
  const closeBtn = h('button', { class: 'absolute right-3 top-3 z-[2] grid place-items-center w-9 h-9 rounded-full bg-black/35 text-white hover:bg-black/55 transition-colors', 'aria-label': 'Fechar', onclick: () => close() }, icon(X, 18));

  // the photo: a ring in the color of the card, a click shows it large
  const photo = avatar(p.name, hue, 132, { photo: p.avatar });
  const photoWrap = h(p.avatar ? 'button' : 'div', { class: `relative -mt-[66px] ml-7 rounded-full w-[132px] h-[132px] animate-pop ${p.avatar ? 'cursor-zoom-in transition-transform hover:scale-[1.04]' : ''}`, style: { boxShadow: '0 0 0 6px var(--s2), 0 14px 30px -10px #000a' }, ...(p.avatar ? { 'aria-label': 'Ver a foto em tamanho grande', title: 'Ver a foto grande' } : {}) }, photo);
  if (p.avatar) photoWrap.addEventListener('click', () => openPhoto(p));

  const chip = (children: Array<Node | string>, cls = '') => h('span', { class: `inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold border border-line bg-s3 animate-fade-up ${cls}` }, ...children);
  const chips: HTMLElement[] = [chip([h('i', { class: 'w-2 h-2 rounded-full bg-ok' }), 'Na sala'])];
  if (share) chips.push(h('span', { class: 'badge-live animate-fade-up' }, 'AO VIVO'), chip([icon(share.source === 'camera' ? Camera : MonitorUp, 13, 'text-accent'), share.source === 'camera' ? 'Câmera' : 'Tela']));

  const fact = (ico: IconNode, title: string, value: string, i: number) =>
    h('div', { class: 'rounded-xl bg-s3 border border-line p-3 animate-fade-up', style: delay(i) },
      h('div', { class: 'flex items-center gap-1.5 text-muted text-[11px] font-extrabold tracking-[0.08em] uppercase mb-1' }, icon(ico, 13), title),
      h('div', { class: 'font-semibold' }, value));
  const facts: HTMLElement[] = [fact(DoorOpen, 'Sala', session?.roomName || 'Sala', 0)];
  facts.push(fact(Signal, 'Conexão', you ? 'É você' : live ? `${QUALITY_WORD[live.quality]}${live.rtt !== null ? ` · ${live.rtt} ms` : ''}` : '—', 1));
  facts.push(fact(Gauge, 'Transmissão', share ? `${share.resolution} · ${share.fps} fps · ${share.mode === 'detail' ? 'Detalhe' : 'Movimento'}` : 'Sem transmissão', 2));
  facts.push(fact(Eye, 'Assistindo', share ? (typeof share.viewers === 'number' ? `${share.viewers} pessoa${share.viewers === 1 ? '' : 's'}` : '—') : '—', 3));

  const actions: HTMLElement[] = [];
  if (share && (!you || session?.sharing)) {
    actions.push(h('button', { class: 'btn btn-primary ripple', onclick: () => {
      close();
      if (!session) return;
      session.addView(p.peerId); // opens the picture in focus, like the "Assistir" of its tile
      session.focus(p.peerId);
      S.gridMode = false;
      emit('session');
    } }, icon(Eye, 16), you ? 'Ver minha prévia' : `Assistir ${p.name}`));
  }
  if (you) actions.push(h('button', { class: 'btn btn-ghost ripple', onclick: () => { close(); openProfile(); } }, icon(Pencil, 16), 'Editar perfil'));

  const close = modal(
    h('div', { class: 'relative overflow-hidden rounded-[inherit]' },
      closeBtn,
      banner,
      photoWrap,
      h('div', { class: 'px-7 pt-4 pb-6' },
        h('div', { class: 'flex items-center gap-2 flex-wrap' },
          h('h2', { class: 'font-display text-[26px] leading-tight font-extrabold tracking-tight animate-fade-up', style: delay(-1) }, p.name),
          you ? h('span', { class: 'px-2 h-6 inline-flex items-center rounded-md bg-accent/20 text-accent text-xs font-bold animate-fade-up' }, 'você') : null),
        h('div', { class: 'flex items-center gap-2 flex-wrap mt-3' }, ...chips),
        h('div', { class: 'grid grid-cols-2 gap-3 mt-5' }, ...facts),
        actions.length ? h('div', { class: 'flex justify-end gap-2 mt-6' }, ...actions) : null)),
    { width: '460px' },
  );
}

/** The photo of somebody shown large, over the profile. */
function openPhoto(p: { name: string; avatar: string | null }): void {
  if (!p.avatar) return;
  const close = modal(
    h('div', { class: 'relative p-3 grid place-items-center' },
      h('img', { src: p.avatar, alt: `Foto de ${p.name}`, class: 'rounded-2xl max-h-[70vh] w-full object-contain', draggable: false }),
      h('button', { class: 'absolute right-5 top-5 grid place-items-center w-9 h-9 rounded-full bg-black/45 text-white hover:bg-black/65 transition-colors', 'aria-label': 'Fechar a foto', onclick: () => close() }, icon(X, 18))),
    { width: '520px' },
  );
}

// ---------------------------------------------------------------------------------------------------------------- fixed rooms
/** Edits a fixed room: its name, picture and the Discord notice of THAT room (the code stays the same). Returns true when something was saved. */
export function editFixedRoom(room: FixedRoom): Promise<boolean> {
  return new Promise((resolve) => {
    let saved = false;
    let iconKey = room.icon ?? '';
    const hasWebhook = room.discordWebhookEnc === 'set';
    const name = h('input', { class: 'field', value: room.name, maxLength: MAX_ROOM_NAME, placeholder: 'Nome da sala fixa', 'aria-label': 'Nome da sala' }) as HTMLInputElement;
    const discord = discordPart(hasWebhook);
    const status = h('p', { class: 'text-live text-[13px] min-h-5' });
    const save = h('button', { class: 'btn btn-primary ripple' }, icon(Check, 16), 'Salvar');
    const close = modal(
      h('div', {},
        header('Editar sala', 'O código da sala continua o mesmo. Quem a favoritou vê o nome novo quando ela estiver aberta.', () => close(), Pencil),
        h('div', { class: 'p-6 pt-4' }, label('Nome da sala', name), label('Ícone da sala', iconPicker(iconKey || 'users', hueOf(room.id), (k) => (iconKey = k))), discord.el, status),
        footer(h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancelar'), save)),
      { onClose: () => resolve(saved) },
    );
    let busy = false;
    save.onclick = async () => {
      if (busy) return;
      const nextName = name.value.replace(/\s+/g, ' ').trim();
      if (!nextName) return void (status.textContent = 'Dê um nome para a sala.');
      if (S.cfg.fixedRooms.some((r) => r.id !== room.id && r.name.trim().toLowerCase() === nextName.toLowerCase())) return void (status.textContent = 'Você já tem uma sala fixa com esse nome.');
      const typed = discord.value();
      if (discord.on() && !hasWebhook && !typed) return void (status.textContent = 'Cole o webhook do canal ou desligue o aviso no Discord.');
      // switch off: take the webhook away (if there was one); switch on: a new address, or leave the saved one as it is
      const webhook = !discord.on() ? (hasWebhook ? null : undefined) : typed || undefined;
      if (nextName === room.name && webhook === undefined && iconKey === (room.icon ?? '')) return close();
      busy = true;
      save.disabled = true;
      status.textContent = '';
      const result = await window.jaca.saveFixedRoom({ id: room.id, name: nextName, icon: iconKey || undefined, webhook });
      busy = false;
      save.disabled = false;
      if (!result.ok) return void (status.textContent = result.message);
      await updateConfig({});
      toast(result.message || 'Sala atualizada', 'ok');
      saved = true;
      close();
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());
    name.focus();
    name.select();
  });
}

/** Asks for confirmation and deletes a fixed room. */
export function deleteFixedRoom(room: FixedRoom): void {
  confirmDialog('Apagar sala fixa', `Apagar a sala fixa "${room.name}"? O código dela deixa de existir, e quem a favoritou vai vê-la sempre fechada.`, 'Apagar', async () => {
    await updateConfig({ fixedRooms: S.cfg.fixedRooms.filter((r) => r.id !== room.id) });
    toast(`A sala fixa ${room.name} foi apagada`, 'warn');
  }, true, Trash2);
}
