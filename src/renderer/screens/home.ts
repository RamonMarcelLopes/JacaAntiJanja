import { decodeInvite } from '../../shared/invite';
import { AppConfig, RoomInfo } from '../../shared/protocol';
import { avatarEl, h, resizeAvatar, toast } from '../dom';
import { JOIN_ERROR_TEXT, JoinError } from '../signaling-client';
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
        await ctx.update({ avatar: await resizeAvatar(file) });
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

  const codeInput = h('input', { type: 'text', placeholder: 'XXXX-XXXX-XXXX-XXXX', maxLength: 24, class: 'code-input', spellcheck: false });
  const createBtn = h('button', { class: 'primary', onclick: () => void create() }, 'Criar sala');
  const joinBtn = h('button', { onclick: () => void join() }, 'Entrar');

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

  async function create(): Promise<void> {
    const cfg = await ensureName();
    if (!cfg) return;
    createBtn.disabled = true;
    createBtn.textContent = 'Criando sala...';
    try {
      const room = await window.jaca.createRoom();
      const session = await Session.join(`ws://127.0.0.1:${room.port}`, room.token, cfg, true);
      room.warnings.forEach((w) => toast(w));
      ctx.openRoom(session, room);
    } catch (e: any) {
      await window.jaca.closeRoom();
      toast(e instanceof JoinError ? (JOIN_ERROR_TEXT[e.code] ?? e.message) : String(e?.message ?? e), 'error');
      createBtn.disabled = false;
      createBtn.textContent = 'Criar sala';
    }
  }

  async function join(): Promise<void> {
    const cfg = await ensureName();
    if (!cfg) return;
    const invite = decodeInvite(codeInput.value);
    if (!invite) {
      toast('Código de convite inválido.', 'error');
      return;
    }
    joinBtn.disabled = true;
    joinBtn.textContent = 'Entrando...';
    try {
      const session = await Session.join(`ws://${invite.ip}:${invite.port}`, invite.token, cfg, false);
      ctx.openRoom(session, null);
    } catch (e: any) {
      toast(e instanceof JoinError ? (JOIN_ERROR_TEXT[e.code] ?? e.message) : 'Falha ao entrar na sala.', 'error');
      joinBtn.disabled = false;
      joinBtn.textContent = 'Entrar';
    }
  }

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void join();
  });

  return h(
    'div',
    { class: 'screen home' },
    h(
      'section',
      { class: 'hero' },
      h('h1', { class: 'wordmark' }, h('span', { class: 'big' }, 'Jaca'), h('span', { class: 'small' }, 'anti Janja')),
      h('p', { class: 'tagline' }, 'Divida sua tela e o som do PC com os amigos. A conexão é direta, sem servidor no meio.'),
      h('div', { class: 'hero-foot' }, h('button', { onclick: ctx.openSettings }, 'Configurações')),
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
      h(
        'section',
        { class: 'block' },
        h('h2', {}, 'Criar sala'),
        h('p', { class: 'muted' }, 'Você vira o host e recebe um código para mandar aos amigos.'),
        createBtn,
      ),
      h('section', { class: 'block' }, h('h2', {}, 'Entrar com código'), h('div', { class: 'row' }, codeInput, joinBtn)),
    ),
  );
}
