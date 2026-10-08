// Small static SVG icons shared by several screens (markup only, no user data).

/** Speaker icon that follows the volume: crossed out at 0, one wave when low, two waves when high. */
export function speakerSvg(volume: number): string {
  const cone = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>';
  const inner =
    volume === 0
      ? '<line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
      : volume < 50
        ? '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
        : '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cone}${inner}</svg>`;
}
