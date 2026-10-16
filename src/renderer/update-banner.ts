import { UpdateState } from '../shared/protocol';
import { h } from './dom';

let state: UpdateState = { status: 'idle' };
let inRoom = false;
const host = h('div', { class: 'update-slot' });
const listeners = new Set<(s: UpdateState) => void>();

export function currentState(): UpdateState {
  return state;
}

/** Lets other screens (settings) react to update status changes. Returns an unsubscribe function. */
export function onUpdateChange(cb: (s: UpdateState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Updating restarts the app, so it is blocked while a room is open. */
export function setInRoom(value: boolean): void {
  inRoom = value;
  render();
}

export function isInRoom(): boolean {
  return inRoom;
}

// The X on the banner hides it until the app is closed: nothing is remembered on disk, so the banner is back every time the app opens.
// Configurações > Sobre keeps offering the update meanwhile.
let dismissed: string | null = null;
const dismissedVersion = (): string | null => dismissed;
const dismissVersion = (version: string): void => {
  dismissed = version;
};

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function render(): void {
  const { status, version, percent } = state;
  if (status === 'available') {
    if (version && dismissedVersion() === version) {
      host.replaceChildren();
      return;
    }
    const btn = h(
      'button',
      {
        class: 'primary',
        disabled: inRoom,
        title: inRoom ? 'Saia da sala para atualizar.' : '',
        onclick: () => {
          void window.jaca.log('atualizacao', `botão "Atualizar agora" do aviso apertado (versão ${version})`);
          void window.jaca.installUpdate();
        },
      },
      inRoom ? 'Saia da sala para atualizar' : 'Atualizar agora',
    );
    const close = h('button', {
      class: 'update-close',
      title: 'Dispensar o aviso (a atualização continua em Configurações > Sobre)',
      'aria-label': 'Dispensar o aviso de atualização',
      onclick: () => {
        void window.jaca.log('atualizacao', `aviso de atualização dispensado com o X (versão ${version}); volta quando o app abrir de novo`);
        if (version) dismissVersion(version);
        render();
      },
    });
    close.innerHTML = CLOSE_SVG; // static markup, no user data
    host.replaceChildren(h('div', { class: 'update-banner' }, h('span', {}, `A versão ${version} está disponível.`), btn, close));
  } else if (status === 'downloading') {
    host.replaceChildren(h('div', { class: 'update-banner' }, h('span', {}, `Baixando a versão ${version}... ${percent ?? 0}%`)));
  } else if (status === 'ready') {
    host.replaceChildren(h('div', { class: 'update-banner' }, h('span', {}, 'Instalando a atualização. O app vai reiniciar.')));
  } else {
    host.replaceChildren();
  }
}

export function initUpdateBanner(): void {
  // right under the custom title bar
  document.getElementById('titlebar')?.after(host);
  window.jaca.onUpdateState((s) => {
    state = s;
    render();
    listeners.forEach((cb) => cb(s));
  });
  void window.jaca.getUpdateState().then((s) => {
    state = s;
    render();
  });
}
