// Small motion helpers used everywhere: pointer light, ripple, tilt, tooltips, toasts, confetti, rolling numbers, FLIP.
import { dismiss, h, icon, pick, rand, reducedMotion } from './dom';
import { Check, CircleAlert, Info, X } from 'lucide';

export function initFx(): void {
  const body = document.body;

  // a light that follows the pointer on every .spot surface
  body.addEventListener('pointermove', (e) => {
    const spot = (e.target as HTMLElement).closest?.('.spot') as HTMLElement | null;
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty('--mx', `${e.clientX - r.left}px`);
      spot.style.setProperty('--my', `${e.clientY - r.top}px`);
    }
    // 3D tilt of the stage tiles
    const tile = (e.target as HTMLElement).closest?.('.tile[data-tilt]') as HTMLElement | null;
    if (tile && !reducedMotion()) {
      const r = tile.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tile.style.transform = `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg) scale(1.012)`;
    }
  });
  body.addEventListener('pointerout', (e) => {
    const tile = (e.target as HTMLElement).closest?.('.tile[data-tilt]') as HTMLElement | null;
    if (tile && !tile.contains(e.relatedTarget as Node)) tile.style.transform = '';
  });

  // ripple on every .ripple element
  body.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest?.('.ripple') as HTMLElement | null;
    if (!el || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = h('span', { class: 'ripple-dot', style: { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` } });
    el.append(dot);
    window.setTimeout(() => dot.remove(), 700);
  });

  // tooltips from data-tip
  let tip: HTMLElement | null = null;
  let tipFor: HTMLElement | null = null; // the element the tooltip belongs to: moving over its children (icon, text) must not rebuild it
  const hideTip = () => {
    tip?.remove();
    tip = null;
    tipFor = null;
  };
  body.addEventListener('pointerover', (e) => {
    const over = e.target as HTMLElement;
    // the little arrow of a call button has no tooltip of its own, and must not show the one of the button
    const t = over.closest?.('.chev') ? null : (over.closest?.('[data-tip]') as HTMLElement | null);
    if (t && t === tipFor) return; // same element: the tooltip stays where it is, no flicker while the pointer moves
    hideTip();
    if (!t) return;
    tipFor = t;
    tip = h('div', { class: 'tooltip' }, t.dataset.tip);
    document.body.append(tip);
    const r = t.getBoundingClientRect();
    const side = t.dataset.tipSide ?? 'top';
    const tr = tip.getBoundingClientRect();
    if (side === 'right') { tip.style.left = `${r.right + 10}px`; tip.style.top = `${r.top + r.height / 2 - tr.height / 2}px`; }
    else if (side === 'bottom') { tip.style.left = `${r.left + r.width / 2 - tr.width / 2}px`; tip.style.top = `${r.bottom + 8}px`; }
    else { tip.style.left = `${r.left + r.width / 2 - tr.width / 2}px`; tip.style.top = `${r.top - tr.height - 8}px`; }
  });
  body.addEventListener('pointerout', (e) => {
    if (tipFor && !tipFor.contains(e.relatedTarget as Node | null)) hideTip(); // the pointer left the element for good (not just for one of its children)
  });
  body.addEventListener('pointerdown', hideTip, true);

  body.append(h('div', { id: 'toasts', class: 'fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end' }));
}

export type ToastKind = 'ok' | 'info' | 'warn';
export function toast(text: string, kind: ToastKind = 'info'): void {
  const box = document.getElementById('toasts');
  if (!box) return;
  // "warn" is the kind of every error and warning of the app: it is red (the color of "ao vivo" and of the stop buttons), not a fixed yellow
  const ico = icon(kind === 'ok' ? Check : kind === 'warn' ? CircleAlert : Info, 18, kind === 'ok' ? 'text-ok' : kind === 'warn' ? 'text-live' : 'text-accent');
  const ms = kind === 'warn' ? 7000 : 4000;
  const close = h('button', { class: 'toast-close', 'aria-label': 'Fechar o aviso', title: 'Fechar', onclick: (e: Event) => { e.stopPropagation(); window.clearTimeout(timer); dismiss(el, 300); } }, icon(X, 14));
  const el = h('div', { class: 'toast', role: 'status', 'data-kind': kind, style: { '--toast-ms': `${ms}ms` } }, ico, h('span', { class: 'font-medium' }, text), close);
  box.append(el);
  while (box.children.length > 4) box.firstElementChild?.remove();
  let timer = window.setTimeout(() => dismiss(el, 300), ms);
  // with the pointer over it the toast waits (and its little bar stops) so it can be read; the X closes it at once. Leaving gives it a moment more.
  el.addEventListener('pointerenter', () => window.clearTimeout(timer));
  el.addEventListener('pointerleave', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => dismiss(el, 300), 2200);
  });
}

/** A burst of colored bits from a point (when something starts: a share, a theme...). */
export function burst(x: number, y: number, n = 22): void {
  if (reducedMotion()) return;
  const colors = ['var(--accent)', '#fff', 'var(--live)', 'var(--ok)', 'var(--warn)'];
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(40, 130);
    const bit = h('i', { class: 'confetti', style: { left: `${x}px`, top: `${y}px`, background: pick(colors), '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 30}px`, '--rot': `${rand(-360, 360)}deg` } });
    document.body.append(bit);
    window.setTimeout(() => bit.remove(), 1000);
  }
}

/** A number whose digits roll upward when it changes (viewer counts, ms). */
export function rollingNumber(initial: number): { el: HTMLElement; set(n: number): void } {
  const line = (n: number) => h('span', { class: 'block leading-[1.2]' }, String(n));
  const el = h('span', { class: 'digit-roll tabular-nums' }, line(initial));
  let value = initial;
  return {
    el,
    set(n: number) {
      if (n === value) return;
      const up = n > value;
      const old = value;
      value = n;
      if (reducedMotion()) { el.replaceChildren(line(n)); return; }
      // two lines stacked; the pair slides by exactly one line
      const track = h('span', { class: 'block' }, up ? line(old) : line(n), up ? line(n) : line(old));
      el.replaceChildren(track);
      const frames = up ? [{ transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }] : [{ transform: 'translateY(-50%)' }, { transform: 'translateY(0)' }];
      const a = track.animate(frames, { duration: 450, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)', fill: 'forwards' });
      a.onfinish = () => { if (value === n) el.replaceChildren(line(n)); };
    },
  };
}

/** FLIP: runs `change`, then slides the children that stayed from where they were to where they are now. */
export function flip(container: HTMLElement, change: () => void): void {
  const before = new Map<string, DOMRect>();
  for (const c of Array.from(container.children) as HTMLElement[]) if (c.dataset.key) before.set(c.dataset.key, c.getBoundingClientRect());
  change();
  if (reducedMotion()) return;
  for (const c of Array.from(container.children) as HTMLElement[]) {
    const old = c.dataset.key ? before.get(c.dataset.key) : undefined;
    if (!old) continue;
    const now = c.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    const sx = old.width / now.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
    c.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx})` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' });
  }
}
