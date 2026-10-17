import { h } from './dom';

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SPARK_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>';

/**
 * Inside a room the notice is out of the way (it would sit over the settings button, and the interface cannot be switched there anyway);
 * it comes back when the room is left. A notice closed with its X stays closed.
 */
export function setUiNoticeInRoom(inRoom: boolean): void {
  const notice = document.getElementById('ui-notice');
  if (notice) notice.hidden = inRoom;
}

/**
 * A notice at the top right that tells the new interface is available. It never closes by itself: only the X closes it (until the app is
 * opened again, nothing is remembered on disk). Clicking it opens Settings where the interface is chosen.
 */
export function initUiNotice(open: () => void): void {
  /** Takes the notice away sliding out to the right (at once under reduced motion). */
  const hide = () => {
    if (notice.classList.contains('closing')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return notice.remove();
    notice.classList.add('closing');
    notice.addEventListener('animationend', () => notice.remove(), { once: true });
    window.setTimeout(() => notice.remove(), 600); // safety net if the animation never fires
  };
  const icon = h('span', { class: 'ui-notice-icon' });
  icon.innerHTML = SPARK_SVG; // static markup, no user data
  const close = h('button', {
    class: 'ui-notice-close',
    title: 'Fechar o aviso',
    'aria-label': 'Fechar o aviso da nova interface',
    onclick: (e: MouseEvent) => {
      e.stopPropagation();
      hide();
      void window.jaca.log('app', 'aviso da nova interface fechado com o X; volta quando o app abrir de novo');
    },
  });
  close.innerHTML = CLOSE_SVG; // static markup, no user data
  const body = h(
    'button',
    {
      class: 'ui-notice-body',
      onclick: () => {
        void window.jaca.log('app', 'aviso da nova interface aberto: indo para Configurações > Interface; o aviso some até o app abrir de novo');
        hide(); // the person saw it: it goes away (until the app is opened again, like with the X)
        open();
      },
    },
    icon,
    h('span', { class: 'ui-notice-text' }, h('strong', {}, 'A nova interface já está disponível!'), h('small', {}, 'Visual novo, com as mesmas funções. Você escolhe qual usar.'), h('span', { class: 'ui-notice-cta' }, 'Conhecer agora →')),
  );
  const notice = h('div', { class: 'ui-notice', role: 'status', id: 'ui-notice' }, body, close);
  document.body.append(notice);
}
