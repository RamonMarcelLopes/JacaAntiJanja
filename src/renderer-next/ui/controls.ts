// Reusable pieces: avatars, switch, slider, dropdown, segmented control, rows of the settings. All animated through styles.css.
import { BookOpen, Check, ChevronDown, Coffee, Code, Dices, Film, Flame, Gamepad2, GraduationCap, Headphones, Heart, Moon, Music, Palette, Pizza, Popcorn, Rocket, Swords, Trophy, Tv, Users, type IconNode } from 'lucide';
import { ROOM_ICON_KEYS } from '../../shared/rooms';
import { dismiss, h, icon, initials } from '../dom';
import { hueOf } from '../state';

/** The pictures a room can have; the keys are the ones the config accepts (ROOM_ICON_KEYS). */
export const ROOM_ICONS: Record<string, IconNode> = {
  film: Film, gamepad: Gamepad2, book: BookOpen, music: Music, users: Users,
  tv: Tv, popcorn: Popcorn, headphones: Headphones, swords: Swords, dices: Dices, trophy: Trophy, rocket: Rocket,
  code: Code, palette: Palette, graduation: GraduationCap, coffee: Coffee, pizza: Pizza, heart: Heart, flame: Flame, moon: Moon,
};
const ICON_NAMES: Record<string, string> = { film: 'Filmes', gamepad: 'Jogos', book: 'Estudo', music: 'Música', users: 'Turma', tv: 'TV', popcorn: 'Cinema', headphones: 'Fones', swords: 'Batalha', dices: 'Jogos de mesa', trophy: 'Campeonato', rocket: 'Foguete', code: 'Código', palette: 'Arte', graduation: 'Aula', coffee: 'Café', pizza: 'Pizza', heart: 'Coração', flame: 'Fogo', moon: 'Noite' };

export const gradient = (hue: number, spread = 40) => `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + spread) % 360} 75% 42%))`;

/** A grid to choose the icon of a room: the chosen one is lit, the others pop a little on hover. */
export function iconPicker(value: string, hue: number, onChange: (key: string) => void): HTMLElement {
  const grid = h('div', { class: 'grid grid-cols-10 gap-1.5', role: 'radiogroup', 'aria-label': 'Ícone da sala' });
  const paint = () =>
    grid.querySelectorAll<HTMLElement>('button').forEach((b) => {
      const on = b.dataset.key === value;
      b.setAttribute('aria-checked', String(on));
      b.style.background = on ? gradient(hue) : '';
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-muted', !on);
      b.classList.toggle('scale-110', on);
    });
  ROOM_ICON_KEYS.forEach((key, i) =>
    grid.append(
      h('button', { type: 'button', role: 'radio', 'data-key': key, 'data-tip': ICON_NAMES[key] ?? key, 'aria-label': ICON_NAMES[key] ?? key, class: 'grid place-items-center h-9 rounded-xl bg-s3 border border-line hover:border-accent hover:text-fg transition-all duration-200 animate-fade-up', style: { animationDelay: `${i * 18}ms` }, onclick: () => { value = key; paint(); onChange(key); } }, icon(ROOM_ICONS[key], 18)),
    ),
  );
  paint();
  return grid;
}

/** The real icon of the app (dist/renderer-next/icon.png, copied from the app's build folder). */
export const appIcon = (size: number, cls = ''): HTMLImageElement => h('img', { src: 'icon.png', alt: '', draggable: false, class: `flex-none select-none ${cls}`, style: { width: `${size}px`, height: `${size}px` } });

/** A round avatar: the photo when the person has one, otherwise the initials on a gradient. */
export function avatar(name: string, hue: number, size = 40, opts: { status?: 'online' | 'live' | 'away' | null; photo?: string | null } = {}): HTMLElement {
  const base = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` };
  const hasPhoto = !!opts.photo && opts.photo.startsWith('data:image/');
  const el = hasPhoto
    ? h('div', { class: 'avatar', style: base }, h('img', { src: opts.photo!, alt: '', draggable: false, class: 'w-full h-full object-cover rounded-full' })) // the photo is rounded by itself: the avatar must not clip, or the status dot would be cut
    : h('div', { class: 'avatar', style: { ...base, background: gradient(hue) } }, initials(name));
  if (opts.status) {
    const color = opts.status === 'live' ? 'var(--live)' : opts.status === 'away' ? 'var(--warn)' : 'var(--ok)';
    el.append(h('i', { class: 'status', style: { background: color } }));
  }
  return el;
}

/** The avatar of a person of the room (own photo or initials; the color comes from the id so it never changes). */
export const personAvatar = (p: { peerId: string; name: string; avatar: string | null }, size = 40, status?: 'online' | 'live' | 'away' | null): HTMLElement =>
  avatar(p.name, hueOf(p.peerId), size, { photo: p.avatar, status });

export function toggle(value: boolean, onChange: (v: boolean) => void, label = ''): HTMLButtonElement {
  const b = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(value), 'aria-label': label });
  b.onclick = () => {
    value = !value;
    b.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  return b;
}

export function slider(value: number, onInput: (v: number) => void, min = 0, max = 100, onChange?: (v: number) => void): HTMLInputElement {
  const s = h('input', { type: 'range', class: 'range', min: String(min), max: String(max), value: String(value) });
  const paint = () => s.style.setProperty('--v', `${((Number(s.value) - min) / (max - min)) * 100}%`);
  paint();
  s.oninput = () => {
    paint();
    onInput(Number(s.value));
  };
  if (onChange) s.onchange = () => onChange(Number(s.value));
  return s;
}

/** Segmented control with a highlight that slides under the selected button. Options are [value, label]. */
export function segmented<T extends string>(options: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement {
  const el = h('div', { class: 'seg', role: 'tablist', style: { '--n': String(options.length), '--i': String(Math.max(0, options.findIndex(([v]) => v === value))) } });
  options.forEach(([v, label], i) => {
    el.append(
      h('button', { role: 'tab', 'aria-selected': String(v === value), onclick: () => {
        el.style.setProperty('--i', String(i));
        el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === el.children[i])));
        onChange(v);
      } }, label),
    );
  });
  return el;
}

/** A group of options to pick one from, with the highlight that slides under the chosen one; each option may have a small icon. Options are [value, label, icon?]. */
export function choice<T extends string | number>(label: string, options: Array<[T, string, IconNode?]>, value: T, onChange: (v: T) => void): HTMLElement {
  const index = (v: T) => Math.max(0, options.findIndex(([x]) => x === v));
  const el = h('div', { class: 'seg seg-sm', role: 'radiogroup', 'aria-label': label, style: { '--n': String(options.length), '--i': String(index(value)) } });
  options.forEach(([v, text, ico]) => {
    el.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onclick: () => {
      value = v;
      el.style.setProperty('--i', String(index(v)));
      el.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-checked', String(options[k][0] === v)));
      onChange(v);
    } }, ico ? icon(ico, 14) : null, text));
  });
  return el;
}

/** A dropdown whose list pops under the button, with the current value checked. Options are [value, label]. */
export function select<T extends string | number>(options: Array<[T, string]>, value: T, onChange: (v: T) => void = () => undefined, width = 180, ariaLabel = ''): HTMLElement {
  const labelOf = (v: T) => options.find(([x]) => x === v)?.[1] ?? String(v);
  const label = h('span', { class: 'truncate' }, labelOf(value));
  const btn = h('button', { type: 'button', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-label': ariaLabel || undefined, class: 'field flex items-center justify-between gap-2 text-left', style: { width: `${width}px`, height: '2.25rem' } }, label, icon(ChevronDown, 16, 'text-muted flex-none transition-transform duration-300'));
  let list: HTMLElement | null = null;
  const close = () => {
    if (!list) return;
    dismiss(list, 160);
    list = null;
    (btn.querySelector('svg') as SVGElement).style.transform = '';
    document.removeEventListener('pointerdown', onDown, true);
  };
  const onDown = (e: Event) => {
    if (list && !list.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  };
  btn.onclick = () => {
    if (list) return close();
    const r = btn.getBoundingClientRect();
    list = h('div', { class: 'menu', role: 'listbox', style: { left: `${r.left}px`, top: `${r.bottom + 6}px`, minWidth: `${r.width}px`, transformOrigin: 'top left', position: 'fixed' } });
    options.forEach(([v, text]) => {
      const item = h('button', { type: 'button', role: 'option', 'aria-selected': String(v === value), class: 'menu-item' }, h('span', { class: 'flex-1' }, text), v === value ? icon(Check, 16, 'text-accent') : null);
      item.onclick = () => {
        value = v;
        label.textContent = text;
        onChange(v);
        close();
      };
      list!.append(item);
    });
    document.body.append(list);
    (btn.querySelector('svg') as SVGElement).style.transform = 'rotate(180deg)';
    document.addEventListener('pointerdown', onDown, true);
  };
  return h('div', { class: 'inline-block' }, btn);
}

/** A labelled row of the settings: title and description on the left, the control on the right. */
export function row(title: string, desc: string | null, control: Node | null, delay = 0): HTMLElement {
  return h('div', { class: 'flex items-center justify-between gap-6 py-4 border-b border-line animate-row-in', style: { animationDelay: `${delay}ms` } },
    h('div', { class: 'min-w-0' }, h('div', { class: 'font-semibold' }, title), desc ? h('div', { class: 'text-muted text-[13px] mt-1 max-w-[520px] leading-relaxed' }, desc) : null),
    control,
  );
}

export const sectionTitle = (text: string, sub?: string) =>
  h('div', { class: 'mb-2 animate-row-in' }, h('h2', { class: 'font-display text-[22px] font-bold tracking-tight' }, text), sub ? h('p', { class: 'text-muted mt-1 text-[13px]' }, sub) : null);

export const chip = (children: Array<Node | string | null>, cls = '') => h('span', { class: `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-s4 border border-line ${cls}` }, ...children);
