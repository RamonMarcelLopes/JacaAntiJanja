import { h } from './dom';

// Window-control glyphs (static markup, no user data), drawn like the Windows ones but in the app's colors.
const MINIMIZE = '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M1 5.5h9" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
const MAXIMIZE = '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><rect x="1.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
const RESTORE =
  '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M3.5 3.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="0.8" y="3.5" width="6.7" height="6.7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
const CLOSE = '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';

function iconButton(label: string, svg: string, onclick: () => void, extraClass = ''): HTMLButtonElement {
  const btn = h('button', { class: `tb-btn ${extraClass}`, title: label, 'aria-label': label, tabIndex: -1, onclick });
  btn.innerHTML = svg;
  return btn;
}

/** Draws the window title bar (icon, name, minimize / maximize-restore / close). The window itself has no native frame. */
export function initTitlebar(): void {
  const bar = document.getElementById('titlebar');
  if (!bar) return;

  const maximizeBtn = iconButton('Maximizar', MAXIMIZE, () => void window.jaca.toggleMaximizeWindow());
  const setMaximized = (maximized: boolean) => {
    maximizeBtn.innerHTML = maximized ? RESTORE : MAXIMIZE;
    const label = maximized ? 'Restaurar' : 'Maximizar';
    maximizeBtn.title = label;
    maximizeBtn.setAttribute('aria-label', label);
  };
  window.jaca.onWindowMaximized(setMaximized);
  void window.jaca.isWindowMaximized().then(setMaximized);

  bar.replaceChildren(
    h('div', { class: 'tb-brand' }, h('img', { src: 'icon.png', alt: '' }), h('span', {}, 'Jaca anti Janja')),
    h(
      'div',
      { class: 'tb-controls' },
      iconButton('Minimizar', MINIMIZE, () => void window.jaca.minimizeWindow()),
      maximizeBtn,
      iconButton('Fechar', CLOSE, () => void window.jaca.closeWindow(), 'close'),
    ),
  );

  // double-clicking the empty part of the bar maximizes/restores, like a native title bar
  bar.addEventListener('dblclick', (e) => {
    if (e.target === bar || (e.target as HTMLElement).closest('.tb-brand')) void window.jaca.toggleMaximizeWindow();
  });
}
