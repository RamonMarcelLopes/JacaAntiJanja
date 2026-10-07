type Child = Node | string | null | undefined | false;
type Props = Record<string, any>;

/** Minimal hyperscript helper. Text is always inserted as text nodes, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/**
 * Closes an element with its exit animation: adds the "closing" class (see app.css) and removes the element when the
 * animation ends. Removes it at once when the user prefers reduced motion. Safe to call twice.
 */
export function dismiss(el: HTMLElement): void {
  if (!el.isConnected || el.classList.contains('closing')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.remove();
    return;
  }
  el.classList.add('closing');
  const remove = () => el.remove();
  el.addEventListener('animationend', (e) => {
    if (e.target === el) remove();
  });
  window.setTimeout(remove, 400); // safety net if the animation never fires
}

/**
 * Lets a modal close by clicking the dark backdrop (the click must start AND end on the backdrop, so dragging a text selection out
 * of the dialog does not close it) or by pressing Esc. `canClose` can veto it, e.g. while something is in progress.
 */
export function dismissOnBackdrop(overlay: HTMLElement, canClose: () => boolean = () => true): void {
  let downOnBackdrop = false;
  overlay.addEventListener('mousedown', (e) => {
    downOnBackdrop = e.target === overlay;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && downOnBackdrop && canClose()) dismiss(overlay);
    downOnBackdrop = false;
  });
  const onKey = (e: KeyboardEvent) => {
    if (!overlay.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.key === 'Escape' && canClose()) dismiss(overlay); // an open dropdown list handles (and swallows) its own Esc first
  };
  document.addEventListener('keydown', onKey);
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts')!;
  const el = h('div', { class: `toast ${kind}` }, message);
  host.append(el);
  setTimeout(() => dismiss(el), kind === 'error' ? 7000 : 3500);
}

// Avatar backgrounds: fruit-derived tones that stay readable with white initials.
const AVATAR_COLORS = ['#3f8f4f', '#b7791f', '#c2512f', '#2f7f86', '#7a4f8f', '#486fb0', '#8a7a2a', '#a8456b'];

export function colorFromName(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0] ?? '?';
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
  return (first + second).toUpperCase();
}

export function avatarEl(name: string, avatar: string | null, size = 64): HTMLElement {
  const base = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` };
  if (avatar && avatar.startsWith('data:image/')) {
    return h('div', { class: 'avatar', style: base }, h('img', { src: avatar, alt: '' }));
  }
  return h('div', { class: 'avatar', style: { ...base, background: colorFromName(name) } }, initials(name));
}

/** Reads an image file and returns a 128x128 cover-cropped JPEG data URL. */
export async function resizeAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
