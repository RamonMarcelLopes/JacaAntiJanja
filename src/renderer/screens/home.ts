import { encodeCloudInvite, encodeInvite, parseInvite } from '../../shared/invite';
import { AppConfig, FavoriteRoom, FixedRoom, RoomInfo, RoomStatus } from '../../shared/protocol';
import { cropAvatar } from '../avatar-crop';
import { avatarEl, dismiss, dismissOnBackdrop, h, toast } from '../dom';
import { askFixedRoomBusy, deleteFixedRoom, discordSection, editFixedRoom } from '../fixed-rooms';
import { customSelect } from '../select';
import { diagnoseCloud } from '../cloud-diagnose';
import { JOIN_ERROR_TEXT, JoinError, UNREACHABLE_CLOUD_TEXT } from '../signaling-client';
import { Session } from '../session';

export interface HomeContext {
  cfg: AppConfig;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
  openSettings(): void;
  openRoom(session: Session, room: RoomInfo | null): void;
}

export function renderHome(ctx: HomeContext): HTMLElement {
  const avatarHolder = h('div', { class: 'avatar-holder' });
  const nameInput = h('input', {
    type: 'text',
    maxLength: 24,
    placeholder: 'Seu nome',
    value: ctx.cfg.name,
    onchange: async () => {
      await ctx.update({ name: nameInput.value.trim() });
      drawAvatar();
    },
  });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    style: { display: 'none' },
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const avatar = await cropAvatar(file);
        if (!avatar) return;
        await ctx.update({ avatar });
        drawAvatar();
      } catch {
        toast('Não foi possível ler essa imagem.', 'error');
      }
    },
  });
  const drawAvatar = () => {
    avatarHolder.replaceChildren(avatarEl(nameInput.value || ctx.cfg.name || '?', ctx.cfg.avatar, 88));
  };
  drawAvatar();

  const DEFAULT_ROOM_NAME = 'Jaca room';
  const TEMPORARY = 'temporary';
  const NEW_FIXED = 'new-fixed';
  // the two buttons of the home screen: each one opens a small dialog (name of the room / code of the room)
  const createBtn = h('button', { class: 'primary', onclick: () => openCreateDialog() }, 'Iniciar sala');
  const joinBtn = h('button', { onclick: () => openJoinDialog() }, 'Entrar');

  /** Saves the typed name and returns the up-to-date config, or null when no name was typed. */
  async function ensureName(): Promise<AppConfig | null> {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Escolha um nome de exibição primeiro.', 'error');
      nameInput.focus();
      return null;
    }
    return ctx.update({ name });
  }

  /**
   * Opens a room: a temporary one (`kind` TEMPORARY), a new fixed room with the typed name (NEW_FIXED) or one of the fixed rooms
   * (`kind` is its id; it keeps its own name and code). `btn` is the dialog button that shows the progress. Returns true when the room opened.
   */
  async function create(kind: string, rawName: string, btn: HTMLButtonElement, webhook = '', takeover = false): Promise<boolean> {
    const cfg = await ensureName();
    if (!cfg) return false;
    const typedName = rawName.replace(/\s+/g, ' ').trim() || DEFAULT_ROOM_NAME;
    if (kind === NEW_FIXED && ctx.cfg.fixedRooms.some((r) => r.name.toLowerCase() === typedName.toLowerCase())) {
      toast('Você já tem uma sala fixa com esse nome. Escolha ela na lista.', 'error');
      return false;
    }
    const label = btn.textContent ?? 'Criar sala';
    btn.disabled = true;
    btn.textContent = kind !== TEMPORARY && kind !== NEW_FIXED ? 'Iniciando sala...' : webhook.trim() ? 'Testando o Discord...' : 'Criando sala...';
    let fixed: FixedRoom | undefined;
    try {
      if (kind === NEW_FIXED) {
        // the new fixed room is kept (with its Discord webhook, tested first) before the room is opened; a bad webhook stops everything here
        const saved = await window.jaca.saveFixedRoom({ name: typedName, webhook: webhook.trim() || undefined });
        if (!saved.ok) throw new Error(saved.message);
        await ctx.update({}); // brings the window's copy of the config up to date
        fixed = ctx.cfg.fixedRooms.find((r) => r.id === saved.id);
        if (!fixed) throw new Error('Não foi possível criar a sala fixa.');
        btn.textContent = 'Criando sala...';
      } else if (kind !== TEMPORARY) {
        fixed = ctx.cfg.fixedRooms.find((r) => r.id === kind);
        if (!fixed) throw new Error('Essa sala fixa não existe mais.');
      }
      const roomName = fixed ? fixed.name : typedName;
      const room = await window.jaca.createRoom(roomName, fixed?.id, takeover);
      // Cloudflare mode: the owner's Worker is the room server (the key is inside wsUrl and never shown); direct mode: our own local server
      const session =
        room.mode === 'cloudflare'
          ? await Session.join(room.wsUrl!, 0, cfg, true, room.code, { roomName })
          : await Session.join(`ws://127.0.0.1:${room.port}`, room.token, cfg, true);
      room.warnings.forEach((w) => toast(w));
      ctx.openRoom(session, room);
      // the notice in the Discord channel of THIS fixed room (if it has a webhook) goes out only now that the room really is open
      if (fixed) {
        void window.jaca.discordNotify({ fixedId: fixed.id, code: room.code }).then((r) => {
          if (!r.ok) toast(`Não consegui avisar no Discord: ${r.message}`, 'error');
        });
      }
      return true;
    } catch (e: any) {
      void window.jaca.log('criar', `${e instanceof JoinError ? e.code : 'erro'}: ${String(e?.message ?? e)} (modo ${ctx.cfg.connectionMode})`);
      await window.jaca.closeRoom();
      if (!(e instanceof JoinError) && fixed && errorText(e) === 'FIXED_ROOM_BUSY') {
        // the fixed room still looks open (the app closed without ending it): reopen the same room, or open a temporary one instead
        btn.disabled = false;
        btn.textContent = label;
        const choice = await askFixedRoomBusy(fixed.name);
        if (choice === 'takeover') return create(kind, rawName, btn, webhook, true);
        if (choice === 'temporary') return create(TEMPORARY, fixed.name, btn);
        return false;
      }
      toast(e instanceof JoinError ? (e.code === 'UNREACHABLE' && ctx.cfg.connectionMode === 'cloudflare' ? UNREACHABLE_CLOUD_TEXT : (JOIN_ERROR_TEXT[e.code] ?? e.message)) : errorText(e), 'error');
      btn.disabled = false;
      btn.textContent = label;
      return false;
    }
  }

  /** Joins with a typed code, or with the code of a favorite room (then `btn` is that favorite's button). Returns true when it got in. */
  async function join(codeText: string, btn: HTMLButtonElement): Promise<boolean> {
    const cfg = await ensureName();
    if (!cfg) return false;
    const invite = parseInvite(codeText);
    if (!invite) {
      toast('Código de convite inválido.', 'error');
      return false;
    }
    const label = btn.textContent ?? 'Entrar';
    btn.disabled = true;
    btn.textContent = 'Entrando...';
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
      ctx.openRoom(session, null);
      return true;
    } catch (e: any) {
      void window.jaca.log('entrar', `${e instanceof JoinError ? e.code : 'erro'}: ${String(e?.message ?? e)} (${invite.kind === 'cloud' ? 'Cloudflare, conta ' + invite.subdomain : 'direto'})`); // never the full code: it is a way into the room
      let text = e instanceof JoinError ? (JOIN_ERROR_TEXT[e.code] ?? e.message) : String(e?.message ?? 'Falha ao entrar na sala.');
      if (e instanceof JoinError && (e.code === 'UNREACHABLE' || e.code === 'TIMEOUT') && invite.kind === 'cloud') {
        // find out whether this PC's network is the problem, instead of just saying it failed
        btn.textContent = 'Verificando...';
        const base = await window.jaca.workerWsBase(invite.subdomain);
        text = base ? await diagnoseCloud(base, invite.subdomain) : UNREACHABLE_CLOUD_TEXT;
      }
      void window.jaca.log('rede', `mensagem mostrada: ${text}`);
      toast(text, 'error');
      btn.disabled = btn.dataset.closed === '1'; // a favorite that is closed stays off
      btn.textContent = label;
      return false;
    }
  }

  /** A small dialog over the home screen. `canClose` is false while something is being opened. */
  function openDialog(content: HTMLElement[], canClose: () => boolean): HTMLElement {
    const overlay = h('div', { class: 'overlay' }, h('div', { class: 'dialog small', role: 'dialog' }, ...content));
    dismissOnBackdrop(overlay, canClose);
    document.body.append(overlay);
    return overlay;
  }

  // ---- "Entrar": asks for the code of the room
  function openJoinDialog(): void {
    // the longest code is a Cloudflare one: 11 characters + "@" + an account name of up to 63 (the first versions allowed only 24, which cut the end of the account name)
    const codeInput = h('input', { type: 'text', placeholder: 'XXXX-XXXX-XXXX-XXXX', maxLength: 80, class: 'code-input', spellcheck: false });
    const enterBtn = h('button', { class: 'primary' }, 'Entrar');
    let busy = false;
    const submit = async () => {
      if (busy) return;
      busy = true;
      if (await join(codeInput.value, enterBtn)) dismiss(overlay);
      busy = false;
    };
    enterBtn.onclick = () => void submit();
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
    const overlay = openDialog(
      [
        h('h2', {}, 'Entrar em uma sala'),
        h('label', { class: 'field' }, h('span', {}, 'Código da sala'), codeInput),
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dismiss(overlay) }, 'Cancelar'), enterBtn),
      ],
      () => !busy,
    );
    window.setTimeout(() => codeInput.focus(), 50);
  }

  // ---- "Criar sala": asks for the name of the room ("Jaca room" suggested and selected). With the Cloudflare mode it also asks the kind
  // of room: a temporary one, one of the host's fixed rooms (same code every time) or a new fixed room.
  const errorText = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  function openCreateDialog(): void {
    const cloud = ctx.cfg.connectionMode === 'cloudflare';
    let kind = TEMPORARY;
    let busy = false;
    const isExistingFixed = () => ctx.cfg.fixedRooms.some((r) => r.id === kind);
    const nameField = h('input', { type: 'text', maxLength: 32, value: DEFAULT_ROOM_NAME, placeholder: 'Nome da sala' });
    const startBtn = h('button', { class: 'primary' }, 'Criar sala');
    // only for a NEW fixed room: the Discord channel that gets a notice every time this room opens (an existing one is edited with "Editar sala")
    const discord = discordSection(false); // a switch, and the webhook field only while it is on
    discord.el.hidden = true;
    const dialogTitle = h('h2', {}, 'Criar sala');
    const syncLabel = () => {
      // an existing fixed room is started again, the others are created
      const label = isExistingFixed() ? 'Iniciar sala' : 'Criar sala';
      startBtn.textContent = label;
      dialogTitle.textContent = label;
      discord.el.hidden = kind !== NEW_FIXED;
    };
    const makeKindSelect = (selected: string): HTMLButtonElement => {
      const select = customSelect<string>(
        selected,
        [
          [TEMPORARY, 'Sala temporária'],
          ...ctx.cfg.fixedRooms.map((r): [string, string] => [r.id, `Sala fixa: ${r.name}`]),
          [NEW_FIXED, '+ Nova sala fixa'],
        ],
        (value) => {
          kind = value;
          const fixed = ctx.cfg.fixedRooms.find((r) => r.id === value);
          nameField.disabled = !!fixed; // a fixed room keeps its own name
          nameField.value = fixed ? fixed.name : DEFAULT_ROOM_NAME;
          if (!fixed) {
            nameField.focus();
            nameField.select();
          }
          syncLabel();
        },
        'Tipo de sala',
        {
          // three dots on each fixed room inside the list
          has: (value) => ctx.cfg.fixedRooms.some((r) => r.id === value),
          items: [
            { label: 'Editar sala', onSelect: (id) => void editFixed(id) },
            { label: 'Apagar', danger: true, onSelect: (id) => void removeFixed(id) },
          ],
        },
      );
      select.title = 'Temporária: cada sala tem um código novo. Fixa: abre sempre com o mesmo código, e seus amigos podem favoritá-la.';
      return select;
    };
    let kindSelect = makeKindSelect(TEMPORARY);
    /** The list of options changed (a room was renamed or deleted): rebuilds the dropdown, keeping `selected`. */
    const refreshKindSelect = (selected: string) => {
      kind = selected;
      const fixed = ctx.cfg.fixedRooms.find((r) => r.id === selected);
      nameField.disabled = !!fixed;
      nameField.value = fixed ? fixed.name : DEFAULT_ROOM_NAME;
      syncLabel();
      const fresh = makeKindSelect(selected);
      kindSelect.replaceWith(fresh);
      kindSelect = fresh;
    };
    async function editFixed(id: string): Promise<void> {
      const room = ctx.cfg.fixedRooms.find((r) => r.id === id);
      if (room && (await editFixedRoom(ctx, room))) refreshKindSelect(kind);
    }
    async function removeFixed(id: string): Promise<void> {
      const room = ctx.cfg.fixedRooms.find((r) => r.id === id);
      if (room && (await deleteFixedRoom(ctx, room))) refreshKindSelect(kind === id ? TEMPORARY : kind);
    }
    const submit = async () => {
      if (busy) return;
      busy = true;
      const useDiscord = kind === NEW_FIXED && discord.on();
      if (useDiscord && !discord.value()) {
        toast('Cole o webhook do canal ou desligue o aviso no Discord.', 'error');
      } else if (await create(kind, nameField.value, startBtn, useDiscord ? discord.value() : '')) {
        dismiss(overlay);
      }
      busy = false;
    };
    startBtn.onclick = () => void submit();
    nameField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
    const overlay = openDialog(
      [
        dialogTitle,
        h('label', { class: 'field' }, h('span', {}, 'Nome da sala'), nameField),
        cloud ? h('div', { class: 'field' }, h('span', {}, 'Tipo de sala'), kindSelect) : null,
        cloud ? discord.el : null,
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dismiss(overlay) }, 'Cancelar'), startBtn),
      ].filter((el) => el !== null) as HTMLElement[],
      () => !busy,
    );
    window.setTimeout(() => {
      nameField.focus();
      nameField.select(); // "Jaca room" comes selected, so typing replaces it
    }, 50);
  }

  // ---- favorite rooms: saved by the guests, with the name the host gave; shows whether each one is open right now
  const favList = h('div', { class: 'fav-list' });
  // filters (not saved: every time the app opens the whole list shows): by room name and by open / closed
  type FavFilter = 'all' | 'open' | 'closed';
  let favFilter: FavFilter = 'all';
  const favSearch = h('input', { type: 'search', class: 'fav-search', placeholder: 'Buscar sala pelo nome', maxLength: 32, 'aria-label': 'Buscar sala favorita pelo nome', spellcheck: false });
  favSearch.addEventListener('input', () => drawFavs());
  const favSeg = h('div', { class: 'seg seg3', role: 'radiogroup', 'aria-label': 'Filtrar salas por estado' });
  favSeg.dataset.pos = '0';
  const favFilterButtons = new Map<FavFilter, HTMLButtonElement>();
  for (const [value, label] of [['all', 'Todas'], ['open', 'Abertas'], ['closed', 'Fechadas']] as Array<[FavFilter, string]>) {
    const btn = h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(value === favFilter) }, label);
    btn.onclick = () => {
      favFilter = value;
      favSeg.dataset.pos = String(['all', 'open', 'closed'].indexOf(value));
      for (const [v, b] of favFilterButtons) b.setAttribute('aria-checked', String(v === value));
      drawFavs();
    };
    favFilterButtons.set(value, btn);
    favSeg.append(btn);
  }
  const favFilters = h('div', { class: 'fav-filters' }, favSearch, favSeg);
  const favSection = h('section', { class: 'block fav-block' }, h('h2', {}, 'Salas favoritas'), favFilters, favList);
  /** Lower case without accents, so "sala do joao" finds "Sala do João". */
  const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const statuses = new Map<string, RoomStatus>();
  const statusText = (st: RoomStatus | undefined): string => {
    if (!st || st.state === 'unknown') return 'Sem resposta do servidor da sala';
    if (st.state === 'closed') return 'Fechada';
    const people = st.count === 1 ? '1 pessoa' : `${st.count ?? '?'} pessoas`;
    return `Aberta${st.hostName ? ` · ${st.hostName}` : ''} · ${people}`;
  };
  // three dots on a favorite (visible on hover): copy its code or take it off the list
  let closeFavMenu: (() => void) | null = null;
  function openFavMenu(anchor: HTMLElement, fav: FavoriteRoom): void {
    closeFavMenu?.();
    anchor.setAttribute('aria-expanded', 'true');
    const copy = h('button', {
      class: 'menu-item',
      role: 'menuitem',
      onclick: async () => {
        close();
        try {
          await window.jaca.copyText(fav.code);
          toast('Código copiado.');
        } catch {
          toast('Não foi possível copiar o código.', 'error');
        }
      },
    }, 'Copiar código');
    const remove = h('button', {
      class: 'menu-item danger-item',
      role: 'menuitem',
      onclick: async () => {
        close();
        await ctx.update({ favoriteRooms: ctx.cfg.favoriteRooms.filter((f) => f.code !== fav.code) });
        statuses.delete(fav.code);
        drawFavs();
      },
    }, 'Remover dos favoritos');
    const menu = h('div', { class: 'menu', role: 'menu' }, copy, remove);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    const onDown = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    function close(): void {
      dismiss(menu);
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      closeFavMenu = null;
    }
    closeFavMenu = close;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.body.append(menu);
    copy.focus();
  }

  let favSig = '';
  let favDrawn = false;
  function drawFavs(): void {
    const favorites = ctx.cfg.favoriteRooms;
    // redraw only when something changed, so the rows do not replay their entrance and an open menu or the scroll position is not lost
    const query = plain(favSearch.value.trim());
    const visible = favorites.filter((f) => {
      const state = statuses.get(f.code)?.state;
      return (!query || plain(f.name).includes(query)) && (favFilter === 'all' || state === favFilter);
    });
    const sig = JSON.stringify([favorites.length, favFilter, query, visible.map((f) => [f.code, f.name, statuses.get(f.code)])]);
    if (sig === favSig) return;
    favSig = sig;
    favList.classList.toggle('static', favDrawn); // only the first drawing plays the entrance; typing in the search must not replay it
    favDrawn = true;
    if (!favorites.length) {
      favList.replaceChildren(h('p', { class: 'muted fav-empty' }, 'Você ainda não favoritou nenhuma sala. Dentro de uma sala, clique na estrela ao lado do código para favoritá-la.'));
      return;
    }
    if (!visible.length) {
      favList.replaceChildren(h('p', { class: 'muted fav-empty' }, 'Nenhuma sala encontrada com esse filtro.'));
      return;
    }
    favList.replaceChildren(
      ...visible.map((fav) => {
        const st = statuses.get(fav.code);
        const closed = st?.state === 'closed'; // nobody to join: the button is off until the room opens
        const enter = h('button', { class: st?.state === 'open' ? 'primary' : '', disabled: closed, title: closed ? 'A sala está fechada' : '' }, 'Entrar');
        if (closed) enter.dataset.closed = '1';
        enter.onclick = () => void join(fav.code, enter);
        const kebab = h('button', {
          class: 'fav-kebab',
          title: 'Opções da sala',
          'aria-label': `Opções de ${fav.name}`,
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            openFavMenu(kebab, fav);
          },
        }, h('span', { class: 'kebab-dots', 'aria-hidden': 'true' }));
        return h(
          'div',
          { class: 'fav-row', 'data-state': st?.state ?? 'unknown' },
          h('span', { class: 'fav-dot', 'aria-hidden': 'true' }),
          h('div', { class: 'fav-info' }, h('strong', {}, fav.name), h('small', { class: 'muted' }, statusText(st))),
          enter,
          kebab,
        );
      }),
    );
  }
  async function pollFavs(): Promise<void> {
    const favorites = ctx.cfg.favoriteRooms;
    if (!favorites.length || document.hidden) return;
    const results = await window.jaca.roomsStatus(favorites.map((f) => f.code));
    if (!root.isConnected) return;
    let renamed = false;
    const next = ctx.cfg.favoriteRooms.map((fav) => {
      const st = results.find((r) => r.code === fav.code);
      if (!st) return fav;
      if (statuses.get(fav.code)?.state === 'closed' && st.state === 'open') {
        toast(`A sala ${st.name || fav.name} abriu.`);
      }
      statuses.set(fav.code, st);
      // the name is the host's: when the host renames the room, the favorite follows
      if (st.state === 'open' && st.name && st.name !== fav.name) {
        renamed = true;
        return { ...fav, name: st.name };
      }
      return fav;
    });
    if (renamed) await ctx.update({ favoriteRooms: next });
    drawFavs();
  }

  const root = h(
    'div',
    { class: 'screen home' },
    h(
      'section',
      { class: 'hero' },
      h('h1', { class: 'wordmark' }, h('span', { class: 'big' }, 'Jaca'), h('span', { class: 'small' }, 'anti Janja')),
      h('p', { class: 'tagline' }, 'Divida sua tela e o som do PC com os amigos.'),
      h(
        'div',
        { class: 'hero-foot' },
        h('button', { onclick: ctx.openSettings }, 'Configurações'),
        // read-only: the mode is changed in Configurações > Rede
        h('p', { class: 'conn-mode' }, 'Modo de conexão: ', h('span', { class: 'conn-badge', 'data-mode': ctx.cfg.connectionMode === 'cloudflare' ? 'cloudflare' : 'direct' }, ctx.cfg.connectionMode === 'cloudflare' ? 'Cloudflare' : 'VPN')),
      ),
    ),
    h(
      'main',
      { class: 'home-form' },
      h(
        'section',
        { class: 'block' },
        h('h2', {}, 'Seu perfil'),
        h(
          'div',
          { class: 'profile' },
          avatarHolder,
          h(
            'div',
            { class: 'profile-fields' },
            nameInput,
            h(
              'div',
              { class: 'row' },
              h('button', { onclick: () => fileInput.click() }, 'Escolher imagem'),
              h(
                'button',
                {
                  class: 'ghost',
                  onclick: async () => {
                    await ctx.update({ avatar: null });
                    drawAvatar();
                  },
                },
                'Remover',
              ),
            ),
            fileInput,
          ),
        ),
      ),
      h('section', { class: 'block' }, h('h2', {}, 'Iniciar ou entrar em uma sala'), h('div', { class: 'home-actions' }, createBtn, joinBtn)),
      favSection,
    ),
  );

  drawFavs();
  window.setTimeout(() => void pollFavs(), 100);
  const pollTimer = window.setInterval(() => {
    if (!root.isConnected) return window.clearInterval(pollTimer); // the home screen was left
    void pollFavs();
  }, 20_000);
  return root;
}
