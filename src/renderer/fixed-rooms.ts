import { AppConfig, FixedRoom, MAX_ROOM_NAME } from '../shared/protocol';
import { dismiss, dismissOnBackdrop, h, toast } from './dom';

/** What the dialogs need from the app: the current config and a way to save changes to it. */
export interface FixedRoomsContext {
  cfg: AppConfig;
  update(patch: Partial<AppConfig>): Promise<AppConfig>;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A small dialog; resolves with whatever `build` passes to `finish`, or with `cancelled` when it is closed another way. */
function smallDialog<T>(cancelled: T, build: (finish: (value: T) => void, overlay: HTMLElement) => HTMLElement[]): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const overlay = h('div', { class: 'overlay' });
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      dismiss(overlay);
      resolve(value);
    };
    overlay.append(h('div', { class: 'dialog small', role: 'dialog' }, ...build(finish, overlay)));
    dismissOnBackdrop(overlay);
    // closing by the backdrop or Esc dismisses the overlay without calling `finish`: settle as cancelled when it disappears
    const watcher = window.setInterval(() => {
      if (!overlay.isConnected) {
        window.clearInterval(watcher);
        finish(cancelled);
      }
    }, 200);
    document.body.append(overlay);
  });
}

/** The text that explains where to get the Discord webhook address. */
const WEBHOOK_HELP =
  'No Discord: configurações do canal > Integrações > Webhooks > Novo webhook > copiar a URL. Fica guardada criptografada neste PC e nunca aparece na tela. Quem tiver essa URL consegue postar no canal, e o código da sala fica visível para todos que veem o canal.';

export interface DiscordSection {
  el: HTMLElement;
  /** Is the "Avisar no Discord" switch on? */
  on(): boolean;
  /** The address typed in the field ('' when nothing was typed). */
  value(): string;
}

/**
 * The Discord notice of a fixed room: a switch, and only while it is on the field for the webhook of THAT room. Used by the "edit room"
 * dialog and by the "new fixed room" form. `hasSaved`: the room already has a webhook (the switch starts on and the field says so).
 */
export function discordSection(hasSaved: boolean): DiscordSection {
  let on = hasSaved;
  const toggle = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-label': 'Avisar no Discord quando a sala abrir', title: 'Ligar ou desligar o aviso no Discord' });
  const input = h('input', {
    type: 'password',
    autocomplete: 'off',
    spellcheck: false,
    maxLength: 300,
    placeholder: hasSaved ? 'Webhook guardado (cole outro para trocar)' : 'https://discord.com/api/webhooks/...',
  });
  const field = h('label', { class: 'field discord-field' }, h('span', {}, 'Webhook desta sala'), input, h('small', { class: 'muted' }, WEBHOOK_HELP));
  const draw = () => {
    toggle.setAttribute('aria-checked', String(on));
    field.hidden = !on;
  };
  toggle.onclick = () => {
    on = !on;
    draw();
    if (on) input.focus();
  };
  draw();
  const row = h(
    'div',
    { class: 'toggle-row' },
    h('div', { class: 'toggle-text' }, h('strong', {}, 'Avisar no Discord'), h('small', { class: 'muted' }, 'Posta num canal quando esta sala abrir, com o código.')),
    toggle,
  );
  return { el: h('div', { class: 'discord-section' }, row, field), on: () => on, value: () => input.value.trim() };
}

/** Edits a fixed room: its name and the Discord notice of THAT room (the code stays the same). Returns true when something was saved. */
export async function editFixedRoom(ctx: FixedRoomsContext, room: FixedRoom): Promise<boolean> {
  const hasWebhook = room.discordWebhookEnc === 'set';
  return smallDialog<boolean>(false, (finish) => {
    const nameInput = h('input', { type: 'text', maxLength: MAX_ROOM_NAME, value: room.name, placeholder: 'Nome da sala fixa' });
    const discord = discordSection(hasWebhook);
    const status = h('small', { class: 'dialog-error' }, '');
    const save = h('button', { class: 'primary' }, 'Salvar');
    let busy = false;
    const submit = async () => {
      if (busy) return;
      const name = nameInput.value.replace(/\s+/g, ' ').trim();
      if (!name) {
        status.textContent = 'Dê um nome para a sala.';
        return;
      }
      if (ctx.cfg.fixedRooms.some((r) => r.id !== room.id && sameName(r.name, name))) {
        status.textContent = 'Você já tem uma sala fixa com esse nome.';
        return;
      }
      const typed = discord.value();
      if (discord.on() && !hasWebhook && !typed) {
        status.textContent = 'Cole o webhook do canal ou desligue o aviso no Discord.';
        return;
      }
      // switch off: take the webhook away (if there was one); switch on: a new address, or leave the saved one as it is
      const webhook = !discord.on() ? (hasWebhook ? null : undefined) : typed || undefined;
      if (name === room.name && webhook === undefined) return finish(false);
      busy = true;
      save.disabled = true;
      save.textContent = typed && discord.on() ? 'Testando...' : 'Salvando...';
      status.textContent = '';
      const result = await window.jaca.saveFixedRoom({ id: room.id, name, webhook });
      busy = false;
      save.disabled = false;
      save.textContent = 'Salvar';
      if (!result.ok) {
        status.textContent = result.message;
        return;
      }
      await ctx.update({}); // brings the window's copy of the config up to date
      toast(result.message || 'Sala atualizada.');
      finish(true);
    };
    save.onclick = () => void submit();
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
    window.setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 50);
    return [
      h('h2', {}, 'Editar sala'),
      h('p', { class: 'muted' }, 'O código da sala continua o mesmo. Quem a favoritou vê o nome novo quando ela estiver aberta.'),
      h('label', { class: 'field' }, h('span', {}, 'Nome da sala'), nameInput),
      discord.el,
      status,
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => finish(false) }, 'Cancelar'), save),
    ];
  });
}

/**
 * A fixed room still looks open (the app closed without ending it). Asks what to do: take the same room back (same code), open a
 * temporary room with another code, or do nothing.
 */
export function askFixedRoomBusy(roomName: string): Promise<'takeover' | 'temporary' | null> {
  return smallDialog<'takeover' | 'temporary' | null>(null, (finish) => [
    h('h2', {}, 'A sala ainda aparece aberta'),
    h(
      'p',
      {},
      `A sala fixa "${roomName}" ainda está aberta no servidor. Costuma acontecer quando o app fechou sem encerrar a sala. Você pode reabrir a mesma sala, com o mesmo código (quem ainda estiver nela é desconectado), ou criar uma sala temporária com outro código.`,
    ),
    h(
      'div',
      { class: 'row end wrap' },
      h('button', { class: 'ghost', onclick: () => finish(null) }, 'Cancelar'),
      h('button', { onclick: () => finish('temporary') }, 'Criar temporária'),
      h('button', { class: 'primary', onclick: () => finish('takeover') }, 'Reabrir esta sala'),
    ),
  ]);
}

/** Asks for confirmation and deletes a fixed room. Returns true when it was deleted. */
export async function deleteFixedRoom(ctx: FixedRoomsContext, room: FixedRoom): Promise<boolean> {
  const confirmed = await smallDialog<boolean>(false, (finish) => [
    h('h2', {}, 'Apagar sala fixa'),
    h('p', {}, `Apagar a sala fixa "${room.name}"? O código dela deixa de existir, e quem a favoritou vai vê-la sempre fechada.`),
    h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => finish(false) }, 'Cancelar'), h('button', { class: 'danger', onclick: () => finish(true) }, 'Apagar')),
  ]);
  if (!confirmed) return false;
  await ctx.update({ fixedRooms: ctx.cfg.fixedRooms.filter((r) => r.id !== room.id) });
  toast(`Sala fixa ${room.name} apagada.`);
  return true;
}
