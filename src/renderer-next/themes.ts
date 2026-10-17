// The ten accent colors the person can pick (soft, pastel tones; no purple or pink). The first one is the default.
import { reducedMotion } from './dom';

export interface Theme { label: string; value: string }
export const THEMES: Theme[] = [
  { label: 'Verde', value: '#9CFF8C' },
  { label: 'Menta', value: '#A8F0CF' },
  { label: 'Pistache', value: '#D0F09C' },
  { label: 'Amarelo', value: '#FFE08C' },
  { label: 'Damasco', value: '#FFC99E' },
  { label: 'Coral', value: '#FF9A8A' },
  { label: 'Azul', value: '#8CB8FF' },
  { label: 'Céu', value: '#A9DDF7' },
  { label: 'Ciano / água', value: '#8CFFE0' },
  { label: 'Areia', value: '#EADFC4' },
];

const KEY = 'jaca-ui-accent';
/** The color the new interface starts with, until the person picks another: green. */
export const DEFAULT_THEME = THEMES.find((t) => t.label === 'Verde')!.value;
let current = DEFAULT_THEME;

export const currentTheme = () => current;

export function loadTheme(): void {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && THEMES.some((t) => t.value === saved)) current = saved;
  } catch { /* storage may be unavailable */ }
  document.documentElement.style.setProperty('--accent', current);
}

/** Changes the accent. With an origin, the new color grows as a circle from that point (View Transitions API). */
export function setTheme(value: string, origin?: { x: number; y: number }): void {
  current = value;
  try { localStorage.setItem(KEY, value); } catch { /* ignore */ }
  const apply = () => document.documentElement.style.setProperty('--accent', value);
  const doc = document as any;
  if (origin && typeof doc.startViewTransition === 'function' && !reducedMotion()) {
    document.documentElement.style.setProperty('--vx', `${origin.x}px`);
    document.documentElement.style.setProperty('--vy', `${origin.y}px`);
    doc.startViewTransition(apply);
  } else apply();
  window.dispatchEvent(new CustomEvent('themechange', { detail: value }));
}
