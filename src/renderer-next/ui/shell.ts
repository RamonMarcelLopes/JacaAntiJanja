// The frame of the app: title bar, the rail of rooms on the left and the column with the room's streams and people.
import { ArrowLeftRight, Camera, Compass, Copy, Download, EllipsisVertical, House, LogOut, Lock, Minus, MonitorUp, PanelLeftClose, PanelLeftOpen, Plus, Settings, Square, Star, Tv, Users, Video, X } from 'lucide';
import { formatDuration } from '../../shared/time';
import { enterRoom as _unused, createRoom, joinRoom, leaveRoom, NEW_FIXED, TEMPORARY } from '../flows';
import { h, icon, reducedMotion } from '../dom';
import { toast } from '../fx';
import { emit, hueOf, isMe, RoomEntry, roomEntries, S, sameRoom, setSideCollapsed } from '../state';
import { appIcon, avatar, gradient, personAvatar, ROOM_ICONS } from './controls';
import { confirmDialog, openCreateRoom, openJoin, openPeerProfile, openProfile, toggleFavorite } from './dialogs';
import { openSettings } from './settings';
import { closeMenus } from './menus';

void _unused;
void NEW_FIXED;
void TEMPORARY;

/** Plays the "pressed" animation of a button once (the .go class is taken off again when it ends). */
function playOnce(el: HTMLElement): void {
  el.classList.remove('go');
  void el.offsetWidth; // so pressing twice in a row plays it twice
  el.classList.add('go');
  window.setTimeout(() => el.classList.remove('go'), 700);
}

// ---------------------------------------------------------------------------------------------------------------- title bar
export function titlebar(): HTMLElement {
  const maxBtn = h('button', { class: 'w-11 h-8 grid place-items-center text-muted transition-colors hover:bg-s4 hover:text-fg', 'aria-label': 'Maximizar', 'data-tip': 'Maximizar', 'data-tip-side': 'bottom', onclick: () => void window.jaca.toggleMaximizeWindow() }, icon(Square, 14));
  const win = (ico: typeof X, cls: string, tip: string, fn: () => void) => h('button', { class: `w-11 h-8 grid place-items-center text-muted transition-colors ${cls}`, 'aria-label': tip, 'data-tip': tip, 'data-tip-side': 'bottom', onclick: fn }, icon(ico, 14));
  window.jaca.onWindowMaximized((max) => maxBtn.setAttribute('data-tip', max ? 'Restaurar' : 'Maximizar'));
  return h('div', { id: 'titlebar', class: 'h-8 flex items-center bg-s0 border-b border-line select-none', style: { '-webkit-app-region': 'drag' } as any, ondblclick: () => void window.jaca.toggleMaximizeWindow() },
    h('div', { class: 'flex items-center gap-2 px-3 text-[12px] font-semibold text-muted' }, appIcon(18, 'rounded-[5px]'), 'Jaca anti Janja'),
    h('div', { class: 'flex-1' }),
    h('div', { class: 'flex', style: { '-webkit-app-region': 'no-drag' } as any, ondblclick: (e: Event) => e.stopPropagation() },
      win(Minus, 'hover:bg-s4 hover:text-fg', 'Minimizar', () => void window.jaca.minimizeWindow()),
      maxBtn,
      win(X, 'hover:bg-live hover:text-white', 'Fechar', () => void window.jaca.closeWindow()),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------- the update notice (top of the window)
export function updateBanner(): HTMLElement & { draw(): void } {
  const wrap = h('div', { class: 'relative z-20', 'data-testid': 'update-banner' });
  const draw = () => {
    wrap.replaceChildren();
    const { status, version, percent } = S.update;
    const bar = (...children: Array<Node | null>) =>
      h('div', { class: 'relative flex items-center justify-center gap-3 h-10 px-12 text-[13px] font-semibold animate-slide-down', style: { background: 'linear-gradient(90deg, color-mix(in oklab, var(--accent) 30%, var(--s1)), color-mix(in oklab, var(--accent) 55%, var(--s1)), color-mix(in oklab, var(--accent) 30%, var(--s1)))', backgroundSize: '200% 100%' } }, ...children);
    if (status === 'available') {
      if (S.updateDismissed) return;
      const inRoom = S.view === 'room';
      const btn = h('button', { class: 'btn btn-primary ripple h-7 px-3 text-xs', disabled: inRoom, title: inRoom ? 'Saia da sala para atualizar.' : '', onclick: () => {
        void window.jaca.log('atualizacao', `botão "Atualizar agora" do aviso apertado (versão ${version})`);
        void window.jaca.installUpdate();
      } }, icon(Download, 14), inRoom ? 'Saia da sala para atualizar' : 'Atualizar agora');
      wrap.append(bar(
        icon(Download, 16, 'text-accent'),
        h('span', {}, `A versão ${version} está disponível.`),
        btn,
        h('button', { class: 'icon-btn absolute right-3 top-1/2 -translate-y-1/2', 'aria-label': 'Dispensar o aviso de atualização', 'data-tip': 'Dispensar (continua em Configurações > Sobre)', onclick: () => {
          void window.jaca.log('atualizacao', `aviso de atualização dispensado com o X (versão ${version}); volta quando o app abrir de novo`);
          S.updateDismissed = true;
          emit('update');
        } }, icon(X, 16)),
      ));
    } else if (status === 'downloading') wrap.append(bar(h('span', {}, `Baixando a versão ${version}... ${percent ?? 0}%`)));
    else if (status === 'ready') wrap.append(bar(h('span', {}, 'Instalando a atualização. O app vai reiniciar.')));
  };
  draw();
  return Object.assign(wrap, { draw });
}

// ---------------------------------------------------------------------------------------------------------------- flight of the profile and the settings
// Folding the column makes the profile photo and the gear fly from the foot of the column to the foot of the rail (and back when it opens again).
// The real elements are swapped for a clone that travels in a fixed layer, so the clipping of the column never cuts the flight.
type FlyKey = 'side-avatar' | 'side-gear' | 'rail-avatar' | 'rail-gear';
const fly = <T extends HTMLElement>(el: T, key: FlyKey): T => {
  el.dataset.fly = key;
  return el;
};
const flyEl = (key: FlyKey) => document.querySelector<HTMLElement>(`[data-fly="${key}"]`);

/** Call right BEFORE the layout changes: remembers where the flying pieces are now. */
export function captureFly(): Map<FlyKey, { rect: DOMRect; clone: HTMLElement }> {
  const out = new Map<FlyKey, { rect: DOMRect; clone: HTMLElement }>();
  for (const key of ['side-avatar', 'side-gear', 'rail-avatar', 'rail-gear'] as FlyKey[]) {
    const el = flyEl(key);
    if (el) out.set(key, { rect: el.getBoundingClientRect(), clone: el.cloneNode(true) as HTMLElement });
  }
  return out;
}

/** Call right AFTER the layout changed (S.sideCollapsed is already the new value). */
export function playFly(before: ReturnType<typeof captureFly>): void {
  const pairs: Array<[FlyKey, FlyKey]> = S.sideCollapsed
    ? [['side-avatar', 'rail-avatar'], ['side-gear', 'rail-gear']]
    : [['rail-avatar', 'side-avatar'], ['rail-gear', 'side-gear']];
  const ms = 560;
  for (const [from, to] of pairs) {
    const dest = flyEl(to);
    const src = before.get(from);
    if (!dest) continue;
    if (!src || reducedMotion()) { dest.style.visibility = ''; continue; }
    const end = dest.getBoundingClientRect();
    const dx = end.left - src.rect.left, dy = end.top - src.rect.top;
    const sx = end.width / src.rect.width, sy = end.height / src.rect.height;
    const clone = src.clone;
    Object.assign(clone.style, { position: 'fixed', left: `${src.rect.left}px`, top: `${src.rect.top}px`, width: `${src.rect.width}px`, height: `${src.rect.height}px`, margin: '0', zIndex: '90', pointerEvents: 'none', transformOrigin: '0 0', visibility: 'visible' });
    clone.removeAttribute('data-fly');
    document.body.append(clone);
    dest.style.visibility = 'hidden';
    const there = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    // a little arc: the piece rises/dips on the way so it reads as a flight and not a slide
    const arc = `translate(${dx * 0.5}px, ${dy * 0.5 - 26}px) scale(${(1 + sx) / 2 + 0.12}, ${(1 + sy) / 2 + 0.12})`;
    clone.animate(
      [{ transform: 'translate(0, 0) scale(1)' }, { transform: arc, offset: 0.5 }, { transform: there }],
      { duration: ms, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    ).onfinish = () => {
      // swap in the same task (no fade): the clone is opaque until the real element takes its place, so there is no blink
      dest.style.visibility = '';
      clone.remove();
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------- rail
/** Enters (or starts) the room of the rail / the home. Leaving the room one is in asks first. */
export function openEntry(r: RoomEntry): void {
  const go = () => {
    if (r.kind === 'fixa') void createRoom({ kind: r.fixedId!, name: r.name });
    else void joinRoom(r.code);
  };
  if (r.kind === 'favorita' && r.state === 'closed') return void toast(`${r.name} está fechada agora`, 'warn');
  if (S.view !== 'room') return go();
  if (sameRoom(S.session?.inviteCode ?? '', r.code)) return; // already in this one
  confirmDialog('Trocar de sala', `Você está em ${S.session?.roomName || 'uma sala'}. Se continuar, você sai dela e entra em ${r.name}.`, `Entrar em ${r.name}`, () => {
    const done = new Promise<void>((resolve) => {
      const prev = S.session!;
      const keep = prev.onEnded;
      prev.onEnded = async (reason) => {
        await keep(reason);
        resolve();
      };
    });
    leaveRoom();
    void done.then(go);
  }, false, ArrowLeftRight);
}

export function rail(): HTMLElement & { draw(animate?: boolean, pop?: boolean): void } {
  const el = h('nav', { class: 'w-[72px] bg-s0 flex flex-col items-center gap-2 py-3 overflow-y-auto flex-none', 'aria-label': 'Salas' });
  const draw = (animate = false, pop = false) => {
    el.replaceChildren();
    let i = 0;
    const stagger = () => ({ animationDelay: `${i++ * 55}ms` });
    const cls = animate ? 'animate-pop' : '';
    const home = h('button', { class: `rail-btn ${cls}`, 'aria-label': 'Início', 'aria-current': String(S.view === 'home'), 'data-tip': 'Início', 'data-tip-side': 'right', style: { ...stagger(), background: 'transparent', borderRadius: '16px' }, onclick: () => {
      if (S.view !== 'room') return;
      // the icon is a way out of the room, so it asks first (the leave buttons do not)
      confirmDialog('Ir para o início', `Você está em ${S.session?.roomName || 'uma sala'}. Se continuar, você sai dela e volta para o início.`, 'Ir para o início', leaveRoom, false, House);
    } }, h('i', { class: 'rail-pill' }), h('span', { class: 'block w-full h-full overflow-hidden rounded-[inherit]' }, appIcon(48, 'scale-[1.08]'))); // the clip is the same 16px as the selected room; the art is a bit larger so its own corners never show
    el.append(home, h('div', { class: 'w-8 h-0.5 rounded bg-line my-1' }));
    for (const r of roomEntries()) {
      const open = r.state === 'open';
      const here = S.view === 'room' && sameRoom(S.session?.inviteCode ?? '', r.code);
      const b = h('button', {
        class: `rail-btn ${cls}`,
        'aria-label': r.name,
        'aria-current': String(here),
        'data-open': String(open),
        'data-room': r.name,
        'data-tip': r.kind === 'fixa' ? `${r.name} · sua sala fixa${open ? ` · ${r.count ?? '?'} na sala` : ''}` : `${r.name} · ${open ? `${r.count ?? '?'} na sala` : r.state === 'closed' ? 'fechada' : 'sem resposta'}`,
        'data-tip-side': 'right',
        style: { ...stagger(), background: open || r.kind === 'fixa' ? gradient(r.hue) : 'var(--s3)', opacity: open || r.kind === 'fixa' ? '1' : '0.55' },
        onclick: () => openEntry(r),
      }, h('i', { class: 'rail-pill' }), icon(ROOM_ICONS[r.icon], 22));
      if (open) b.append(h('i', { class: 'rail-open-dot', 'aria-hidden': 'true' }));
      el.append(b);
    }
    const add = (ico: typeof Plus, tip: string, fn: () => void) => h('button', { class: `rail-btn ${cls}`, 'aria-label': tip, 'data-tip': tip, 'data-tip-side': 'right', style: { ...stagger(), background: 'var(--s2)', color: 'var(--accent)' }, onclick: fn }, h('i', { class: 'rail-pill' }), icon(ico, 22));
    el.append(add(Plus, 'Iniciar sala', openCreateRoom), add(Compass, 'Entrar com código', openJoin), h('div', { class: 'flex-1' }));
    // Foot of the rail. With the column open: only the update. With the column folded: [open column], the update, the profile and, at the very bottom, the settings
    const folded = S.sideCollapsed;
    const pc = pop ? 'animate-pop' : '';
    if (folded) {
      el.append(h('button', { class: `rail-btn ${pc}`, 'data-tip': 'Mostrar a coluna lateral', 'data-tip-side': 'right', 'aria-label': 'Mostrar a coluna lateral', style: { background: 'var(--s2)', color: 'var(--muted)' }, onclick: () => setSideCollapsed(false) }, icon(PanelLeftOpen, 22)));
    }
    if (S.update.status === 'available') {
      el.append(h('button', { class: 'rail-btn animate-float', 'aria-label': 'Atualização disponível', 'data-tip': 'Atualização disponível', 'data-tip-side': 'right', style: { background: 'color-mix(in oklab, var(--accent) 22%, var(--s3))', color: 'var(--accent)' }, onclick: () => openSettings('Sobre') }, h('i', { class: 'rail-pill' }), icon(Download, 22)));
    }
    if (folded) {
      el.append(
        h('button', { class: 'rounded-full transition-transform hover:scale-105 active:scale-95', 'data-tip': `${S.cfg.name || 'Seu perfil'} · Editar perfil`, 'data-tip-side': 'right', 'aria-label': 'Editar perfil', onclick: openProfile }, fly(avatar(S.cfg.name || '?', hueOf(S.cfg.name || 'eu'), 44, { photo: S.cfg.avatar, status: S.view === 'room' ? 'online' : 'away' }), 'rail-avatar')),
        fly(h('button', { class: 'rail-btn anim-gear', 'data-tip': 'Configurações', 'data-tip-side': 'right', 'aria-label': 'Configurações', style: { background: 'var(--s2)', color: 'var(--muted)' }, onclick: (e: Event) => {
          playOnce(e.currentTarget as HTMLElement);
          openSettings(); // at once: the gear keeps spinning under the opening layer
        } }, icon(Settings, 22)), 'rail-gear'),
      );
    }
  };
  draw(true);
  return Object.assign(el, { draw });
}

// ---------------------------------------------------------------------------------------------------------------- the column of the room (or of the home)
const quality = (ms: number | null) => (ms === null ? 'bg-muted' : ms < 70 ? 'bg-ok' : ms < 120 ? 'bg-warn' : 'bg-live');

export function sidebar(): HTMLElement & { draw(animate?: boolean): void; tick(): void; fold(): void } {
  // the aside clips and animates its width; the column inside keeps 264px so nothing is squeezed while it slides shut
  const el = h('aside', { id: 'sidebar', class: 'bg-s1 flex-none min-h-0 overflow-hidden border-r border-line transition-[width,border-color] duration-[380ms] ease-[var(--ease-spring)]' });
  const inner = h('div', { class: 'w-[264px] h-full flex flex-col min-h-0' });
  el.append(inner);
  const foldBtn = () => h('button', { class: 'icon-btn flex-none', 'data-tip': 'Recolher a coluna', 'data-tip-side': 'bottom', 'aria-label': 'Recolher a coluna lateral', onclick: () => setSideCollapsed(true) }, icon(PanelLeftClose, 16));
  const fold = () => {
    el.style.width = S.sideCollapsed ? '0px' : '264px';
    el.style.borderRightColor = S.sideCollapsed ? 'transparent' : '';
    el.inert = S.sideCollapsed; // folded: nothing in it can be focused
    el.setAttribute('aria-hidden', String(S.sideCollapsed));
  };
  const body = h('div', { class: 'flex-1 overflow-y-auto min-h-0 scroll-fade py-2' });
  const timerEl = h('span', { class: 'tabular-nums', 'data-testid': 'room-timer' });
  const section = (title: string, count?: number) => h('div', { class: 'flex items-center justify-between px-4 pt-4 pb-1.5 text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase' }, h('span', {}, title), count !== undefined ? h('span', { class: 'font-semibold' }, String(count)) : null);

  const peerMenu = (anchor: HTMLElement, p: { peerId: string; name: string; avatar: string | null }) => {
    document.querySelector('.peer-menu')?.remove();
    const items: Array<[string, () => void]> = [['Ver perfil', () => openPeerProfile(p)]];
    if (p.peerId === S.session?.selfId) items.push(['Editar perfil', openProfile]);
    const menu = h('div', { class: 'menu peer-menu', role: 'menu', style: { position: 'fixed', transformOrigin: 'top right' } },
      ...items.map(([text, fn]) => h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { menu.remove(); fn(); } }, text)));
    const r = anchor.getBoundingClientRect();
    document.body.append(menu);
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
    const off = (e: Event) => {
      if (menu.contains(e.target as Node)) return;
      menu.remove();
      document.removeEventListener('pointerdown', off, true);
    };
    document.addEventListener('pointerdown', off, true);
  };

  const drawRoom = (animate: boolean) => {
    const session = S.session!;
    const people = [...session.peers.values()];
    const live = people.filter((p) => p.share);
    let i = 0;
    const anim = (extra = '') => (animate ? { class: `animate-slide-right ${extra}`, style: { animationDelay: `${i++ * 45}ms` } } : { class: extra, style: {} });
    const code = session.inviteCode;
    const isFav = S.cfg.favoriteRooms.some((f) => f.code === code);
    const canFav = !!code && code.includes('@') && !session.isHost;
    const kindLabel = S.room?.code && S.cfg.fixedRooms.some((r) => session.isHost && r.name === session.roomName) ? 'fixa' : session.isHost ? 'temporária' : 'convidado';
    // the name copies the room code; the star is its own button (favorite / unfavorite)
    const head = h('div', { class: 'w-full h-12 pl-4 pr-2 flex items-center gap-2 border-b border-line flex-none' },
      h('button', { class: 'flex-1 min-w-0 h-full flex items-center gap-2 text-left hover:text-accent transition-colors', 'data-tip': 'Copiar o código da sala', 'data-tip-side': 'bottom', 'aria-label': 'Copiar o código da sala', onclick: async () => {
        try {
          await window.jaca.copyText(code);
          toast('Código copiado', 'ok');
        } catch {
          toast('Não foi possível copiar o código', 'warn');
        }
      } },
        h('span', { class: 'font-display font-bold truncate' }, session.roomName || (session.isHost ? 'Sua sala' : 'Sala')),
        h('span', { class: 'text-[11px] font-semibold px-1.5 py-0.5 rounded bg-s4 text-muted flex-none' }, kindLabel),
      ),
      canFav ? h('button', { class: 'icon-btn flex-none', 'data-tip': isFav ? 'Tirar dos favoritos' : 'Favoritar', 'data-tip-side': 'bottom', 'aria-label': isFav ? 'Tirar dos favoritos' : 'Favoritar esta sala', onclick: () => void toggleFavorite(code, session.roomName).then(() => emit('rooms')) }, icon(Star, 16, isFav ? 'text-warn fill-current' : 'text-muted')) : null,
      foldBtn(),
    );
    body.replaceChildren(
      h('div', { class: 'px-4 py-3 flex items-center justify-between text-[13px] text-muted' }, h('span', {}, 'Aberta há'), h('span', { class: 'font-semibold text-fg' }, timerEl)),
    );
    if (live.length) {
      body.append(section('Ao vivo agora', live.length));
      for (const p of live) {
        const a = anim();
        const watching = session.watched.has(p.peerId);
        const clickable = !isMe(p) || session.sharing;
        const item = h('button', { class: 'flex items-center gap-3 flex-1 min-w-0 text-left', 'data-live': p.name, disabled: !clickable, onclick: () => {
          if (!clickable) return;
          watchPerson(p.peerId); // opens it and puts it in focus; this list is also how you switch to another picture
        } },
          h('div', { class: 'grid place-items-center w-9 h-9 rounded-lg flex-none', style: { background: gradient(hueOf(p.peerId)) } }, icon(p.share!.source === 'camera' ? Camera : MonitorUp, 18, 'text-white')),
          h('div', { class: 'min-w-0 flex-1' },
            h('div', { class: 'flex items-center gap-1.5' }, h('span', { class: 'font-semibold truncate' }, isMe(p) ? `${p.name} (você)` : p.name), h('span', { class: 'badge-live flex-none whitespace-nowrap !text-[9px] !px-1.5 !py-0.5 !leading-none' }, 'AO VIVO')),
            h('div', { class: 'text-[12px] text-muted truncate' }, `${p.share!.resolution} · ${p.share!.fps} fps${typeof p.share!.viewers === 'number' ? ` · ${p.share!.viewers} assistindo` : ''}`),
          ),
          watching ? icon(Video, 16, 'text-accent flex-none') : null,
        );
        // the profile menu is a sibling of the button (a button cannot sit inside another one)
        const liveKebab = h('button', { class: 'icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100 flex-none', 'aria-label': `Opções do perfil de ${p.name}`, onclick: (e: Event) => { e.stopPropagation(); peerMenu(liveKebab, p); } }, icon(EllipsisVertical, 16));
        const row = h('div', { class: `spot group mx-2 flex items-center gap-1 pl-2.5 pr-1 py-2 rounded-xl hover:bg-s3 transition-colors ${a.class}`, style: a.style }, item, liveKebab);
        body.append(row);
      }
    }
    // whoever is live is already in "Ao vivo agora": this list is for the others, so nobody appears twice
    const others = people.filter((p) => !p.share);
    body.append(section(live.length ? 'Também na sala' : 'Na sala', others.length));
    for (const p of others) {
      const a = anim();
      const kebab = h('button', { class: 'icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100', 'aria-label': `Opções do perfil de ${p.name}`, onclick: (e: Event) => { e.stopPropagation(); peerMenu(kebab, p); } }, icon(EllipsisVertical, 16));
      body.append(
        h('div', { class: `spot mx-2 flex items-center gap-3 px-2.5 py-1.5 rounded-xl hover:bg-s3 transition-colors group ${a.class}`, style: a.style, 'data-pid': p.peerId },
          personAvatar(p, 34, 'online'),
          h('div', { class: 'min-w-0 flex-1' },
            h('div', { class: 'font-semibold truncate' }, isMe(p) ? `${p.name} (você)` : p.name),
            h('div', { class: 'flex items-center gap-1.5 text-[12px] text-muted whitespace-nowrap overflow-hidden' },
              h('span', { class: 'truncate' }, 'Sem transmissão'),
              !isMe(p) && p.quality !== 'unknown' ? h('span', { class: `w-2 h-2 rounded-full ${p.quality === 'good' ? 'bg-ok' : p.quality === 'ok' ? 'bg-warn' : 'bg-live'}` }) : null,
              !isMe(p) && p.rtt !== null ? h('span', { class: 'tabular-nums flex-none', 'data-ms': p.peerId }, `${p.rtt} ms`) : null,
            ),
          ),
          kebab,
        ),
      );
    }
    // a person who is live can still be looked at: the three dots of their line in "Ao vivo agora" are in the stage tile menu; profile of live people
    // is reached from the tile name too, so nothing is lost here
    return head;
  };

  const drawHome = (animate: boolean) => {
    // Rooms are entered from the cards of the home and from the rail; this column only tells which of them are open right now
    const open = roomEntries().filter((r) => r.state === 'open');
    body.replaceChildren(h('div', { class: 'px-4 pt-3 pb-2 text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase' }, 'Abertas agora'));
    if (!open.length) body.append(h('div', { class: 'mx-4 mt-2 text-[13px] text-muted leading-relaxed' }, 'Nenhuma das suas salas favoritas ou fixas está aberta agora. Quando uma abrir, ela aparece aqui.'));
    open.forEach((r, i) => {
      body.append(
        h('button', { class: `mx-2 w-[calc(100%-1rem)] flex items-start gap-3 px-2.5 py-2.5 rounded-xl text-left hover:bg-s3 transition-colors ${animate ? 'animate-slide-right' : ''}`, style: { animationDelay: `${i * 60}ms` }, onclick: () => openEntry(r) },
          h('div', { class: 'grid place-items-center w-8 h-8 rounded-lg flex-none', style: { background: gradient(r.hue) } }, icon(ROOM_ICONS[r.icon], 16, 'text-white')),
          h('div', { class: 'min-w-0' }, h('div', { class: 'text-[13px] font-semibold truncate' }, r.name), h('div', { class: 'text-[12px] text-muted truncate' }, `${r.host ? `${r.host} · ` : ''}${r.count ?? '?'} pessoa${r.count === 1 ? '' : 's'}`)),
        ),
      );
    });
    return h('div', { class: 'h-12 pl-4 pr-2 flex items-center gap-2 border-b border-line font-display font-bold flex-none' }, icon(House, 18, 'text-accent'), h('span', { class: 'flex-1' }, 'Início'), foldBtn());
  };

  const userPanel = () => {
    const name = S.cfg.name || 'Seu perfil';
    // `motion`: the little animation of the icon (the gear turns, the arrow of "sair" shoots out); it plays on hover and once more when pressed
    const btn = (ico: typeof Camera, tip: string, fn: () => void, motion = '', delayMs = 0) => {
      const b = h('button', { class: `icon-btn ${motion}`, 'data-tip': tip, 'aria-label': tip, onclick: () => {
        playOnce(b);
        if (delayMs) window.setTimeout(fn, delayMs); // lets the icon finish its move before the screen changes
        else fn();
      } }, icon(ico, 18));
      return b;
    };
    return h('div', { class: 'flex items-center gap-2.5 px-3 h-[60px] bg-s0/70 border-t border-line flex-none' },
      h('button', { class: 'flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg hover:bg-s3 px-1 py-1 transition-colors', 'aria-label': 'Editar perfil', onclick: openProfile },
        fly(avatar(name, hueOf(S.cfg.name || 'eu'), 36, { photo: S.cfg.avatar, status: S.view === 'room' ? 'online' : 'away' }), 'side-avatar'),
        h('div', { class: 'min-w-0' }, h('div', { class: 'font-semibold truncate leading-tight' }, name), h('div', { class: 'text-[12px] text-muted truncate leading-tight' }, S.view === 'room' ? `Na sala · ${S.session?.roomName ?? ''}` : 'Fora de uma sala')),
      ),
      S.view === 'room' ? btn(LogOut, 'Sair da sala', leaveRoom, 'anim-leave', 360) : null,
      fly(btn(Settings, 'Configurações', () => openSettings(), 'anim-gear'), 'side-gear'),
    );
  };

  const draw = (animate = false) => {
    document.querySelector('.peer-menu')?.remove();
    const head = S.view === 'room' && S.session ? drawRoom(animate) : drawHome(animate);
    inner.replaceChildren(head, body, userPanel());
    tick();
  };
  const tick = () => {
    const session = S.session;
    if (S.view === 'room' && session) {
      const elapsed = session.roomElapsedMs();
      timerEl.textContent = elapsed === null ? '—' : formatDuration(elapsed);
      // the milliseconds change all the time: updated in place, without redrawing the list
      el.querySelectorAll<HTMLElement>('[data-ms]').forEach((n) => {
        const p = session.peers.get(n.dataset.ms!);
        if (p?.rtt !== null && p?.rtt !== undefined) n.textContent = `${p.rtt} ms`;
      });
    }
  };
  fold();
  draw(true);
  return Object.assign(el, { draw, tick, fold });
}

/** Opens the picture of somebody and puts it in focus (the first one watched takes the focus by itself). */
export function watchPerson(peerId: string): void {
  const session = S.session;
  if (!session) return;
  closeMenus();
  session.addView(peerId);
  session.focus(peerId);
  S.gridMode = false;
  emit('session');
}

void Copy;
void Lock;
void Tv;
void Users;
