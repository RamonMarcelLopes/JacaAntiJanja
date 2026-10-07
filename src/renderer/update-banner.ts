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

function render(): void {
  const { status, version, percent } = state;
  if (status === 'available') {
    const btn = h(
      'button',
      { class: 'primary', disabled: inRoom, title: inRoom ? 'Saia da sala para atualizar.' : '', onclick: () => void window.jaca.installUpdate() },
      inRoom ? 'Saia da sala para atualizar' : 'Atualizar agora',
    );
    host.replaceChildren(h('div', { class: 'update-banner' }, h('span', {}, `A versão ${version} está disponível.`), btn));
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
