// The home: greeting, the two ways in (start a room, enter with a code) and the saved rooms (favorites and fixed rooms) with their live state.
import { ArrowRight, Check, ChevronRight, Cloud, KeyRound, Lock, Network, Play, Plus, Search, Star, Trash2 } from 'lucide';
import { h, icon } from '../dom';
import { flip, toast } from '../fx';
import { updateConfig, hueOf, roomEntries, RoomEntry, S } from '../state';
import { openEntry } from './shell';
import { avatar, gradient, ROOM_ICONS, segmented } from './controls';
import { openCreateRoom, openJoin, openProfile } from './dialogs';
import { openSettings } from './settings';

export function home(): HTMLElement & { draw(): void; drawList(): void } {
  const root = h('section', { class: 'flex-1 min-w-0 overflow-y-auto bg-s2 relative view-enter', 'data-testid': 'home' });
  type Filter = 'all' | 'open' | 'closed';
  let filter: Filter = 'all';
  let query = '';
  let list: HTMLElement;

  const greet = () => {
    const hour = new Date().getHours();
    // 0h-5h madrugada, 5h-12h dia, 12h-18h tarde, 18h-24h noite
    return hour < 5 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  };

  const actionCard = (title: string, desc: string, ico: typeof Plus, fn: () => void, delay: number) =>
    h('button', { class: 'spot group text-left p-5 rounded-2xl bg-s3 border border-line hover:border-accent hover:-translate-y-1 transition-all duration-300 animate-fade-up ripple', 'aria-label': title, style: { animationDelay: `${delay}ms` }, onclick: fn },
      h('div', { class: 'flex items-center gap-4' },
        h('div', { class: 'grid place-items-center w-12 h-12 rounded-2xl bg-accent/20 text-accent group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300' }, icon(ico, 24)),
        h('div', { class: 'flex-1' }, h('div', { class: 'font-display font-bold text-lg' }, title), h('div', { class: 'text-muted text-[13px]' }, desc)),
        icon(ArrowRight, 20, 'text-muted group-hover:text-accent group-hover:translate-x-1 transition-all'),
      ),
    );

  const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** The cards come in with an animation only the first time; every later redraw (a status check, a filter) leaves them still. */
  let cardsShown = false;
  const roomCard = (r: RoomEntry, i: number) => {
    const open = r.state === 'open';
    const fixed = r.kind === 'fixa';
    const unknown = r.state === 'unknown';
    const enter = fixed
      ? h('button', { class: 'btn btn-primary ripple', 'aria-label': `Iniciar ${r.name}`, onclick: (e: Event) => { e.stopPropagation(); openEntry(r); } }, icon(Play, 14), open ? 'Reabrir' : 'Iniciar')
      : open || unknown
        ? h('button', { class: 'btn btn-primary ripple', 'aria-label': `Entrar em ${r.name}`, onclick: (e: Event) => { e.stopPropagation(); openEntry(r); } }, 'Entrar')
        : h('button', { class: 'btn closed-btn', 'aria-disabled': 'true', 'aria-label': `${r.name} está fechada`, onclick: (e: Event) => { e.stopPropagation(); openEntry(r); } }, icon(Lock, 14), 'Fechada');
    const statusLine = open
      ? [h('span', { class: 'w-2 h-2 rounded-full bg-ok animate-pulse-dot' }), h('span', { class: 'text-ok font-semibold' }, 'Aberta'), h('span', { class: 'text-muted truncate' }, `· ${r.host ? `${r.host} · ` : ''}${r.count ?? '?'} pessoa${r.count === 1 ? '' : 's'}`)]
      : r.state === 'closed'
        ? [h('span', { class: 'closed-pill' }, icon(Lock, 11), 'FECHADA')]
        : [h('span', { class: 'text-muted' }, 'Sem resposta do servidor da sala')];
    const kebab = !fixed
      ? h('button', { class: 'icon-btn flex-none -mt-1 -mr-1', 'data-tip': 'Tirar dos favoritos', 'aria-label': `Tirar ${r.name} dos favoritos`, onclick: async (e: Event) => {
          e.stopPropagation();
          await updateConfig({ favoriteRooms: S.cfg.favoriteRooms.filter((f) => f.code !== r.code) });
          S.statuses.delete(r.code);
          toast(`${r.name} saiu dos favoritos`, 'ok');
        } }, icon(Star, 17, 'text-warn fill-current'))
      : h('button', { class: 'icon-btn flex-none -mt-1 -mr-1', 'data-tip': 'Copiar o código', 'aria-label': `Copiar o código de ${r.name}`, onclick: async (e: Event) => {
          e.stopPropagation();
          try {
            await window.jaca.copyText(r.code);
            toast('Código copiado', 'ok');
          } catch {
            toast('Não foi possível copiar o código', 'warn');
          }
        } }, icon(Check, 17, 'text-muted'));
    return h('div', { 'data-key': r.key, 'data-room-card': r.name, class: `spot relative p-4 rounded-2xl bg-s3 border border-line transition-all duration-300 ${cardsShown ? '' : 'animate-fade-up'} ${open || fixed ? 'hover:border-accent hover:-translate-y-1 cursor-pointer' : 'room-closed'}`, style: cardsShown ? {} : { animationDelay: `${i * 70}ms` }, onclick: () => openEntry(r) },
      h('div', { class: 'flex items-start gap-3' },
        h('div', { class: `room-ico grid place-items-center w-12 h-12 rounded-2xl flex-none ${open || fixed ? '' : 'grayscale opacity-50'}`, style: { background: gradient(r.hue) } }, icon(ROOM_ICONS[r.icon], 24, 'text-white')),
        h('div', { class: 'min-w-0 flex-1' },
          h('div', { class: 'font-display font-bold truncate' }, r.name),
          h('div', { class: 'flex items-center gap-1.5 text-[12px] mt-0.5' }, ...statusLine),
        ),
        kebab,
      ),
      h('div', { class: 'flex items-center justify-between mt-4' },
        h('span', { class: 'text-[12px] font-semibold px-2 py-0.5 rounded-md bg-s4 text-muted' }, fixed ? 'Sala fixa' : 'Favorita'),
        h('div', { class: 'flex items-center gap-2' }, enter),
      ),
    );
  };

  let listSig = '';
  const drawList = () => {
    const shown = roomEntries().filter((r) => (filter === 'all' || r.state === filter) && (!query || plain(r.name).includes(plain(query))));
    // nothing changed since the last drawing (the status check that runs every 20 s found the same answers): leave the cards alone
    const sig = JSON.stringify([filter, query, shown.map((r) => [r.key, r.name, r.state, r.host, r.count, r.icon]), roomEntries().length]);
    if (sig === listSig && cardsShown) return;
    listSig = sig;
    flip(list, () =>
      list.replaceChildren(...(shown.length ? shown.map(roomCard) : [h('div', { class: 'col-span-full text-center text-muted py-12 animate-fade-in' }, roomEntries().length ? 'Nenhuma sala encontrada com esse filtro.' : 'Você ainda não favoritou nenhuma sala. Dentro de uma sala, clique na estrela para favoritá-la.')])),
    );
    cardsShown = true;
  };

  const nameCard = () => {
    const input = h('input', { class: 'field', placeholder: 'Seu nome', maxLength: 24, 'aria-label': 'Seu nome' }) as HTMLInputElement;
    const save = async () => {
      const name = input.value.trim();
      if (!name) return void toast('Escolha um nome de exibição primeiro.', 'warn');
      await updateConfig({ name });
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && void save());
    return h('div', { class: 'flex items-center gap-3 p-4 mb-6 rounded-2xl bg-s3 border border-accent/50 animate-fade-up' },
      h('div', { class: 'flex-1' }, h('div', { class: 'font-display font-bold' }, 'Como você quer ser chamado?'), h('div', { class: 'text-muted text-[13px]' }, 'É o nome que seus amigos veem dentro das salas.')),
      h('div', { class: 'w-[220px]' }, input),
      h('button', { class: 'btn btn-primary ripple', onclick: () => void save() }, icon(Check, 16), 'Salvar'),
    );
  };

  const draw = () => {
    cardsShown = false;
    listSig = '';
    list = h('div', { class: 'grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]', 'data-testid': 'rooms' });
    const search = h('input', { class: 'field !pl-9', placeholder: 'Buscar sala pelo nome', 'aria-label': 'Buscar sala pelo nome', maxLength: 32, spellcheck: false, oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; drawList(); } });
    const cloud = S.cfg.connectionMode === 'cloudflare';
    const name = S.cfg.name.trim();
    root.replaceChildren(
      h('div', { class: 'aurora' }, h('i'), h('i'), h('i')),
      h('div', { class: 'relative z-[1] max-w-[1040px] mx-auto px-10 py-10' },
        h('div', { class: 'flex items-center justify-between gap-6 mb-8 animate-fade-up' },
          h('div', {},
            h('h1', { class: 'font-display text-[38px] font-extrabold tracking-tight leading-tight' }, `${greet()}${name ? ', ' : ''}`, name ? h('span', { class: 'bg-clip-text text-transparent', style: { backgroundImage: 'linear-gradient(90deg, var(--accent), color-mix(in oklab, var(--accent) 55%, #ffffff), var(--accent))', backgroundSize: '200% 100%', animation: 'shimmer 5s linear infinite' } }, name) : null),
            h('p', { class: 'text-muted mt-1' }, 'Divida a sua tela e o som do PC com os amigos.'),
          ),
          h('div', { class: 'flex items-center gap-3' },
            // the connection mode, loud on purpose: it decides how friends reach you. Click = go adjust it in Configurações > Rede
            h('button', { class: 'mode-badge group', 'data-tip': 'Ajustar o modo de conexão', 'data-tip-side': 'bottom', 'aria-label': `Modo de conexão: ${cloud ? 'Cloudflare' : 'Direto (VPN)'}. Abrir os ajustes`, onclick: () => openSettings('Rede') },
              icon(cloud ? Cloud : Network, 15, 'text-accent'),
              h('span', { class: 'text-muted font-semibold' }, 'Modo:'), h('span', { class: 'font-bold' }, cloud ? 'Cloudflare' : 'Direto (VPN)'),
              icon(ChevronRight, 14, 'text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all')),
            name ? h('button', { class: 'flex items-center gap-2.5 pl-1.5 pr-3 h-11 rounded-full bg-s3 border border-line hover:border-accent transition-colors', 'aria-label': 'Editar perfil', onclick: openProfile }, avatar(name, hueOf(name), 32, { photo: S.cfg.avatar }), h('span', { class: 'font-semibold' }, name)) : null,
          ),
        ),
        name ? null : nameCard(),
        h('div', { class: 'grid grid-cols-2 gap-4 mb-10' },
          actionCard('Iniciar sala', 'Você vira o host e manda o código.', Plus, openCreateRoom, 80),
          actionCard('Entrar com código', 'Cole o código que um amigo mandou.', KeyRound, openJoin, 160),
        ),
        h('div', { class: 'flex items-center justify-between gap-4 mb-4 animate-fade-up', style: { animationDelay: '220ms' } },
          h('h2', { class: 'font-display text-xl font-bold' }, 'Salas favoritas'),
          h('div', { class: 'flex items-center gap-3' },
            h('div', { class: 'relative w-[240px]' }, h('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted' }, icon(Search, 16)), search),
            segmented<Filter>([['all', 'Todas'], ['open', 'Abertas'], ['closed', 'Fechadas']], filter, (v) => { filter = v; drawList(); }),
          ),
        ),
        list,
      ),
    );
    drawList();
  };
  draw();
  void Trash2;
  return Object.assign(root, { draw, drawList });
}
