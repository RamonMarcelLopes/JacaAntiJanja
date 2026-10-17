// Same hyperscript helper as Jaca anti Janja (src/renderer/dom.ts), plus a tiny wrapper around the lucide icons.
import { createElement, type IconNode } from 'lucide';

type Child = Node | string | null | undefined | false;
type Props = Record<string, any>;

/** Minimal hyperscript helper. Text is always inserted as text nodes, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) (sk.startsWith('--') ? el.style.setProperty(sk, String(sv)) : ((el.style as any)[sk] = sv));
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
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

export const icon = (node: IconNode, size = 18, cls = ''): SVGElement => createElement(node, { width: size, height: size, class: cls, 'stroke-width': 2 }) as SVGElement;

/** Closes an element with its exit animation ("closing" class) and removes it afterwards. */
export function dismiss(el: HTMLElement, ms = 260): void {
  if (!el.isConnected || el.classList.contains('closing')) return;
  el.classList.add('closing');
  window.setTimeout(() => el.remove(), ms);
}

export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const initials = (name: string) => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const reducedMotion = () => document.documentElement.classList.contains('no-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
