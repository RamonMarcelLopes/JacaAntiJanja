// The cascading menu of the call buttons: level 1 above the little arrow, each deeper level to the right of the one it came from.
import { ChevronRight, Check, type IconNode } from 'lucide';
import { dismiss, h, icon } from '../dom';

export interface MenuRow { label: string; icon?: IconNode; value?: string; checked?: boolean; onSelect?: () => void; sub?: () => MenuRow[] | Promise<MenuRow[]> }

let levels: HTMLElement[] = [];
let owner: HTMLElement | null = null;
let stopListeners: (() => void) | null = null;

export function closeMenus(): void {
  document.body.classList.remove('menu-open');
  levels.forEach((m) => dismiss(m, 180));
  levels = [];
  owner?.querySelector('.chev')?.classList.remove('open');
  owner = null;
  stopListeners?.();
  stopListeners = null;
}

function show(depth: number, rows: MenuRow[], place: (menu: HTMLElement) => { left: number; top: number }): HTMLElement {
  levels.splice(depth).forEach((m) => dismiss(m, 140));
  const menu = h('div', { class: 'menu', role: 'menu', style: { position: 'fixed', visibility: 'hidden' } });
  for (const r of rows) {
    const item = h('button', { class: 'menu-item', role: 'menuitem' });
    if (r.icon) item.append(h('span', { class: 'text-muted' }, icon(r.icon, 18)));
    item.append(h('span', { class: 'flex-1 truncate' }, r.label));
    if (r.value) item.append(h('span', { class: 'text-muted text-[13px]' }, r.value));
    if (r.checked) item.append(icon(Check, 16, 'text-ok'));
    if (r.sub) item.append(icon(ChevronRight, 14, 'text-muted'));
    item.onclick = async () => {
      if (r.sub) {
        menu.querySelectorAll('.menu-item.open').forEach((x) => x.classList.remove('open'));
        item.classList.add('open');
        const parent = menu.getBoundingClientRect();
        const subRows = await r.sub();
        if (levels[depth] !== menu) return; // the menu was closed while the list loaded
        // the second level sits a little lower than the first (about 10% of its height); the third one is level with the second
        show(depth + 1, subRows, () => ({ left: parent.right + 8, top: parent.top + (depth === 0 ? parent.height * 0.1 : 0) }));
      } else {
        r.onSelect?.();
        closeMenus();
      }
    };
    menu.append(item);
  }
  document.body.append(menu);
  const pos = place(menu);
  menu.style.left = `${Math.max(8, Math.min(pos.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(pos.top, innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.visibility = '';
  levels[depth] = menu;
  return menu;
}

/** Opens the menu of a call button; calling it again with the same button closes it. */
export function toggleMenu(button: HTMLElement, rows: () => MenuRow[]): void {
  const same = owner === button;
  if (levels.length) closeMenus();
  if (same) return;
  owner = button;
  document.body.classList.add('menu-open'); // keeps the call bar visible while its menu is open
  const chev = button.querySelector('.chev') as HTMLElement | null;
  chev?.classList.add('open');
  const r = (chev ?? button).getBoundingClientRect();
  const onDown = (e: Event) => {
    const t = e.target as Node;
    if (levels.some((m) => m.contains(t)) || button.contains(t)) return;
    closeMenus();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenus();
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  stopListeners = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
  // the first menu is centered on its button, so the two levels that open to its right still fit in the window without covering each other
  const b = button.getBoundingClientRect();
  show(0, rows(), (menu) => ({ left: b.left + b.width / 2 - menu.offsetWidth / 2, top: r.top - 10 - menu.offsetHeight }));
}
