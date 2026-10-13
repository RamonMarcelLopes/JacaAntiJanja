import { dismiss, h } from './dom';

// Static markup (no user data): check mark for the selected option.
const CHECK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

let nextId = 0;

/**
 * Custom dropdown that replaces the native <select> (whose list cannot be styled): a pill button showing the current
 * value and our own list below it. Mouse, keyboard (arrows, Home/End, Enter/Space, Esc, Tab) and screen readers
 * (combobox + listbox roles) are supported. The button keeps `data-value` in sync with the selected option.
 */
/** Optional three-dot menu on some options (e.g. edit / delete a saved item): `has` says which options get it. */
export interface RowMenu {
  has(value: string): boolean;
  items: Array<{ label: string; danger?: boolean; onSelect(value: string): void }>;
}

export function customSelect<T extends string | number>(value: T, options: Array<[T, string]>, onChange: (value: string) => void, ariaLabel?: string, rowMenu?: RowMenu): HTMLButtonElement {
  const items = options.map(([v, label]) => ({ value: String(v), label }));
  let current = Math.max(0, items.findIndex((i) => i.value === String(value)));
  let active = current;
  let menu: HTMLElement | null = null;
  let cleanup: (() => void) | null = null;
  let rowPopup: HTMLElement | null = null; // the small menu of an option's three dots, while it is open
  let rowAnchor: HTMLElement | null = null; // the dots button that opened it
  let closeRowPopup: (() => void) | null = null;
  const id = `sel${nextId++}`;

  // All labels share one grid cell and only the current one is visible, so the button is always as wide as the longest
  // option and does not jump when the value changes.
  const labels = items.map((it, i) => h('span', { class: `sl ${i === current ? 'on' : ''}` }, it.label));
  const btn = h(
    'button',
    { class: 'select-btn', type: 'button', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': ariaLabel },
    h('span', { class: 'select-labels' }, ...labels),
  );
  btn.dataset.value = items[current].value;

  const setActive = (idx: number) => {
    active = (idx + items.length) % items.length;
    menu?.querySelectorAll('.select-option').forEach((el, i) => el.classList.toggle('active', i === active));
    (menu?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    btn.setAttribute('aria-activedescendant', `${id}-${active}`);
  };

  const choose = (idx: number) => {
    current = idx;
    labels.forEach((l, i) => l.classList.toggle('on', i === idx));
    btn.dataset.value = items[idx].value;
    close();
    btn.focus();
    onChange(items[idx].value);
  };

  const place = () => {
    if (!menu) return;
    const r = btn.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(r.width, rowMenu ? 260 : 0)}px`; // lists with three dots are wider, so the dots sit well apart from the text
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8 && r.top - mh - 6 > 8) top = r.top - mh - 6; // not enough room below: open upwards
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - mw - 8))}px`;
  };

  function open(): void {
    if (menu) return;
    active = current;
    menu = h(
      'div',
      { class: `select-menu ${rowMenu ? 'has-row-menu' : ''}`, role: 'listbox', id: `${id}-list` },
      ...items.map((it, i) => {
        const check = h('span', { class: 'select-check', 'aria-hidden': 'true' });
        check.innerHTML = CHECK;
        const dots =
          rowMenu?.has(it.value)
            ? h(
                'button',
                {
                  class: 'opt-kebab',
                  type: 'button',
                  title: 'Opções',
                  'aria-label': `Opções de ${it.label}`,
                  'aria-haspopup': 'menu',
                  onmousedown: (e: MouseEvent) => e.preventDefault(),
                  onclick: (e: MouseEvent) => {
                    e.stopPropagation(); // does not choose the option
                    openRowMenu(e.currentTarget as HTMLElement, it.value); // the list stays open under it; a second click closes it
                  },
                },
                h('span', { class: 'kebab-dots', 'aria-hidden': 'true' }),
              )
            : null;
        return h(
          'div',
          {
            class: `select-option ${i === current ? 'selected' : ''} ${i === active ? 'active' : ''}`,
            role: 'option',
            id: `${id}-${i}`,
            'aria-selected': String(i === current),
            onmousemove: () => setActive(i),
            onmousedown: (e: MouseEvent) => e.preventDefault(), // keep focus on the button
            onclick: () => choose(i),
          },
          h('span', { class: 'select-option-label' }, it.label),
          dots,
          check,
        );
      }),
    );
    document.body.append(menu);
    place();
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', `${id}-list`);
    btn.setAttribute('aria-activedescendant', `${id}-${active}`);
    btn.classList.add('open');

    const onDown = (e: MouseEvent) => {
      if (!menu?.contains(e.target as Node) && !btn.contains(e.target as Node) && !rowPopup?.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
      if (!menu?.contains(e.target as Node)) close();
    };
    const onAway = () => close();
    // the controls bar is rebuilt now and then; if this button disappears the list must go too
    const watchdog = window.setInterval(() => {
      if (!btn.isConnected) close();
    }, 250);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    cleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('blur', onAway);
      window.clearInterval(watchdog);
    };
  }

  /** The small menu of one option's three dots (edit / delete...), opened at the place of the dots after the list closed. */
  function openRowMenu(anchorEl: HTMLElement, optionValue: string): void {
    if (!rowMenu) return;
    const wasOpenHere = rowAnchor === anchorEl;
    closeRowPopup?.(); // closes whatever menu was open (this option's or another one's)
    if (wasOpenHere) return; // a second click on the same dots only closes its menu
    const anchor = anchorEl.getBoundingClientRect();
    const done = () => {
      dismiss(popup);
      if (rowPopup === popup) {
        rowPopup = null;
        rowAnchor = null;
        closeRowPopup = null;
      }
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const popup = h(
      'div',
      { class: 'menu row-menu', role: 'menu' },
      ...rowMenu.items.map((item) =>
        h('button', { class: `menu-item ${item.danger ? 'danger-item' : ''}`, role: 'menuitem', onclick: () => { done(); close(); item.onSelect(optionValue); } }, item.label), // choosing an action closes the list too
      ),
    );
    rowPopup = popup;
    rowAnchor = anchorEl;
    closeRowPopup = done;
    const onDown = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) done(); // the dots handle their own click (it toggles)
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done();
      }
    };
    popup.style.top = `${anchor.bottom + 4}px`;
    popup.style.right = `${Math.max(8, window.innerWidth - anchor.right)}px`;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.body.append(popup);
    (popup.firstElementChild as HTMLElement | null)?.focus();
  }

  function close(): void {
    if (!menu) return;
    dismiss(menu);
    menu = null;
    cleanup?.();
    cleanup = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    btn.classList.remove('open');
  }

  btn.addEventListener('click', () => (menu ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (!menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(active - 1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        close();
        break;
    }
  });

  return btn;
}
