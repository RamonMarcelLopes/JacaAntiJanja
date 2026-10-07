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

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts')!;
  const el = h('div', { class: `toast ${kind}` }, message);
  host.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
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
